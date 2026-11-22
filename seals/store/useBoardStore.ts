import { createStore } from "zustand/vanilla";
import {
    cellKey,
    clampGrid,
    inBounds,
    resolveBoardTileColor,
    uid,
    type Tile,
    type CatalogBoard,
    type GridConfig,
    type CellKey,
    type ColorKey,
    type ColorMode,
    type ColorSystemId,
    type SentenceToken,
} from "@/lib/board";
import { createPresetCatalogLayout, initialData } from "@/lib/boardDefaults";
import {
    DEFAULT_FEATURE_FLAGS,
    type BoardData,
    type ChatMessage,
    type FeatureFlags,
    type PreReflowSnapshot,
} from "@/models/boardData";
import {
    PROFILE_SCHEMA_VERSION,
    type LocalProfileDocument,
    type LocalStorageStatus,
    type OfflineDesignatedProfileSummary,
    type ProfileSummary,
    type RecoverableLegacyProfileSummary,
} from "@/models/profile";
import type { User } from "@/models/user";
import { type AuthSession, isGuardianRole, LOCAL_CHILD_SESSION } from "@/models/auth";
import { verifySessionServerAction } from "@/app/actions/auth";
import { authService, type AuthService } from "@/services/auth/authService";
import {
    chatSocketService,
    isSameChatBindingContext,
    isValidChatMessage,
    type ChatBindingContext,
    type ChatSocketListener,
} from "@/services/chat/chatSocketService";
import { localProfileService, LocalProfileService } from "@/services/storage/localProfileService";
import { discardPreparedMedia, mediaRepository } from "@/services/storage/mediaRepository";
import { ttsService } from "@/services/tts/ttsService";

export type { BoardData } from "@/models/boardData";
export { initialData };

const MAX_SENTENCE_HISTORY = 20;

export interface BoardState extends BoardData {
    setColorSystem: (system: ColorSystemId, mode?: ColorMode) => boolean;
    resetBoardData: () => boolean;
    // Profile & persistence metadata (W01, W08)
    activeProfileId: string;
    activeProfileName: string;
    cloudProfileId: string | null;
    cloudRevision: number | null;
    activeProfileOwnerId: string | null;
    profiles: ProfileSummary[];
    offlineDesignatedProfiles: OfflineDesignatedProfileSummary[];
    recoverableLegacyProfiles: RecoverableLegacyProfileSummary[];
    storageStatus: LocalStorageStatus;
    storageError: string | null;
    dirty: boolean;
    localEditVersion: number;
    lastPublishedEditVersion: number;

    // Session-local state (never persisted to localStorage or cloud)
    sentenceHistory: SentenceToken[][];
    sentenceRevision: number;
    preReflowSnapshot: PreReflowSnapshot | null;
    currentUser: User | null;
    authSessionExpiresAt: string | null;
    chatLastReadAt: Record<string, string>;

    // Auth commands
    applyAuthSession: (session: AuthSession) => { ok: boolean };
    enterOfflineChildMode: (localProfileId?: string) => void;
    handleSessionExpired: () => void;
    logout: (authSvc?: AuthService) => void;

    // Hydration & profile commands (W01)
    hydrateFromStorage: (service?: LocalProfileService) => Promise<void>;
    reloadLocalProfiles: () => void;
    applySyncedCloudProfile: (doc: LocalProfileDocument, service?: LocalProfileService) => boolean;
    switchProfile: (localProfileId: string, service?: LocalProfileService) => void;
    createProfile: (name: string, boardData?: BoardData, service?: LocalProfileService) => string;
    renameProfile: (localProfileId: string, name: string, service?: LocalProfileService) => void;
    deleteProfile: (localProfileId: string, service?: LocalProfileService) => void;
    importProfileDocument: (doc: LocalProfileDocument, service?: LocalProfileService) => string;
    setProfileOfflineDesignated: (localProfileId: string, enabled: boolean) => boolean;
    recoverLegacyProfile: (
        legacyProfileId: string,
    ) => Promise<{ ok: boolean; localProfileId?: string; error?: string }>;
    markCloudSynced: (
        localProfileId: string,
        cloudProfileId: string,
        cloudRevision: number,
        publishedEditVersion?: number,
        preserveDirty?: boolean,
    ) => void;
    clearStorageError: () => void;

    // Layout & grid commands (W02)
    setGridConfig: (grid: GridConfig, boardId?: string) => boolean;
    applyBoardSettings: (
        grid: GridConfig,
        appearance: BoardData["tileAppearance"],
        mode: "manual" | "automatic",
        boardId?: string,
        useGlobal?: boolean,
    ) => boolean;
    reflowOutOfBoundsTiles: (boardId: string) => boolean;
    reflowBoardToGrid: (boardId: string, grid: GridConfig) => void;
    setGridConfigAndReflow: (grid: GridConfig, boardId?: string) => boolean;
    rollbackReflow: () => boolean;
    setTileAppearance: (patch: Partial<BoardData["tileAppearance"]>) => boolean;
    setSpeechConfig: (patch: Partial<BoardData["speechConfig"]>) => boolean;
    setAccessConfig: (patch: Partial<BoardData["accessConfig"]>) => boolean;
    setFeatureFlags: (patch: Partial<FeatureFlags>) => boolean;

    // Sentence commands (W04)
    appendSentenceTile: (tile: Tile, boardId?: string) => void;
    removeSentenceTokenAt: (index: number) => void;
    popSentenceToken: () => void;
    clearSentence: (recordHistory?: boolean) => void;
    undoSentenceEdit: () => boolean;

    // Tile & catalog commands (W02, W03, W06, W07)
    upsertTile: (tile: Tile) => boolean;
    assignSlot: (boardId: string, page: number, cell: CellKey, tileId: string | null) => boolean;
    swapSlots: (boardId: string, page: number, from: CellKey, to: CellKey, toPage?: number) => boolean;
    setSlotHidden: (boardId: string, page: number, cell: CellKey, hidden: boolean) => boolean;
    createCatalog: (input: {
        name: string;
        shortName?: string;
        colorKey: ColorKey;
        iconName: string | null;
        placeFolderOnHome?: boolean;
    }) => string | null;
    updateCatalog: (
        id: string,
        patch: Partial<
            Pick<CatalogBoard, "name" | "shortName" | "colorKey" | "iconName" | "gridOverride" | "layoutModeOverride">
        >,
    ) => boolean;
    deleteCatalog: (id: string) => boolean;
    reorderCatalog: (id: string, direction: number) => boolean;
    addWordsToCatalog: (id: string, tileIds: string[]) => boolean;
    placeFolderOnHome: (id: string) => boolean;

    // Experimental module data (W09 - retained when disabled)
    addScribbleDraft: (text: string) => void;
    addChatMessage: (sender: ChatMessage["sender"], text: string, context: ChatBindingContext | null, id: string) => ChatMessage | null;
    dismissLegacyChatMessages: () => boolean;
    receiveChatMessages: (incoming: ChatMessage[], context?: ChatBindingContext) => void;
    markChatRead: () => void;
    togglePinnedTile: (tileId: string) => boolean;
}

function addToBoard(data: BoardData, id: string, tileIds: string[]) {
    const board = data.boards[id];
    if (!board) return;
    const grid = board.gridOverride ?? data.gridConfig;
    for (const tileId of tileIds) {
        if (!data.tiles[tileId]) continue;
        const alreadyPlaced = board.pages.some(page =>
            Object.values(page.cells).some(cell => cell?.tileId === tileId),
        );
        if (alreadyPlaced) continue;
        let placed = false;
        for (const page of board.pages) {
            for (let i = 0; i < grid.rows * grid.cols; i++) {
                const key = cellKey(Math.floor(i / grid.cols), i % grid.cols);
                if (!page.cells[key]) {
                    page.cells[key] = { tileId };
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }
        if (!placed) {
            board.pages.push({ cells: { "0:0": { tileId } } });
        }
    }
}

function extractBoardDataWithSentence(state: BoardData, sentence: SentenceToken[]): BoardData {
    return {
        tiles: state.tiles,
        boards: state.boards,
        catalogOrder: state.catalogOrder,
        colorSystem: state.colorSystem ?? "custom",
        inactiveCatalogLayouts: state.inactiveCatalogLayouts,
        gridConfig: state.gridConfig,
        layoutMode: state.layoutMode ?? "manual",
        tileAppearance: state.tileAppearance,
        speechConfig: state.speechConfig,
        accessConfig: state.accessConfig,
        featureFlags: state.featureFlags ?? { ...DEFAULT_FEATURE_FLAGS },
        ...(state.experimentalData ? { experimentalData: state.experimentalData } : {}),
        sentence,
    };
}

function normalizeDimension(value: number | undefined): number {
    return value === undefined || !Number.isFinite(value) ? 50 : Math.max(1, Math.min(100, Math.round(value)));
}

function normalizeAppearance(
    appearance: BoardData["tileAppearance"],
): BoardData["tileAppearance"] {
    return {
        ...appearance,
        tileWidth: normalizeDimension(appearance.tileWidth),
        tileHeight: normalizeDimension(appearance.tileHeight),
    };
}

// Creates the expected page arrangement without modifying the board.
function createRepackedPages(
    board: CatalogBoard,
    grid: GridConfig,
): CatalogBoard["pages"] {
    const placements = board.pages.flatMap(page =>
        Object.entries(page.cells)
            .filter(([, placement]) => !!placement)
            .sort(([a], [b]) => {
                const [aRow, aCol] = a.split(":").map(Number);
                const [bRow, bCol] = b.split(":").map(Number);

                return aRow - bRow || aCol - bCol;
            })
            .map(([, placement]) => placement!),
    );

    const capacity = grid.rows * grid.cols;
    const pageCount = Math.max(
        1,
        Math.ceil(placements.length / capacity),
    );

    return Array.from({ length: pageCount }, (_, pageIndex) => {
        const cells: CatalogBoard["pages"][number]["cells"] = {};

        placements
            .slice(
                pageIndex * capacity,
                (pageIndex + 1) * capacity,
            )
            .forEach((placement, index) => {
                const key = cellKey(
                    Math.floor(index / grid.cols),
                    index % grid.cols,
                );

                cells[key] = { ...placement };
            });

        return { cells };
    });
}

function repackBoard(
    data: BoardData,
    id: string,
    gridOverride?: GridConfig,
) {
    const board = data.boards[id];
    if (!board) return;
    const grid = gridOverride ?? board.gridOverride ?? data.gridConfig;
    board.pages = createRepackedPages(board, grid);
}

export function extractBoardData(state: BoardData): BoardData {
    return structuredClone(extractBoardDataWithSentence(state, state.sentence));
}

export function isMediaReferenced(data: BoardData, mediaId: string, excludeTileId?: string): boolean {
    for (const tile of Object.values(data.tiles)) {
        if (tile.id !== excludeTileId && tile.mediaId === mediaId) {
            return true;
        }
    }
    for (const token of data.sentence) {
        if (token.mediaId === mediaId) {
            return true;
        }
    }
    return false;
}

function pushSentenceHistory(history: SentenceToken[][], current: SentenceToken[]): SentenceToken[][] {
    const next = [...history, structuredClone(current)];
    return next.length > MAX_SENTENCE_HISTORY ? next.slice(next.length - MAX_SENTENCE_HISTORY) : next;
}

function reflowBoard(data: BoardData, id: string) {
    const board = data.boards[id];
    const grid = board.gridOverride ?? data.gridConfig;
    const overflow: { tileId: string; hidden?: boolean }[] = [];
    board.pages.forEach(page => {
        Object.entries(page.cells).forEach(([key, placement]) => {
            if (placement && !inBounds(key, grid)) {
                overflow.push(placement);
                delete page.cells[key as CellKey];
            }
        });
    });
    for (const placement of overflow) {
        const before = new Set(
            board.pages.flatMap((page, index) => Object.keys(page.cells).map(key => `${index}/${key}`)),
        );
        addToBoard(data, id, [placement.tileId]);
        board.pages.forEach((page, index) => {
            Object.keys(page.cells).forEach(key => {
                if (!before.has(`${index}/${key}`)) page.cells[key as CellKey] = placement;
            });
        });
    }
}

function cleanAccessConfig(config: BoardData["accessConfig"]): BoardData["accessConfig"] {
    return {
        longPressToEdit: config.longPressToEdit,
        holdDurationMs: config.holdDurationMs,
        moveTolerancePx: config.moveTolerancePx,
        swipeThresholdPx: config.swipeThresholdPx,
    };
}

export function accountProfileOwnerId(user: User | null): string | null {
    return user && user.id !== LOCAL_CHILD_SESSION.user.id ? user.id : null;
}

const CHAT_LAST_READ_STORAGE_KEY = "wikahon.chatLastReadAt.v1";

function readChatLastReadMap(): Record<string, string> {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(CHAT_LAST_READ_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string" && value.length > 0) {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

function writeChatLastReadMap(map: Record<string, string>): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(CHAT_LAST_READ_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Ignore storage quota or private-mode failures for read markers.
    }
}

export function sortChatMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages
        .map((message, index) => {
            const ts = message.createdAt ? Date.parse(message.createdAt) : NaN;
            return { message, index, ts };
        })
        .sort((a, b) => {
            const aValid = Number.isFinite(a.ts);
            const bValid = Number.isFinite(b.ts);
            if (!aValid && !bValid) return a.index - b.index;
            if (!aValid) return -1;
            if (!bValid) return 1;
            if (a.ts !== b.ts) return a.ts - b.ts;
            return a.message.id.localeCompare(b.message.id);
        })
        .map(entry => entry.message);
}

export function isOwnChatMessage(
    message: ChatMessage,
    currentUserId: string | null,
    senderRole: ChatMessage["sender"],
): boolean {
    if (message.verified !== true && message.pendingContext) {
        return message.pendingContext.userId === currentUserId;
    }
    if (message.verified === true) {
        return message.senderUserId && currentUserId
            ? message.senderUserId === currentUserId
            : message.sender === senderRole;
    }
    return false;
}

export function chatReadScopeKey(
    userId: string,
    activeProfileId: string,
    cloudProfileId: string | null,
): string {
    return `${userId}:${cloudProfileId ?? activeProfileId}`;
}

export function countUnreadChatMessages(
    messages: ChatMessage[],
    currentUserId: string | null,
    senderRole: ChatMessage["sender"],
    lastReadAt?: string,
): number {
    if (!currentUserId) return 0;
    const lastReadTs = lastReadAt ? Date.parse(lastReadAt) : NaN;
    let count = 0;
    for (const m of messages) {
        if (m.verified !== true || !m.createdAt) continue;
        if (isOwnChatMessage(m, currentUserId, senderRole)) continue;
        const msgTs = Date.parse(m.createdAt);
        if (!Number.isFinite(msgTs)) continue;
        if (!Number.isFinite(lastReadTs) || msgTs > lastReadTs) {
            count += 1;
        }
    }
    return count;
}

export function matchesChatBindingContext(
    state: Pick<BoardState, "currentUser" | "activeProfileId" | "cloudProfileId">,
    context: ChatBindingContext | null | undefined,
): boolean {
    if (!context) return false;
    return (
        state.currentUser?.id === context.userId &&
        state.activeProfileId === context.localProfileId &&
        state.cloudProfileId === context.cloudProfileId
    );
}

/** Builds a chat binding context for a signed-in user with a linked cloud profile, or null otherwise. */
export function resolveChatBindingContext(
    user: User | null,
    activeProfileId: string,
    cloudProfileId: string | null,
): ChatBindingContext | null {
    if (!user || user.id === LOCAL_CHILD_SESSION.user.id || !cloudProfileId) {
        return null;
    }
    return {
        userId: user.id,
        localProfileId: activeProfileId,
        cloudProfileId,
    };
}

/** Creates context-verified socket handlers so stale messages never cross identity or profile boundaries. */
export function createBoundChatSocketHandlers(
    getState: () => Pick<
        BoardState,
        "currentUser" | "activeProfileId" | "cloudProfileId" | "experimentalData" | "receiveChatMessages"
    >,
    activeContext: ChatBindingContext | null,
): Pick<ChatSocketListener, "onMessages" | "getLocalMessages"> {
    return {
        onMessages: (incoming, msgContext) => {
            if (!activeContext) return;
            if (msgContext && !isSameChatBindingContext(msgContext, activeContext)) return;
            const latest = getState();
            if (!matchesChatBindingContext(latest, activeContext)) return;
            latest.receiveChatMessages(incoming, activeContext);
        },
        getLocalMessages: msgContext => {
            if (!activeContext) return [];
            if (msgContext && !isSameChatBindingContext(msgContext, activeContext)) return [];
            const latest = getState();
            if (!matchesChatBindingContext(latest, activeContext)) return [];
            return latest.experimentalData?.chatMessages ?? [];
        },
    };
}

function buildActivatedProfileState(params: {
    doc: LocalProfileDocument;
    previousSentenceRevision: number;
    profiles: ProfileSummary[];
    storageStatus: LocalStorageStatus;
    storageError: string | null;
    dirty?: boolean;
    localEditVersion?: number;
    lastPublishedEditVersion?: number;
}) {
    const { doc, previousSentenceRevision, profiles, storageStatus, storageError } = params;
    return {
        tiles: doc.boardData.tiles,
        boards: doc.boardData.boards,
        catalogOrder: doc.boardData.catalogOrder,
        colorSystem: doc.boardData.colorSystem ?? ("custom" as const),
        inactiveCatalogLayouts: doc.boardData.inactiveCatalogLayouts,
        gridConfig: doc.boardData.gridConfig,
        layoutMode: doc.boardData.layoutMode ?? ("manual" as const),
        tileAppearance: doc.boardData.tileAppearance,
        speechConfig: doc.boardData.speechConfig,
        accessConfig: doc.boardData.accessConfig,
        featureFlags: doc.boardData.featureFlags ?? { ...DEFAULT_FEATURE_FLAGS },
        experimentalData: doc.boardData.experimentalData,
        sentence: doc.boardData.sentence ?? [],
        sentenceHistory: [] as SentenceToken[][],
        sentenceRevision: previousSentenceRevision + 1,
        preReflowSnapshot: null,
        activeProfileId: doc.localProfileId,
        activeProfileName: doc.name,
        activeProfileOwnerId: doc.ownerUserId ?? null,
        cloudProfileId: doc.cloudProfileId ?? null,
        cloudRevision: doc.cloudRevision ?? null,
        profiles,
        storageStatus,
        storageError,
        dirty: params.dirty ?? doc.dirty ?? false,
        localEditVersion: params.localEditVersion ?? doc.localEditVersion ?? 0,
        lastPublishedEditVersion: params.lastPublishedEditVersion ?? doc.lastPublishedEditVersion ?? 0,
    };
}

function buildUnauthenticatedState(previousSentenceRevision: number) {
    return {
        ...buildActivatedProfileState({
            doc: {
                schemaVersion: PROFILE_SCHEMA_VERSION,
                localProfileId: "unauthenticated",
                name: "Not signed in",
                cloudProfileId: null,
                cloudRevision: null,
                ownerUserId: null,
                dirty: false,
                localEditVersion: 0,
                lastPublishedEditVersion: 0,
                boardData: initialData(),
            },
            previousSentenceRevision,
            profiles: [],
            storageStatus: "ok",
            storageError: null,
            dirty: false,
            localEditVersion: 0,
            lastPublishedEditVersion: 0,
        }),
        currentUser: null as User | null,
        authSessionExpiresAt: null as string | null,
        chatLastReadAt: {} as Record<string, string>,
        offlineDesignatedProfiles: [] as OfflineDesignatedProfileSummary[],
        recoverableLegacyProfiles: [] as RecoverableLegacyProfileSummary[],
    };
}

export const createBoardStore = (profileService: LocalProfileService = localProfileService) =>
    createStore<BoardState>()((set, get) => {
        let persistenceBlocked = true;
        let authGeneration = 0;

        const refreshDiscoveryLists = (user: User | null, svc = profileService) => ({
            offlineDesignatedProfiles: svc.listOfflineDesignatedProfiles(),
            recoverableLegacyProfiles: isGuardianRole(user?.role) ? svc.listRecoverableLegacyProfiles() : [],
        });

        const activateOfflineChildProfiles = (
            preferredProfileId?: string,
            svc = profileService,
        ) => {
            const previous = get();
            const res = svc.loadOfflineChildProfiles(preferredProfileId);
            const doc = res.activeDocument;
            const accountChanged = previous.currentUser?.id !== LOCAL_CHILD_SESSION.user.id;
            const profileChanged = previous.activeProfileId !== doc.localProfileId;
            const cloudChanged = previous.cloudProfileId !== (doc.cloudProfileId ?? null);
            persistenceBlocked = res.status !== "ok";
            if (accountChanged || profileChanged) ttsService.stop();
            if (accountChanged || profileChanged || cloudChanged) {
                chatSocketService.setActiveContext(null);
            }
            set({
                ...buildActivatedProfileState({
                    doc,
                    previousSentenceRevision: previous.sentenceRevision,
                    profiles: res.index.profiles,
                    storageStatus: res.status,
                    storageError: res.errorMessage ?? null,
                }),
                currentUser: LOCAL_CHILD_SESSION.user,
                authSessionExpiresAt: null,
                ...refreshDiscoveryLists(LOCAL_CHILD_SESSION.user, svc),
            });
        };

        const loadProfilesForUser = (
            currentUser: User | null,
            authSessionExpiresAt: string | null,
            svc = profileService,
        ) => {
            const previous = get();
            if (!currentUser) {
                persistenceBlocked = true;
                if (previous.currentUser !== null || previous.activeProfileId !== "unauthenticated") {
                    ttsService.stop();
                }
                if (
                    previous.currentUser !== null ||
                    previous.activeProfileId !== "unauthenticated" ||
                    previous.cloudProfileId !== null
                ) {
                    chatSocketService.setActiveContext(null);
                }
                set({
                    ...buildUnauthenticatedState(previous.sentenceRevision),
                    ...refreshDiscoveryLists(null, svc),
                });
                return;
            }

            const res = svc.loadOrMigrateActiveProfile(accountProfileOwnerId(currentUser));
            const doc = res.activeDocument;
            const accountChanged = previous.currentUser?.id !== currentUser.id;
            const profileChanged = previous.activeProfileId !== doc.localProfileId;
            const cloudChanged = previous.cloudProfileId !== (doc.cloudProfileId ?? null);
            persistenceBlocked = res.status !== "ok";
            if (accountChanged || profileChanged) ttsService.stop();
            if (accountChanged || profileChanged || cloudChanged) {
                chatSocketService.setActiveContext(null);
            }
            set({
                ...buildActivatedProfileState({
                    doc,
                    previousSentenceRevision: previous.sentenceRevision,
                    profiles: res.index.profiles,
                    storageStatus: res.status,
                    storageError: res.errorMessage ?? null,
                }),
                currentUser,
                authSessionExpiresAt,
                ...refreshDiscoveryLists(currentUser, svc),
            });
        };

        const persistCurrent = (
            nextData: BoardData,
            options?: {
                dirty?: boolean;
                localEditVersion?: number;
                lastPublishedEditVersion?: number;
            },
        ) => {
            const s = get();
            const nextDirty = options?.dirty ?? s.dirty;
            const nextEditVersion = options?.localEditVersion ?? s.localEditVersion;
            const nextLastPublished = options?.lastPublishedEditVersion ?? s.lastPublishedEditVersion;
            if (persistenceBlocked || !s.currentUser) {
                set({
                    dirty: nextDirty,
                    localEditVersion: nextEditVersion,
                    lastPublishedEditVersion: nextLastPublished,
                });
                return false;
            }
            const ownerUserId = s.activeProfileOwnerId ?? accountProfileOwnerId(s.currentUser);
            const doc: LocalProfileDocument = {
                schemaVersion: PROFILE_SCHEMA_VERSION,
                localProfileId: s.activeProfileId,
                name: s.activeProfileName,
                cloudProfileId: s.cloudProfileId,
                cloudRevision: s.cloudRevision,
                ownerUserId,
                dirty: nextDirty,
                localEditVersion: nextEditVersion,
                lastPublishedEditVersion: nextLastPublished,
                boardData: nextData,
            };
            const res = profileService.saveProfileDocument(doc, {
                allowOfflineDesignated: s.currentUser.id === LOCAL_CHILD_SESSION.user.id,
            });
            if (!res.ok) {
                set({
                    storageStatus: res.status,
                    storageError: res.errorMessage ?? "Unable to save changes to local storage.",
                    dirty: nextDirty,
                    localEditVersion: nextEditVersion,
                    lastPublishedEditVersion: nextLastPublished,
                });
            } else {
                set({
                    storageStatus: "ok",
                    storageError: null,
                    dirty: nextDirty,
                    localEditVersion: nextEditVersion,
                    lastPublishedEditVersion: nextLastPublished,
                });
            }
            return res.ok;
        };

        const canMutateSettings = (): boolean => {
            const s = get();
            return isGuardianRole(s.currentUser?.role);
        };

        const mutateBoard = (
            fn: (data: BoardData) => void,
            requireEditGuard = true,
            markCloudModified = true,
        ): boolean => {
            if (requireEditGuard && !canMutateSettings()) {
                return false;
            }
            const s = get();
            const data = extractBoardData(s);
            fn(data);
            const nextEditVersion = markCloudModified ? s.localEditVersion + 1 : s.localEditVersion;
            const nextDirty = markCloudModified ? true : s.dirty;
            set({
                ...data,
                dirty: nextDirty,
                localEditVersion: nextEditVersion,
                preReflowSnapshot: null,
            });
            persistCurrent(data, {
                dirty: nextDirty,
                localEditVersion: nextEditVersion,
            });
            return true;
        };

        const reflowBoards = (ids: string[], grid?: GridConfig, boardId?: string): boolean => {
            if (!canMutateSettings()) return false;
            const current = get();
            if ((!ids.length && !grid) || ids.some(id => !current.boards[id])) return false;
            // Capture the entire operation before changing dimensions or moving tiles.
            const snapshot: PreReflowSnapshot = {
                previousGlobalGrid: { ...current.gridConfig },
                boards: ids.map(id => ({
                    boardId: id,
                    previousGrid: current.boards[id].gridOverride
                        ? { ...current.boards[id].gridOverride }
                        : undefined,
                    pages: structuredClone(current.boards[id].pages),
                })),
            };
            const ok = mutateBoard(data => {
                if (grid) {
                    if (boardId) data.boards[boardId].gridOverride = clampGrid(grid);
                    else data.gridConfig = clampGrid(grid);
                }
                ids.forEach(id => reflowBoard(data, id));
            });
            if (ok) set({ preReflowSnapshot: snapshot });
            return ok;
        };

        return {
            ...buildUnauthenticatedState(-1),

            applyAuthSession: session => {
                authGeneration += 1;
                authService.clearPendingLogout();
                const expiresAt = session.expiresAt ?? null;
                if (get().currentUser?.id === session.user.id) {
                    set({
                        currentUser: session.user,
                        authSessionExpiresAt: expiresAt,
                        ...refreshDiscoveryLists(session.user),
                    });
                } else {
                    loadProfilesForUser(session.user, expiresAt);
                }
                return { ok: true };
            },

            enterOfflineChildMode: localProfileId => {
                authGeneration += 1;
                activateOfflineChildProfiles(localProfileId);
            },

            handleSessionExpired: () => {
                authGeneration += 1;
                loadProfilesForUser(null, null);
            },

            logout: (authSvc = authService) => {
                get().handleSessionExpired();
                void authSvc.signOut().catch(() => undefined);
            },

            hydrateFromStorage: async (svc = profileService) => {
                const generation = ++authGeneration;
                authService.cleanupLegacyAuthStorage();
                let session: AuthSession | null = null;
                if (authService.hasPendingLogout()) {
                    void authService.completePendingSignOut().catch(() => undefined);
                } else {
                    try {
                        const serverRes = await verifySessionServerAction();
                        if (serverRes?.ok && serverRes.session) session = serverRes.session;
                    } catch {
                        // Server verification may be unavailable offline.
                    }
                    if (!session) {
                        try {
                            session = await authService.getSession();
                        } catch {
                            session = null;
                        }
                    }
                }
                if (authGeneration !== generation) return;
                if (authService.hasPendingLogout()) {
                    session = null;
                }
                set({ chatLastReadAt: readChatLastReadMap() });

                const offlineChild = typeof navigator !== "undefined" && !navigator.onLine;
                if (!session && offlineChild) {
                    const designated = svc.listOfflineDesignatedProfiles();
                    if (designated.length <= 1) {
                        activateOfflineChildProfiles(designated[0]?.localProfileId, svc);
                    } else {
                        loadProfilesForUser(null, null, svc);
                    }
                    return;
                }
                loadProfilesForUser(
                    session?.user ?? null,
                    session?.expiresAt ?? null,
                    svc,
                );
            },

            reloadLocalProfiles: () => {
                const s = get();
                if (!s.currentUser) return;
                if (s.currentUser.id === LOCAL_CHILD_SESSION.user.id) {
                    activateOfflineChildProfiles(s.activeProfileId);
                    return;
                }
                loadProfilesForUser(s.currentUser, s.authSessionExpiresAt);
            },

            applySyncedCloudProfile: (doc, svc = profileService) => {
                if (persistenceBlocked) return false;
                const s = get();
                const targetOwnerId = accountProfileOwnerId(s.currentUser);
                if (targetOwnerId === null || doc.ownerUserId !== targetOwnerId) return false;
                const existingSummary = doc.cloudProfileId
                    ? s.profiles.find(p => p.cloudProfileId === doc.cloudProfileId)
                    : undefined;
                let updateInPlaceId: string | null = null;
                let existingBoardData: BoardData | null = null;
                if (existingSummary) {
                    const existingDoc =
                        existingSummary.localProfileId === s.activeProfileId
                            ? null
                            : svc.loadProfileDocument(existingSummary.localProfileId, targetOwnerId).doc;
                    const isExistingDirty =
                        existingSummary.localProfileId === s.activeProfileId
                            ? s.dirty
                            : Boolean(existingDoc?.dirty);
                    if (!isExistingDirty) {
                        updateInPlaceId = existingSummary.localProfileId;
                        existingBoardData =
                            existingSummary.localProfileId === s.activeProfileId
                                ? extractBoardData(s)
                                : (existingDoc?.boardData ?? null);
                    }
                }
                const fallbackNewId = s.profiles.some(p => p.localProfileId === doc.localProfileId)
                    ? `profile-${uid()}`
                    : doc.localProfileId;
                const targetLocalProfileId = updateInPlaceId ?? fallbackNewId;
                const keepCurrentActive = updateInPlaceId === null && s.dirty;
                const copyName =
                    updateInPlaceId === null && existingSummary
                        ? `${doc.name} (Cloud rev ${doc.cloudRevision ?? 1})`
                        : doc.name;
                const sanitizedDoc: LocalProfileDocument = {
                    ...doc,
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    localProfileId: targetLocalProfileId,
                    name: copyName,
                    ownerUserId: targetOwnerId,
                    dirty: false,
                    localEditVersion: doc.localEditVersion ?? 0,
                    lastPublishedEditVersion: doc.lastPublishedEditVersion ?? 0,
                    boardData: {
                        ...doc.boardData,
                        accessConfig: cleanAccessConfig(doc.boardData.accessConfig),
                        ...(updateInPlaceId !== null
                            ? {
                                  experimentalData:
                                      doc.boardData.experimentalData ?? existingBoardData?.experimentalData,
                                  sentence: existingBoardData?.sentence ?? [],
                              }
                            : {}),
                    },
                };
                const saveRes = svc.saveProfileDocument(sanitizedDoc);
                if (!saveRes.ok) {
                    set({
                        storageStatus: saveRes.status,
                        storageError: saveRes.errorMessage ?? "Could not save synced cloud profile.",
                    });
                    return false;
                }
                const resolvedOwnerId = targetOwnerId;
                const profiles = s.profiles.some(p => p.localProfileId === targetLocalProfileId)
                    ? s.profiles.map(p =>
                          p.localProfileId === targetLocalProfileId
                              ? {
                                    ...p,
                                    name: sanitizedDoc.name,
                                    cloudProfileId: sanitizedDoc.cloudProfileId ?? null,
                                    ownerUserId: resolvedOwnerId,
                                }
                              : p,
                      )
                    : [
                          ...s.profiles,
                          {
                              localProfileId: targetLocalProfileId,
                              name: sanitizedDoc.name,
                              cloudProfileId: sanitizedDoc.cloudProfileId ?? null,
                              ownerUserId: resolvedOwnerId,
                          },
                      ];
                const indexRes = svc.saveActiveIndex({
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    activeProfileId: keepCurrentActive ? s.activeProfileId : targetLocalProfileId,
                    profiles,
                }, targetOwnerId);
                if (!indexRes.ok) {
                    if (!updateInPlaceId) {
                        svc.deleteProfileDocument(targetLocalProfileId, targetOwnerId);
                    }
                    set({
                        storageStatus: indexRes.status,
                        storageError: indexRes.errorMessage ?? "Could not save synced profile index.",
                    });
                    return false;
                }
                if (doc.localProfileId !== targetLocalProfileId) {
                    void mediaRepository
                        .listProfileMedia(doc.localProfileId)
                        .then(async records => {
                            for (const rec of records) {
                                const loaded = rec.blob instanceof Blob
                                    ? rec
                                    : await mediaRepository.loadMedia(doc.localProfileId, rec.mediaId);
                                if (!loaded) continue;
                                await mediaRepository.saveMedia(targetLocalProfileId, loaded.mediaId, loaded.blob, {
                                    mimeType: loaded.mimeType,
                                    width: loaded.width,
                                    height: loaded.height,
                                    checksum: loaded.checksum,
                                });
                            }
                            if (records.length > 0) {
                                await discardPreparedMedia(doc.localProfileId);
                            }
                        })
                        .catch(() => undefined);
                }
                if (keepCurrentActive) {
                    set({
                        profiles,
                        storageStatus: "ok",
                        storageError: null,
                        ...refreshDiscoveryLists(s.currentUser, svc),
                    });
                    return true;
                }
                ttsService.stop();
                if (
                    s.activeProfileId !== targetLocalProfileId ||
                    s.cloudProfileId !== (sanitizedDoc.cloudProfileId ?? null)
                ) {
                    chatSocketService.setActiveContext(null);
                }
                set({
                    ...buildActivatedProfileState({
                        doc: sanitizedDoc,
                        previousSentenceRevision: s.sentenceRevision,
                        profiles,
                        storageStatus: "ok",
                        storageError: null,
                        dirty: false,
                    }),
                    ...refreshDiscoveryLists(s.currentUser, svc),
                });
                return true;
            },

            switchProfile: (localProfileId, svc = profileService) => {
                ttsService.stop();
                const s = get();
                if (!s.currentUser) return;
                const targetSummary = s.profiles.find(p => p.localProfileId === localProfileId);
                if (s.activeProfileId === localProfileId || !targetSummary) return;
                const isOfflineChild = s.currentUser.id === LOCAL_CHILD_SESSION.user.id;
                const targetOwnerId = isOfflineChild
                    ? (targetSummary.ownerUserId ?? null)
                    : accountProfileOwnerId(s.currentUser);
                const loaded = svc.loadProfileDocument(localProfileId, targetOwnerId);
                if (!loaded.doc) {
                    set({
                        storageStatus: loaded.status,
                        storageError: loaded.errorMessage ?? "Could not load selected profile.",
                    });
                    return;
                }
                if (!isOfflineChild) {
                    const nextIndex = {
                        schemaVersion: PROFILE_SCHEMA_VERSION,
                        activeProfileId: loaded.doc.localProfileId,
                        profiles: s.profiles,
                    };
                    svc.saveActiveIndex(nextIndex, accountProfileOwnerId(s.currentUser));
                }
                persistenceBlocked = false;
                chatSocketService.setActiveContext(null);
                set({
                    ...buildActivatedProfileState({
                        doc: loaded.doc,
                        previousSentenceRevision: s.sentenceRevision,
                        profiles: s.profiles,
                        storageStatus: "ok",
                        storageError: null,
                    }),
                    ...refreshDiscoveryLists(s.currentUser, svc),
                });
            },

            createProfile: (name, boardData, svc = profileService) => {
                if (persistenceBlocked) return get().activeProfileId;
                if (!canMutateSettings()) return get().activeProfileId;
                ttsService.stop();
                const s = get();
                const ownerUserId = accountProfileOwnerId(s.currentUser);
                const data = boardData ?? initialData();
                const doc: LocalProfileDocument = {
                    ...svc.createProfileDocument(name, {
                        ...data,
                        accessConfig: cleanAccessConfig(data.accessConfig),
                    }),
                    ownerUserId,
                    dirty: false,
                    localEditVersion: 0,
                    lastPublishedEditVersion: 0,
                };
                const saveRes = svc.saveProfileDocument(doc);
                const profiles = [
                    ...s.profiles,
                    { localProfileId: doc.localProfileId, name: doc.name, cloudProfileId: null, ownerUserId },
                ];
                svc.saveActiveIndex({
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    activeProfileId: doc.localProfileId,
                    profiles,
                }, accountProfileOwnerId(s.currentUser));
                chatSocketService.setActiveContext(null);
                set({
                    ...buildActivatedProfileState({
                        doc,
                        previousSentenceRevision: s.sentenceRevision,
                        profiles,
                        storageStatus: saveRes.status,
                        storageError: saveRes.errorMessage ?? null,
                        dirty: false,
                    }),
                    ...refreshDiscoveryLists(s.currentUser, svc),
                });
                return doc.localProfileId;
            },

            renameProfile: (localProfileId, name, svc = profileService) => {
                if (persistenceBlocked) return;
                if (!canMutateSettings()) return;
                const trimmed = name.trim();
                if (!trimmed) return;
                const s = get();
                if (!s.profiles.some(p => p.localProfileId === localProfileId)) return;
                const ownerUserId = accountProfileOwnerId(s.currentUser);
                const profiles = s.profiles.map(p =>
                    p.localProfileId === localProfileId ? { ...p, name: trimmed } : p,
                );
                if (s.activeProfileId === localProfileId) {
                    const nextEditVersion = s.localEditVersion + 1;
                    set({
                        activeProfileName: trimmed,
                        profiles,
                        dirty: true,
                        localEditVersion: nextEditVersion,
                    });
                    persistCurrent(extractBoardData(get()), {
                        dirty: true,
                        localEditVersion: nextEditVersion,
                    });
                } else {
                    const loaded = svc.loadProfileDocument(localProfileId, ownerUserId);
                    if (loaded.doc) {
                        svc.saveProfileDocument({
                            ...loaded.doc,
                            name: trimmed,
                            dirty: true,
                            localEditVersion: (loaded.doc.localEditVersion ?? 0) + 1,
                        });
                    }
                    set({ profiles });
                }
                svc.saveActiveIndex({
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    activeProfileId: s.activeProfileId,
                    profiles,
                }, ownerUserId);
                svc.syncOfflineDesignatedProfileMeta(localProfileId, ownerUserId, { name: trimmed });
                set(refreshDiscoveryLists(s.currentUser, svc));
            },

            deleteProfile: (localProfileId, svc = profileService) => {
                if (persistenceBlocked) return;
                if (!canMutateSettings()) return;
                const s = get();
                if (s.profiles.length <= 1 || !s.profiles.some(p => p.localProfileId === localProfileId)) return;
                const ownerUserId = accountProfileOwnerId(s.currentUser);
                const remaining = s.profiles.filter(p => p.localProfileId !== localProfileId);
                const nextActiveId =
                    s.activeProfileId === localProfileId ? remaining[0].localProfileId : s.activeProfileId;
                let replacementDoc: LocalProfileDocument | null = null;
                if (s.activeProfileId === localProfileId) {
                    const loaded = svc.loadProfileDocument(nextActiveId, ownerUserId);
                    if (!loaded.doc) {
                        set({
                            storageStatus: loaded.status,
                            storageError: loaded.errorMessage ?? "Could not load replacement profile.",
                        });
                        return;
                    }
                    replacementDoc = loaded.doc;
                }
                svc.deleteProfileDocument(localProfileId, ownerUserId);
                svc.syncOfflineDesignatedProfileMeta(localProfileId, ownerUserId, { deleted: true });
                void mediaRepository
                    .listProfileMedia(localProfileId)
                    .then(records =>
                        Promise.all(records.map(r => mediaRepository.removeMedia(localProfileId, r.mediaId))),
                    )
                    .catch(() => undefined);
                svc.saveActiveIndex({
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    activeProfileId: nextActiveId,
                    profiles: remaining,
                }, ownerUserId);
                if (replacementDoc) {
                    ttsService.stop();
                    chatSocketService.setActiveContext(null);
                    set({
                        ...buildActivatedProfileState({
                            doc: replacementDoc,
                            previousSentenceRevision: s.sentenceRevision,
                            profiles: remaining,
                            storageStatus: "ok",
                            storageError: null,
                        }),
                        ...refreshDiscoveryLists(s.currentUser, svc),
                    });
                    return;
                }
                set({
                    profiles: remaining,
                    ...refreshDiscoveryLists(s.currentUser, svc),
                });
            },

            importProfileDocument: (doc, svc = profileService) => {
                if (persistenceBlocked) {
                    throw new Error("Cannot modify the profile list while saved data is unavailable or unsupported.");
                }
                if (!canMutateSettings()) {
                    throw new Error("Guardian access is required to import a profile.");
                }
                const s = get();
                // Import preparation already stored media under this profile ID.
                const newId = doc.localProfileId;
                if (s.profiles.some(p => p.localProfileId === newId)) {
                    throw new Error("Imported profile ID already exists.");
                }
                const ownerUserId = accountProfileOwnerId(s.currentUser);
                if (doc.ownerUserId && doc.ownerUserId !== ownerUserId) {
                    throw new Error("This cloud profile belongs to a different session.");
                }
                const imported: LocalProfileDocument = {
                    ...doc,
                    boardData: {
                        ...doc.boardData,
                        accessConfig: cleanAccessConfig(doc.boardData.accessConfig),
                    },
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    localProfileId: newId,
                    ownerUserId,
                    dirty: false,
                    localEditVersion: doc.localEditVersion ?? 0,
                    lastPublishedEditVersion: doc.lastPublishedEditVersion ?? 0,
                };
                const saveRes = svc.saveProfileDocument(imported);
                if (!saveRes.ok) {
                    throw new Error(saveRes.errorMessage ?? "Could not save imported profile.");
                }
                const profiles = [
                    ...s.profiles,
                    {
                        localProfileId: newId,
                        name: imported.name,
                        cloudProfileId: imported.cloudProfileId ?? null,
                        ownerUserId,
                    },
                ];
                const indexRes = svc.saveActiveIndex({
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    activeProfileId: s.activeProfileId,
                    profiles,
                }, accountProfileOwnerId(s.currentUser));
                if (!indexRes.ok) {
                    svc.deleteProfileDocument(newId, ownerUserId);
                    throw new Error(indexRes.errorMessage ?? "Could not save profile list.");
                }
                set({
                    profiles,
                    storageStatus: saveRes.status,
                    storageError: saveRes.errorMessage ?? null,
                    ...refreshDiscoveryLists(s.currentUser, svc),
                });
                return newId;
            },

            setProfileOfflineDesignated: (localProfileId, enabled) => {
                if (!canMutateSettings()) return false;
                const s = get();
                const ownerUserId = accountProfileOwnerId(s.currentUser);
                if (!ownerUserId) return false;
                const summary = s.profiles.find(p => p.localProfileId === localProfileId);
                if (!summary) return false;
                const res = profileService.setOfflineDesignatedProfile(
                    { localProfileId, name: summary.name, ownerUserId },
                    enabled,
                );
                set({ offlineDesignatedProfiles: res.profiles });
                return res.ok;
            },

            recoverLegacyProfile: async legacyProfileId => {
                if (!canMutateSettings()) {
                    return { ok: false, error: "Guardian access is required to recover a legacy board." };
                }
                const startGeneration = authGeneration;
                const s = get();
                const ownerUserId = accountProfileOwnerId(s.currentUser);
                if (!ownerUserId) {
                    return { ok: false, error: "Guardian access is required to recover a legacy board." };
                }
                const legacyDoc = profileService.readLegacyProfileDocument(legacyProfileId);
                if (!legacyDoc) {
                    return { ok: false, error: "Legacy board was not found or was already recovered." };
                }

                const targetId = `recovered-${ownerUserId.slice(0, 8)}-${legacyProfileId}`;
                const copiedMediaIds = new Set<string>();
                try {
                    const mediaRecords = await mediaRepository.listProfileMedia(legacyProfileId);
                    for (const rec of mediaRecords) {
                        const loaded =
                            rec.blob instanceof Blob
                                ? rec
                                : await mediaRepository.loadMedia(legacyProfileId, rec.mediaId);
                        if (!loaded) {
                            return { ok: false, error: "Could not read legacy profile photo data." };
                        }
                        const savedMedia = await mediaRepository.saveMedia(targetId, loaded.mediaId, loaded.blob, {
                            mimeType: loaded.mimeType,
                            width: loaded.width,
                            height: loaded.height,
                            checksum: loaded.checksum,
                        });
                        if (!savedMedia.ok) {
                            return { ok: false, error: savedMedia.error ?? "Could not copy legacy profile photos." };
                        }
                        copiedMediaIds.add(loaded.mediaId);
                    }

                    const referencedMediaIds = new Set<string>();
                    for (const tile of Object.values(legacyDoc.boardData.tiles)) {
                        if (typeof tile.mediaId === "string" && tile.mediaId.length > 0) {
                            referencedMediaIds.add(tile.mediaId);
                        }
                    }
                    for (const token of legacyDoc.boardData.sentence) {
                        if (typeof token.mediaId === "string" && token.mediaId.length > 0) {
                            referencedMediaIds.add(token.mediaId);
                        }
                    }

                    for (const mediaId of referencedMediaIds) {
                        if (!copiedMediaIds.has(mediaId)) {
                            const legacyPhoto = await mediaRepository.loadMedia(legacyProfileId, mediaId);
                            if (legacyPhoto) {
                                const savedMedia = await mediaRepository.saveMedia(
                                    targetId,
                                    legacyPhoto.mediaId,
                                    legacyPhoto.blob,
                                    {
                                        mimeType: legacyPhoto.mimeType,
                                        width: legacyPhoto.width,
                                        height: legacyPhoto.height,
                                        checksum: legacyPhoto.checksum,
                                    },
                                );
                                if (!savedMedia.ok) {
                                    return {
                                        ok: false,
                                        error: savedMedia.error ?? "Could not copy legacy profile photos.",
                                    };
                                }
                                copiedMediaIds.add(mediaId);
                            }
                        }
                        if (copiedMediaIds.has(mediaId)) {
                            const verifiedPhoto = await mediaRepository.loadMedia(targetId, mediaId);
                            if (!verifiedPhoto) {
                                return { ok: false, error: "Could not verify recovered profile photos." };
                            }
                        }
                    }
                    for (const mediaId of copiedMediaIds) {
                        if (!referencedMediaIds.has(mediaId)) {
                            const verifiedPhoto = await mediaRepository.loadMedia(targetId, mediaId);
                            if (!verifiedPhoto) {
                                return { ok: false, error: "Could not verify recovered profile photos." };
                            }
                        }
                    }
                } catch {
                    return { ok: false, error: "Could not copy legacy profile photos." };
                }

                if (authGeneration !== startGeneration || accountProfileOwnerId(get().currentUser) !== ownerUserId) {
                    return { ok: false, error: "Account session changed while recovering legacy board." };
                }

                const recoveredDoc: LocalProfileDocument = {
                    ...legacyDoc,
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    localProfileId: targetId,
                    ownerUserId,
                    dirty: true,
                    localEditVersion: 1,
                    lastPublishedEditVersion: 0,
                    boardData: {
                        ...legacyDoc.boardData,
                        accessConfig: cleanAccessConfig(legacyDoc.boardData.accessConfig),
                    },
                };
                const saveRes = profileService.saveProfileDocument(recoveredDoc);
                if (!saveRes.ok) {
                    return { ok: false, error: saveRes.errorMessage ?? "Could not save recovered board." };
                }
                const verifiedDoc = profileService.loadProfileDocument(targetId, ownerUserId).doc;
                if (!verifiedDoc) {
                    return { ok: false, error: "Recovered board could not be verified in local storage." };
                }

                const latest = get();
                const recoveredSummary: ProfileSummary = {
                    localProfileId: targetId,
                    name: verifiedDoc.name,
                    cloudProfileId: verifiedDoc.cloudProfileId ?? null,
                    ownerUserId,
                };
                const profiles = latest.profiles.some(p => p.localProfileId === targetId)
                    ? latest.profiles.map(p => (p.localProfileId === targetId ? recoveredSummary : p))
                    : [...latest.profiles, recoveredSummary];

                const indexRes = profileService.saveActiveIndex(
                    {
                        schemaVersion: PROFILE_SCHEMA_VERSION,
                        activeProfileId: targetId,
                        profiles,
                    },
                    ownerUserId,
                );
                if (!indexRes.ok) {
                    return { ok: false, error: indexRes.errorMessage ?? "Could not update profile list." };
                }

                profileService.retireRecoveredLegacyProfile(legacyProfileId);
                if (legacyProfileId !== targetId && copiedMediaIds.size > 0) {
                    await Promise.all(
                        Array.from(copiedMediaIds).map(mediaId => mediaRepository.removeMedia(legacyProfileId, mediaId)),
                    ).catch(() => undefined);
                }

                persistenceBlocked = false;
                ttsService.stop();
                if (
                    latest.activeProfileId !== targetId ||
                    latest.cloudProfileId !== (verifiedDoc.cloudProfileId ?? null)
                ) {
                    chatSocketService.setActiveContext(null);
                }
                set({
                    ...buildActivatedProfileState({
                        doc: verifiedDoc,
                        previousSentenceRevision: latest.sentenceRevision,
                        profiles,
                        storageStatus: "ok",
                        storageError: null,
                    }),
                    ...refreshDiscoveryLists(latest.currentUser),
                });
                return { ok: true, localProfileId: targetId };
            },

            markCloudSynced: (
                localProfileId,
                cloudProfileId,
                cloudRevision,
                publishedEditVersion,
                preserveDirty = false,
            ) => {
                const s = get();
                // A publish can finish after the user switches or deletes profiles.
                if (!s.profiles.some(p => p.localProfileId === localProfileId)) return;
                const activeOwnerId = s.activeProfileOwnerId ?? accountProfileOwnerId(s.currentUser);
                let summaryOwnerId = activeOwnerId;
                if (s.activeProfileId !== localProfileId) {
                    const loaded = profileService.loadProfileDocument(localProfileId, accountProfileOwnerId(s.currentUser));
                    if (!loaded.doc) return;
                    const existingSummary = s.profiles.find(p => p.localProfileId === localProfileId);
                    summaryOwnerId = loaded.doc.ownerUserId ?? existingSummary?.ownerUserId ?? activeOwnerId;
                    const currentEditVersion = loaded.doc.localEditVersion ?? 0;
                    const shouldClearDirty =
                        !preserveDirty &&
                        (publishedEditVersion === undefined || currentEditVersion === publishedEditVersion);
                    const nextDirty = shouldClearDirty
                        ? false
                        : currentEditVersion !== publishedEditVersion && publishedEditVersion !== undefined
                          ? true
                          : Boolean(loaded.doc.dirty);
                    const nextLastPublished = publishedEditVersion ?? currentEditVersion;
                    const saved = profileService.saveProfileDocument({
                        ...loaded.doc,
                        cloudProfileId,
                        cloudRevision,
                        dirty: nextDirty,
                        localEditVersion: currentEditVersion,
                        lastPublishedEditVersion: nextLastPublished,
                    });
                    if (!saved.ok) {
                        set({ storageStatus: saved.status, storageError: saved.errorMessage ?? "Unable to save cloud profile link." });
                        return;
                    }
                }
                const profiles = s.profiles.map(p =>
                    p.localProfileId === localProfileId
                        ? { ...p, cloudProfileId, ownerUserId: summaryOwnerId }
                        : p,
                );
                profileService.saveActiveIndex({
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    activeProfileId: s.activeProfileId,
                    profiles,
                }, accountProfileOwnerId(s.currentUser));
                set({ profiles });
                if (s.activeProfileId === localProfileId) {
                    const latest = get();
                    const currentEditVersion = latest.localEditVersion;
                    const shouldClearDirty =
                        !preserveDirty &&
                        (publishedEditVersion === undefined || currentEditVersion === publishedEditVersion);
                    const nextDirty = shouldClearDirty
                        ? false
                        : currentEditVersion !== publishedEditVersion && publishedEditVersion !== undefined
                          ? true
                          : latest.dirty;
                    const nextLastPublished = publishedEditVersion ?? currentEditVersion;
                    set({ cloudProfileId, cloudRevision });
                    persistCurrent(extractBoardData(get()), {
                        dirty: nextDirty,
                        localEditVersion: currentEditVersion,
                        lastPublishedEditVersion: nextLastPublished,
                    });
                }
            },

            clearStorageError: () => set({ storageError: null }),

            setColorSystem: (system, mode) => {
                if (!canMutateSettings()) return false;
                const current = get().colorSystem ?? "custom";
                const colorMode = get().tileAppearance.colorMode;
                if (system === current && (mode === undefined || mode === colorMode)) return true;
                return mutateBoard(data => {
                    if (mode !== undefined) data.tileAppearance.colorMode = mode;
                    if (system === current) return;
                    const layouts = data.inactiveCatalogLayouts ?? {};
                    layouts[current] = { boards: data.boards, catalogOrder: data.catalogOrder };
                    const next = layouts[system] ??
                        (system === "custom" ? initialData() : createPresetCatalogLayout(system));
                    delete layouts[system];
                    data.colorSystem = system;
                    data.inactiveCatalogLayouts = layouts;
                    data.boards = next.boards;
                    data.catalogOrder = next.catalogOrder;
                });
            },

            resetBoardData: () => {
                const ok = mutateBoard(data => {
                    const defaults = initialData();
                    data.tiles = defaults.tiles;
                    data.boards = defaults.boards;
                    data.catalogOrder = defaults.catalogOrder;
                    data.colorSystem = defaults.colorSystem;
                    data.inactiveCatalogLayouts = undefined;
                    data.gridConfig = defaults.gridConfig;
                    data.layoutMode = defaults.layoutMode;
                    data.tileAppearance = defaults.tileAppearance;
                    data.sentence = [];
                    if (data.experimentalData) data.experimentalData.pinnedTileIds = undefined;
                });
                if (ok) set(state => ({
                    sentenceHistory: [],
                    sentenceRevision: state.sentenceRevision + 1,
                }));
                return ok;
            },

            setGridConfig: (grid, id) =>
                mutateBoard(d => {
                    if (id && d.boards[id]) d.boards[id].gridOverride = clampGrid(grid);
                    else if (!id) d.gridConfig = clampGrid(grid);
                    Object.values(d.boards)
                        .filter(b => (id ? b.id === id : !b.gridOverride))
                        .forEach(b => repackBoard(d, b.id));
                }),

            applyBoardSettings: (grid, appearance, mode, id, useGlobal = false) =>
                mutateBoard(d => {
                    const nextGrid = clampGrid(grid);
                    const previousGrid = (id ? d.boards[id]?.gridOverride : undefined) ?? d.gridConfig;
                    if (id && d.boards[id]) {
                        if (useGlobal) {
                            delete d.boards[id].gridOverride;
                            delete d.boards[id].layoutModeOverride;
                        } else {
                            d.boards[id].layoutModeOverride = mode;
                            if (mode === "manual") d.boards[id].gridOverride = nextGrid;
                        }
                    } else if (!id) {
                        d.layoutMode = mode;
                        if (mode === "manual") d.gridConfig = nextGrid;
                    }
                    d.tileAppearance = normalizeAppearance(appearance);
                    if (
                        mode === "manual" &&
                        !useGlobal &&
                        (nextGrid.rows !== previousGrid.rows || nextGrid.cols !== previousGrid.cols)
                    ) {
                        Object.values(d.boards)
                            .filter(b =>
                                id
                                    ? b.id === id
                                    : !b.gridOverride && (b.layoutModeOverride ?? d.layoutMode) === "manual",
                            )
                            .forEach(b => repackBoard(d, b.id, nextGrid));
                    }
                }),

            reflowOutOfBoundsTiles: id => mutateBoard(d => repackBoard(d, id)),

            // Only update Zustand when the actual page arrangement changes.
            reflowBoardToGrid: (id, grid) => {
                const state = get();
                const board = state.boards[id];
                if (!board) return;
                const nextGrid = clampGrid(grid);
                const nextPages = createRepackedPages(board, nextGrid);
                if (JSON.stringify(board.pages) === JSON.stringify(nextPages)) {
                    return;
                }
                mutateBoard(data => {
                    data.boards[id].pages = nextPages;
                });
            },

            setGridConfigAndReflow: (grid, id) =>
                reflowBoards(
                    id ? [id] : Object.values(get().boards).filter(board => !board.gridOverride).map(board => board.id),
                    grid,
                    id,
                ),

            rollbackReflow: () => {
                const snap = get().preReflowSnapshot;
                if (!snap) return false;
                const ok = mutateBoard(d => {
                    for (const previous of snap.boards) {
                        const b = d.boards[previous.boardId];
                        if (!b) continue;
                        b.pages = structuredClone(previous.pages);
                        if (previous.previousGrid) {
                            b.gridOverride = { ...previous.previousGrid };
                        } else {
                            delete b.gridOverride;
                        }
                    }
                    d.gridConfig = { ...snap.previousGlobalGrid };
                });
                if (ok) {
                    set({ preReflowSnapshot: null });
                }
                return ok;
            },

            setTileAppearance: patch =>
                mutateBoard(d => {
                    d.tileAppearance = normalizeAppearance({ ...d.tileAppearance, ...patch });
                }),

            setSpeechConfig: patch => {
                const keys = Object.keys(patch);
                const volumeOnly = keys.length === 1 && keys[0] === "volume";
                const markCloudModified = !(volumeOnly && !canMutateSettings());
                return mutateBoard(
                    d => {
                        d.speechConfig = { ...d.speechConfig, ...patch };
                    },
                    !volumeOnly,
                    markCloudModified,
                );
            },

            setAccessConfig: patch =>
                mutateBoard(d => {
                    d.accessConfig = { ...d.accessConfig, ...patch };
                }),

            setFeatureFlags: patch =>
                mutateBoard(d => {
                    d.featureFlags = { ...(d.featureFlags ?? DEFAULT_FEATURE_FLAGS), ...patch };
                }),

            appendSentenceTile: (tile, boardId) => {
                const s = get();
                const history = pushSentenceHistory(s.sentenceHistory, s.sentence);
                const nextToken: SentenceToken = {
                    instanceId: uid(),
                    tileId: tile.id,
                    label: tile.label,
                    spokenText: tile.spokenText || tile.label,
                    iconName: tile.iconName,
                    mediaId: tile.mediaId ?? null,
                    colorKey: s.colorSystem && s.colorSystem !== "custom"
                        ? resolveBoardTileColor(tile, s.boards, s.tileAppearance.colorMode, s.colorSystem, boardId)
                        : tile.colorKey ?? s.boards[tile.categoryId]?.colorKey ?? "slate",
                    wordClass: tile.wordClass,
                };
                const nextSentence = [...s.sentence, nextToken];
                set({
                    sentence: nextSentence,
                    sentenceHistory: history,
                    sentenceRevision: s.sentenceRevision + 1,
                });
                persistCurrent(extractBoardDataWithSentence(s, nextSentence));
            },

            removeSentenceTokenAt: i => {
                const s = get();
                if (i < 0 || i >= s.sentence.length) return;
                const history = pushSentenceHistory(s.sentenceHistory, s.sentence);
                const nextSentence = s.sentence.filter((_, n) => n !== i);
                set({
                    sentence: nextSentence,
                    sentenceHistory: history,
                    sentenceRevision: s.sentenceRevision + 1,
                });
                persistCurrent(extractBoardDataWithSentence(s, nextSentence));
            },

            popSentenceToken: () => {
                const s = get();
                if (s.sentence.length === 0) return;
                const history = pushSentenceHistory(s.sentenceHistory, s.sentence);
                const nextSentence = s.sentence.slice(0, -1);
                set({
                    sentence: nextSentence,
                    sentenceHistory: history,
                    sentenceRevision: s.sentenceRevision + 1,
                });
                persistCurrent(extractBoardDataWithSentence(s, nextSentence));
            },

            clearSentence: (recordHistory = true) => {
                const s = get();
                if (s.sentence.length === 0) return;
                const history = recordHistory ? pushSentenceHistory(s.sentenceHistory, s.sentence) : s.sentenceHistory;
                set({
                    sentence: [],
                    sentenceHistory: history,
                    sentenceRevision: s.sentenceRevision + 1,
                });
                persistCurrent(extractBoardDataWithSentence(s, []));
            },

            undoSentenceEdit: () => {
                const s = get();
                if (s.sentenceHistory.length === 0) return false;
                const previous = s.sentenceHistory[s.sentenceHistory.length - 1];
                const remaining = s.sentenceHistory.slice(0, -1);
                const restoredSentence = structuredClone(previous);
                set({
                    sentence: restoredSentence,
                    sentenceHistory: remaining,
                    sentenceRevision: s.sentenceRevision + 1,
                });
                persistCurrent(extractBoardDataWithSentence(s, restoredSentence));
                return true;
            },

            upsertTile: tile => {
                const s = get();
                const oldTile = s.tiles[tile.id];
                const ok = mutateBoard(d => {
                    d.tiles[tile.id] = tile;
                });
                if (ok && oldTile?.mediaId && oldTile.mediaId !== tile.mediaId) {
                    const currentData = extractBoardData(get());
                    if (!isMediaReferenced(currentData, oldTile.mediaId)) {
                        void mediaRepository.removeMedia(s.activeProfileId, oldTile.mediaId);
                    }
                }
                return ok;
            },

            assignSlot: (id, page, key, tileId) =>
                mutateBoard(d => {
                    const b = d.boards[id];
                    if (!b || (tileId && !d.tiles[tileId])) return;
                    while (b.pages.length <= page) b.pages.push({ cells: {} });
                    if (tileId) {
                        const prev = b.pages[page].cells[key];
                        b.pages[page].cells[key] =
                            prev?.tileId === tileId && prev.hidden ? { tileId, hidden: true } : { tileId };
                    } else {
                        delete b.pages[page].cells[key];
                    }
                }),

            swapSlots: (id, page, from, to, toPage = page) =>
                mutateBoard(d => {
                    const pages = d.boards[id]?.pages;
                    const source = pages?.[page]?.cells;
                    if (!pages || !source) return;
                    while (pages.length <= toPage) pages.push({ cells: {} });
                    const destination = pages[toPage].cells;
                    const a = source[from];
                    const b = destination[to];
                    delete source[from];
                    delete destination[to];
                    if (a) destination[to] = a;
                    if (b) source[from] = b;
                }),

            setSlotHidden: (id, page, key, hidden) =>
                mutateBoard(d => {
                    const p = d.boards[id]?.pages[page]?.cells[key];
                    if (p) p.hidden = hidden;
                }),

            createCatalog: input => {
                if (!canMutateSettings() || (get().colorSystem ?? "custom") !== "custom") return null;
                const id = `cat-${uid()}`;
                mutateBoard(d => {
                    d.boards[id] = {
                        id,
                        name: input.name.trim() || "Catalog",
                        shortName: input.shortName?.trim() || input.name.trim() || "Catalog",
                        colorKey: input.colorKey,
                        iconName: input.iconName,
                        isBuiltIn: false,
                        pages: [{ cells: {} }],
                    };
                    d.catalogOrder.push(id);
                });
                if (input.placeFolderOnHome) {
                    get().placeFolderOnHome(id);
                }
                return id;
            },

            updateCatalog: (id, patch) =>
                mutateBoard(d => {
                    if (!d.boards[id]) return;
                    if (d.colorSystem && d.colorSystem !== "custom" &&
                        (patch.name !== undefined || patch.shortName !== undefined ||
                            patch.colorKey !== undefined || patch.iconName !== undefined)) return;
                    Object.assign(d.boards[id], patch);
                    for (const tile of Object.values(d.tiles)) {
                        if (tile.kind !== "folder" || tile.targetBoardId !== id) continue;
                        if (patch.name !== undefined) tile.label = patch.name;
                        if (patch.iconName !== undefined) tile.iconName = patch.iconName;
                    }
                }),

            deleteCatalog: id =>
                mutateBoard(d => {
                    if (!d.boards[id] || d.boards[id].isBuiltIn) return;
                    delete d.boards[id];
                    d.catalogOrder = d.catalogOrder.filter(c => c !== id);
                    const folderIds = new Set(
                        Object.values(d.tiles)
                            .filter(t => t.kind === "folder" && t.targetBoardId === id)
                            .map(t => t.id),
                    );
                    for (const b of Object.values(d.boards)) {
                        b.pages.forEach(p =>
                            Object.entries(p.cells).forEach(([k, v]) => {
                                if (v && folderIds.has(v.tileId)) delete p.cells[k as CellKey];
                            }),
                        );
                    }
                    folderIds.forEach(k => delete d.tiles[k]);
                    Object.values(d.tiles).forEach(t => {
                        if (t.categoryId === id) t.categoryId = "home";
                    });
                }),

            reorderCatalog: (id, direction) =>
                mutateBoard(d => {
                    const a = d.catalogOrder.indexOf(id);
                    const b = a + direction;
                    if (a >= 0 && b >= 0 && b < d.catalogOrder.length) {
                        [d.catalogOrder[a], d.catalogOrder[b]] = [d.catalogOrder[b], d.catalogOrder[a]];
                    }
                }),

            addWordsToCatalog: (id, ids) => mutateBoard(d => addToBoard(d, id, ids)),

            placeFolderOnHome: id =>
                mutateBoard(d => {
                    const b = d.boards[id];
                    if (!b) return;
                    const tileId = `folder-${id}`;
                    d.tiles[tileId] = {
                        id: tileId,
                        kind: "folder",
                        label: b.name,
                        categoryId: id,
                        targetBoardId: id,
                        iconName: b.iconName,
                    };
                    addToBoard(d, "home", [tileId]);
                }),

            addScribbleDraft: text => {
                const trimmed = text.trim();
                if (!trimmed) return;
                mutateBoard(d => {
                    const prev = d.experimentalData?.scribbleDrafts ?? [];
                    d.experimentalData = {
                        ...(d.experimentalData ?? {}),
                        scribbleDrafts: [...prev, trimmed],
                    };
                }, false, false);
            },

            addChatMessage: (sender, text, context, id) => {
                const trimmed = text.trim();
                if (!trimmed || (context && !matchesChatBindingContext(get(), context))) return null;
                const message: ChatMessage = {
                    id,
                    sender,
                    text: trimmed,
                    createdAt: new Date().toISOString(),
                    ...(context ? { pendingContext: { ...context } } : {}),
                };
                const data = extractBoardData(get());
                const prev = data.experimentalData?.chatMessages ?? [];
                data.experimentalData = {
                    ...(data.experimentalData ?? {}),
                    chatMessages: sortChatMessages([...prev, message]),
                };
                if (!persistCurrent(data)) return null;
                set({ ...data });
                return message;
            },

            dismissLegacyChatMessages: () => {
                const data = extractBoardData(get());
                const prev = data.experimentalData?.chatMessages ?? [];
                data.experimentalData = { ...(data.experimentalData ?? {}), chatMessages: prev.filter(m => m.verified === true || m.pendingContext) };
                if (!persistCurrent(data)) return false;
                set({ ...data });
                return true;
            },

            receiveChatMessages: (incoming, context) => {
                if (!Array.isArray(incoming) || !context || !matchesChatBindingContext(get(), context)) return;
                const verified = incoming.filter(item => isValidChatMessage(item) && item.verified === true);
                if (!verified.length) return;
                mutateBoard(d => {
                    const merged = new Map((d.experimentalData?.chatMessages ?? []).map(m => [m.id, m]));
                    for (const msg of verified) merged.set(msg.id, { ...msg, pendingContext: undefined });
                    d.experimentalData = {
                        ...(d.experimentalData ?? {}),
                        chatMessages: sortChatMessages(Array.from(merged.values())),
                    };
                }, false, false);
            },

            markChatRead: () => {
                const state = get();
                if (!state.currentUser) return;
                const scopeKey = chatReadScopeKey(
                    state.currentUser.id,
                    state.activeProfileId,
                    state.cloudProfileId,
                );
                let latestMsgTs = -Infinity;
                for (const m of state.experimentalData?.chatMessages ?? []) {
                    if (m.verified !== true || !m.createdAt) continue;
                    const ts = Date.parse(m.createdAt);
                    if (Number.isFinite(ts) && ts > latestMsgTs) {
                        latestMsgTs = ts;
                    }
                }
                const existingRaw = state.chatLastReadAt[scopeKey];
                const existingTs = existingRaw ? Date.parse(existingRaw) : NaN;
                if (existingRaw && Number.isFinite(existingTs) && existingTs >= latestMsgTs) {
                    return;
                }
                const nextIso = new Date(Math.max(Date.now(), latestMsgTs)).toISOString();
                const nextMap = { ...state.chatLastReadAt, [scopeKey]: nextIso };
                writeChatLastReadMap(nextMap);
                set({ chatLastReadAt: nextMap });
            },

            togglePinnedTile: tileId =>
                mutateBoard(d => {
                    const prev = d.experimentalData?.pinnedTileIds ?? [];
                    const next = prev.includes(tileId)
                        ? prev.filter(id => id !== tileId)
                        : [...prev, tileId];
                    d.experimentalData = {
                        ...(d.experimentalData ?? {}),
                        pinnedTileIds: next,
                    };
                }),
        };
    });

export type BoardStore = ReturnType<typeof createBoardStore>;
