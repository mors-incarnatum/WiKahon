import {
    COLOR_SYSTEMS,
    type BoardPage,
    type CatalogBoard,
    type ColorSystemId,
    type GridConfig,
    type LanguageTag,
    type Tile,
} from "@/lib/board";
import { readColorSystem, sanitizeInactiveCatalogLayouts } from "@/lib/boardDefaults";
import { COLOR_KEYS, LANGUAGE_TAGS, WORD_CLASSES } from "@/lib/boardSchemas";
import { DEFAULT_FEATURE_FLAGS, isValidMediaId, type BoardData, type FeatureFlags } from "../boardData";
import type { BoardRow, Insert, Json, ProfileSettingsRow, TileRow } from "./database.types";

export interface BoardEntry {
    board: CatalogBoard;
    catalogSystem: ColorSystemId | null;
}

export interface CompactInactiveCatalogLayout {
    home: CatalogBoard;
    catalogOrder: string[];
}

export type CompactInactiveCatalogLayouts = Partial<Record<ColorSystemId, CompactInactiveCatalogLayout>>;

export type CloudSettings = Pick<
    BoardData,
    "catalogOrder" | "colorSystem" | "gridConfig" | "layoutMode" | "tileAppearance" | "speechConfig"
> & {
    inactiveCatalogLayouts?: CompactInactiveCatalogLayouts;
    accessConfig: BoardData["accessConfig"];
    featureFlags?: FeatureFlags;
};

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireValid(condition: boolean, field: string): asserts condition {
    if (!condition) throw new Error(`Invalid Supabase ${field}`);
}
function oneOf(value: unknown, choices: readonly string[]): boolean {
    return typeof value === "string" && choices.includes(value);
}
export function parseLanguageTag(value: unknown): LanguageTag {
    return value === "fil" || value === "en" || value === "taglish" ? value : "fil";
}
function layoutMode(value: unknown): BoardData["layoutMode"] {
    return value === "manual" || value === "automatic" ? value : undefined;
}
function tileDimension(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : 50;
}
function grid(value: unknown): GridConfig {
    requireValid(
        object(value) &&
            [value.rows, value.cols].every(n => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 16),
        "grid",
    );
    return { rows: value.rows as number, cols: value.cols as number };
}
function pages(value: unknown): BoardPage[] {
    requireValid(Array.isArray(value) && value.length > 0, "pages");
    for (const page of value) {
        requireValid(object(page) && object(page.cells), "page cells");
        for (const [key, cell] of Object.entries(page.cells)) {
            requireValid(
                /^(0|[1-9]|1[0-5]):(0|[1-9]|1[0-5])$/.test(key) &&
                    object(cell) &&
                    typeof cell.tileId === "string" &&
                    cell.tileId.length > 0 &&
                    (cell.hidden === undefined || typeof cell.hidden === "boolean"),
                "cell placement",
            );
        }
    }
    return structuredClone(value) as BoardPage[];
}
function json(value: unknown): Json {
    // Remove optional undefined properties before passing domain interfaces to PostgREST.
    return JSON.parse(JSON.stringify(value)) as Json;
}

function sanitizeCompactInactiveCatalogLayouts(raw: unknown): CompactInactiveCatalogLayouts {
    if (!object(raw)) return {};
    const layouts: CompactInactiveCatalogLayouts = {};
    for (const system of Object.keys(COLOR_SYSTEMS) as ColorSystemId[]) {
        const entry = raw[system];
        if (!object(entry) || !object(entry.home) || !Array.isArray(entry.catalogOrder)) continue;
        const sanitized = sanitizeInactiveCatalogLayouts({
            [system]: { boards: { home: entry.home }, catalogOrder: [] },
        });
        const home = sanitized?.[system]?.boards.home;
        if (!home) continue;
        layouts[system] = {
            home,
            catalogOrder: entry.catalogOrder.filter(
                (id): id is string => typeof id === "string" && id.length > 0 && id !== "home",
            ),
        };
    }
    return layouts;
}

export function boardToRow(
    profileId: string,
    board: CatalogBoard,
    catalogSystem: ColorSystemId | null = null,
): Insert<"boards"> {
    requireValid(
        board.layoutModeOverride === undefined || oneOf(board.layoutModeOverride, ["manual", "automatic"]),
        "board layoutModeOverride",
    );
    requireValid(catalogSystem === null || Object.hasOwn(COLOR_SYSTEMS, catalogSystem), "board catalogSystem");
    const gridOverride = board.gridOverride ? grid(board.gridOverride) : null;
    const row: Insert<"boards"> = {
        profile_id: profileId,
        id: board.id,
        name: board.name,
        short_name: board.shortName,
        color_key: board.colorKey,
        icon_name: board.iconName,
        is_built_in: board.isBuiltIn,
        grid_override: gridOverride ? json(gridOverride) : null,
        layout_mode_override: board.layoutModeOverride ?? null,
        catalog_system: catalogSystem,
        pages: json(pages(board.pages)),
    };
    boardEntryFromRow(row as BoardRow);
    return row;
}

export function boardFromRow(row: BoardRow): CatalogBoard {
    requireValid(typeof row.id === "string" && row.id.length > 0, "board id");
    requireValid(typeof row.name === "string" && row.name.trim().length > 0, "board name");
    requireValid(typeof row.short_name === "string", "board short_name");
    requireValid(oneOf(row.color_key, COLOR_KEYS), "board color_key");
    requireValid(typeof row.is_built_in === "boolean", "board is_built_in");
    requireValid(
        row.layout_mode_override === null ||
            row.layout_mode_override === undefined ||
            oneOf(row.layout_mode_override, ["manual", "automatic"]),
        "board layout_mode_override",
    );
    const parsedGrid = row.grid_override === null ? undefined : grid(row.grid_override);
    const modeOverride = layoutMode(row.layout_mode_override);
    return {
        id: row.id,
        name: row.name,
        shortName: row.short_name,
        colorKey: row.color_key,
        iconName: row.icon_name,
        isBuiltIn: row.is_built_in,
        ...(parsedGrid ? { gridOverride: parsedGrid } : {}),
        ...(modeOverride ? { layoutModeOverride: modeOverride } : {}),
        pages: pages(row.pages),
    };
}

export function boardEntryFromRow(row: BoardRow): BoardEntry {
    requireValid(
        row.catalog_system === null ||
            row.catalog_system === undefined ||
            Object.hasOwn(COLOR_SYSTEMS, row.catalog_system),
        "board catalog_system",
    );
    return {
        board: boardFromRow(row),
        catalogSystem: row.catalog_system ?? null,
    };
}

export function tileToRow(profileId: string, tile: Tile): Insert<"tiles"> {
    const row: Insert<"tiles"> = {
        profile_id: profileId,
        id: tile.id,
        kind: tile.kind,
        label: tile.label,
        spoken_text: tile.spokenText ?? null,
        icon_name: tile.iconName,
        media_id: tile.mediaId ?? null,
        language: parseLanguageTag(tile.language),
        is_quick_phrase: tile.isQuickPhrase ?? false,
        category_id: tile.categoryId,
        // The editor may convert a folder to a word while retaining optional fields.
        target_board_id: tile.kind === "folder" ? (tile.targetBoardId ?? null) : null,
        color_key: tile.colorKey ?? null,
        word_class: tile.wordClass ?? null,
        is_custom: tile.isCustom ?? false,
    };
    tileFromRow(row as TileRow);
    return row;
}

export function tileFromRow(row: TileRow): Tile {
    requireValid(typeof row.id === "string" && row.id.length > 0, "tile id");
    requireValid(typeof row.label === "string" && row.label.trim().length > 0, "tile label");
    requireValid(typeof row.category_id === "string" && row.category_id.length > 0, "tile category_id");
    requireValid(
        (row.kind === "folder" && typeof row.target_board_id === "string" && row.target_board_id.length > 0) ||
            (row.kind === "word" && row.target_board_id === null),
        "tile target_board_id",
    );
    requireValid(row.media_id === null || isValidMediaId(row.media_id), "media_id");
    requireValid(oneOf(row.language, LANGUAGE_TAGS), "tile language");
    requireValid(row.color_key === null || oneOf(row.color_key, COLOR_KEYS), "tile color_key");
    requireValid(row.word_class === null || oneOf(row.word_class, WORD_CLASSES), "tile word_class");
    return {
        id: row.id,
        kind: row.kind,
        label: row.label,
        iconName: row.icon_name,
        categoryId: row.category_id,
        isCustom: row.is_custom,
        language: parseLanguageTag(row.language),
        ...(row.spoken_text === null ? {} : { spokenText: row.spoken_text }),
        ...(row.media_id ? { mediaId: row.media_id } : {}),
        ...(row.is_quick_phrase ? { isQuickPhrase: row.is_quick_phrase } : {}),
        ...(row.target_board_id === null ? {} : { targetBoardId: row.target_board_id }),
        ...(row.color_key === null ? {} : { colorKey: row.color_key }),
        ...(row.word_class === null ? {} : { wordClass: row.word_class }),
    };
}

export function settingsFromRow(row: ProfileSettingsRow): CloudSettings {
    const a = row.tile_appearance,
        s = row.speech_config,
        c = row.access_config;
    requireValid(
        object(a) &&
            oneOf(a.labelPosition, ["top", "bottom"]) &&
            [a.fontScale, a.iconScale].every(v => oneOf(v, ["sm", "md", "lg"])) &&
            typeof a.showIcons === "boolean" &&
            oneOf(a.gridGap, ["compact", "normal", "relaxed"]) &&
            oneOf(a.colorMode, ["catalog", "wordClass", "neutral"]) &&
            [a.tileWidth, a.tileHeight].every(
                v => v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100),
            ),
        "tile appearance",
    );
    requireValid(
        object(s) &&
            typeof s.volume === "number" &&
            Number.isFinite(s.volume) &&
            s.volume >= 0 &&
            s.volume <= 1 &&
            typeof s.speakOnTap === "boolean" &&
            oneOf(s.autoClear, ["off", "afterSpeak", "nextTap"]) &&
            (s.rate === undefined ||
                (typeof s.rate === "number" && Number.isFinite(s.rate) && s.rate >= 0.5 && s.rate <= 2)),
        "speech config",
    );
    requireValid(
        object(c) &&
            !("editPin" in c) &&
            !("pinVerifier" in c) &&
            typeof c.longPressToEdit === "boolean" &&
            [c.holdDurationMs, c.moveTolerancePx, c.swipeThresholdPx].every(
                n => typeof n === "number" && Number.isFinite(n) && n >= 0,
            ),
        "access config",
    );
    requireValid(
        Array.isArray(row.catalog_order) && row.catalog_order.every(id => typeof id === "string"),
        "catalog order",
    );
    requireValid(Object.hasOwn(COLOR_SYSTEMS, row.color_system), "color system");
    requireValid(oneOf(row.layout_mode, ["manual", "automatic"]), "layout mode");
    requireValid(object(row.inactive_catalog_layouts), "inactive catalog layouts");
    for (const [system, entry] of Object.entries(row.inactive_catalog_layouts)) {
        requireValid(
            Object.hasOwn(COLOR_SYSTEMS, system) &&
                object(entry) &&
                object(entry.home) &&
                Array.isArray(entry.catalogOrder) &&
                entry.catalogOrder.every(id => typeof id === "string"),
            "inactive catalog layout",
        );
    }
    requireValid(
        object(row.feature_flags) && Object.values(row.feature_flags).every(v => typeof v === "boolean"),
        "feature flags",
    );
    const rawFlags = row.feature_flags;
    const featureFlags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
    for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof FeatureFlags)[]) {
        if (Object.prototype.hasOwnProperty.call(rawFlags, key)) {
            featureFlags[key] = rawFlags[key] as boolean;
        }
    }
    return {
        catalogOrder: [...row.catalog_order],
        colorSystem: readColorSystem(row.color_system),
        inactiveCatalogLayouts: sanitizeCompactInactiveCatalogLayouts(row.inactive_catalog_layouts),
        gridConfig: grid(row.grid_config),
        layoutMode: layoutMode(row.layout_mode) ?? "manual",
        tileAppearance: {
            labelPosition: a.labelPosition as BoardData["tileAppearance"]["labelPosition"],
            fontScale: a.fontScale as BoardData["tileAppearance"]["fontScale"],
            iconScale: a.iconScale as BoardData["tileAppearance"]["iconScale"],
            showIcons: a.showIcons as boolean,
            gridGap: a.gridGap as BoardData["tileAppearance"]["gridGap"],
            colorMode: a.colorMode as BoardData["tileAppearance"]["colorMode"],
            tileWidth: tileDimension(a.tileWidth),
            tileHeight: tileDimension(a.tileHeight),
        },
        speechConfig: {
            volume: s.volume as number,
            speakOnTap: s.speakOnTap as boolean,
            autoClear: s.autoClear as BoardData["speechConfig"]["autoClear"],
            rate: (s.rate ?? 1) as number,
        },
        accessConfig: {
            longPressToEdit: c.longPressToEdit,
            holdDurationMs: c.holdDurationMs as number,
            moveTolerancePx: c.moveTolerancePx as number,
            swipeThresholdPx: c.swipeThresholdPx as number,
        },
        featureFlags,
    };
}

export function settingsToRow(profileId: string, data: CloudSettings): Insert<"profile_settings"> {
    // Explicit allowlist excludes legacy PIN fields and the local sentence.
    const rawFlags = data.featureFlags ?? DEFAULT_FEATURE_FLAGS;
    const featureFlags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
    for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof FeatureFlags)[]) {
        featureFlags[key] = Boolean(rawFlags[key] ?? DEFAULT_FEATURE_FLAGS[key]);
    }
    const volume =
        typeof data.speechConfig.volume === "number" && Number.isFinite(data.speechConfig.volume)
            ? Math.max(0, Math.min(1, data.speechConfig.volume))
            : data.speechConfig.volume;
    const rate =
        data.speechConfig.rate === undefined
            ? 1
            : typeof data.speechConfig.rate === "number" && Number.isFinite(data.speechConfig.rate)
              ? Math.max(0.5, Math.min(2, data.speechConfig.rate))
              : data.speechConfig.rate;

    const row: Insert<"profile_settings"> = {
        profile_id: profileId,
        catalog_order: [...data.catalogOrder],
        color_system: readColorSystem(data.colorSystem),
        layout_mode: data.layoutMode === "automatic" ? "automatic" : "manual",
        inactive_catalog_layouts: json(sanitizeCompactInactiveCatalogLayouts(data.inactiveCatalogLayouts)),
        grid_config: json(grid(data.gridConfig)),
        tile_appearance: json({
            labelPosition: data.tileAppearance.labelPosition,
            fontScale: data.tileAppearance.fontScale,
            iconScale: data.tileAppearance.iconScale,
            showIcons: data.tileAppearance.showIcons,
            gridGap: data.tileAppearance.gridGap,
            colorMode: data.tileAppearance.colorMode,
            tileWidth: tileDimension(data.tileAppearance.tileWidth),
            tileHeight: tileDimension(data.tileAppearance.tileHeight),
        }),
        speech_config: json({
            volume,
            speakOnTap: data.speechConfig.speakOnTap,
            autoClear: data.speechConfig.autoClear,
            rate,
        }),
        access_config: json({
            longPressToEdit: data.accessConfig.longPressToEdit,
            holdDurationMs: data.accessConfig.holdDurationMs,
            moveTolerancePx: data.accessConfig.moveTolerancePx,
            swipeThresholdPx: data.accessConfig.swipeThresholdPx,
        }),
        feature_flags: json(featureFlags),
    };
    settingsFromRow(row as ProfileSettingsRow);
    return row;
}
