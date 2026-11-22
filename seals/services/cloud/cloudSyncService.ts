import { uid, type CatalogBoard, type Tile } from "@/lib/board";
import { initialData } from "@/lib/boardDefaults";
import type { BoardData } from "@/models/boardData";
import { PROFILE_SCHEMA_VERSION, type LocalProfileDocument } from "@/models/profile";
import { getSupabaseBrowserClient, type BoardSupabaseClient } from "@/models/supabase/client";
import { SupabaseBoardRepository, type IBoardRepository } from "@/models/supabase/boardRepository";
import type { Json, ProfileRow } from "@/models/supabase/database.types";
import {
    boardToRow,
    settingsToRow,
    tileToRow,
    tileToWord,
    wordToRow,
    wordToTile,
} from "@/models/supabase/mappers";
import type { Word } from "@/models/word";
import { discardPreparedMedia, mediaRepository, type IMediaRepository } from "@/services/storage/mediaRepository";

export interface CloudUser {
    id: string;
    email: string | null;
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
            for (const mediaId of mediaIds) {
                const record = await this.mediaRepo.loadMedia(params.localProfileId, mediaId);
                if (!record) throw new Error(`Cannot publish: missing photo ${mediaId}.`);
                await repo.uploadProfileMedia(profileId, mediaId, record.blob, record.mimeType);
            }

            // 2. Normalize boards, words (public.words), and folder tiles (public.tiles).
            // Include inactive catalogs so shared vocabulary and folder targets retain their database references.
            const inactiveBoards = Object.values(params.boardData.inactiveCatalogLayouts ?? {})
                .flatMap(layout => Object.values(layout.boards).filter(board => board.id !== "home"));
            const boards = [...new Map(
                [...inactiveBoards, ...Object.values(params.boardData.boards)].map(board => [board.id, board]),
            ).values()];
            const boardIds = new Set(boards.map(b => b.id));
            const fallbackCategoryId = boardIds.has("home") ? "home" : (boards[0]?.id ?? "home");
            const words: Word[] = [];
            const folderTiles: Tile[] = [];
            for (const tile of Object.values(params.boardData.tiles)) {
                const normalizedCategoryId = boardIds.has(tile.categoryId) ? tile.categoryId : fallbackCategoryId;
                if (tile.kind === "word") {
                    words.push(tileToWord({ ...tile, categoryId: normalizedCategoryId }));
                } else if (tile.kind === "folder" && tile.targetBoardId && boardIds.has(tile.targetBoardId)) {
                    folderTiles.push({ ...tile, categoryId: normalizedCategoryId });
                }
            }

            // Keep the two UI palette additions in settings JSON alongside existing database enum values.
            const colorOverrides = (entries: { id: string; colorKey?: Tile["colorKey"] }[]) =>
                Object.fromEntries(entries.flatMap(({ id, colorKey }) =>
                    colorKey === "yellow" || colorKey === "white" ? [[id, colorKey] as const] : [],
                ));
            const cloudSettings = {
                colorSystem: params.boardData.colorSystem,
                inactiveCatalogLayouts: params.boardData.inactiveCatalogLayouts,
                colorOverrides: {
                    boards: colorOverrides(boards),
                    tiles: colorOverrides([...words, ...folderTiles]),
                },
                catalogOrder: params.boardData.catalogOrder,
                gridConfig: params.boardData.gridConfig,
                layoutMode: params.boardData.layoutMode,
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

            // 3. Require atomic server-side snapshot publication.
            const { data: rpcRevision, error: rpcError } = await client.rpc("publish_profile_snapshot", {
                p_profile_id: profileId,
                p_expected_revision: expectedRev ?? null,
                p_boards: boards.map(b => boardToRow(profileId, b)) as unknown as Json,
                p_tiles: folderTiles.map(t => tileToRow(profileId, t)) as unknown as Json,
                p_words: words.map(w => wordToRow(profileId, w)) as unknown as Json,
                p_settings: settingsRow as unknown as Json,
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

            if (params.cloudProfileId) {
                const profilesTable = client.from("profiles");
                if (profilesTable && typeof profilesTable.select === "function" && typeof profilesTable.update === "function") {
                    const { data: existingProfile } = await profilesTable
                        .select("name")
                        .eq("id", profileId)
                        .maybeSingle();
                    if (!existingProfile || existingProfile.name !== params.profileName) {
                        const { error: renameError } = await profilesTable
                            .update({ name: params.profileName })
                            .eq("id", profileId);
                        if (renameError) throw new Error(renameError.message);
                    }
                } else if (profilesTable && typeof profilesTable.update === "function") {
                    const { error: renameError } = await profilesTable
                        .update({ name: params.profileName })
                        .eq("id", profileId);
                    if (renameError) throw new Error(renameError.message);
                }
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
        try {
            const [boards, folderTiles, words, settings] = await Promise.all([
                repo.listBoards(cloudProfile.id),
                repo.listTiles(cloudProfile.id),
                repo.listWords(cloudProfile.id),
                repo.getSettings(cloudProfile.id),
            ]);

            const defaults = initialData();
            const boardMap: Record<string, CatalogBoard> = {};
            const inactiveIds = new Set(Object.values(settings?.inactiveCatalogLayouts ?? {})
                .flatMap(layout => Object.keys(layout.boards).filter(id => id !== "home")));
            const activeIds = new Set(settings?.catalogOrder);
            for (const board of boards) {
                if (inactiveIds.has(board.id) && !activeIds.has(board.id)) continue;
                const override = settings?.colorOverrides?.boards[board.id];
                boardMap[board.id] = override ? { ...board, colorKey: override } : board;
            }
            const tileMap: Record<string, Tile> = {};
            for (const tile of [...words.map(wordToTile), ...folderTiles]) {
                const override = settings?.colorOverrides?.tiles[tile.id];
                tileMap[tile.id] = override ? { ...tile, colorKey: override } : tile;
            }

            // Download referenced media into local IndexedDB under the target localProfileId.
            const mediaIds = new Set(Object.values(tileMap).flatMap(tile => (tile.mediaId ? [tile.mediaId] : [])));
            for (const mediaId of mediaIds) {
                const alreadyExists = targetLocalProfileId
                    ? (await this.mediaRepo.loadMedia(localProfileId, mediaId)) !== null
                    : false;
                const blob = await repo.downloadProfileMedia(cloudProfile.id, mediaId);
                if (!blob) throw new Error(`Could not download photo ${mediaId}.`);
                const saved = await this.mediaRepo.saveMedia(localProfileId, mediaId, blob, {
                    mimeType: blob.type || "image/webp", width: 0, height: 0,
                });
                if (!saved.ok) throw new Error(`Could not save photo ${mediaId}: ${saved.error ?? "storage error"}`);
                if (!alreadyExists) {
                    newlyAddedMediaIds.push(mediaId);
                }
            }

            const boardData: BoardData = {
                ...defaults,
                boards: Object.keys(boardMap).length ? boardMap : defaults.boards,
                tiles: Object.keys(tileMap).length ? tileMap : defaults.tiles,
                ...(settings
                    ? {
                          catalogOrder: settings.catalogOrder,
                          colorSystem: settings.colorSystem,
                          inactiveCatalogLayouts: settings.inactiveCatalogLayouts,
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
