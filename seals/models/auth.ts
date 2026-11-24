import type { User, UserRole } from "./user";

export interface AuthSession {
    user: User;
    username: string;
    expiresAt?: string;
    source?: "supabase" | "local-child";
}

export interface ProvisionedChildAccount {
    userId: string;
    username: string;
    name: string;
    profileId: string | null;
    profileName: string | null;
}

/** Built-in offline AAC session used when continuing as Child without cloud sign-in. */
export const LOCAL_CHILD_SESSION: AuthSession = {
    user: {
        id: "local-child-lily",
        name: "Lily",
        email: null,
        role: "CHILD",
    },
    username: "lily",
    source: "local-child",
};

/** Returns true when the role has guardian editing permissions. */
export function isGuardianRole(role: UserRole | null | undefined): boolean {
    return role === "PARENT" || role === "CAREGIVER";
}

/** Normalizes a server-supplied role value to a valid UserRole, defaulting to "CHILD". */
export function parseServerRole(value: unknown): UserRole {
    if (typeof value === "string") {
        const normalized = value.trim().toUpperCase();
        if (normalized === "PARENT" || normalized === "CAREGIVER" || normalized === "CHILD") {
            return normalized;
        }
    }
    return "CHILD";
}
