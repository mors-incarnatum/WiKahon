import type { BoardData } from "./boardData";

export const PROFILE_SCHEMA_VERSION = 3 as const;

export interface LocalProfileDocument {
    schemaVersion: typeof PROFILE_SCHEMA_VERSION;
    localProfileId: string;
    name: string;
    cloudProfileId?: string | null;
    cloudRevision?: number | null;
    ownerUserId?: string | null;
    dirty?: boolean; // True when there are unpublished cloud-publishable edits
    localEditVersion?: number; // Monotonic counter incremented on cloud-publishable edits
    lastPublishedEditVersion?: number; // Edit version last confirmed published to cloud
    boardData: BoardData;
}

export interface ProfileSummary {
    localProfileId: string;
    name: string;
    cloudProfileId?: string | null;
    ownerUserId?: string | null;
}

export interface OfflineDesignatedProfileSummary {
    localProfileId: string;
    name: string;
    ownerUserId: string;
}

export interface RecoverableLegacyProfileSummary {
    localProfileId: string;
    name: string;
    cloudProfileId: string | null;
}

export interface ActiveProfileIndex {
    schemaVersion: typeof PROFILE_SCHEMA_VERSION;
    activeProfileId: string;
    profiles: ProfileSummary[];
}

export type LocalStorageStatus =
    | "ok"
    | "unavailable"
    | "quota-exceeded"
    | "corrupt"
    | "unsupported-version";

export interface LocalProfileLoadResult {
    index: ActiveProfileIndex;
    activeDocument: LocalProfileDocument;
    status: LocalStorageStatus;
    errorMessage?: string;
    unsupportedPayload?: unknown;
}
