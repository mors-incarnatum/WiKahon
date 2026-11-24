import { COLOR_SYSTEMS, uid, type CatalogBoard, type ColorSystemId, type Tile } from "@/lib/board";
import { initialData, readColorSystem, sanitizeInactiveCatalogLayouts } from "@/lib/boardDefaults";
import type { BoardData } from "@/models/boardData";
import { PROFILE_SCHEMA_VERSION, type LocalProfileDocument } from "@/models/profile";
import { getSupabaseBrowserClient, type BoardSupabaseClient } from "@/models/supabase/client";
import { SupabaseBoardRepository, type IBoardRepository } from "@/models/supabase/boardRepository";
import type { Json, ProfileRow } from "@/models/supabase/database.types";
import {
    boardToRow,
    settingsToRow,
    tileToRow,
    type BoardEntry,
    type CloudSettings,
    type CompactInactiveCatalogLayouts,
} from "@/models/supabase/mappers";
import { discardPreparedMedia, mediaRepository, type IMediaRepository } from "@/services/storage/mediaRepository";

export interface CloudUser {
    id: string;
    email: string | null;
}

const MEDIA_CONCURRENCY = 4;

async function runInChunks<T>(
    items: readonly T[],
    concurrency: number,
    task: (item: T) => Promise<void>,
): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
        await Promise.all(items.slice(i, i + concurrency).map(task));
    }
}

function isMissingPublishRpcError(error: { code?: string; message?: string }): boolean {
    if (error.code === "PGRST202") return true;
    const message = error.message ?? "";
    return message.includes("Could not find the function public.publish_profile_snapshot");
}

export class CloudSyncService {
    constructor(
        private readonly getClient: () => BoardSupabaseClient | null = getSupabaseBrowserClient,
        private readonly makeRepo: (client: BoardSupabaseClient) => IBoardRepository = c =>
            new SupabaseBoardRepository(c),
        private readonly mediaRepo: IMediaRepository = mediaRepository,
    ) {}

    isConfigured(): boolean {
        return this.getClient() !== null;
    }

    async getCurrentUser(): Promise<CloudUser | null> {
        const client = this.getClient();
        if (!client) return null;
        const { data } = await client.auth.getUser();
        if (!data.user) return null;
        return { id: data.user.id, email: data.user.email ?? null };
    }

    async listCloudProfiles(userId: string): Promise<{ ok: boolean; profiles: ProfileRow[]; error?: string }> {
        const client = this.getClient();
        if (!client) return { ok: false, profiles: [], error: "Supabase is not configured." };
        try {
            if ((await this.getCurrentUser())?.id !== userId) {
                return { ok: false, profiles: [], error: "The signed-in account changed." };
            }
            const repo = this.makeRepo(client);
            const profiles = await repo.listProfiles();
            if ((await this.getCurrentUser())?.id !== userId) {
                return { ok: false, profiles: [], error: "The signed-in account changed." };
            }
            return { ok: true, profiles };
        } catch (error) {
            return {
                ok: false,
                profiles: [],
                error: error instanceof Error ? error.message : "Could not list cloud profiles.",
            };
        }
    }

    async publishProfile(params: {
        userId: string;
        localProfileId: string;
        profileName: string;
        cloudProfileId: string | null;
        expectedRevision: number | null;
        boardData: BoardData;
    }): Promise<{ ok: boolean; cloudProfileId?: string; revision?: number; isConflict?: boolean; error?: string }> {
        const client = this.getClient();
        if (!client) return { ok: false, error: "Supabase is not configured." };
        const user = await this.getCurrentUser();
        if (user?.id !== params.userId) return { ok: false, error: "The signed-in account changed." };

        const repo = this.makeRepo(client);
        let targetCloudId = params.cloudProfileId;
        let expectedRev = params.expectedRevision;
        let snapshotCommitted = false;
        try {
            if (!targetCloudId) {
                const created = await repo.createProfile(params.profileName, user.id);
                targetCloudId = created.id;
                expectedRev = created.revision ?? 1;
            }
            const profileId = targetCloudId;

            // 1. Publish referenced media first to the private profile-scoped bucket.
            const mediaIds = new Set<string>();
            for (const tile of Object.values(params.boardData.tiles)) {
                if (tile.mediaId) mediaIds.add(tile.mediaId);
            }
            const existingRemoteIds = new Set(await repo.listProfileMedia(profileId).catch(() => []));
            const missingMediaIds = [...mediaIds].filter(id => !existingRemoteIds.has(id));
            await runInChunks(missingMediaIds, MEDIA_CONCURRENCY, async mediaId => {
                const record = await this.mediaRepo.loadMedia(params.localProfileId, mediaId);
                if (!record) throw new Error(`Cannot publish: missing photo ${mediaId}.`);
                await repo.uploadProfileMedia(profileId, mediaId, record.blob, record.mimeType);
            });

            // 2. Normalize active/inactive boards and tiles (both words and folders live in public.tiles).
            const activeBoards = Object.values(params.boardData.boards);
            const boardIds = new Set(activeBoards.map(b => b.id));
            const boardEntries: BoardEntry[] = activeBoards.map(board => ({
                board,
                catalogSystem: null,
            }));
            const compactInactiveLayouts: CompactInactiveCatalogLayouts = {};
            for (const [system, layout] of Object.entries(params.boardData.inactiveCatalogLayouts ?? {}) as [
                ColorSystemId,
                NonNullable<BoardData["inactiveCatalogLayouts"]>[ColorSystemId],
            ][]) {
                if (!layout || !Object.hasOwn(COLOR_SYSTEMS, system)) continue;
                if (layout.boards.home) {
                    compactInactiveLayouts[system] = {
                        home: layout.boards.home,
                        catalogOrder: layout.catalogOrder,
                    };
                }
                for (const board of Object.values(layout.boards)) {
                    if (board.id === "home" || boardIds.has(board.id)) continue;
                    boardIds.add(board.id);
                    boardEntries.push({ board, catalogSystem: system });
                }
            }

            const fallbackCategoryId = boardIds.has("home") ? "home" : (boardEntries[0]?.board.id ?? "home");
            const tiles: Tile[] = [];
            for (const tile of Object.values(params.boardData.tiles)) {
                const normalizedCategoryId = boardIds.has(tile.categoryId) ? tile.categoryId : fallbackCategoryId;
                if (tile.kind === "word") {
                    tiles.push({ ...tile, categoryId: normalizedCategoryId });
                } else if (tile.kind === "folder" && tile.targetBoardId && boardIds.has(tile.targetBoardId)) {
                    tiles.push({ ...tile, categoryId: normalizedCategoryId });
                }
            }

            const cloudSettings: CloudSettings = {
                colorSystem: readColorSystem(params.boardData.colorSystem),
                inactiveCatalogLayouts: compactInactiveLayouts,
                catalogOrder: params.boardData.catalogOrder,
                gridConfig: params.boardData.gridConfig,
                layoutMode: params.boardData.layoutMode ?? "manual",
                tileAppearance: params.boardData.tileAppearance,
                speechConfig: params.boardData.speechConfig,
                accessConfig: {
                    longPressToEdit: params.boardData.accessConfig.longPressToEdit,
                    holdDurationMs: params.boardData.accessConfig.holdDurationMs,
                    moveTolerancePx: params.boardData.accessConfig.moveTolerancePx,
                    swipeThresholdPx: params.boardData.accessConfig.swipeThresholdPx,
                },
                featureFlags: params.boardData.featureFlags,
            };
            const settingsRow = settingsToRow(profileId, cloudSettings);

            // 3. Require atomic server-side snapshot publication (including owner-only rename).
            const { data: rpcRevision, error: rpcError } = await client.rpc("publish_profile_snapshot", {
                p_profile_id: profileId,
                p_expected_revision: expectedRev ?? null,
                p_boards: boardEntries.map(({ board, catalogSystem }) =>
                    boardToRow(profileId, board, catalogSystem),
                ) as unknown as Json,
                p_tiles: tiles.map(t => tileToRow(profileId, t)) as unknown as Json,
                p_settings: settingsRow as unknown as Json,
                p_profile_name: params.profileName,
            });

            if (rpcError) {
                if (isMissingPublishRpcError(rpcError)) {
                    throw new Error(
                        "Cloud publishing requires the atomic publish_profile_snapshot database function. Please run database migrations; your local draft is preserved.",
                    );
                }
                throw new Error(rpcError.message);
            }
            if (typeof rpcRevision !== "number") {
                throw new Error("Cloud publish returned an invalid revision.");
            }
            const nextRevision = rpcRevision;
            snapshotCommitted = true;

            const staleIds = [...existingRemoteIds].filter(id => !mediaIds.has(id));
            if (staleIds.length > 0) {
                await repo.removeProfileMedia(profileId, staleIds).catch(() => undefined);
            }

            return { ok: true, cloudProfileId: profileId, revision: nextRevision };
        } catch (error) {
            if (!snapshotCommitted && !params.cloudProfileId && targetCloudId) {
                try {
                    await client.from("profiles").delete().eq("id", targetCloudId);
                } catch {
                    // Best-effort cleanup of uncommitted shell profile.
                }
            }
            const msg = error instanceof Error ? error.message : "Cloud publish failed.";
            let errorMessage = msg;
            let isConflict = false;
            if (msg.includes("STALE_REVISION")) {
                isConflict = true;
                errorMessage =
                    "Cloud profile was updated on another device. Download a copy before publishing; your local draft is intact.";
            } else if (msg.includes("PERMISSION_DENIED")) {
                errorMessage = "Read-only viewer accounts cannot publish changes to this cloud profile.";
            }
            return {
                ok: false,
                ...(params.cloudProfileId ? { cloudProfileId: params.cloudProfileId, revision: expectedRev ?? 1 } : {}),
                ...(isConflict ? { isConflict: true } : {}),
                error: errorMessage,
            };
        }
    }

    async downloadAsLocalCopy(
        cloudProfile: ProfileRow,
        userId: string,
        targetLocalProfileId?: string,
    ): Promise<{ ok: boolean; doc?: LocalProfileDocument; error?: string }> {
        const client = this.getClient();
        if (!client) return { ok: false, error: "Supabase is not configured." };
        const user = await this.getCurrentUser();
        if (user?.id !== userId) return { ok: false, error: "The signed-in account changed." };

        const repo = this.makeRepo(client);
        const localProfileId = targetLocalProfileId ?? `profile-${uid()}`;
        const newlyAddedMediaIds: string[] = [];
        let aborted = false;
        try {
            const [boardEntries, tiles, settings] = await Promise.all([
                repo.listBoards(cloudProfile.id),
                repo.listTiles(cloudProfile.id),
                repo.getSettings(cloudProfile.id),
            ]);

            const defaults = initialData();
            const boardMap: Record<string, CatalogBoard> = {};
            const inactiveBoardsBySystem: Partial<Record<ColorSystemId, Record<string, CatalogBoard>>> = {};
            for (const { board, catalogSystem } of boardEntries) {
                if (catalogSystem === null) {
                    boardMap[board.id] = board;
                } else {
                    const bucket = (inactiveBoardsBySystem[catalogSystem] ??= {});
                    bucket[board.id] = board;
                }
            }
            const rawInactiveLayouts: Record<string, { boards: Record<string, CatalogBoard>; catalogOrder: string[] }> = {};
            for (const [system, compact] of Object.entries(settings?.inactiveCatalogLayouts ?? {}) as [
                ColorSystemId,
                NonNullable<CompactInactiveCatalogLayouts[ColorSystemId]>,
            ][]) {
                if (!compact) continue;
                const systemBoards: Record<string, CatalogBoard> = {
                    ...(inactiveBoardsBySystem[system] ?? {}),
                    home: compact.home,
                };
                for (const id of compact.catalogOrder) {
                    if (!Object.hasOwn(systemBoards, id) && Object.hasOwn(boardMap, id)) {
                        systemBoards[id] = boardMap[id];
                    }
                }
                rawInactiveLayouts[system] = {
                    boards: systemBoards,
                    catalogOrder: compact.catalogOrder,
                };
            }
            const inactiveCatalogLayouts = sanitizeInactiveCatalogLayouts(rawInactiveLayouts);
            const hasInactiveLayouts = Boolean(inactiveCatalogLayouts && Object.keys(inactiveCatalogLayouts).length > 0);

            const tileMap: Record<string, Tile> = {};
            for (const tile of tiles) {
                tileMap[tile.id] = tile;
            }

            // Download missing referenced media into local IndexedDB under the target localProfileId.
            const mediaIds = [...new Set(Object.values(tileMap).flatMap(tile => (tile.mediaId ? [tile.mediaId] : [])))];
            await runInChunks(mediaIds, MEDIA_CONCURRENCY, async mediaId => {
                if (aborted) return;
                if (targetLocalProfileId && (await this.mediaRepo.loadMedia(localProfileId, mediaId)) !== null) {
                    return;
                }
                const blob = await repo.downloadProfileMedia(cloudProfile.id, mediaId);
                if (aborted) return;
                if (!blob) throw new Error(`Could not download photo ${mediaId}.`);
                const saved = await this.mediaRepo.saveMedia(localProfileId, mediaId, blob, {
                    mimeType: blob.type || "image/webp", width: 0, height: 0,
                });
                if (!saved.ok) throw new Error(`Could not save photo ${mediaId}: ${saved.error ?? "storage error"}`);
                if (aborted) {
                    await this.mediaRepo.removeMedia(localProfileId, mediaId);
                    return;
                }
                newlyAddedMediaIds.push(mediaId);
            });

            const boardData: BoardData = {
                ...defaults,
                boards: Object.keys(boardMap).length ? boardMap : defaults.boards,
                tiles: Object.keys(tileMap).length ? tileMap : defaults.tiles,
                ...(settings
                    ? {
                          catalogOrder: settings.catalogOrder,
                          colorSystem: settings.colorSystem,
                          ...(hasInactiveLayouts ? { inactiveCatalogLayouts } : {}),
                          gridConfig: settings.gridConfig,
                          layoutMode: settings.layoutMode ?? defaults.layoutMode,
                          tileAppearance: settings.tileAppearance,
                          speechConfig: settings.speechConfig,
                          accessConfig: {
                              ...defaults.accessConfig,
                              ...settings.accessConfig,
                          },
                          featureFlags: settings.featureFlags ?? defaults.featureFlags,
                      }
                    : {}),
                sentence: [],
            };

            if ((await this.getCurrentUser())?.id !== userId) throw new Error("The signed-in account changed.");
            return {
                ok: true,
                doc: {
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    localProfileId,
                    name: cloudProfile.name,
                    cloudProfileId: cloudProfile.id,
                    cloudRevision: cloudProfile.revision ?? 1,
                    ownerUserId: userId,
                    dirty: false,
                    localEditVersion: 0,
                    lastPublishedEditVersion: 0,
                    boardData,
                },
            };
        } catch (error) {
            aborted = true;
            if (!targetLocalProfileId) {
                await discardPreparedMedia(localProfileId, this.mediaRepo);
            } else {
                await Promise.all(newlyAddedMediaIds.map(id => this.mediaRepo.removeMedia(localProfileId, id)));
            }
            return {
                ok: false,
                error: error instanceof Error ? error.message : "Could not download cloud profile.",
            };
        }
    }

    async deleteCloudProfile(profileId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
        const client = this.getClient();
        if (!client) return { ok: false, error: "Supabase is not configured." };
        try {
            const user = await this.getCurrentUser();
            if (user?.id !== userId) {
                return { ok: false, error: "The signed-in account changed." };
            }
            const repo = this.makeRepo(client);
            const mediaIds = await repo.listProfileMedia(profileId).catch(() => []);
            if (mediaIds.length > 0) {
                await repo.removeProfileMedia(profileId, mediaIds).catch(() => undefined);
            }
            await repo.deleteProfile(profileId);
            return { ok: true };
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : "Could not delete cloud profile.",
            };
        }
    }

    async syncAssignedProfileForCurrentUser(
        userId: string,
        currentCloudProfileId: string | null,
        currentRevision: number | null,
        isLocalDirty: boolean,
        targetLocalProfileId?: string,
    ): Promise<{ ok: boolean; doc?: LocalProfileDocument; updated?: boolean; conflictProfile?: ProfileRow; error?: string }> {
        const res = await this.listCloudProfiles(userId);
        if (!res.ok || res.profiles.length === 0) {
            return { ok: res.ok, updated: false, ...(res.error ? { error: res.error } : {}) };
        }

        const target =
            (currentCloudProfileId
                ? res.profiles.find(p => p.id === currentCloudProfileId)
                : undefined) ?? res.profiles[0];
        if (!target) {
            return { ok: true, updated: false };
        }

        if (isLocalDirty) {
            if (
                currentCloudProfileId === null ||
                target.id !== currentCloudProfileId ||
                (target.revision ?? 1) > (currentRevision ?? 0)
            ) {
                return { ok: true, updated: false, conflictProfile: target };
            }
            return { ok: true, updated: false };
        }

        if (
            target.id === currentCloudProfileId &&
            (target.revision ?? 1) <= (currentRevision ?? 0)
        ) {
            return { ok: true, updated: false };
        }

        const dl = await this.downloadAsLocalCopy(
            target,
            userId,
            target.id === currentCloudProfileId ? targetLocalProfileId : undefined,
        );
        if (!dl.ok || !dl.doc) {
            return { ok: false, error: dl.error };
        }
        return { ok: true, doc: dl.doc, updated: true };
    }
}

export const cloudSyncService = new CloudSyncService();
