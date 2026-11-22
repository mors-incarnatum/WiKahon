"use server";

import crypto from "node:crypto";
import { isGuardianRole, type ProvisionedChildAccount } from "@/models/auth";
import {
    createSupabaseServiceRoleClient,
    resolveSupabaseServerSession,
} from "@/models/supabase/server";
import { validateChildProvisionInput, type ValidationFieldErrors } from "@/lib/validation";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireGuardianAdminContext() {
    const session = await resolveSupabaseServerSession();
    if (!session || session.source !== "supabase" || !isGuardianRole(session.user.role)) {
        return {
            ok: false as const,
            error: "Only signed-in guardians can manage child accounts.",
        };
    }

    const adminClient = createSupabaseServiceRoleClient();
    if (!adminClient) {
        return {
            ok: false as const,
            error: "Child account provisioning requires SUPABASE_SERVICE_ROLE_KEY on the server.",
        };
    }

    return { ok: true as const, session, adminClient };
}

/** Server Action: lists CHILD accounts linked as viewers on any cloud profile owned by the signed-in guardian. */
export async function listProvisionedChildAccountsServerAction(): Promise<{
    ok: boolean;
    children: ProvisionedChildAccount[];
    error?: string;
}> {
    const ctx = await requireGuardianAdminContext();
    if (!ctx.ok) {
        return { ok: false, children: [], error: ctx.error };
    }

    const { adminClient, session } = ctx;
    const { data: ownedProfiles, error: profilesError } = await adminClient
        .from("profiles")
        .select("id, name")
        .eq("owner_id", session.user.id)
        .order("id");

    if (profilesError) {
        return { ok: false, children: [], error: profilesError.message };
    }

    if (!ownedProfiles || ownedProfiles.length === 0) {
        return { ok: true, children: [] };
    }

    const profileNameById = new Map(ownedProfiles.map(p => [p.id, p.name]));
    const ownedIds = ownedProfiles.map(p => p.id);

    const { data: memberships, error: membershipError } = await adminClient
        .from("profile_memberships")
        .select("profile_id, user_id, role")
        .in("profile_id", ownedIds)
        .eq("role", "viewer");

    if (membershipError) {
        return { ok: false, children: [], error: membershipError.message };
    }

    if (!memberships || memberships.length === 0) {
        return { ok: true, children: [] };
    }

    const uniqueUserIds = [...new Set(memberships.map(m => m.user_id))];
    const { data: childAccounts, error: accountsError } = await adminClient
        .from("user_accounts")
        .select("user_id, username, display_name, role")
        .in("user_id", uniqueUserIds)
        .eq("role", "CHILD");

    if (accountsError) {
        return { ok: false, children: [], error: accountsError.message };
    }

    const accountById = new Map((childAccounts ?? []).map(a => [a.user_id, a]));
    const children: ProvisionedChildAccount[] = [];
    for (const m of memberships) {
        const account = accountById.get(m.user_id);
        if (!account) continue;
        children.push({
            userId: account.user_id,
            username: account.username,
            name: account.display_name,
            profileId: m.profile_id,
            profileName: profileNameById.get(m.profile_id) ?? "Board profile",
        });
    }

    children.sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username));
    return { ok: true, children };
}

/** Server Action: creates a CHILD Supabase Auth user + user_accounts row and grants viewer access to an owned cloud profile. */
export async function provisionChildAccountServerAction(input: {
    name: string;
    username: string;
    email?: string;
    password: string;
    confirmPassword: string;
    profileId: string;
}): Promise<{
    ok: boolean;
    child?: ProvisionedChildAccount;
    error?: string;
    fieldErrors?: ValidationFieldErrors;
}> {
    const ctx = await requireGuardianAdminContext();
    if (!ctx.ok) {
        return { ok: false, error: ctx.error };
    }

    const validation = validateChildProvisionInput({
        ...input,
        email: input.email ?? "",
    });
    if (!validation.ok) {
        return {
            ok: false,
            error: validation.error,
            fieldErrors: validation.fieldErrors,
        };
    }

    const { adminClient, session } = ctx;
    const data = validation.data;

    const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("id, owner_id, name")
        .eq("id", data.profileId)
        .maybeSingle();

    if (profileError) {
        return { ok: false, error: profileError.message };
    }
    if (!profile || profile.owner_id !== session.user.id) {
        return {
            ok: false,
            error: "You can only assign child accounts to cloud profiles you own.",
            fieldErrors: { profileId: ["Select a cloud profile you own."] },
        };
    }

    const { data: existingUsername, error: usernameError } = await adminClient
        .from("user_accounts")
        .select("user_id")
        .eq("username", data.username)
        .maybeSingle();

    if (usernameError) {
        return { ok: false, error: usernameError.message };
    }
    if (existingUsername) {
        return {
            ok: false,
            error: "That username is already taken.",
            fieldErrors: { username: ["That username is already taken."] },
        };
    }

    const resolvedEmail = data.email
        ? data.email
        : `${data.username}.${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}@child.wikahon.app`;

    const { data: createdAuth, error: createUserError } = await adminClient.auth.admin.createUser({
        email: resolvedEmail,
        password: data.password,
        email_confirm: true,
        app_metadata: {
            role: "CHILD",
            username: data.username,
            name: data.name,
        },
        user_metadata: {
            username: data.username,
            name: data.name,
        },
    });

    if (createUserError || !createdAuth.user) {
        const msg = createUserError?.message ?? "Could not create child account.";
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes("already been registered") || lowerMsg.includes("email_exists")) {
            return {
                ok: false,
                error: "An account with that email already exists.",
                fieldErrors: { email: ["An account with that email already exists."] },
            };
        }
        if (lowerMsg.includes("password") || lowerMsg.includes("weak_password")) {
            return {
                ok: false,
                error: msg,
                fieldErrors: { password: [msg] },
            };
        }
        return { ok: false, error: msg };
    }

    const createdUser = createdAuth.user;

    const { error: accountUpsertError } = await adminClient.from("user_accounts").upsert(
        {
            user_id: createdUser.id,
            username: data.username,
            display_name: data.name,
            role: "CHILD",
        },
        { onConflict: "user_id" },
    );

    if (accountUpsertError) {
        await adminClient.auth.admin.deleteUser(createdUser.id).catch(() => undefined);
        if (accountUpsertError.code === "23505") {
            return {
                ok: false,
                error: "That username is already taken.",
                fieldErrors: { username: ["That username is already taken."] },
            };
        }
        return { ok: false, error: accountUpsertError.message };
    }

    const { error: membershipError } = await adminClient.from("profile_memberships").upsert(
        {
            profile_id: profile.id,
            user_id: createdUser.id,
            role: "viewer",
        },
        { onConflict: "profile_id,user_id" },
    );

    if (membershipError) {
        await adminClient.auth.admin.deleteUser(createdUser.id).catch(() => undefined);
        return { ok: false, error: "Could not link child account to the board profile." };
    }

    return {
        ok: true,
        child: {
            userId: createdUser.id,
            username: data.username,
            name: data.name,
            profileId: profile.id,
            profileName: profile.name,
        },
    };
}

/** Server Action: removes a CHILD user's viewer membership from an owned cloud profile. */
export async function removeChildProfileAccessServerAction(input: {
    profileId: string;
    childUserId: string;
}): Promise<{ ok: boolean; error?: string }> {
    const ctx = await requireGuardianAdminContext();
    if (!ctx.ok) {
        return { ok: false, error: ctx.error };
    }

    const profileId = input.profileId.trim();
    const childUserId = input.childUserId.trim();
    if (!UUID_REGEX.test(profileId) || !UUID_REGEX.test(childUserId)) {
        return { ok: false, error: "Invalid profile or child account identifier." };
    }

    const { adminClient, session } = ctx;

    const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("id, owner_id")
        .eq("id", profileId)
        .maybeSingle();

    if (profileError) {
        return { ok: false, error: profileError.message };
    }
    if (!profile || profile.owner_id !== session.user.id) {
        return { ok: false, error: "You can only manage access for cloud profiles you own." };
    }

    const { data: account, error: accountError } = await adminClient
        .from("user_accounts")
        .select("user_id, role")
        .eq("user_id", childUserId)
        .maybeSingle();

    if (accountError) {
        return { ok: false, error: accountError.message };
    }
    if (!account || account.role !== "CHILD") {
        return { ok: false, error: "Target user is not a child account." };
    }

    const { error: deleteError } = await adminClient
        .from("profile_memberships")
        .delete()
        .eq("profile_id", profileId)
        .eq("user_id", childUserId);

    if (deleteError) {
        return { ok: false, error: deleteError.message };
    }

    return { ok: true };
}
