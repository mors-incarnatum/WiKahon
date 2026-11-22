"use client";
import { createContext, Fragment, useContext, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { verifySessionServerAction } from "@/app/actions/auth";
import { isSessionExpired } from "@/lib/session";
import { LOCAL_CHILD_SESSION, type AuthSession } from "@/models/auth";
import { authService } from "@/services/auth/authService";
import { chatSocketService } from "@/services/chat/chatSocketService";
import { cloudSyncService } from "@/services/cloud/cloudSyncService";
import { discardPreparedMedia } from "@/services/storage/mediaRepository";
import { activeProfileIndexKey, profileStorageKey } from "@/services/storage/localProfileService";
import { accountProfileOwnerId, createBoardStore, type BoardState, type BoardStore } from "./useBoardStore";

const SESSION_CHECK_INTERVAL_MS = 30_000;

const BoardContext = createContext<BoardStore | null>(null);

export function BoardProvider({ children }: { children: React.ReactNode }) {
    const [store] = useState(() => createBoardStore());
    const [ready, setReady] = useState(false);
    const lastSyncKeyRef = useRef<string | null>(null);

    const userId = useStore(store, s => s.currentUser?.id);
    const activeProfileId = useStore(store, s => s.activeProfileId);
    const cloudProfileId = useStore(store, s => s.cloudProfileId);

    useEffect(() => {
        void store
            .getState()
            .hydrateFromStorage()
            .catch(() => undefined)
            .finally(() => setReady(true));

        const handleStorage = (event: StorageEvent) => {
            const state = store.getState();
            if (!state.currentUser) return;
            if (event.key !== null && event.key !== activeProfileIndexKey(accountProfileOwnerId(state.currentUser))
                && event.key !== profileStorageKey(state.activeProfileId)) return;
            state.reloadLocalProfiles();
        };
        window.addEventListener("storage", handleStorage);

        const unsubscribeAuth = authService.subscribeAuthEvents({
            onSignedOut: () => store.getState().handleSessionExpired(),
            onSessionChanged: session => {
                if (authService.hasPendingLogout()) return;
                if (session) {
                    store.getState().applyAuthSession(session);
                }
            },
        });

        let revalidating = false;
        const revalidateSession = async (forceServerCheck: boolean) => {
            if (revalidating) return;
            const s = store.getState();
            if (authService.hasPendingLogout()) {
                if (s.currentUser && s.currentUser.id !== LOCAL_CHILD_SESSION.user.id) {
                    s.handleSessionExpired();
                }
                void authService.completePendingSignOut().catch(() => undefined);
                return;
            }
            if (!s.currentUser || s.currentUser.id === LOCAL_CHILD_SESSION.user.id) return;
            const expired = isSessionExpired(s.authSessionExpiresAt);
            if (!forceServerCheck && !expired) return;

            revalidating = true;
            try {
                let nextSession: AuthSession | null = null;
                try {
                    const serverRes = await verifySessionServerAction();
                    if (serverRes?.ok && serverRes.session) {
                        nextSession = serverRes.session;
                    }
                } catch {
                    // Network/server error; fallback to browser auth client.
                }
                if (!nextSession) {
                    try {
                        nextSession = await authService.getSession();
                    } catch {
                        nextSession = null;
                    }
                }
                const latest = store.getState();
                if (authService.hasPendingLogout()) {
                    if (latest.currentUser && latest.currentUser.id !== LOCAL_CHILD_SESSION.user.id) {
                        latest.handleSessionExpired();
                    }
                    void authService.completePendingSignOut().catch(() => undefined);
                    return;
                }
                if (latest.currentUser !== s.currentUser || latest.authSessionExpiresAt !== s.authSessionExpiresAt) return;
                if (nextSession && !isSessionExpired(nextSession.expiresAt)) {
                    if (s.currentUser.id !== nextSession.user.id || latest.authSessionExpiresAt !== (nextSession.expiresAt ?? null)) {
                        latest.applyAuthSession(nextSession);
                    }
                    return;
                }
                if (!latest.currentUser || latest.currentUser.id === LOCAL_CHILD_SESSION.user.id) return;
                const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
                if (expired || !isOffline) {
                    if (isOffline && latest.currentUser.role === "CHILD") {
                        latest.enterOfflineChildMode();
                    } else {
                        latest.handleSessionExpired();
                    }
                }
            } finally {
                revalidating = false;
            }
        };

        const handleFocus = () => {
            void revalidateSession(true);
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void revalidateSession(true);
            }
        };
        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        const intervalId = window.setInterval(() => {
            void revalidateSession(false);
        }, SESSION_CHECK_INTERVAL_MS);

        return () => {
            window.removeEventListener("storage", handleStorage);
            unsubscribeAuth();
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.clearInterval(intervalId);
        };
    }, [store]);

    useEffect(() => {
        if (!ready) return;
        if (!userId || userId === LOCAL_CHILD_SESSION.user.id) {
            chatSocketService.setActiveContext(null);
            lastSyncKeyRef.current = null;
            return;
        }

        chatSocketService.setActiveContext(
            cloudProfileId
                ? { userId, localProfileId: activeProfileId, cloudProfileId }
                : null,
        );

        const syncKey = `${userId}:${cloudProfileId ?? "none"}`;
        if (lastSyncKeyRef.current === syncKey) return;
        lastSyncKeyRef.current = syncKey;

        let cancelled = false;
        const { activeProfileId: currentActiveProfileId, cloudRevision, dirty } = store.getState();
        void cloudSyncService
            .syncAssignedProfileForCurrentUser(
                userId,
                cloudProfileId,
                cloudRevision,
                dirty,
                !dirty && cloudProfileId ? currentActiveProfileId : undefined,
            )
            .then(res => {
                if (res.ok && res.updated && res.doc) {
                    const latest = store.getState();
                    if (cancelled || latest.currentUser?.id !== userId || latest.activeProfileId !== currentActiveProfileId
                        || latest.cloudProfileId !== cloudProfileId || !latest.applySyncedCloudProfile(res.doc)) {
                        if (res.doc.localProfileId !== currentActiveProfileId) {
                            return discardPreparedMedia(res.doc.localProfileId);
                        }
                        return;
                    }
                    lastSyncKeyRef.current = `${userId}:${res.doc.cloudProfileId ?? "none"}`;
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [ready, userId, activeProfileId, cloudProfileId, store]);

    return (
        <BoardContext.Provider value={store}>
            {ready ? <Fragment key={userId}>{children}</Fragment> : <div role="status">Loading board…</div>}
        </BoardContext.Provider>
    );
}

export function useBoardStoreApi(): BoardStore {
    const store = useContext(BoardContext);
    if (!store) throw new Error("BoardProvider is required");
    return store;
}

export function useBoardStore<T>(selector: (state: BoardState) => T): T {
    const store = useBoardStoreApi();
    return useStore(store, selector);
}

export function useBoardSelector<T>(selector: (state: BoardState) => T): T {
    return useBoardStore(useShallow(selector));
}
