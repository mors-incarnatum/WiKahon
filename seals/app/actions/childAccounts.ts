"use server";

import crypto from "node:crypto";
import { isGuardianRole, type ProvisionedChildAccount } from "@/models/auth";
import {
    createSupabaseServiceRoleClient,
    resolveSupabaseServerSession,
} from "@/models/supabase/server";
import type { BoardSupabaseClient } from "@/models/supabase/client";
import {
    validateChildPasswordResetInput,
    validateChildProvisionInput,
    validateChildUpdateInput,
    type ValidationFieldErrors,
} from "@/lib/validation";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SupabaseErrorLike = { code?: string; message?: string } | null | undefined;

interface ChildAccountRow {
    user_id: string;
    username: string;
    display_name: string;
    role: string;
    guardian_id?: string | null;
}

function isMissingGuardianColumnError(error: SupabaseErrorLike): boolean {
    if (!error) return false;
    return error.code === "42703" || (error.message ?? "").includes("guardian_id");
}

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

async function fetchOwnedProfiles(adminClient: BoardSupabaseClient, guardianUserId: string) {
    return adminClient
        .from("profiles")
        .select("id, name")
        .eq("owner_id", guardianUserId)
        .order("id");
}

async function fetchChildAccountById(adminClient: BoardSupabaseClient, childUserId: string): Promise<{
    ok: boolean;
    account?: ChildAccountRow | null;
    hasGuardianColumn: boolean;
    error?: string;
}> {
    const withGuardian = await adminClient
        .from("user_accounts")
        .select("user_id, username, display_name, role, guardian_id")
        .eq("user_id", childUserId)
        .maybeSingle();

    if (!withGuardian.error) {
        return { ok: true, account: withGuardian.data, hasGuardianColumn: true };
    }

    if (!isMissingGuardianColumnError(withGuardian.error)) {
        return { ok: false, hasGuardianColumn: true, error: withGuardian.error.message };
    }

    const fallback = await adminClient
        .from("user_accounts")
        .select("user_id, username, display_name, role")
        .eq("user_id", childUserId)
        .maybeSingle();

    if (fallback.error) {
        return { ok: false, hasGuardianColumn: false, error: fallback.error.message };
    }

    return { ok: true, account: fallback.data, hasGuardianColumn: false };
}

async function verifyGuardianOwnsChild(
    adminClient: BoardSupabaseClient,
    guardianUserId: string,
    childUserId: string,
): Promise<{
    ok: true;
    account: ChildAccountRow;
    ownedProfiles: Array<{ id: string; name: string }>;
    hasGuardianColumn: boolean;
} | { ok: false; error: string }> {
    const accountRes = await fetchChildAccountById(adminClient, childUserId);
    if (!accountRes.ok) {
        return { ok: false, error: accountRes.error ?? "Could not verify child account." };
    }
    const account = accountRes.account;
    if (!account || account.role !== "CHILD") {
        return { ok: false, error: "Target user is not a child account." };
    }

    const { data: ownedProfiles, error: profilesError } = await fetchOwnedProfiles(adminClient, guardianUserId);
    if (profilesError) {
        return { ok: false, error: profilesError.message };
    }
    const owned = ownedProfiles ?? [];

    if (account.guardian_id) {
        if (account.guardian_id !== guardianUserId) {
            return { ok: false, error: "You do not have permission to manage this child account." };
        }
        return { ok: true, account, ownedProfiles: owned, hasGuardianColumn: accountRes.hasGuardianColumn };
    }

    const ownedIds = owned.map(p => p.id);
    if (ownedIds.length > 0) {
        const { data: memberships, error: membershipError } = await adminClient
            .from("profile_memberships")
            .select("profile_id")
            .eq("user_id", childUserId)
            .eq("role", "viewer")
            .in("profile_id", ownedIds)
            .limit(1);

        if (membershipError) {
            return { ok: false, error: membershipError.message };
        }
        if (memberships && memberships.length > 0) {
            return { ok: true, account, ownedProfiles: owned, hasGuardianColumn: accountRes.hasGuardianColumn };
        }
    }

    const { data: authUserRes, error: authError } = await adminClient.auth.admin.getUserById(childUserId);
    if (!authError && authUserRes.user?.app_metadata?.guardian_id === guardianUserId) {
        return { ok: true, account, ownedProfiles: owned, hasGuardianColumn: accountRes.hasGuardianColumn };
    }

    return { ok: false, error: "You do not have permission to manage this child account." };
}

/** Server Action: lists CHILD accounts owned by the signed-in guardian (directly or via legacy board memberships). */
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
    const { data: ownedProfiles, error: profilesError } = await fetchOwnedProfiles(adminClient, session.user.id);
    if (profilesError) {
        return { ok: false, children: [], error: profilesError.message };
    }

    const owned = ownedProfiles ?? [];
    const profileNameById = new Map(owned.map(p => [p.id, p.name]));
    const ownedIds = owned.map(p => p.id);

    const membershipsByUserId = new Map<string, string>();
    if (ownedIds.length > 0) {
        const { data: memberships, error: membershipError } = await adminClient
            .from("profile_memberships")
            .select("profile_id, user_id, role")
            .in("profile_id", ownedIds)
            .eq("role", "viewer");

        if (membershipError) {
            return { ok: false, children: [], error: membershipError.message };
        }

        const profileOrder = new Map(owned.map((p, index) => [p.id, index]));
        const sortedMemberships = [...(memberships ?? [])].sort(
            (a, b) => (profileOrder.get(a.profile_id) ?? 0) - (profileOrder.get(b.profile_id) ?? 0),
        );
        for (const m of sortedMemberships) {
            if (!membershipsByUserId.has(m.user_id)) {
                membershipsByUserId.set(m.user_id, m.profile_id);
            }
        }
    }

    const accountsById = new Map<string, ChildAccountRow>();
    let hasGuardianColumn = true;

    const directRes = await adminClient
        .from("user_accounts")
        .select("user_id, username, display_name, role, guardian_id")
        .eq("role", "CHILD")
        .eq("guardian_id", session.user.id);

    if (directRes.error) {
        if (isMissingGuardianColumnError(directRes.error)) {
            hasGuardianColumn = false;
        } else {
            return { ok: false, children: [], error: directRes.error.message };
        }
    } else {
        for (const row of directRes.data ?? []) {
            accountsById.set(row.user_id, row);
        }
    }

    const membershipUserIds = [...membershipsByUserId.keys()].filter(id => !accountsById.has(id));
    if (membershipUserIds.length > 0) {
        const membershipAccountsRes = hasGuardianColumn
            ? await adminClient
                  .from("user_accounts")
                  .select("user_id, username, display_name, role, guardian_id")
                  .in("user_id", membershipUserIds)
                  .eq("role", "CHILD")
            : await adminClient
                  .from("user_accounts")
                  .select("user_id, username, display_name, role")
                  .in("user_id", membershipUserIds)
                  .eq("role", "CHILD");

        if (membershipAccountsRes.error) {
            return { ok: false, children: [], error: membershipAccountsRes.error.message };
        }

        for (const row of (membershipAccountsRes.data ?? []) as ChildAccountRow[]) {
            if (hasGuardianColumn && row.guardian_id && row.guardian_id !== session.user.id) {
                continue;
            }
            accountsById.set(row.user_id, row);
        }
    }

    const children: ProvisionedChildAccount[] = [];
    for (const account of accountsById.values()) {
        const assignedProfileId = membershipsByUserId.get(account.user_id) ?? null;
        children.push({
            userId: account.user_id,
            username: account.username,
            name: account.display_name,
            profileId: assignedProfileId,
            profileName: assignedProfileId ? (profileNameById.get(assignedProfileId) ?? "Board profile") : null,
        });
    }

    children.sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username));
    return { ok: true, children };
}

/** Server Action: creates a CHILD Supabase Auth user + user_accounts row and optionally grants viewer access to an owned cloud profile. */
export async function provisionChildAccountServerAction(input: {
    name: string;
    username: string;
    email?: string;
    password: string;
    confirmPassword: string;
    profileId?: string;
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
        profileId: input.profileId ?? "",
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

    let profile: { id: string; owner_id: string; name: string } | null = null;
    if (data.profileId) {
        const { data: foundProfile, error: profileError } = await adminClient
            .from("profiles")
            .select("id, owner_id, name")
            .eq("id", data.profileId)
            .maybeSingle();

        if (profileError) {
            return { ok: false, error: profileError.message };
        }
        if (!foundProfile || foundProfile.owner_id !== session.user.id) {
            return {
                ok: false,
                error: "You can only assign child accounts to cloud profiles you own.",
                fieldErrors: { profileId: ["Select a cloud profile you own."] },
            };
        }
        profile = foundProfile;
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
            guardian_id: session.user.id,
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

    // `on_auth_user_created` (`private.handle_new_auth_user`) inserts the
    // `public.user_accounts` row inside the `auth.users` transaction; verify
    // it with a lightweight PK read and skip the redundant upsert when exact.
    const accountRes = await fetchChildAccountById(adminClient, createdUser.id);
    if (!accountRes.ok) {
        await adminClient.auth.admin.deleteUser(createdUser.id).catch(() => undefined);
        return { ok: false, error: accountRes.error ?? "Could not verify child account." };
    }

    const existingAccount = accountRes.account;
    if (existingAccount && existingAccount.username !== data.username) {
        await adminClient.auth.admin.deleteUser(createdUser.id).catch(() => undefined);
        return {
            ok: false,
            error: "That username is already taken.",
            fieldErrors: { username: ["That username is already taken."] },
        };
    }

    const isTriggerRowComplete =
        existingAccount != null &&
        existingAccount.username === data.username &&
        existingAccount.display_name === data.name &&
        existingAccount.role === "CHILD" &&
        (!accountRes.hasGuardianColumn || existingAccount.guardian_id === session.user.id);

    if (!isTriggerRowComplete) {
        let { error: accountUpsertError } = await adminClient.from("user_accounts").upsert(
            {
                user_id: createdUser.id,
                username: data.username,
                display_name: data.name,
                role: "CHILD",
                guardian_id: session.user.id,
            },
            { onConflict: "user_id" },
        );

        if (accountUpsertError && isMissingGuardianColumnError(accountUpsertError)) {
            const fallbackRes = await adminClient.from("user_accounts").upsert(
                {
                    user_id: createdUser.id,
                    username: data.username,
                    display_name: data.name,
                    role: "CHILD",
                },
                { onConflict: "user_id" },
            );
            accountUpsertError = fallbackRes.error;
        }

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
    }

    if (profile) {
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
    }

    return {
        ok: true,
        child: {
            userId: createdUser.id,
            username: data.username,
            name: data.name,
            profileId: profile?.id ?? null,
            profileName: profile?.name ?? null,
        },
    };
}

/** Server Action: updates a child account's display name and assigned cloud board profile. */
export async function updateChildAccountServerAction(input: {
    childUserId: string;
    name: string;
    profileId?: string;
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

    const validation = validateChildUpdateInput({
        ...input,
        profileId: input.profileId ?? "",
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

    const ownership = await verifyGuardianOwnsChild(adminClient, session.user.id, data.childUserId);
    if (!ownership.ok) {
        return { ok: false, error: ownership.error };
    }

    let targetProfile: { id: string; name: string } | null = null;
    if (data.profileId) {
        const matched = ownership.ownedProfiles.find(p => p.id === data.profileId);
        if (!matched) {
            return {
                ok: false,
                error: "You can only assign child accounts to cloud profiles you own.",
                fieldErrors: { profileId: ["Select a cloud profile you own."] },
            };
        }
        targetProfile = matched;
    }

    const accountUpdatePayload: { display_name: string; guardian_id?: string } = {
        display_name: data.name,
    };
    if (ownership.hasGuardianColumn && !ownership.account.guardian_id) {
        accountUpdatePayload.guardian_id = session.user.id;
    }

    const { error: updateAccountError } = await adminClient
        .from("user_accounts")
        .update(accountUpdatePayload)
        .eq("user_id", data.childUserId);

    if (updateAccountError) {
        return { ok: false, error: updateAccountError.message };
    }

    const { data: existingAuth } = await adminClient.auth.admin.getUserById(data.childUserId);
    const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(data.childUserId, {
        user_metadata: {
            ...(existingAuth.user?.user_metadata ?? {}),
            username: ownership.account.username,
            name: data.name,
        },
        app_metadata: {
            ...(existingAuth.user?.app_metadata ?? {}),
            role: "CHILD",
            username: ownership.account.username,
            name: data.name,
            guardian_id: session.user.id,
        },
    });

    if (updateAuthError) {
        return { ok: false, error: updateAuthError.message };
    }

    const ownedIds = ownership.ownedProfiles.map(p => p.id);
    const otherOwnedIds = targetProfile ? ownedIds.filter(id => id !== targetProfile.id) : ownedIds;

    if (otherOwnedIds.length > 0) {
        const { error: removeOtherError } = await adminClient
            .from("profile_memberships")
            .delete()
            .eq("user_id", data.childUserId)
            .eq("role", "viewer")
            .in("profile_id", otherOwnedIds);

        if (removeOtherError) {
            return { ok: false, error: removeOtherError.message };
        }
    }

    if (targetProfile) {
        const { error: upsertMembershipError } = await adminClient.from("profile_memberships").upsert(
            {
                profile_id: targetProfile.id,
                user_id: data.childUserId,
                role: "viewer",
            },
            { onConflict: "profile_id,user_id" },
        );

        if (upsertMembershipError) {
            return { ok: false, error: upsertMembershipError.message };
        }
    }

    return {
        ok: true,
        child: {
            userId: data.childUserId,
            username: ownership.account.username,
            name: data.name,
            profileId: targetProfile?.id ?? null,
            profileName: targetProfile?.name ?? null,
        },
    };
}

/** Server Action: resets a guardian-owned child account's password. */
export async function resetChildPasswordServerAction(input: {
    childUserId: string;
    password: string;
    confirmPassword: string;
}): Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: ValidationFieldErrors;
}> {
    const ctx = await requireGuardianAdminContext();
    if (!ctx.ok) {
        return { ok: false, error: ctx.error };
    }

    const validation = validateChildPasswordResetInput(input);
    if (!validation.ok) {
        return {
            ok: false,
            error: validation.error,
            fieldErrors: validation.fieldErrors,
        };
    }

    const { adminClient, session } = ctx;
    const data = validation.data;

    const ownership = await verifyGuardianOwnsChild(adminClient, session.user.id, data.childUserId);
    if (!ownership.ok) {
        return { ok: false, error: ownership.error };
    }

    const { error: passwordError } = await adminClient.auth.admin.updateUserById(data.childUserId, {
        password: data.password,
    });

    if (passwordError) {
        const msg = passwordError.message;
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes("password") || lowerMsg.includes("weak_password")) {
            return { ok: false, error: msg, fieldErrors: { password: [msg] } };
        }
        return { ok: false, error: msg };
    }

    return { ok: true };
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

    const accountRes = await fetchChildAccountById(adminClient, childUserId);
    if (!accountRes.ok) {
        return { ok: false, error: accountRes.error ?? "Could not verify child account." };
    }
    if (!accountRes.account || accountRes.account.role !== "CHILD") {
        return { ok: false, error: "Target user is not a child account." };
    }

    if (accountRes.hasGuardianColumn && !accountRes.account.guardian_id) {
        await adminClient
            .from("user_accounts")
            .update({ guardian_id: session.user.id })
            .eq("user_id", childUserId)
            .is("guardian_id", null);
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

/** Server Action: permanently deletes a guardian-owned child account after checking no other guardian owns a linked profile. */
export async function deleteChildAccountServerAction(input: {
    childUserId: string;
}): Promise<{ ok: boolean; error?: string }> {
    const ctx = await requireGuardianAdminContext();
    if (!ctx.ok) {
        return { ok: false, error: ctx.error };
    }

    const childUserId = input.childUserId.trim();
    if (!UUID_REGEX.test(childUserId)) {
        return { ok: false, error: "Invalid child account identifier." };
    }

    const { adminClient, session } = ctx;
    const ownership = await verifyGuardianOwnsChild(adminClient, session.user.id, childUserId);
    if (!ownership.ok) {
        return { ok: false, error: ownership.error };
    }

    const { data: allMemberships, error: membershipsError } = await adminClient
        .from("profile_memberships")
        .select("profile_id")
        .eq("user_id", childUserId);

    if (membershipsError) {
        return { ok: false, error: membershipsError.message };
    }

    const membershipProfileIds = [...new Set((allMemberships ?? []).map(m => m.profile_id))];
    if (membershipProfileIds.length > 0) {
        const { data: linkedProfiles, error: linkedProfilesError } = await adminClient
            .from("profiles")
            .select("id, owner_id")
            .in("id", membershipProfileIds);

        if (linkedProfilesError) {
            return { ok: false, error: linkedProfilesError.message };
        }

        const hasForeignProfile = (linkedProfiles ?? []).some(p => p.owner_id !== session.user.id);
        if (hasForeignProfile) {
            return {
                ok: false,
                error: "This child account is linked to another guardian's board profile. Remove that profile access before deleting the account.",
            };
        }
    }

    const ownedIds = ownership.ownedProfiles.map(p => p.id);
    if (ownedIds.length > 0) {
        const { error: cleanupError } = await adminClient
            .from("profile_memberships")
            .delete()
            .eq("user_id", childUserId)
            .in("profile_id", ownedIds);

        if (cleanupError) {
            return { ok: false, error: cleanupError.message };
        }
    }

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(childUserId);
    if (deleteUserError) {
        return { ok: false, error: deleteUserError.message };
    }

    return { ok: true };
}
