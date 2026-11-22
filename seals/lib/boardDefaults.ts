import {
    CATEGORY_IDS,
    CATEGORIES,
    INITIAL_DICTIONARY,
    DEFAULT_GRID,
    clampGrid,
    cellKey,
    type Tile,
    type CatalogBoard,
    type ColorKey,
    type GridConfig,
    type BoardPage,
    type CellKey,
    type CellPlacement,
} from "@/lib/board";
import { DEFAULT_FEATURE_FLAGS, type BoardData } from "@/models/boardData";
import {
    AccessConfigSchema,
    ChatMessageSchema,
    FeatureFlagsSchema,
    SentenceTokenSchema,
    SpeechConfigSchema,
    TileAppearanceSchema,
    TileSchema,
} from "@/lib/boardSchemas";

export function initialData(): BoardData {
    const tiles: Record<string, Tile> = {};
    const boards: Record<string, CatalogBoard> = {};
    const colors: ColorKey[] = ["rose", "emerald", "amber", "blue"];
    CATEGORY_IDS.forEach((id, n) => {
        const cells: CatalogBoard["pages"][number]["cells"] = {};
        INITIAL_DICTIONARY[id].forEach((word, i) => {
            tiles[word.id] = { ...word, kind: "word", language: "fil" };
            cells[cellKey(Math.floor(i / 4), i % 4)] = { tileId: word.id };
        });
        boards[id] = {
            id,
            name: CATEGORIES[id].label,
            shortName: CATEGORIES[id].wheel,
            colorKey: colors[n],
            iconName: INITIAL_DICTIONARY[id][0].iconName,
            isBuiltIn: true,
            pages: [{ cells }],
        };
    });
    const cells: CatalogBoard["pages"][number]["cells"] = {};
    for (let i = 0; i < 20; i++) {
        cells[cellKey(Math.floor(i / 4), i % 4)] = {
            tileId: INITIAL_DICTIONARY[CATEGORY_IDS[i % 4]][Math.floor(i / 4)].id,
        };
    }
    boards.home = {
        id: "home",
        name: "Home",
        shortName: "Home",
        colorKey: "slate",
        iconName: null,
        isBuiltIn: true,
        pages: [{ cells }],
    };
    return {
        tiles,
        boards,
        catalogOrder: [...CATEGORY_IDS],
        gridConfig: { ...DEFAULT_GRID },
        layoutMode: "manual",
        tileAppearance: {
            labelPosition: "bottom",
            fontScale: "md",
            iconScale: "md",
            showIcons: true,
            gridGap: "normal",
            colorMode: "catalog",
            tileWidth: 50,
            tileHeight: 50,
        },
        speechConfig: {
            volume: 1,
            speakOnTap: true,
            autoClear: "off",
            rate: 1,
        },
        accessConfig: {
            longPressToEdit: true,
            holdDurationMs: 650,
            moveTolerancePx: 12,
            swipeThresholdPx: 60,
        },
        featureFlags: { ...DEFAULT_FEATURE_FLAGS },
        sentence: [],
    };
}

const VALID_COLOR_KEYS: ReadonlySet<string> = new Set<ColorKey>([
    "rose",
    "emerald",
    "amber",
    "blue",
    "violet",
    "teal",
    "orange",
    "pink",
    "slate",
]);

const CELL_KEY_RE = /^(0|[1-9]|1[0-5]):(0|[1-9]|1[0-5])$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidColorKey(value: unknown): value is ColorKey {
    return typeof value === "string" && VALID_COLOR_KEYS.has(value);
}

function sanitizeGrid(value: Record<string, unknown>, fallback: GridConfig): GridConfig {
    const rows = typeof value.rows === "number" && Number.isFinite(value.rows) ? value.rows : fallback.rows;
    const cols = typeof value.cols === "number" && Number.isFinite(value.cols) ? value.cols : fallback.cols;
    return clampGrid({ rows, cols });
}

function sanitizePages(rawPages: unknown): BoardPage[] {
    if (!Array.isArray(rawPages) || rawPages.length === 0) {
        return [{ cells: {} }];
    }
    const pages: BoardPage[] = [];
    for (const rawPage of rawPages) {
        if (!isPlainObject(rawPage) || !isPlainObject(rawPage.cells)) continue;
        const cells: Partial<Record<CellKey, CellPlacement>> = {};
        for (const [key, rawCell] of Object.entries(rawPage.cells)) {
            if (
                !CELL_KEY_RE.test(key) ||
                !isPlainObject(rawCell) ||
                typeof rawCell.tileId !== "string" ||
                rawCell.tileId.length === 0
            ) {
                continue;
            }
            cells[key as CellKey] =
                typeof rawCell.hidden === "boolean"
                    ? { tileId: rawCell.tileId, hidden: rawCell.hidden }
                    : { tileId: rawCell.tileId };
        }
        pages.push({ cells });
    }
    return pages.length > 0 ? pages : [{ cells: {} }];
}

function sanitizeBoards(rawBoards: Record<string, unknown>, fallbackGrid: GridConfig): Record<string, CatalogBoard> {
    const boards: Record<string, CatalogBoard> = {};
    for (const [key, rawBoard] of Object.entries(rawBoards)) {
        if (key === "__proto__" || !isPlainObject(rawBoard)) continue;
        if (
            typeof rawBoard.id !== "string" ||
            typeof rawBoard.name !== "string" ||
            typeof rawBoard.shortName !== "string" ||
            typeof rawBoard.isBuiltIn !== "boolean"
        ) {
            continue;
        }
        boards[key] = {
            id: rawBoard.id,
            name: rawBoard.name,
            shortName: rawBoard.shortName,
            colorKey: isValidColorKey(rawBoard.colorKey) ? rawBoard.colorKey : "slate",
            iconName: typeof rawBoard.iconName === "string" ? rawBoard.iconName : null,
            isBuiltIn: rawBoard.isBuiltIn,
            ...(isPlainObject(rawBoard.gridOverride)
                ? { gridOverride: sanitizeGrid(rawBoard.gridOverride, fallbackGrid) }
                : {}),
            ...(rawBoard.layoutModeOverride === "manual" || rawBoard.layoutModeOverride === "automatic"
                ? { layoutModeOverride: rawBoard.layoutModeOverride }
                : {}),
            pages: sanitizePages(rawBoard.pages),
        };
    }
    return boards;
}

function sanitizeTiles(
    rawTiles: Record<string, unknown>,
    defaultTiles: Record<string, Tile> = initialData().tiles,
): Record<string, Tile> {
    const tiles: Record<string, Tile> = {};
    for (const [key, rawTile] of Object.entries(rawTiles)) {
        if (key === "__proto__") continue;
        const parsed = TileSchema.safeParse(rawTile);
        if (parsed.success) {
            tiles[key] = parsed.data;
        } else if (Object.prototype.hasOwnProperty.call(defaultTiles, key)) {
            tiles[key] = defaultTiles[key];
        }
    }
    return tiles;
}

function mergeValidFields<T extends object>(
    defaultsObj: T,
    rawObj: unknown,
    shape: {
        [K in keyof T]: {
            safeParse: (value: unknown) => { success: true; data: T[K] } | { success: false };
        };
    },
): T {
    const result = { ...defaultsObj };
    if (!isPlainObject(rawObj)) return result;
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
        if (Object.prototype.hasOwnProperty.call(rawObj, key)) {
            const parsed = shape[key].safeParse(rawObj[key]);
            if (parsed.success) {
                result[key] = parsed.data;
            }
        }
    }
    return result;
}

function sanitizeExperimentalData(rawExp: unknown): BoardData["experimentalData"] | undefined {
    if (!isPlainObject(rawExp)) return undefined;
    const result: NonNullable<BoardData["experimentalData"]> = {};
    if (Array.isArray(rawExp.scribbleDrafts)) {
        result.scribbleDrafts = rawExp.scribbleDrafts.flatMap(item =>
            typeof item === "string" ? [item] : [],
        );
    }
    if (Array.isArray(rawExp.chatMessages)) {
        result.chatMessages = rawExp.chatMessages.flatMap(item => {
            const parsed = ChatMessageSchema.safeParse(item);
            return parsed.success ? [parsed.data] : [];
        });
    }
    if (Array.isArray(rawExp.pinnedTileIds)) {
        result.pinnedTileIds = rawExp.pinnedTileIds.flatMap(item =>
            typeof item === "string" && item.length > 0 ? [item] : [],
        );
    }
    return result;
}

export function sanitizeBoardData(raw: unknown): BoardData | null {
    if (!isPlainObject(raw)) return null;
    if (!isPlainObject(raw.tiles) || !isPlainObject(raw.boards)) return null;

    const defaults = initialData();
    const rawAccess = isPlainObject(raw.accessConfig) ? raw.accessConfig : {};
    const experimentalData = sanitizeExperimentalData(raw.experimentalData);

    return {
        tiles: sanitizeTiles(raw.tiles, defaults.tiles),
        boards: sanitizeBoards(raw.boards, defaults.gridConfig),
        catalogOrder: Array.isArray(raw.catalogOrder)
            ? raw.catalogOrder.filter((id): id is string => typeof id === "string")
            : defaults.catalogOrder,
        gridConfig: isPlainObject(raw.gridConfig)
            ? sanitizeGrid(raw.gridConfig, defaults.gridConfig)
            : defaults.gridConfig,
        layoutMode: raw.layoutMode === "automatic" ? "automatic" : "manual",
        tileAppearance: mergeValidFields(defaults.tileAppearance, raw.tileAppearance, TileAppearanceSchema.shape),
        speechConfig: mergeValidFields(defaults.speechConfig, raw.speechConfig, SpeechConfigSchema.shape),
        accessConfig: {
            ...mergeValidFields(
                {
                    longPressToEdit: defaults.accessConfig.longPressToEdit,
                    holdDurationMs: defaults.accessConfig.holdDurationMs,
                    moveTolerancePx: defaults.accessConfig.moveTolerancePx,
                    swipeThresholdPx: defaults.accessConfig.swipeThresholdPx,
                },
                rawAccess,
                {
                    longPressToEdit: AccessConfigSchema.shape.longPressToEdit,
                    holdDurationMs: AccessConfigSchema.shape.holdDurationMs,
                    moveTolerancePx: AccessConfigSchema.shape.moveTolerancePx,
                    swipeThresholdPx: AccessConfigSchema.shape.swipeThresholdPx,
                },
            ),
        },
        featureFlags: mergeValidFields(defaults.featureFlags, raw.featureFlags, FeatureFlagsSchema.shape),
        ...(experimentalData !== undefined ? { experimentalData } : {}),
        sentence: Array.isArray(raw.sentence)
            ? raw.sentence.flatMap(token => {
                  const parsed = SentenceTokenSchema.safeParse(token);
                  return parsed.success ? [parsed.data] : [];
              })
            : [],
    };
}
