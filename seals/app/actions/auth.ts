"use server";

import { headers } from "next/headers";
import type { AuthSession } from "@/models/auth";
import type { UserRole } from "@/models/user";
import {
    createSupabaseServerClient,
    createSupabaseServiceRoleClient,
    resolveSupabaseServerSession,
} from "@/models/supabase/server";
import { deleteServerSession } from "@/lib/serverSession";
import {
    validateLoginInput,
    validateSignupInput,
    type ValidationFieldErrors,
} from "@/lib/validation";

export interface AuthActionResponse {
    ok: boolean;
    session?: AuthSession;
    tokens?: { accessToken: string; refreshToken: string };
    error?: string;
    fieldErrors?: ValidationFieldErrors;
    requiresEmailConfirmation?: boolean;
    message?: string;
}

const UNIFORM_LOGIN_ERROR = "Invalid email/username or password.";
const MAX_LOGIN_ATTEMPTS = 10;
const WINDOW_MS = 60_000;
const loginAttempts = new Map<string, number[]>();

async function isLoginRateLimited(normalizedIdentifier: string): Promise<boolean> {
    let clientIp = "unknown";
    try {
        const headerStore = await headers();
        const forwardedFor = headerStore.get("x-forwarded-for");
        clientIp = forwardedFor?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || "unknown";
    } catch {
        // Ignore when called outside a Next.js request context (e.g., unit tests).
    }

    const key = `${normalizedIdentifier}:${clientIp}`;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const recent = (loginAttempts.get(key) ?? []).filter((ts) => ts > windowStart);

    if (recent.length >= MAX_LOGIN_ATTEMPTS) {
        loginAttempts.set(key, recent);
        return true;
    }

    recent.push(now);
    loginAttempts.set(key, recent);
    return false;
}

/** Server Action: validates credentials with Zod, signs in via Supabase Auth, and resolves the server session. */
export async function loginServerAction(input: {
    identifier: string;
    password: string;
}): Promise<AuthActionResponse> {
    const validation = validateLoginInput(input);
    if (!validation.ok) {
        return {
            ok: false,
            error: validation.error,
            fieldErrors: validation.fieldErrors,
        };
    }

    const normalizedIdentifier = validation.data.identifier.trim().toLowerCase();
    if (await isLoginRateLimited(normalizedIdentifier)) {
        return {
            ok: false,
            error: "Too many sign-in attempts. Please wait a minute and try again.",
        };
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
        return {
            ok: false,
            error: "Supabase Auth is not configured on this environment.",
        };
    }

    let email: string;
    if (normalizedIdentifier.includes("@")) {
        email = normalizedIdentifier;
    } else {
        const username = normalizedIdentifier === "guardian" ? "kyle" : normalizedIdentifier === "child" ? "lily" : normalizedIdentifier;
        const rpcClient = createSupabaseServiceRoleClient() ?? supabase;
        const { data: resolvedEmail, error: lookupError } = await rpcClient.rpc("resolve_login_email", {
            p_identifier: username,
        });
        if (lookupError || !resolvedEmail) {
            return {
                ok: false,
                error: UNIFORM_LOGIN_ERROR,
            };
        }
        email = resolvedEmail.trim().toLowerCase();
    }

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: validation.data.password,
    });

    if (error || !data.user) {
        return {
            ok: false,
            error: UNIFORM_LOGIN_ERROR,
        };
    }

    await deleteServerSession();

    const session = await resolveSupabaseServerSession({
        client: supabase,
        user: data.user,
        expiresAt: data.session?.expires_at,
    });
    if (!session) {
        return {
            ok: false,
            error: "Unable to resolve authenticated session.",
        };
    }

    return {
        ok: true,
        session,
        tokens: data.session
            ? {
                  accessToken: data.session.access_token,
                  refreshToken: data.session.refresh_token,
              }
            : undefined,
    };
}

/** Server Action: validates registration fields with Zod, whitelists guardian role server-side, and registers via Supabase Auth. */
export async function signupServerAction(input: {
    name: string;
    username: string;
    email?: string;
    role?: UserRole;
    password: string;
    confirmPassword: string;
}): Promise<AuthActionResponse> {
    const guardianRole: "PARENT" | "CAREGIVER" = input.role === "PARENT" ? "PARENT" : "CAREGIVER";
    const validation = validateSignupInput({
        ...input,
        email: input.email ?? "",
        role: guardianRole,
    });
    if (!validation.ok) {
        return {
            ok: false,
            error: validation.error,
            fieldErrors: validation.fieldErrors,
        };
    }

    if (!validation.data.email) {
        return {
            ok: false,
            error: "Email address is required for account registration.",
            fieldErrors: {
                email: ["Email address is required."],
            },
        };
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
        return {
            ok: false,
            error: "Supabase Auth is not configured on this environment.",
        };
    }

    const { data, error } = await supabase.auth.signUp({
        email: validation.data.email,
        password: validation.data.password,
        options: {
            data: {
                name: validation.data.name,
                username: validation.data.username,
                guardian_type: guardianRole,
            },
        },
    });

    if (error || !data.user) {
        return {
            ok: false,
            error: error?.message || "Unable to register account.",
        };
    }

    if ((Array.isArray(data.user.identities) && data.user.identities.length === 0) || !data.session) {
        return {
            ok: true,
            requiresEmailConfirmation: true,
            message: "Check your email to confirm your account before signing in.",
        };
    }

    await deleteServerSession();

    const session = await resolveSupabaseServerSession({
        client: supabase,
        user: data.user,
        expiresAt: data.session.expires_at,
    });
    if (!session) {
        return {
            ok: false,
            error: "Account created, but session could not be verified.",
        };
    }

    return {
        ok: true,
        session,
        tokens: {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
        },
    };
}

/** Server Action: signs out of Supabase Auth locally on this device and clears any legacy session cookie. */
export async function logoutServerAction(): Promise<{ ok: boolean }> {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
        await supabase.auth.signOut({ scope: "local" });
    }
    await deleteServerSession();
    return { ok: true };
}

/** Server Action: verifies the active Supabase Auth session on the server. */
export async function verifySessionServerAction(): Promise<{
    ok: boolean;
    session: AuthSession | null;
}> {
    const session = await resolveSupabaseServerSession();
    return { ok: Boolean(session), session };
}
