
import type { User } from "@supabase/supabase-js";
import { parseServerRole, type AuthSession } from "@/models/auth";

export interface UserAccountProfileRow {
    username: string;
    display_name: string;
    role: string;
}

function firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed.length > 0) return trimmed;
        }
    }
    return "";
}

/**
 * Pure mapper from a Supabase Auth user and optional `user_accounts` row to an AuthSession.
 * Role is sourced strictly from `user_accounts.role` or `app_metadata.role` (never `user_metadata`).
 */
export function mapSupabaseUserToSession(
    user: User,
    accountRow: UserAccountProfileRow | null,
    expiresAtSec?: number | null,
): AuthSession {
    const role = parseServerRole(accountRow?.role || user.app_metadata?.role);
    const emailLocal = user.email ? user.email.split("@")[0].trim() : "";

    const username =
        firstNonEmptyString(
            accountRow?.username,
            user.user_metadata?.username,
            user.app_metadata?.username,
            emailLocal,
        ) || user.id;

    const name =
        firstNonEmptyString(
            accountRow?.display_name,
            user.user_metadata?.name,
            user.app_metadata?.name,
            emailLocal,
        ) || "User";

    const expiresAt =
        typeof expiresAtSec === "number" && Number.isFinite(expiresAtSec) && expiresAtSec > 0
            ? new Date(expiresAtSec * 1000).toISOString()
            : undefined;

    return {
        user: {
            id: user.id,
            name,
            email: user.email ?? null,
            role,
        },
        username,
        ...(expiresAt ? { expiresAt } : {}),
        source: "supabase",
    };
}
