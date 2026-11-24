import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { AuthSession } from "@/models/auth";
import type { BoardSupabaseClient } from "./client";
import type { Database } from "./database.types";
import { mapSupabaseUserToSession, type UserAccountProfileRow } from "./sessionMapper";

const RECOVERY_COOKIE_NAME = "wikahon-password-recovery";
const RECOVERY_COOKIE_MAX_AGE = 60 * 60;

/** Server-only privileged client for private RPCs (such as resolve_login_email) after revoking public anon grants. */
export function createSupabaseServiceRoleClient(): BoardSupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) return null;
    return createClient<Database>(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

/** Uses separate, server-only cookies so a recovery link cannot sign in to the board. */
export async function createSupabaseRecoveryClient(): Promise<BoardSupabaseClient | null> {
    return createSupabaseServerClient("recovery");
}

/** Creates a request-scoped Supabase client using Next.js server cookies. */
export async function createSupabaseServerClient(mode?: "recovery"): Promise<BoardSupabaseClient | null> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;

    const cookieStore = await cookies();
    return createServerClient<Database>(url, key, {
        cookieOptions: mode === "recovery" ? {
            name: RECOVERY_COOKIE_NAME,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
        } : undefined,
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
                try {
                    for (const { name, value, options } of cookiesToSet) {
                        cookieStore.set(name, value, mode === "recovery" && options.maxAge !== 0
                            ? { ...options, maxAge: RECOVERY_COOKIE_MAX_AGE }
                            : options);
                    }
                } catch {
                    // Server Components cannot mutate cookies during render; proxy.ts handles refresh.
                }
            },
        },
    });
}

/** Resolves the authenticated Supabase user and server-controlled role into an AuthSession. */
export async function resolveSupabaseServerSession(options?: {
    client?: BoardSupabaseClient | null;
    user?: User | null;
    expiresAt?: number | null;
}): Promise<AuthSession | null> {
    const client = options?.client ?? (await createSupabaseServerClient());
    if (!client) return null;

    try {
        let user = options?.user ?? null;
        let expiresAt = options?.expiresAt;

        if (!user) {
            const { data: userData, error: userError } = await client.auth.getUser();
            if (userError || !userData.user) return null;
            user = userData.user;

            if (expiresAt === undefined) {
                const { data: sessionData } = await client.auth.getSession();
                expiresAt = sessionData.session?.expires_at;
            }
        }

        let accountRow: UserAccountProfileRow | null = null;
        try {
            const { data, error } = await client
                .from("user_accounts")
                .select("username, display_name, role")
                .eq("user_id", user.id)
                .maybeSingle();
            if (!error && data) {
                accountRow = data;
            }
        } catch {
            // Gracefully fall back to app_metadata if user_accounts migration is not yet deployed.
        }

        return mapSupabaseUserToSession(user, accountRow, expiresAt);
    } catch {
        return null;
    }
}
