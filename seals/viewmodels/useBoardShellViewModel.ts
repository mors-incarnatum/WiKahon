"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { isGuardianRole, LOCAL_CHILD_SESSION } from "@/models/auth";
import type { Tile } from "@/lib/board";
import { chatSocketService } from "@/services/chat/chatSocketService";
import { cloudSyncService } from "@/services/cloud/cloudSyncService";
import { discardPreparedMedia } from "@/services/storage/mediaRepository";
import { useBoardReady, useBoardStore, useBoardStoreApi } from "@/store/BoardProvider";
import {
    chatReadScopeKey,
    countUnreadChatMessages,
    createBoundChatSocketHandlers,
    resolveChatBindingContext,
} from "@/store/useBoardStore";
import { useSentenceViewModel } from "./useSentenceViewModel";
import { useChatDraftViewModel } from "./useChatDraftViewModel";
import { useEditModeViewModel } from "./useEditModeViewModel";

export type ShellPanel = "settings" | "profiles" | "catalogs" | "layout" | "scribble" | "chat" | null;
type LocalPanel = "settings" | "profiles" | "catalogs" | "layout" | null;

const DEFAULT_PINNED_TILE_IDS = ["n-5", "n-3", "n-1", "p-4", "f-1"] as const;

export const SentenceContext = createContext<ReturnType<typeof useSentenceViewModel> | null>(null);

export function useSentenceContext() {
    const vm = useContext(SentenceContext);
    if (!vm) throw new Error("Sentence provider required");
    return vm;
}

export function useBoardShellViewModel() {
    const sentence = useSentenceViewModel();
    const edit = useEditModeViewModel();
    const pathname = usePathname();
    const router = useRouter();
    const params = useParams<{ categoryId?: string | string[] }>();

    const storeApi = useBoardStoreApi();
    const ready = useBoardReady();
    const currentUser = useBoardStore(s => s.currentUser);
    const activeProfileId = useBoardStore(s => s.activeProfileId);
    const activeProfileName = useBoardStore(s => s.activeProfileName);
    const cloudProfileId = useBoardStore(s => s.cloudProfileId);
    const profileScope = JSON.stringify([currentUser?.id, activeProfileId, cloudProfileId]);
    const storageStatus = useBoardStore(s => s.storageStatus);
    const storageError = useBoardStore(s => s.storageError);
    const dirty = useBoardStore(s => s.dirty);
    const featureFlags = useBoardStore(s => s.featureFlags);
    const tiles = useBoardStore(s => s.tiles);
    const boards = useBoardStore(s => s.boards);
    const colorSystem = useBoardStore(s => s.colorSystem);
    const tileAppearance = useBoardStore(s => s.tileAppearance);
    const pinnedTileIds = useBoardStore(s => s.experimentalData?.pinnedTileIds);
    const chatMessages = useBoardStore(s => s.experimentalData?.chatMessages);
    const chatLastReadAt = useBoardStore(s => s.chatLastReadAt);
    const markChatRead = useBoardStore(s => s.markChatRead);
    const clearStorageError = useBoardStore(s => s.clearStorageError);
    const storeLogout = useBoardStore(s => s.logout);

    const [localPanelState, setLocalPanelState] = useState<{
        userId: string | null;
        panel: LocalPanel;
    }>({
        userId: null,
        panel: null,
    });

    const [syncingCloud, setSyncingCloud] = useState(false);
    const [syncStatus, setSyncStatus] = useState<string | null>(null);
    const [wheelState, setWheelState] = useState<{
        userId: string;
        coords: { x: number; y: number };
    } | null>(null);

    const lastBoardLocation = useRef({
        scope: profileScope,
        path: pathname.startsWith("/board") ? pathname : "/board",
    });

    const returnToBoard = () => {
        const { scope, path } = lastBoardLocation.current;
        router.push(scope === profileScope ? path : "/board");
    };

    const chatDraft = useChatDraftViewModel(profileScope, sentence.state.tokens, returnToBoard);

    useEffect(() => {
        if (!syncStatus) return;
        const timer = window.setTimeout(() => setSyncStatus(null), 4000);
        return () => window.clearTimeout(timer);
    }, [syncStatus]);

    useEffect(() => {
        if (pathname.startsWith("/board")) {
            lastBoardLocation.current = { scope: profileScope, path: pathname };
        }
    }, [pathname, profileScope]);

    useEffect(() => {
        if (ready && !currentUser) {
            router.replace("/login");
        }
    }, [ready, currentUser, router]);

    const isGuardian = isGuardianRole(currentUser?.role);
    const wheelEnabled = featureFlags?.categoryWheel ?? false;
    const pinnedEnabled = featureFlags?.pinnedVocabulary ?? false;

    const effectivePinnedIds =
        pinnedTileIds && pinnedTileIds.length > 0 ? pinnedTileIds : DEFAULT_PINNED_TILE_IDS;

    const pinnedTiles: Tile[] = pinnedEnabled
        ? effectivePinnedIds.map(id => tiles[id]).filter((t): t is Tile => Boolean(t))
        : [];

    const routePanel: ShellPanel =
        pathname === "/chat" ? "chat" : pathname === "/scribble" ? "scribble" : null;

    const localPanel: LocalPanel =
        currentUser && (localPanelState.userId === null || localPanelState.userId === currentUser.id)
            ? localPanelState.panel
            : null;

    const wheel = currentUser && wheelState?.userId === currentUser.id ? wheelState.coords : null;

    const gatedLocalPanel: LocalPanel =
        !isGuardian &&
        (localPanel === "settings" ||
            localPanel === "profiles" ||
            localPanel === "catalogs" ||
            localPanel === "layout")
            ? null
            : localPanel;

    const activePanel: ShellPanel = gatedLocalPanel ?? routePanel;
    const isChatOpen = pathname === "/chat";
    const isScribbleOpen = pathname === "/scribble";

    const senderRole = isGuardian ? "guardian" : "child";

    const chatScopeKey = currentUser
        ? chatReadScopeKey(currentUser.id, activeProfileId, cloudProfileId)
        : null;

    const lastReadAt = chatScopeKey ? chatLastReadAt[chatScopeKey] : undefined;

    const unreadChatCount =
        !currentUser || isChatOpen
            ? 0
            : countUnreadChatMessages(chatMessages ?? [], currentUser.id, senderRole, lastReadAt);

    useEffect(() => {
        if (isChatOpen && currentUser) {
            markChatRead();
        }
    }, [isChatOpen, currentUser, activeProfileId, cloudProfileId, chatMessages, markChatRead]);

    const boundChatContext = resolveChatBindingContext(currentUser, activeProfileId, cloudProfileId);
    const boundUserId = boundChatContext?.userId ?? null;
    const boundLocalProfileId = boundChatContext?.localProfileId ?? null;
    const boundCloudProfileId = boundChatContext?.cloudProfileId ?? null;

    const chatEnabled = Boolean(currentUser) && (Boolean(featureFlags?.parentChildChat) || isChatOpen);

    useEffect(() => {
        const activeContext =
            boundUserId && boundLocalProfileId && boundCloudProfileId
                ? {
                      userId: boundUserId,
                      localProfileId: boundLocalProfileId,
                      cloudProfileId: boundCloudProfileId,
                  }
                : null;

        chatSocketService.setActiveContext(activeContext);

        if (!chatEnabled) return;

        return chatSocketService.subscribe(
            createBoundChatSocketHandlers(() => storeApi.getState(), activeContext),
        );
    }, [chatEnabled, storeApi, boundUserId, boundLocalProfileId, boundCloudProfileId]);

    const setPanel = (next: ShellPanel) => {
        if (
            !isGuardian &&
            (next === "settings" ||
                next === "profiles" ||
                next === "catalogs" ||
                next === "layout")
        ) {
            return;
        }

        if (next === "chat") {
            setLocalPanelState({ userId: currentUser?.id ?? null, panel: null });

            if (pathname !== "/chat") {
                if (pathname.startsWith("/board")) {
                    lastBoardLocation.current = { scope: profileScope, path: pathname };
                }

                router.push("/chat");
            }

            return;
        }

        if (next === "scribble") {
            setLocalPanelState({ userId: currentUser?.id ?? null, panel: null });

            if (pathname !== "/scribble") {
                if (pathname.startsWith("/board")) {
                    lastBoardLocation.current = { scope: profileScope, path: pathname };
                }

                router.push("/scribble");
            }

            return;
        }

        if (next === null) {
            if (gatedLocalPanel !== null) {
                setLocalPanelState({ userId: currentUser?.id ?? null, panel: null });
                return;
            }

            setLocalPanelState({ userId: currentUser?.id ?? null, panel: null });

            if (pathname === "/chat" || pathname === "/scribble") {
                returnToBoard();
            }

            return;
        }

        setLocalPanelState({ userId: currentUser?.id ?? null, panel: next });
    };

    const toggleChat = () => (pathname === "/chat" ? returnToBoard() : setPanel("chat"));
    const toggleScribble = () =>
        pathname === "/scribble" ? returnToBoard() : setPanel("scribble");

    const canSyncCloud = Boolean(
        currentUser &&
            currentUser.id !== LOCAL_CHILD_SESSION.user.id &&
            cloudSyncService.isConfigured(),
    );

    const syncCloudNow = async () => {
        if (!canSyncCloud || !currentUser || syncingCloud) return;

        const snapshot = storeApi.getState();
        const userId = currentUser.id;
        const targetLocalProfileId = snapshot.activeProfileId;
        const targetCloudProfileId = snapshot.cloudProfileId;

        setSyncingCloud(true);
        setSyncStatus(null);

        try {
            const res = await cloudSyncService.syncAssignedProfileForCurrentUser(
                userId,
                targetCloudProfileId,
                snapshot.cloudRevision,
                snapshot.dirty,
                !snapshot.dirty && targetCloudProfileId ? targetLocalProfileId : undefined,
            );

            const latest = storeApi.getState();

            if (res.ok && res.updated && res.doc) {
                const sameTarget =
                    latest.currentUser?.id === userId &&
                    latest.activeProfileId === targetLocalProfileId &&
                    latest.cloudProfileId === targetCloudProfileId;

                if (sameTarget && (await latest.applySyncedCloudProfile(res.doc))) {
                    setSyncStatus("Synced from cloud");
                } else {
                    if (
                        res.doc.localProfileId !== targetLocalProfileId &&
                        res.doc.localProfileId !== storeApi.getState().activeProfileId
                    ) {
                        await discardPreparedMedia(res.doc.localProfileId);
                    }

                    if (sameTarget && !storeApi.getState().storageError) {
                        setSyncStatus("Cloud sync failed.");
                    }
                }
            } else if (res.ok && res.conflictProfile) {
                setSyncStatus("Newer cloud version available in Settings → Profiles.");
            } else if (res.ok) {
                setSyncStatus("Board is up to date");
            } else {
                setSyncStatus(res.error ?? "Cloud sync failed.");
            }
        } catch {
            setSyncStatus("Cloud sync failed.");
        } finally {
            setSyncingCloud(false);
        }
    };

    const logout = () => {
        setLocalPanelState({ userId: null, panel: null });
        setWheelState(null);
        setSyncStatus(null);
        edit.actions.lock();
        storeLogout();
        router.replace("/login");
    };

    const rawCategoryId = Array.isArray(params?.categoryId)
        ? params.categoryId[0]
        : params?.categoryId;

    const boardId = rawCategoryId ? decodeURIComponent(rawCategoryId) : "home";

    return {
        sentence,
        chatDraft,
        edit,
        state: {
            ready,
            currentUser,
            isGuardian,
            panel: activePanel,
            isChatOpen,
            unreadChatCount,
            isScribbleOpen,
            wheel: wheelEnabled ? wheel : null,
            boardId,
            activeProfileName,
            storageStatus,
            storageError,
            dirty,
            canSyncCloud,
            syncingCloud,
            syncStatus,
            featureFlags,
            wheelEnabled,
            pinnedTiles,
            boards,
            tileAppearance,
            colorSystem,
        },
        actions: {
            setPanel,
            toggleChat,
            addWordsToChat: () => {
                chatDraft.actions.useWords();
                router.push("/chat");
            },
            cancelChatComposition: () => {
                chatDraft.actions.cancelComposition();
                router.push("/chat");
            },
            toggleScribble,
            syncCloudNow,
            clearSyncStatus: () => setSyncStatus(null),
            logout,
            closeWheel: () => setWheelState(null),
            openCatalogs: () => {
                setWheelState(null);
                if (isGuardian) {
                    setLocalPanelState({ userId: currentUser?.id ?? null, panel: "catalogs" });
                }
            },
            clearStorageError,
            onContextMenu: (e: React.MouseEvent) => {
                if (!currentUser || !wheelEnabled || isChatOpen || isScribbleOpen) return;
                e.preventDefault();
                setWheelState({ userId: currentUser.id, coords: { x: e.clientX, y: e.clientY } });
            },
            onKeyDown: (e: React.KeyboardEvent) => {
                if (!currentUser || !wheelEnabled || isChatOpen || isScribbleOpen) return;

                if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                    e.preventDefault();
                    setWheelState({
                        userId: currentUser.id,
                        coords: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
                    });
                }
            },
        },
    };
}