import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV_VARS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WIKAHON_KYLE_EMAIL",
    "WIKAHON_KYLE_PASSWORD",
    "WIKAHON_LILY_EMAIL",
    "WIKAHON_LILY_PASSWORD",
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEnv() {
    const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());
    if (missing.length > 0) {
        console.error(
            `Missing required environment variable(s): ${missing.join(", ")}. ` +
                "Provide them via your shell or environment before running this script.",
        );
        process.exit(1);
    }

    const defaultProfileId = process.env.WIKAHON_DEFAULT_PROFILE_ID?.trim() || null;
    if (defaultProfileId && !UUID_REGEX.test(defaultProfileId)) {
        console.error("WIKAHON_DEFAULT_PROFILE_ID must be a valid UUID when provided.");
        process.exit(1);
    }

    return {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL.trim(),
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
        kyle: {
            email: process.env.WIKAHON_KYLE_EMAIL.trim(),
            password: process.env.WIKAHON_KYLE_PASSWORD,
            role: "CAREGIVER",
            username: "kyle",
            name: "Kyle",
        },
        lily: {
            email: process.env.WIKAHON_LILY_EMAIL.trim(),
            password: process.env.WIKAHON_LILY_PASSWORD,
            role: "CHILD",
            username: "lily",
            name: "Lily",
        },
        defaultProfileId,
    };
}

async function listAuthUsersByEmail(supabase, targetEmails) {
    const wanted = new Set(targetEmails.map((email) => email.toLowerCase()));
    const found = new Map();
    const perPage = 1000;

    for (let page = 1; ; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) {
            throw new Error(`Failed to list Supabase Auth users (page ${page}): ${error.message}`);
        }

        const users = data?.users ?? [];
        for (const user of users) {
            const normalizedEmail = user.email?.toLowerCase();
            if (normalizedEmail && wanted.has(normalizedEmail)) {
                found.set(normalizedEmail, user);
            }
        }

        if (found.size === wanted.size || users.length < perPage) {
            break;
        }
    }

    return found;
}

async function verifyUsernameAvailability(supabase, expectedUsers) {
    const { data: existingAccounts, error } = await supabase
        .from("user_accounts")
        .select("user_id, username")
        .in(
            "username",
            expectedUsers.map((u) => u.username),
        );

    if (error) {
        throw new Error(`Failed to verify username availability in user_accounts: ${error.message}`);
    }

    const expectedByUsername = new Map(expectedUsers.map((u) => [u.username, u]));
    for (const row of existingAccounts ?? []) {
        const spec = expectedByUsername.get(row.username);
        if (!spec) {
            continue;
        }
        const existingAuthUser = spec.existingAuthUser;
        if (!existingAuthUser || row.user_id !== existingAuthUser.id) {
            throw new Error(
                `Refusing to provision '${spec.username}': username is already assigned to a different user_id (${row.user_id}) in public.user_accounts.`,
            );
        }
    }
}

async function ensureAuthUser(supabase, existingUser, spec) {
    const metadata = {
        ...(existingUser?.app_metadata ?? {}),
        role: spec.role,
        username: spec.username,
        name: spec.name,
        ...(spec.guardianId ? { guardian_id: spec.guardianId } : {}),
    };
    const userMetadata = {
        ...(existingUser?.user_metadata ?? {}),
        username: spec.username,
        name: spec.name,
        guardian_type: spec.role,
    };

    if (existingUser) {
        const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, {
            email: spec.email,
            password: spec.password,
            email_confirm: true,
            app_metadata: metadata,
            user_metadata: userMetadata,
        });
        if (error || !data?.user) {
            throw new Error(`Failed to update Auth user '${spec.username}': ${error?.message ?? "unknown error"}`);
        }
        return data.user;
    }

    const { data, error } = await supabase.auth.admin.createUser({
        email: spec.email,
        password: spec.password,
        email_confirm: true,
        app_metadata: metadata,
        user_metadata: userMetadata,
    });
    if (error || !data?.user) {
        throw new Error(`Failed to create Auth user '${spec.username}': ${error?.message ?? "unknown error"}`);
    }
    return data.user;
}

async function upsertUserAccount(supabase, userId, spec) {
    const payload = {
        user_id: userId,
        username: spec.username,
        display_name: spec.name,
        role: spec.role,
        ...(spec.guardianId ? { guardian_id: spec.guardianId } : {}),
    };

    const { error } = await supabase.from("user_accounts").upsert(
        payload,
        { onConflict: "user_id" },
    );

    if (error) {
        throw new Error(`Failed to upsert user_accounts row for '${spec.username}': ${error.message}`);
    }
}

async function ensureDefaultProfile(supabase, ownerId, defaultProfileId) {
    if (defaultProfileId) {
        const { data: existingById, error: lookupError } = await supabase
            .from("profiles")
            .select("id, owner_id, name")
            .eq("id", defaultProfileId)
            .maybeSingle();

        if (lookupError) {
            throw new Error(`Failed to look up WIKAHON_DEFAULT_PROFILE_ID: ${lookupError.message}`);
        }

        if (existingById) {
            if (existingById.owner_id !== ownerId) {
                throw new Error(
                    `Refusing to reassign profile ${existingById.id}: owned by ${existingById.owner_id}, expected Kyle (${ownerId}).`,
                );
            }
            return existingById;
        }

        const { data: insertedWithId, error: insertWithIdError } = await supabase
            .from("profiles")
            .insert({ id: defaultProfileId, owner_id: ownerId, name: "Lily's Board" })
            .select("id, owner_id, name")
            .single();

        if (insertWithIdError || !insertedWithId) {
            throw new Error(
                `Failed to create profile for WIKAHON_DEFAULT_PROFILE_ID: ${insertWithIdError?.message ?? "unknown error"}`,
            );
        }
        return insertedWithId;
    }

    const { data: existingOwnedList, error: ownedError } = await supabase
        .from("profiles")
        .select("id, owner_id, name")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: true })
        .limit(2);

    if (ownedError) {
        throw new Error(`Failed to query existing profiles for Kyle: ${ownedError.message}`);
    }

    const ownedProfiles = existingOwnedList ?? [];
    if (ownedProfiles.length > 1) {
        throw new Error(
            `Multiple existing profiles found for Kyle (${ownerId}). Set WIKAHON_DEFAULT_PROFILE_ID explicitly to select which profile to link.`,
        );
    }

    if (ownedProfiles.length === 1) {
        return ownedProfiles[0];
    }

    const { data: created, error: createError } = await supabase
        .from("profiles")
        .insert({ owner_id: ownerId, name: "Lily's Board" })
        .select("id, owner_id, name")
        .single();

    if (createError || !created) {
        throw new Error(`Failed to create default board profile: ${createError?.message ?? "unknown error"}`);
    }
    return created;
}

async function main() {
    const config = readEnv();
    const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const existingByEmail = await listAuthUsersByEmail(supabase, [
        config.kyle.email,
        config.lily.email,
    ]);

    await verifyUsernameAvailability(supabase, [
        { ...config.kyle, existingAuthUser: existingByEmail.get(config.kyle.email.toLowerCase()) },
        { ...config.lily, existingAuthUser: existingByEmail.get(config.lily.email.toLowerCase()) },
    ]);

    const kyleUser = await ensureAuthUser(
        supabase,
        existingByEmail.get(config.kyle.email.toLowerCase()),
        config.kyle,
    );
    const lilySpec = { ...config.lily, guardianId: kyleUser.id };
    const lilyUser = await ensureAuthUser(
        supabase,
        existingByEmail.get(config.lily.email.toLowerCase()),
        lilySpec,
    );

    await Promise.all([
        upsertUserAccount(supabase, kyleUser.id, config.kyle),
        upsertUserAccount(supabase, lilyUser.id, lilySpec),
    ]);

    const profile = await ensureDefaultProfile(supabase, kyleUser.id, config.defaultProfileId);

    const { error: membershipError } = await supabase.from("profile_memberships").upsert(
        {
            profile_id: profile.id,
            user_id: lilyUser.id,
            role: "viewer",
        },
        { onConflict: "profile_id,user_id" },
    );

    if (membershipError) {
        throw new Error(`Failed to upsert Lily's profile membership: ${membershipError.message}`);
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                users: [
                    { userId: kyleUser.id, username: config.kyle.username, role: config.kyle.role },
                    { userId: lilyUser.id, username: config.lily.username, role: config.lily.role },
                ],
                profile: {
                    id: profile.id,
                    ownerId: profile.owner_id,
                    viewerId: lilyUser.id,
                },
            },
            null,
            2,
        ),
    );
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
