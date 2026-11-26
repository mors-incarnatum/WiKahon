import type { Tile, CatalogBoard, GridConfig, SentenceToken, ColorMode, BoardPage, ColorSystemId } from "@/lib/board";

export interface FeatureFlags {
    animation: boolean;
    vibration: boolean;
    categoryWheel: boolean;
    scribblePractice: boolean;
    parentChildChat: boolean;
    pinnedVocabulary: boolean;
    childBoardLayout: boolean;
}

export interface ChatMessage {
    id: string;
    sender: "child" | "guardian";
    text: string;
    senderUserId?: string | null;
    senderName?: string | null;
    verified?: boolean;
    pendingContext?: { userId: string; localProfileId: string; cloudProfileId: string };
    createdAt?: string;
}

export interface ExperimentalData {
    scribbleDrafts?: string[];
    chatMessages?: ChatMessage[];
    pinnedTileIds?: string[];
}

export interface CatalogLayout {
    boards: Record<string, CatalogBoard>;
    catalogOrder: string[];
}

export type InactiveCatalogLayouts = Partial<Record<ColorSystemId, CatalogLayout>>;

export interface BoardData {
    tiles: Record<string, Tile>;
    boards: Record<string, CatalogBoard>;
    catalogOrder: string[];
    colorSystem?: ColorSystemId;
    inactiveCatalogLayouts?: InactiveCatalogLayouts;
    gridConfig: GridConfig;
    layoutMode?: "manual" | "automatic";
    tileAppearance: {
        labelPosition: "top" | "bottom";
        fontScale: "sm" | "md" | "lg";
        iconScale: "sm" | "md" | "lg";
        showIcons: boolean;
        gridGap: "compact" | "normal" | "relaxed";
        colorMode: ColorMode;
        tileWidth: number;
        tileHeight: number;
    };
    speechConfig: {
        volume: number;
        speakOnTap: boolean;
        autoClear: "off" | "afterSpeak" | "nextTap";
        rate: number;
    };
    accessConfig: {
        longPressToEdit: boolean;
        holdDurationMs: number;
        moveTolerancePx: number;
        swipeThresholdPx: number;
    };
    featureFlags: FeatureFlags;
    experimentalData?: ExperimentalData;
    sentence: SentenceToken[];
}

export interface PreReflowSnapshot {
    previousGlobalGrid: GridConfig;
    boards: {
        boardId: string;
        previousGrid?: GridConfig;
        pages: BoardPage[];
    }[];
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
    animation: false,
    vibration: false,
    categoryWheel: false,
    scribblePractice: false,
    parentChildChat: false,
    pinnedVocabulary: false,
    childBoardLayout: false,
};

export const SAFE_MEDIA_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidMediaId(id: unknown): id is string {
    return typeof id === "string" && SAFE_MEDIA_ID_RE.test(id);
}
