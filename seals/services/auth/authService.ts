import { logoutServerAction } from "@/app/actions/auth";
import type { AuthSession } from "@/models/auth";
import { getSupabaseBrowserClient, type BoardSupabaseClient } from "@/models/supabase/client";
import { mapSupabaseUserToSession, type UserAccountProfileRow } from "@/models/supabase/sessionMapper";
import type { StorageLike } from "@/services/storage/localProfileService";

export const LEGACY_AUTH_STORAGE_KEYS = [
    "wikahon-auth-session-v1",
    "wikahon-auth-accounts-v1",
] as const;
export const AUTH_BROADCAST_CHANNEL = "wikahon-auth-channel";
export const AUTH_BROADCAST_STORAGE_KEY = "wikahon-auth-event-v1";
export const PENDING_LOGOUT_STORAGE_KEY = "wikahon-pending-logout-v1";

type AuthBroadcastEventType = "SIGNED_OUT" | "SESSION_REFRESHED";

interface AuthBroadcastPayload {
    type: AuthBroadcastEventType;
    timestamp: number;
}

export interface AuthEventHandlers {
    onSignedOut: () => void;
    onSessionChanged?: (session: AuthSession | null) => void;
}

function getBrowserStorage(storage?: StorageLike | null): StorageLike | null {
    if (storage !== undefined) return storage;
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            return window.localStorage;
        }
    } catch {
        return null;
    }
    return null;
}

function parseBroadcastPayload(raw: unknown): AuthBroadcastPayload | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (
        (obj.type === "SIGNED_OUT" || obj.type === "SESSION_REFRESHED") &&
        typeof obj.timestamp === "number"
    ) {
        return { type: obj.type, timestamp: obj.timestamp };
    }
    return null;
}

export class AuthService {
    private storage: StorageLike | null;
    private pendingLogoutFallback = false;
    private pendingSignOutPromise: Promise<void> | null = null;
    private logoutEpoch = 0;

    constructor(
        storage?: StorageLike | null,
        private readonly getClient: () => BoardSupabaseClient | null = getSupabaseBrowserClient,
    ) {
        this.storage = getBrowserStorage(storage);
    }

    private getStorage(): StorageLike | null {
        return this.storage ?? getBrowserStorage();
    }

    markPendingLogout(userId?: string | null): void {
        const storage = this.getStorage();
        if (storage) {
            try {
                storage.setItem(
                    PENDING_LOGOUT_STORAGE_KEY,
                    JSON.stringify({ userId: userId ?? null, timestamp: Date.now() }),
                );
                this.pendingLogoutFallback = false;
                return;
            } catch {
                // Fall back to in-memory flag if storage write fails.
            }
        }
        this.pendingLogoutFallback = true;
    }

    clearPendingLogout(): void {
        this.logoutEpoch += 1;
        this.pendingLogoutFallback = false;
        const storage = this.getStorage();
        if (storage) {
            try {
                storage.removeItem(PENDING_LOGOUT_STORAGE_KEY);
            } catch {
                // Ignore storage removal errors.
            }
        }
    }

    hasPendingLogout(): boolean {
        const storage = this.getStorage();
        if (storage) {
            try {
                if (storage.getItem(PENDING_LOGOUT_STORAGE_KEY) !== null) {
                    return true;
                }
                return this.pendingLogoutFallback;
            } catch {
                return this.pendingLogoutFallback;
            }
        }
        return this.pendingLogoutFallback;
    }

    private clearBrowserAuthCookies(): void {
        if (typeof document === "undefined") return;
        try {
            const rawCookies = document.cookie ? document.cookie.split(";") : [];
            for (const entry of rawCookies) {
                const eqIndex = entry.indexOf("=");
                const name = (eqIndex >= 0 ? entry.slice(0, eqIndex) : entry).trim();
                if (name.startsWith("sb-")) {
                    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
                }
            }
        } catch {
            // Ignore cookie access errors.
        }
    }

    private async executeDeviceSignOut(epoch: number): Promise<void> {
        let localSucceeded = true;
        const client = this.getClient();
        if (client && this.logoutEpoch === epoch) {
            try {
                const { error } = await client.auth.signOut({ scope: "local" });
                if (error) {
                    localSucceeded = false;
                }
            } catch {
                localSucceeded = false;
            }
        }

        if (this.logoutEpoch !== epoch) return;
        this.clearBrowserAuthCookies();

        let serverSucceeded = false;
        try {
            const res = await logoutServerAction();
            serverSucceeded = Boolean(res?.ok);
        } catch {
            serverSucceeded = false;
        }

        if (this.logoutEpoch === epoch && localSucceeded && serverSucceeded) {
            this.clearPendingLogout();
        }
    }

    private broadcastEvent(type: AuthBroadcastEventType): void {
        const payload: AuthBroadcastPayload = { type, timestamp: Date.now() };
        if (typeof BroadcastChannel !== "undefined") {
            try {
                const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
                channel.postMessage(payload);
                channel.close();
            } catch {
                // Ignore BroadcastChannel errors in unsupported environments.
            }
        }
        const storage = this.getStorage();
        if (storage) {
            try {
                storage.setItem(AUTH_BROADCAST_STORAGE_KEY, JSON.stringify(payload));
            } catch {
                // Ignore storage write errors.
            }
        }
    }

    cleanupLegacyAuthStorage(): void {
        const storage = this.getStorage();
        if (storage) {
            for (const key of LEGACY_AUTH_STORAGE_KEYS) {
                try {
                    storage.removeItem(key);
                } catch {
                    // Ignore storage removal errors.
                }
            }
        }
        if (typeof document !== "undefined") {
            try {
                document.cookie = "wikahon_session=; Path=/; Max-Age=0; SameSite=Lax";
            } catch {
                // Ignore cookie write errors.
            }
        }
    }

    async getSession(): Promise<AuthSession | null> {
        const client = this.getClient();
        if (!client) return null;

        const [{ data: userData, error: userError }, { data: sessionData }] = await Promise.all([
            client.auth.getUser(),
            client.auth.getSession(),
        ]);
        const user = userData?.user;
        if (userError || !user) return null;

        let accountRow: UserAccountProfileRow | null = null;
        try {
            const { data } = await client
                .from("user_accounts")
                .select("username, display_name, role")
                .eq("user_id", user.id)
                .maybeSingle();
            if (data) {
                accountRow = data;
            }
        } catch {
            // Fall back to auth user metadata if user_accounts cannot be queried.
        }

        return mapSupabaseUserToSession(user, accountRow, sessionData?.session?.expires_at);
    }

    async syncBrowserSession(tokens?: { accessToken: string; refreshToken: string }): Promise<void> {
        this.clearPendingLogout();
        if (!tokens?.accessToken || !tokens?.refreshToken) return;
        const client = this.getClient();
        if (!client) return;
        try {
            await client.auth.setSession({
                access_token: tokens.accessToken,
                refresh_token: tokens.refreshToken,
            });
        } catch {
            // Ignore browser client sync errors; server cookies remain authoritative.
        }
    }

    broadcastLogout(): void {
        this.broadcastEvent("SIGNED_OUT");
    }

    broadcastSessionRefresh(): void {
        this.broadcastEvent("SESSION_REFRESHED");
    }

    subscribeAuthEvents(handlers: AuthEventHandlers): () => void {
        let sessionEvent = 0;
        let refreshTimer: ReturnType<typeof setTimeout> | undefined;
        const signedOut = () => {
            sessionEvent += 1;
            clearTimeout(refreshTimer);
            handlers.onSignedOut();
        };
        const refreshSession = (expectedUserId?: string) => {
            const event = ++sessionEvent;
            clearTimeout(refreshTimer);
            // Let Supabase finish processing the auth event before reading the session.
            refreshTimer = setTimeout(() => {
                void this.getSession().then(session => {
                    if (event === sessionEvent && (!expectedUserId || session?.user.id === expectedUserId)) {
                        handlers.onSessionChanged?.(session);
                    }
                }).catch(() => undefined);
            }, 0);
        };
        const handlePayload = (payload: AuthBroadcastPayload | null) => {
            if (!payload) return;
            if (payload.type === "SIGNED_OUT") {
                signedOut();
            } else if (payload.type === "SESSION_REFRESHED") {
                refreshSession();
            }
        };

        let channel: BroadcastChannel | null = null;
        if (typeof BroadcastChannel !== "undefined") {
            try {
                channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
                channel.onmessage = (event: MessageEvent) => {
                    handlePayload(parseBroadcastPayload(event.data));
                };
            } catch {
                channel = null;
            }
        }

        const onStorage = (event: StorageEvent) => {
            if (event.key !== AUTH_BROADCAST_STORAGE_KEY || !event.newValue) return;
            try {
                handlePayload(parseBroadcastPayload(JSON.parse(event.newValue)));
            } catch {
                // Ignore malformed storage broadcast payloads.
            }
        };
        if (typeof window !== "undefined") {
            window.addEventListener("storage", onStorage);
        }

        const client = this.getClient();
        const authSubscription = client?.auth.onAuthStateChange((event, session) => {
            if (event === "SIGNED_OUT") {
                signedOut();
            } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
                refreshSession(session?.user.id);
            }
        }).data.subscription;

        return () => {
            sessionEvent += 1;
            clearTimeout(refreshTimer);
            if (channel) {
                try {
                    channel.close();
                } catch {
                    // Ignore channel close errors.
                }
            }
            if (typeof window !== "undefined") {
                window.removeEventListener("storage", onStorage);
            }
            authSubscription?.unsubscribe();
        };
    }

    async completePendingSignOut(): Promise<void> {
        if (!this.hasPendingLogout()) return;
        if (this.pendingSignOutPromise) {
            return this.pendingSignOutPromise;
        }
        const epoch = this.logoutEpoch;
        this.cleanupLegacyAuthStorage();
        const task = this.executeDeviceSignOut(epoch).finally(() => {
            if (this.pendingSignOutPromise === task) {
                this.pendingSignOutPromise = null;
            }
        });
        this.pendingSignOutPromise = task;
        return task;
    }

    async signOut(userId?: string | null): Promise<void> {
        const epoch = ++this.logoutEpoch;
        this.markPendingLogout(userId);
        this.cleanupLegacyAuthStorage();
        this.broadcastLogout();

        const task = this.executeDeviceSignOut(epoch).finally(() => {
            if (this.pendingSignOutPromise === task) {
                this.pendingSignOutPromise = null;
            }
        });
        this.pendingSignOutPromise = task;
        return task;
    }
}

export const authService = new AuthService();
