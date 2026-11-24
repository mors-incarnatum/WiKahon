import { uid } from "@/lib/board";
import { initialData, sanitizeBoardData } from "@/lib/boardDefaults";
import {
    PROFILE_SCHEMA_VERSION,
    type ActiveProfileIndex,
    type LocalProfileDocument,
    type LocalProfileLoadResult,
    type LocalStorageStatus,
    type OfflineDesignatedProfileSummary,
    type RecoverableLegacyProfileSummary,
} from "@/models/profile";
import type { BoardData } from "@/models/boardData";

export const ACTIVE_PROFILE_INDEX_KEY = "wikahon-active-profile-v3";
export const PROFILE_KEY_PREFIX = "wikahon-board-v3:";
export const OFFLINE_DESIGNATED_PROFILES_KEY = "wikahon-offline-designated-v1";

export function activeProfileIndexKey(ownerUserId: string | null): string {
    return `${ACTIVE_PROFILE_INDEX_KEY}:${ownerUserId === null ? "offline" : `user:${ownerUserId}`}`;
}

export function profileStorageKey(localProfileId: string): string {
    return `${PROFILE_KEY_PREFIX}${localProfileId}`;
}

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
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

function classifyWriteError(error: unknown): { status: LocalStorageStatus; message: string } {
    const name = error instanceof Error ? error.name : "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
        return {
            status: "quota-exceeded",
            message: "Device storage is full. Changes remain in memory, but could not be saved. Export a backup.",
        };
    }
    return {
        status: "unavailable",
        message: "Browser storage is unavailable. Changes remain in memory for this session only.",
    };
}

function safeParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
    try {
        return { ok: true, value: JSON.parse(raw) };
    } catch {
        return { ok: false };
    }
}

function readOfflineDesignatedEntries(storage: StorageLike): OfflineDesignatedProfileSummary[] {
    const raw = storage.getItem(OFFLINE_DESIGNATED_PROFILES_KEY);
    if (!raw) return [];
    const parsed = safeParseJson(raw);
    if (!parsed.ok || !Array.isArray(parsed.value)) return [];
    const byId = new Map<string, OfflineDesignatedProfileSummary>();
    for (const item of parsed.value) {
        if (item === null || typeof item !== "object") continue;
        const entry = item as Record<string, unknown>;
        if (
            typeof entry.localProfileId !== "string" ||
            entry.localProfileId.trim().length === 0 ||
            typeof entry.ownerUserId !== "string" ||
            entry.ownerUserId.trim().length === 0
        ) {
            continue;
        }
        const name =
            typeof entry.name === "string" && entry.name.trim().length > 0
                ? entry.name.trim()
                : "Child Profile";
        byId.set(entry.localProfileId, {
            localProfileId: entry.localProfileId,
            name,
            ownerUserId: entry.ownerUserId,
        });
    }
    return Array.from(byId.values());
}

function writeOfflineDesignatedEntries(storage: StorageLike, entries: OfflineDesignatedProfileSummary[]): void {
    if (entries.length === 0) {
        storage.removeItem(OFFLINE_DESIGNATED_PROFILES_KEY);
    } else {
        storage.setItem(OFFLINE_DESIGNATED_PROFILES_KEY, JSON.stringify(entries));
    }
}

export function isOfflineDesignatedProfile(
    storage: StorageLike,
    localProfileId: string,
    docOwnerId: string | null,
): boolean {
    if (typeof docOwnerId !== "string" || docOwnerId.length === 0) return false;
    return readOfflineDesignatedEntries(storage).some(
        entry => entry.localProfileId === localProfileId && entry.ownerUserId === docOwnerId,
    );
}

function belongsToAccount(
    value: unknown,
    localProfileId: string,
    ownerUserId: string | null,
    allowOfflineDesignated = false,
    storage: StorageLike | null = null,
): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const doc = value as Record<string, unknown>;
    if (doc.localProfileId !== localProfileId) return false;
    const docOwnerId = typeof doc.ownerUserId === "string" ? doc.ownerUserId : null;
    if (ownerUserId !== null) {
        return docOwnerId === ownerUserId;
    }
    if (docOwnerId === null && !doc.cloudProfileId) {
        return true;
    }
    return (
        allowOfflineDesignated &&
        storage !== null &&
        typeof doc.ownerUserId === "string" &&
        isOfflineDesignatedProfile(storage, localProfileId, doc.ownerUserId)
    );
}

// Another tab may have upgraded this key since the active board was loaded.
function savedWithNewerVersion(storage: StorageLike, key: string): boolean {
    const raw = storage.getItem(key);
    if (raw === null) return false;
    const parsed = safeParseJson(raw);
    return parsed.ok && typeof parsed.value === "object" && parsed.value !== null
        && "schemaVersion" in parsed.value && typeof parsed.value.schemaVersion === "number"
        && parsed.value.schemaVersion > PROFILE_SCHEMA_VERSION;
}

export class LocalProfileService {
    private storage: StorageLike | null;

    constructor(storage?: StorageLike | null) {
        this.storage = getBrowserStorage(storage);
    }

    private getStorage(): StorageLike | null {
        return this.storage ?? getBrowserStorage();
    }

    saveProfileDocument(
        doc: LocalProfileDocument,
        options?: { allowOfflineDesignated?: boolean },
    ): { ok: boolean; status: LocalStorageStatus; errorMessage?: string } {
        const storage = this.getStorage();
        if (!storage) {
            return {
                ok: false,
                status: "unavailable",
                errorMessage: "Browser storage is unavailable. Changes are kept in memory only.",
            };
        }
        try {
            const key = profileStorageKey(doc.localProfileId);
            if (savedWithNewerVersion(storage, key)) {
                return { ok: false, status: "unsupported-version", errorMessage: "This profile was saved by a newer version. Changes are kept in memory." };
            }
            const allowOfflineDesignated =
                options?.allowOfflineDesignated ??
                isOfflineDesignatedProfile(storage, doc.localProfileId, doc.ownerUserId ?? null);
            let preservedOwnerUserId = doc.ownerUserId ?? null;
            let preservedCloudProfileId = doc.cloudProfileId ?? null;
            const raw = storage.getItem(key);
            if (raw !== null) {
                const existing = safeParseJson(raw);
                if (
                    !existing.ok ||
                    !belongsToAccount(
                        existing.value,
                        doc.localProfileId,
                        doc.ownerUserId ?? null,
                        allowOfflineDesignated,
                        storage,
                    )
                ) {
                    return { ok: false, status: "corrupt", errorMessage: "The saved profile could not be verified for this account." };
                }
                if (allowOfflineDesignated && !preservedOwnerUserId && typeof existing.value.ownerUserId === "string") {
                    preservedOwnerUserId = existing.value.ownerUserId;
                    if (preservedCloudProfileId === null && typeof existing.value.cloudProfileId === "string") {
                        preservedCloudProfileId = existing.value.cloudProfileId;
                    }
                }
            }
            const payload = JSON.stringify({
                ...doc,
                ownerUserId: preservedOwnerUserId,
                cloudProfileId: preservedCloudProfileId,
                schemaVersion: PROFILE_SCHEMA_VERSION,
                dirty: Boolean(doc.dirty),
                localEditVersion: typeof doc.localEditVersion === "number" ? doc.localEditVersion : 0,
                lastPublishedEditVersion: typeof doc.lastPublishedEditVersion === "number" ? doc.lastPublishedEditVersion : 0,
            });
            storage.setItem(key, payload);
            return { ok: true, status: "ok" };
        } catch (error) {
            const classified = classifyWriteError(error);
            return { ok: false, status: classified.status, errorMessage: classified.message };
        }
    }

    saveActiveIndex(index: ActiveProfileIndex, ownerUserId: string | null): { ok: boolean; status: LocalStorageStatus; errorMessage?: string } {
        const storage = this.getStorage();
        if (!storage) {
            return { ok: false, status: "unavailable", errorMessage: "Browser storage is unavailable." };
        }
        try {
            const key = activeProfileIndexKey(ownerUserId);
            if (savedWithNewerVersion(storage, key)) {
                return { ok: false, status: "unsupported-version", errorMessage: "The saved profile list requires a newer version." };
            }
            storage.setItem(key, JSON.stringify(index));
            return { ok: true, status: "ok" };
        } catch (error) {
            const classified = classifyWriteError(error);
            return { ok: false, status: classified.status, errorMessage: classified.message };
        }
    }

    loadProfileDocument(
        localProfileId: string,
        ownerUserId: string | null,
        options?: { allowOfflineDesignated?: boolean },
    ): {
        doc: LocalProfileDocument | null;
        status: LocalStorageStatus;
        errorMessage?: string;
        unsupportedPayload?: unknown;
    } {
        const storage = this.getStorage();
        if (!storage) {
            return { doc: null, status: "unavailable", errorMessage: "Browser storage is unavailable." };
        }
        const raw = storage.getItem(profileStorageKey(localProfileId));
        if (!raw) {
            return { doc: null, status: "corrupt", errorMessage: "Profile data was not found." };
        }
        const parsed = safeParseJson(raw);
        if (
            !parsed.ok ||
            !belongsToAccount(
                parsed.value,
                localProfileId,
                ownerUserId,
                Boolean(options?.allowOfflineDesignated),
                storage,
            )
        ) {
            return { doc: null, status: "corrupt", errorMessage: "Profile is unavailable for this account." };
        }
        const obj = parsed.value;
        const version = typeof obj.schemaVersion === "number" ? obj.schemaVersion : 0;
        if (version > PROFILE_SCHEMA_VERSION) {
            return {
                doc: null,
                status: "unsupported-version",
                errorMessage: `Profile uses unsupported schema version ${version}. Preserved without overwriting.`,
                unsupportedPayload: obj,
            };
        }
        const validBoard = sanitizeBoardData(obj.boardData);
        if (version !== PROFILE_SCHEMA_VERSION || !validBoard) {
            return { doc: null, status: "corrupt", errorMessage: "Profile data is invalid." };
        }
        const rawDoc = obj as unknown as LocalProfileDocument;
        let dirty = Boolean(obj.dirty);
        let localEditVersion: number;
        let lastPublishedEditVersion: number;
        if (typeof obj.localEditVersion !== "number") {
            const defaults = initialData();
            const hasLegacyUnverifiedEdits =
                obj.dirty === true ||
                obj.cloudProfileId != null ||
                JSON.stringify(validBoard.tiles) !== JSON.stringify(defaults.tiles) ||
                JSON.stringify(validBoard.boards) !== JSON.stringify(defaults.boards);
            if (hasLegacyUnverifiedEdits) {
                dirty = true;
                localEditVersion = 1;
                lastPublishedEditVersion = 0;
            } else {
                dirty = false;
                localEditVersion = 0;
                lastPublishedEditVersion = 0;
            }
        } else {
            localEditVersion = obj.localEditVersion;
            lastPublishedEditVersion =
                typeof obj.lastPublishedEditVersion === "number" ? obj.lastPublishedEditVersion : 0;
        }
        return {
            doc: {
                ...rawDoc,
                dirty,
                localEditVersion,
                lastPublishedEditVersion,
                boardData: validBoard,
            },
            status: "ok",
        };
    }

    loadOrMigrateActiveProfile(ownerUserId: string | null): LocalProfileLoadResult {
        const fallbackDoc: LocalProfileDocument = {
            schemaVersion: PROFILE_SCHEMA_VERSION,
            localProfileId: ownerUserId === null ? "default-offline" : `default-user-${ownerUserId}`,
            name: ownerUserId === null ? "Lily's Board" : "My Board",
            cloudProfileId: null,
            cloudRevision: null,
            ownerUserId,
            dirty: false,
            localEditVersion: 0,
            lastPublishedEditVersion: 0,
            boardData: initialData(),
        };
        const fallbackIndex: ActiveProfileIndex = {
            schemaVersion: PROFILE_SCHEMA_VERSION,
            activeProfileId: fallbackDoc.localProfileId,
            profiles: [{
                localProfileId: fallbackDoc.localProfileId,
                name: fallbackDoc.name,
                cloudProfileId: null,
                ownerUserId,
            }],
        };
        const fallback = { index: fallbackIndex, activeDocument: fallbackDoc };
        const storage = this.getStorage();
        if (!storage) {
            return { ...fallback, status: "unavailable", errorMessage: "Browser storage is unavailable." };
        }

        try {
            const scopedIndex = storage.getItem(activeProfileIndexKey(ownerUserId));
            if (scopedIndex !== null) {
                const parsed = safeParseJson(scopedIndex);
                const index = parsed.ok ? parsed.value as Partial<ActiveProfileIndex> | null : null;
                if (typeof index?.schemaVersion === "number" && index.schemaVersion > PROFILE_SCHEMA_VERSION) {
                    return { ...fallback, status: "unsupported-version", errorMessage: "The saved profile list requires a newer version." };
                }
                if (index?.schemaVersion === PROFILE_SCHEMA_VERSION && Array.isArray(index.profiles)) {
                    const documents: LocalProfileDocument[] = [];
                    for (const summary of index.profiles) {
                        if (typeof summary?.localProfileId !== "string") continue;
                        const loaded = this.loadProfileDocument(summary.localProfileId, ownerUserId);
                        if (loaded.status === "unsupported-version") {
                            return { ...fallback, status: loaded.status, errorMessage: loaded.errorMessage };
                        }
                        if (loaded.doc) documents.push(loaded.doc);
                    }
                    const active = documents.find(doc => doc.localProfileId === index.activeProfileId) ?? documents[0];
                    if (active) {
                        const nextIndex: ActiveProfileIndex = {
                            schemaVersion: PROFILE_SCHEMA_VERSION,
                            activeProfileId: active.localProfileId,
                            profiles: documents.map(doc => ({
                                localProfileId: doc.localProfileId,
                                name: doc.name,
                                cloudProfileId: doc.cloudProfileId,
                                ownerUserId,
                            })),
                        };
                        return { index: nextIndex, activeDocument: active, status: "ok" as const };
                    }
                }
                return { ...fallback, status: "corrupt", errorMessage: "Saved profiles are unavailable. Using a temporary board." };
            }

            // A prior save can leave the starter document in place if the index write failed.
            if (storage.getItem(profileStorageKey(fallbackDoc.localProfileId)) !== null) {
                const loaded = this.loadProfileDocument(fallbackDoc.localProfileId, ownerUserId);
                if (!loaded.doc) return { ...fallback, status: loaded.status, errorMessage: loaded.errorMessage };
                fallback.activeDocument = loaded.doc;
                fallbackIndex.profiles[0].name = loaded.doc.name;
                fallbackIndex.profiles[0].cloudProfileId = loaded.doc.cloudProfileId;
            } else {
                const saved = this.saveProfileDocument(fallbackDoc);
                if (!saved.ok) return { ...fallback, ...saved };
            }

            return { ...fallback, ...this.saveActiveIndex(fallbackIndex, ownerUserId) };
        } catch (error) {
            const classified = classifyWriteError(error);
            return { ...fallback, status: classified.status, errorMessage: classified.message };
        }
    }

    createProfileDocument(name: string, boardData?: BoardData): LocalProfileDocument {
        return {
            schemaVersion: PROFILE_SCHEMA_VERSION,
            localProfileId: `profile-${uid()}`,
            name: name.trim() || "Child Profile",
            cloudProfileId: null,
            cloudRevision: null,
            dirty: false,
            localEditVersion: 0,
            lastPublishedEditVersion: 0,
            boardData: boardData ?? initialData(),
        };
    }

    deleteProfileDocument(localProfileId: string, ownerUserId: string | null): void {
        const storage = this.getStorage();
        if (!storage) return;
        try {
            if (this.loadProfileDocument(localProfileId, ownerUserId).doc) {
                storage.removeItem(profileStorageKey(localProfileId));
            }
        } catch {
            // Ignore storage removal errors.
        }
    }

    listOfflineDesignatedProfiles(): OfflineDesignatedProfileSummary[] {
        const storage = this.getStorage();
        if (!storage) return [];
        const entries = readOfflineDesignatedEntries(storage);
        return entries.filter(entry => {
            const raw = storage.getItem(profileStorageKey(entry.localProfileId));
            if (raw === null) return false;
            const parsed = safeParseJson(raw);
            return parsed.ok && belongsToAccount(parsed.value, entry.localProfileId, entry.ownerUserId, false, storage);
        });
    }

    setOfflineDesignatedProfile(
        summary: OfflineDesignatedProfileSummary,
        enabled: boolean,
    ): { ok: boolean; profiles: OfflineDesignatedProfileSummary[] } {
        const storage = this.getStorage();
        if (!storage) return { ok: false, profiles: [] };
        if (!summary.localProfileId || !summary.ownerUserId) {
            return { ok: false, profiles: this.listOfflineDesignatedProfiles() };
        }
        try {
            if (enabled) {
                const raw = storage.getItem(profileStorageKey(summary.localProfileId));
                const parsed = raw !== null ? safeParseJson(raw) : { ok: false as const };
                if (
                    !parsed.ok ||
                    !belongsToAccount(parsed.value, summary.localProfileId, summary.ownerUserId, false, storage)
                ) {
                    return { ok: false, profiles: this.listOfflineDesignatedProfiles() };
                }
            }
            const current = this.listOfflineDesignatedProfiles();
            const normalizedName = summary.name.trim() || "Child Profile";
            const next = enabled
                ? current.some(entry => entry.localProfileId === summary.localProfileId)
                    ? current.map(entry =>
                          entry.localProfileId === summary.localProfileId
                              ? { ...summary, name: normalizedName }
                              : entry,
                      )
                    : [...current, { ...summary, name: normalizedName }]
                : current.filter(entry => entry.localProfileId !== summary.localProfileId);
            writeOfflineDesignatedEntries(storage, next);
            return { ok: true, profiles: this.listOfflineDesignatedProfiles() };
        } catch {
            return { ok: false, profiles: this.listOfflineDesignatedProfiles() };
        }
    }

    syncOfflineDesignatedProfileMeta(
        localProfileId: string,
        ownerUserId: string | null,
        patch: { name?: string; deleted?: boolean },
    ): OfflineDesignatedProfileSummary[] {
        const storage = this.getStorage();
        if (!storage || !ownerUserId) return this.listOfflineDesignatedProfiles();
        try {
            const entries = readOfflineDesignatedEntries(storage);
            const hasMatch = entries.some(
                entry => entry.localProfileId === localProfileId && entry.ownerUserId === ownerUserId,
            );
            if (!hasMatch) return this.listOfflineDesignatedProfiles();
            const trimmedName = typeof patch.name === "string" ? patch.name.trim() : "";
            const next = patch.deleted
                ? entries.filter(
                      entry => !(entry.localProfileId === localProfileId && entry.ownerUserId === ownerUserId),
                  )
                : trimmedName
                  ? entries.map(entry =>
                        entry.localProfileId === localProfileId && entry.ownerUserId === ownerUserId
                            ? { ...entry, name: trimmedName }
                            : entry,
                    )
                  : entries;
            writeOfflineDesignatedEntries(storage, next);
        } catch {
            // Ignore storage errors during metadata sync.
        }
        return this.listOfflineDesignatedProfiles();
    }

    loadOfflineChildProfiles(preferredProfileId?: string): LocalProfileLoadResult {
        const designated = this.listOfflineDesignatedProfiles();
        if (designated.length > 0) {
            const documents: LocalProfileDocument[] = [];
            let unsupportedResult: LocalProfileLoadResult | null = null;
            for (const entry of designated) {
                const loaded = this.loadProfileDocument(entry.localProfileId, entry.ownerUserId);
                if (loaded.status === "unsupported-version" && !unsupportedResult) {
                    const fallbackDoc: LocalProfileDocument = {
                        schemaVersion: PROFILE_SCHEMA_VERSION,
                        localProfileId: "default-offline",
                        name: "Lily's Board",
                        cloudProfileId: null,
                        cloudRevision: null,
                        ownerUserId: null,
                        dirty: false,
                        localEditVersion: 0,
                        lastPublishedEditVersion: 0,
                        boardData: initialData(),
                    };
                    unsupportedResult = {
                        index: {
                            schemaVersion: PROFILE_SCHEMA_VERSION,
                            activeProfileId: fallbackDoc.localProfileId,
                            profiles: [{
                                localProfileId: fallbackDoc.localProfileId,
                                name: fallbackDoc.name,
                                cloudProfileId: null,
                                ownerUserId: null,
                            }],
                        },
                        activeDocument: fallbackDoc,
                        status: loaded.status,
                        errorMessage: loaded.errorMessage,
                        unsupportedPayload: loaded.unsupportedPayload,
                    };
                }
                if (loaded.doc) {
                    documents.push(loaded.doc);
                }
            }
            if (documents.length > 0) {
                const active =
                    (preferredProfileId ? documents.find(doc => doc.localProfileId === preferredProfileId) : undefined) ??
                    documents[0];
                const index: ActiveProfileIndex = {
                    schemaVersion: PROFILE_SCHEMA_VERSION,
                    activeProfileId: active.localProfileId,
                    profiles: documents.map(doc => ({
                        localProfileId: doc.localProfileId,
                        name: doc.name,
                        cloudProfileId: doc.cloudProfileId ?? null,
                        ownerUserId: doc.ownerUserId ?? null,
                    })),
                };
                return { index, activeDocument: active, status: "ok" };
            }
            if (unsupportedResult) {
                return unsupportedResult;
            }
        }
        return this.loadOrMigrateActiveProfile(null);
    }

    listRecoverableLegacyProfiles(): RecoverableLegacyProfileSummary[] {
        const storage = this.getStorage();
        if (!storage) return [];
        const candidateIds: string[] = [];
        const seen = new Set<string>();
        const inLegacyIndex = new Set<string>();

        const rawLegacyIndex = storage.getItem(ACTIVE_PROFILE_INDEX_KEY);
        if (rawLegacyIndex !== null) {
            const parsedIndex = safeParseJson(rawLegacyIndex);
            const indexObj = parsedIndex.ok ? (parsedIndex.value as Partial<ActiveProfileIndex> | null) : null;
            if (Array.isArray(indexObj?.profiles)) {
                for (const summary of indexObj.profiles) {
                    if (typeof summary?.localProfileId === "string" && summary.localProfileId.length > 0) {
                        inLegacyIndex.add(summary.localProfileId);
                        if (!seen.has(summary.localProfileId)) {
                            seen.add(summary.localProfileId);
                            candidateIds.push(summary.localProfileId);
                        }
                    }
                }
            }
        }
        if (storage.getItem(profileStorageKey("default")) !== null && !seen.has("default")) {
            seen.add("default");
            candidateIds.push("default");
        }

        const results: RecoverableLegacyProfileSummary[] = [];
        const defaults = initialData();
        for (const id of candidateIds) {
            const rawDoc = storage.getItem(profileStorageKey(id));
            if (rawDoc === null) continue;
            const parsedDoc = safeParseJson(rawDoc);
            if (!parsedDoc.ok || parsedDoc.value === null || typeof parsedDoc.value !== "object") continue;
            const obj = parsedDoc.value as Record<string, unknown>;
            if ((obj.ownerUserId ?? null) !== null || obj.schemaVersion !== PROFILE_SCHEMA_VERSION) continue;
            const validBoard = sanitizeBoardData(obj.boardData);
            if (!validBoard) continue;
            const cloudProfileId =
                typeof obj.cloudProfileId === "string" && obj.cloudProfileId.trim().length > 0
                    ? obj.cloudProfileId
                    : null;
            const rawName = typeof obj.name === "string" ? obj.name.trim() : "";
            const isDefaultName =
                rawName === "" || rawName === "Lily's Board" || rawName === "My Board" || rawName === "Default";
            if (id === "default" && cloudProfileId === null) {
                const isIdenticalBoard =
                    JSON.stringify(validBoard.tiles) === JSON.stringify(defaults.tiles) &&
                    JSON.stringify(validBoard.boards) === JSON.stringify(defaults.boards) &&
                    JSON.stringify(validBoard.experimentalData ?? null) ===
                        JSON.stringify(defaults.experimentalData ?? null);
                if (isIdenticalBoard && (!inLegacyIndex.has("default") || isDefaultName)) {
                    continue;
                }
            }
            results.push({
                localProfileId: id,
                name: rawName || "Legacy Board",
                cloudProfileId,
            });
        }
        return results;
    }

    readLegacyProfileDocument(legacyProfileId: string): LocalProfileDocument | null {
        const storage = this.getStorage();
        if (!storage) return null;
        const raw = storage.getItem(profileStorageKey(legacyProfileId));
        if (raw === null) return null;
        const parsed = safeParseJson(raw);
        if (!parsed.ok || parsed.value === null || typeof parsed.value !== "object") return null;
        const obj = parsed.value as Record<string, unknown>;
        if ((obj.ownerUserId ?? null) !== null || obj.schemaVersion !== PROFILE_SCHEMA_VERSION) return null;
        if (typeof obj.localProfileId === "string" && obj.localProfileId !== legacyProfileId) return null;
        const validBoard = sanitizeBoardData(obj.boardData);
        if (!validBoard) return null;
        return {
            schemaVersion: PROFILE_SCHEMA_VERSION,
            localProfileId: legacyProfileId,
            name: typeof obj.name === "string" && obj.name.trim().length > 0 ? obj.name.trim() : "Legacy Board",
            cloudProfileId:
                typeof obj.cloudProfileId === "string" && obj.cloudProfileId.trim().length > 0
                    ? obj.cloudProfileId
                    : null,
            cloudRevision: typeof obj.cloudRevision === "number" ? obj.cloudRevision : null,
            ownerUserId: null,
            dirty: Boolean(obj.dirty),
            localEditVersion: typeof obj.localEditVersion === "number" ? obj.localEditVersion : 0,
            lastPublishedEditVersion:
                typeof obj.lastPublishedEditVersion === "number" ? obj.lastPublishedEditVersion : 0,
            boardData: validBoard,
        };
    }

    retireRecoveredLegacyProfile(legacyProfileId: string): void {
        const storage = this.getStorage();
        if (!storage) return;
        try {
            const rawIndex = storage.getItem(ACTIVE_PROFILE_INDEX_KEY);
            if (rawIndex !== null) {
                const parsed = safeParseJson(rawIndex);
                const index = parsed.ok && parsed.value !== null && typeof parsed.value === "object"
                    ? (parsed.value as Partial<ActiveProfileIndex>)
                    : null;
                if (index && Array.isArray(index.profiles)) {
                    const remaining = index.profiles.filter(
                        summary => summary?.localProfileId !== legacyProfileId,
                    );
                    if (remaining.length === 0) {
                        storage.removeItem(ACTIVE_PROFILE_INDEX_KEY);
                    } else {
                        const nextActiveId =
                            index.activeProfileId === legacyProfileId
                                ? remaining[0].localProfileId
                                : index.activeProfileId ?? remaining[0].localProfileId;
                        storage.setItem(
                            ACTIVE_PROFILE_INDEX_KEY,
                            JSON.stringify({
                                ...index,
                                schemaVersion: PROFILE_SCHEMA_VERSION,
                                activeProfileId: nextActiveId,
                                profiles: remaining,
                            }),
                        );
                    }
                }
            }
            storage.removeItem(profileStorageKey(legacyProfileId));
        } catch {
            // Ignore storage cleanup errors after recovery.
        }
    }
}

export const localProfileService = new LocalProfileService();
