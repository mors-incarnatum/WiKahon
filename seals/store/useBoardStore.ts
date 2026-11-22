import { createStore } from "zustand/vanilla";
import { persist, createJSONStorage } from "zustand/middleware";
import {
    CATEGORY_IDS,
    CATEGORIES,
    INITIAL_DICTIONARY,
    DEFAULT_GRID,
    MODIFIED_FITZGERALD_CATALOGS,
    TOBII_DYNAVOX_CATALOGS,
    resolveTileColorKey,
    cellKey,
    clampGrid,
    uid,
    type Tile,
    type CatalogBoard,
    type GridConfig,
    type CellKey,
    type SentenceToken,
    type ColorKey,
    type WordTile,
    type ColorSystemId,
    type ColorSystemConfig,
    type TileSystemAssignment
} from "@/lib/board";

export interface BoardData {
    tiles: Record<string, Tile>;
    boards: Record<string, CatalogBoard>;
    catalogOrder: string[];
    colorSystem: ColorSystemId;
    colorSystemConfigs: Partial<Record<ColorSystemId, ColorSystemConfig>>;
    gridConfig: GridConfig;
    layoutMode: "manual" | "automatic";
    tileAppearance: {
        labelPosition: "top" | "bottom";
        fontScale: "sm" | "md" | "lg";
        iconScale: "sm" | "md" | "lg";
        showIcons: boolean;
        gridGap: "compact" | "normal" | "relaxed";
        colorMode: "catalog" | "wordClass";
        tileWidth: number;
        tileHeight: number;
    };
    speechConfig: {
        volume: number;
        speakOnTap: boolean;
        autoClear: "off" | "afterSpeak" | "nextTap";
    };
    accessConfig: {
        editPin: string | null;
        longPressToEdit: boolean;
        holdDurationMs: number;
        moveTolerancePx: number;
        swipeThresholdPx: number;
    };
    sentence: SentenceToken[];
}

export interface BoardState extends BoardData {
    setColorSystem: (system: ColorSystemId) => void;
    setGridConfig: (grid: GridConfig, boardId?: string) => void;
    applyBoardSettings: (
        grid: GridConfig,
        appearance: BoardData["tileAppearance"],
        mode: "manual" | "automatic",
        boardId?: string,
        useGlobal?: boolean
    ) => void;
    reflowOutOfBoundsTiles: (boardId: string) => void;
    reflowBoardToGrid: (boardId: string, grid: GridConfig) => void;
    setTileAppearance: (patch: Partial<BoardData["tileAppearance"]>) => void;
    setSpeechConfig: (patch: Partial<BoardData["speechConfig"]>) => void;
    setAccessConfig: (patch: Partial<BoardData["accessConfig"]>) => void;
    appendSentenceTile: (tile: Tile) => void;
    removeSentenceTokenAt: (index: number) => void;
    popSentenceToken: () => void;
    clearSentence: () => void;
    upsertTile: (tile: Tile) => void;
    assignSlot: (boardId: string, page: number, cell: CellKey, tileId: string | null) => void;
    swapSlots: (boardId: string, page: number, from: CellKey, to: CellKey) => void;
    setSlotHidden: (boardId: string, page: number, cell: CellKey, hidden: boolean) => void;
    createCatalog: (input: {
        name: string;
        shortName?: string;
        colorKey: ColorKey;
        iconName: string | null;
        placeFolderOnHome?: boolean;
    }) => string;
    updateCatalog: (
        id: string,
        patch: Partial<Pick<CatalogBoard, "name" | "shortName" | "colorKey" | "iconName" | "gridOverride">>
    ) => void;
    deleteCatalog: (id: string) => void;
    reorderCatalog: (id: string, direction: number) => void;
    addWordsToCatalog: (id: string, tileIds: string[]) => void;
    placeFolderOnHome: (id: string) => void;
}

function normalizeDimension(value: number | undefined) {
    if (value === undefined) return 50;
    if (value > 1) return Math.max(1, Math.min(100, Math.round(value)));
    if (value === 1) return 50;
    return Math.max(1, Math.min(100, Math.round(value * 100)));
}

function normalizeAppearance(
    appearance: BoardData["tileAppearance"]
): BoardData["tileAppearance"] {
    return {
        ...appearance,
        tileWidth: normalizeDimension(appearance.tileWidth),
        tileHeight: normalizeDimension(appearance.tileHeight)
    };
}

function stripSharedTileFields(tile: Tile): Tile {
    return {
        id: tile.id,
        kind: tile.kind,
        label: tile.label,
        ...(tile.spokenText !== undefined ? { spokenText: tile.spokenText } : {}),
        iconName: tile.iconName,
        ...(tile.isCustom ? { isCustom: true } : {})
    };
}

function sanitizeSharedTiles(tiles: Record<string, Tile>): Record<string, Tile> {
    const clean: Record<string, Tile> = {};
    for (const [id, tile] of Object.entries(tiles)) {
        clean[id] = stripSharedTileFields(tile);
    }
    return clean;
}

function buildAssignmentsFromTiles(
    tiles: Record<string, Tile>
): Record<string, TileSystemAssignment> {
    const assignments: Record<string, TileSystemAssignment> = {};
    for (const tile of Object.values(tiles)) {
        assignments[tile.id] = {
            categoryId: tile.categoryId ?? "home",
            ...(tile.targetBoardId !== undefined ? { targetBoardId: tile.targetBoardId } : {}),
            ...(tile.colorKey !== undefined ? { colorKey: tile.colorKey } : {}),
            ...(tile.wordClass !== undefined ? { wordClass: tile.wordClass } : {})
        };
    }
    return assignments;
}

export function createPresetSystemConfig(
    system: Exclude<ColorSystemId, "custom">
): ColorSystemConfig {
    const specs =
        system === "modifiedFitzgerald"
            ? MODIFIED_FITZGERALD_CATALOGS
            : TOBII_DYNAVOX_CATALOGS;

    const boards: Record<string, CatalogBoard> = {};
    const catalogOrder: string[] = [];

    for (const spec of specs) {
        boards[spec.id] = {
            id: spec.id,
            name: spec.name,
            shortName: spec.shortName,
            colorKey: spec.colorKey,
            iconName: spec.iconName,
            isBuiltIn: true,
            pages: [{ cells: {} }]
        };
        catalogOrder.push(spec.id);
    }

    boards.home = {
        id: "home",
        name: "Home",
        shortName: "Home",
        colorKey: "slate",
        iconName: null,
        isBuiltIn: true,
        pages: [{ cells: {} }]
    };

    return {
        boards,
        catalogOrder,
        tileAssignments: {},
        initialized: true
    };
}

function syncActiveConfig(d: BoardData) {
    const existing = d.colorSystemConfigs[d.colorSystem];
    d.colorSystemConfigs[d.colorSystem] = {
        boards: structuredClone(d.boards),
        catalogOrder: [...d.catalogOrder],
        tileAssignments: structuredClone(existing?.tileAssignments ?? {}),
        initialized: true
    };
}

export function initialData(): BoardData {
    const tiles: Record<string, Tile> = {};
    const boards: Record<string, CatalogBoard> = {};
    const colors: ColorKey[] = ["rose", "emerald", "amber", "blue"];

    CATEGORY_IDS.forEach((id, n) => {
        const cells: CatalogBoard["pages"][number]["cells"] = {};

        INITIAL_DICTIONARY[id].forEach((word, i) => {
            tiles[word.id] = { ...word, kind: "word" };
            cells[cellKey(Math.floor(i / 4), i % 4)] = {
                tileId: word.id
            };
        });

        boards[id] = {
            id,
            name: CATEGORIES[id].label,
            shortName: CATEGORIES[id].wheel,
            colorKey: colors[n],
            iconName: INITIAL_DICTIONARY[id][0].iconName,
            isBuiltIn: true,
            pages: [{ cells }]
        };
    });

    const cells: CatalogBoard["pages"][number]["cells"] = {};

    for (let i = 0; i < 20; i++)
        cells[cellKey(Math.floor(i / 4), i % 4)] = {
            tileId: INITIAL_DICTIONARY[CATEGORY_IDS[i % 4]][Math.floor(i / 4)].id
        };

    boards.home = {
        id: "home",
        name: "Home",
        shortName: "Home",
        colorKey: "slate",
        iconName: null,
        isBuiltIn: true,
        pages: [{ cells }]
    };

    const customConfig: ColorSystemConfig = {
        boards: structuredClone(boards),
        catalogOrder: [...CATEGORY_IDS],
        tileAssignments: buildAssignmentsFromTiles(tiles),
        initialized: true
    };

    return {
        tiles: sanitizeSharedTiles(tiles),
        boards,
        catalogOrder: [...CATEGORY_IDS],
        colorSystem: "custom",
        colorSystemConfigs: {
            custom: customConfig
        },
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
            tileHeight: 50
        },
        speechConfig: {
            volume: 1,
            speakOnTap: true,
            autoClear: "off"
        },
        accessConfig: {
            editPin: null,
            longPressToEdit: true,
            holdDurationMs: 650,
            moveTolerancePx: 12,
            swipeThresholdPx: 60
        },
        sentence: []
    };
}

export function migrateV1(value: unknown): BoardData {
    const data = initialData();

    const old = value as {
        dictionary?: Record<string, (WordTile | null)[]>;
        homeGrid?: {
            slotIndex: number;
            tile: WordTile | null;
        }[];
    };

    if (!old || typeof old !== "object")
        return data;

    const rawTiles: Record<string, Tile> = { ...data.tiles };

    const convert = (word: WordTile) => {
        rawTiles[word.id] = { ...word, kind: "word" };
        data.tiles[word.id] = stripSharedTileFields(rawTiles[word.id]);
        return { tileId: word.id };
    };

    for (const id of CATEGORY_IDS)
        if (Array.isArray(old.dictionary?.[id])) {
            data.boards[id].pages = [{ cells: {} }];

            old.dictionary![id].forEach((word, i) => {
                if (word)
                    data.boards[id].pages[0].cells[
                        cellKey(Math.floor(i / 4), i % 4)
                    ] = convert(word);
            });
        }

    if (Array.isArray(old.homeGrid)) {
        data.boards.home.pages = [{ cells: {} }];

        old.homeGrid.forEach(({ slotIndex: i, tile }) => {
            if (tile)
                data.boards.home.pages[0].cells[
                    cellKey(Math.floor(i / 4), i % 4)
                ] = convert(tile);
        });
    }

    data.colorSystemConfigs.custom = {
        boards: structuredClone(data.boards),
        catalogOrder: [...data.catalogOrder],
        tileAssignments: buildAssignmentsFromTiles(rawTiles),
        initialized: true
    };

    return data;
}

export function migrateBoardData(value: unknown, version?: number): BoardData {
    if (!value || typeof value !== "object")
        return initialData();

    const candidate = value as Partial<BoardData> & {
        dictionary?: Record<string, (WordTile | null)[]>;
        homeGrid?: { slotIndex: number; tile: WordTile | null }[];
    };

    if ((version !== undefined && version < 2) || ("dictionary" in candidate && !candidate.boards)) {
        return migrateBoardData(migrateV1(value), 3);
    }

    const base = initialData();
    const boards = candidate.boards ?? base.boards;
    const catalogOrder = candidate.catalogOrder ?? base.catalogOrder;
    const rawTiles = candidate.tiles ?? base.tiles;

    const existingConfigs = candidate.colorSystemConfigs
        ? structuredClone(candidate.colorSystemConfigs)
        : {};

    if (!existingConfigs.custom?.initialized) {
        existingConfigs.custom = {
            boards: structuredClone(boards),
            catalogOrder: [...catalogOrder],
            tileAssignments: buildAssignmentsFromTiles(rawTiles),
            initialized: true
        };
    }

    const activeSystem: ColorSystemId =
        version !== undefined && version >= 3 && candidate.colorSystem
            ? candidate.colorSystem
            : "custom";

    if (activeSystem !== "custom" && !existingConfigs[activeSystem]?.initialized) {
        existingConfigs[activeSystem] = createPresetSystemConfig(activeSystem);
    }

    const activeConfig = existingConfigs[activeSystem]!;

    return {
        ...base,
        ...candidate,
        tiles: sanitizeSharedTiles(rawTiles),
        boards: structuredClone(activeConfig.boards),
        catalogOrder: [...activeConfig.catalogOrder],
        colorSystem: activeSystem,
        colorSystemConfigs: existingConfigs,
        tileAppearance: normalizeAppearance({
            ...base.tileAppearance,
            ...(candidate.tileAppearance ?? {})
        })
    };
}

function addToBoard(data: BoardData, id: string, tileIds: string[]) {
    const board = data.boards[id];

    if (!board)
        return;

    const grid = board.gridOverride ?? data.gridConfig;

    for (const tileId of tileIds) {
        if (!data.tiles[tileId])
            continue;

        let placed = false;

        for (const page of board.pages) {
            for (let i = 0; i < grid.rows * grid.cols; i++) {
                const key = cellKey(
                    Math.floor(i / grid.cols),
                    i % grid.cols
                );

                if (!page.cells[key]) {
                    page.cells[key] = { tileId };
                    placed = true;
                    break;
                }
            }

            if (placed)
                break;
        }

        if (!placed)
            board.pages.push({ cells: { "0:0": { tileId } } });
    }
}

// Creates the expected page arrangement without modifying the board.
function createRepackedPages(
    board: CatalogBoard,
    grid: GridConfig
): CatalogBoard["pages"] {
    const placements = board.pages.flatMap(page =>
        Object.entries(page.cells)
            .filter(([, placement]) => !!placement)
            .sort(([a], [b]) => {
                const [aRow, aCol] = a.split(":").map(Number);
                const [bRow, bCol] = b.split(":").map(Number);

                return aRow - bRow || aCol - bCol;
            })
            .map(([, placement]) => placement!)
    );

    const capacity = grid.rows * grid.cols;
    const pageCount = Math.max(
        1,
        Math.ceil(placements.length / capacity)
    );

    return Array.from({ length: pageCount }, (_, pageIndex) => {
        const cells: CatalogBoard["pages"][number]["cells"] = {};

        placements
            .slice(
                pageIndex * capacity,
                (pageIndex + 1) * capacity
            )
            .forEach((placement, index) => {
                const key = cellKey(
                    Math.floor(index / grid.cols),
                    index % grid.cols
                );

                cells[key] = { ...placement };
            });

        return { cells };
    });
}

function repackBoard(
    data: BoardData,
    id: string,
    gridOverride?: GridConfig
) {
    const board = data.boards[id];

    if (!board)
        return;

    const grid = gridOverride ?? board.gridOverride ?? data.gridConfig;

    board.pages = createRepackedPages(board, grid);
}

export const createBoardStore = () =>
    createStore<BoardState>()(
        persist((set, get) => {
            const mutate = (fn: (data: BoardData) => void) =>
                set(state => {
                    const data = structuredClone({
                        tiles: state.tiles,
                        boards: state.boards,
                        catalogOrder: state.catalogOrder,
                        colorSystem: state.colorSystem,
                        colorSystemConfigs: state.colorSystemConfigs,
                        gridConfig: state.gridConfig,
                        layoutMode: state.layoutMode,
                        tileAppearance: state.tileAppearance,
                        speechConfig: state.speechConfig,
                        accessConfig: state.accessConfig,
                        sentence: state.sentence
                    });

                    fn(data);
                    syncActiveConfig(data);
                    return data;
                });

            return {
                ...initialData(),

                setColorSystem: nextSystem =>
                    mutate(d => {
                        if (d.colorSystem === nextSystem)
                            return;

                        syncActiveConfig(d);

                        let target = d.colorSystemConfigs[nextSystem];

                        if (!target || !target.initialized) {
                            target =
                                nextSystem === "custom"
                                    ? {
                                          boards: structuredClone(d.boards),
                                          catalogOrder: [...d.catalogOrder],
                                          tileAssignments: buildAssignmentsFromTiles(d.tiles),
                                          initialized: true
                                      }
                                    : createPresetSystemConfig(nextSystem);

                            d.colorSystemConfigs[nextSystem] = structuredClone(target);
                        }

                        d.colorSystem = nextSystem;
                        d.boards = structuredClone(target.boards);
                        d.catalogOrder = [...target.catalogOrder];
                    }),

                setGridConfig: (grid, id) => mutate(d => {
                    if (id && d.boards[id])
                        d.boards[id].gridOverride = clampGrid(grid);
                    else if (!id)
                        d.gridConfig = clampGrid(grid);

                    Object.values(d.boards)
                        .filter(b => id ? b.id === id : !b.gridOverride)
                        .forEach(b => repackBoard(d, b.id));
                }),

                applyBoardSettings: (
                    grid,
                    appearance,
                    mode,
                    id,
                    useGlobal = false
                ) => mutate(d => {
                    const nextGrid = clampGrid(grid);

                    if (id && d.boards[id]) {
                        if (useGlobal) {
                            delete d.boards[id].gridOverride;
                            delete d.boards[id].layoutModeOverride;
                        } else {
                            d.boards[id].layoutModeOverride = mode;

                            if (mode === "manual")
                                d.boards[id].gridOverride = nextGrid;
                            else
                                delete d.boards[id].gridOverride;
                        }
                    } else if (!id) {
                        d.layoutMode = mode;

                        if (mode === "manual")
                            d.gridConfig = nextGrid;
                    }

                    d.tileAppearance = normalizeAppearance(appearance);

                    if (mode === "manual" && !useGlobal) {
                        Object.values(d.boards)
                            .filter(b =>
                                id
                                    ? b.id === id
                                    : !b.gridOverride &&
                                      (b.layoutModeOverride ?? d.layoutMode) === "manual"
                            )
                            .forEach(b => repackBoard(d, b.id, nextGrid));
                    }
                }),

                reflowOutOfBoundsTiles: id =>
                    mutate(d => repackBoard(d, id)),

                // Only update Zustand when the actual page arrangement changes.
                reflowBoardToGrid: (id, grid) =>
                    set(state => {
                        const board = state.boards[id];

                        if (!board)
                            return state;

                        const nextGrid = clampGrid(grid);
                        const nextPages = createRepackedPages(
                            board,
                            nextGrid
                        );

                        if (
                            JSON.stringify(board.pages) ===
                            JSON.stringify(nextPages)
                        ) {
                            return state;
                        }

                        const nextBoards = {
                            ...state.boards,
                            [id]: {
                                ...board,
                                pages: nextPages
                            }
                        };

                        const activeCfg = state.colorSystemConfigs[state.colorSystem];

                        return {
                            boards: nextBoards,
                            colorSystemConfigs: {
                                ...state.colorSystemConfigs,
                                [state.colorSystem]: {
                                    boards: nextBoards,
                                    catalogOrder: activeCfg?.catalogOrder ?? state.catalogOrder,
                                    tileAssignments: activeCfg?.tileAssignments ?? {},
                                    initialized: true
                                }
                            }
                        };
                    }),

                setTileAppearance: patch =>
                    set(s => ({
                        tileAppearance: normalizeAppearance({
                            ...s.tileAppearance,
                            ...patch
                        })
                    })),

                setSpeechConfig: patch =>
                    set(s => ({
                        speechConfig: {
                            ...s.speechConfig,
                            ...patch
                        }
                    })),

                setAccessConfig: patch =>
                    set(s => ({
                        accessConfig: {
                            ...s.accessConfig,
                            ...patch
                        }
                    })),

                appendSentenceTile: tile =>
                    set(s => {
                        const assignment =
                            s.colorSystemConfigs[s.colorSystem]?.tileAssignments[tile.id];

                        return {
                            sentence: [
                                ...s.sentence,
                                {
                                    instanceId: uid(),
                                    tileId: tile.id,
                                    label: tile.label,
                                    spokenText: tile.spokenText || tile.label,
                                    iconName: tile.iconName,
                                    colorKey: resolveTileColorKey(
                                        tile,
                                        assignment,
                                        s.boards,
                                        s.colorSystem,
                                        s.tileAppearance.colorMode
                                    )
                                }
                            ]
                        };
                    }),

                removeSentenceTokenAt: i =>
                    set(s => ({
                        sentence: s.sentence.filter((_, n) => n !== i)
                    })),

                popSentenceToken: () =>
                    set(s => ({
                        sentence: s.sentence.slice(0, -1)
                    })),

                clearSentence: () => set({ sentence: [] }),

                upsertTile: tile =>
                    mutate(d => {
                        const existing = d.tiles[tile.id];

                        d.tiles[tile.id] = stripSharedTileFields({
                            ...existing,
                            ...tile,
                            isCustom: existing?.isCustom ?? tile.isCustom
                        });

                        const cfg = d.colorSystemConfigs[d.colorSystem];
                        if (cfg) {
                            const prev = cfg.tileAssignments[tile.id];
                            const nextCategoryId =
                                tile.categoryId !== undefined
                                    ? tile.categoryId
                                    : prev?.categoryId ?? "home";
                            const nextTargetBoardId =
                                "targetBoardId" in tile
                                    ? tile.targetBoardId
                                    : prev?.targetBoardId;
                            const nextColorKey =
                                d.colorSystem === "custom"
                                    ? "colorKey" in tile
                                        ? tile.colorKey
                                        : prev?.colorKey
                                    : undefined;
                            const nextWordClass =
                                "wordClass" in tile
                                    ? tile.wordClass
                                    : prev?.wordClass;

                            cfg.tileAssignments[tile.id] = {
                                categoryId: nextCategoryId,
                                ...(nextTargetBoardId !== undefined
                                    ? { targetBoardId: nextTargetBoardId }
                                    : {}),
                                ...(nextColorKey !== undefined
                                    ? { colorKey: nextColorKey }
                                    : {}),
                                ...(nextWordClass !== undefined
                                    ? { wordClass: nextWordClass }
                                    : {})
                            };
                        }
                    }),

                assignSlot: (id, page, key, tileId) =>
                    mutate(d => {
                        const b = d.boards[id];

                        if (!b || (tileId && !d.tiles[tileId]))
                            return;

                        while (b.pages.length <= page)
                            b.pages.push({ cells: {} });

                        if (tileId) {
                            b.pages[page].cells[key] = { tileId };

                            const cfg = d.colorSystemConfigs[d.colorSystem];
                            if (cfg && id !== "home") {
                                const existing = cfg.tileAssignments[tileId];
                                cfg.tileAssignments[tileId] = {
                                    ...existing,
                                    categoryId: id,
                                    ...(d.colorSystem !== "custom" ? { colorKey: undefined } : {})
                                };
                            }
                        } else {
                            delete b.pages[page].cells[key];
                        }
                    }),

                swapSlots: (id, page, from, to) =>
                    mutate(d => {
                        const cells = d.boards[id]?.pages[page]?.cells;

                        if (!cells)
                            return;

                        const a = cells[from];
                        const b = cells[to];

                        delete cells[from];
                        delete cells[to];

                        if (a)
                            cells[to] = a;

                        if (b)
                            cells[from] = b;
                    }),

                setSlotHidden: (id, page, key, hidden) =>
                    mutate(d => {
                        const p = d.boards[id]?.pages[page]?.cells[key];

                        if (p)
                            p.hidden = hidden;
                    }),

                createCatalog: input => {
                    if (get().colorSystem !== "custom")
                        return "";

                    const id = `cat-${uid()}`;

                    mutate(d => {
                        d.boards[id] = {
                            id,
                            name: input.name.trim() || "Catalog",
                            shortName:
                                input.shortName?.trim() ||
                                input.name.trim(),
                            colorKey: input.colorKey,
                            iconName: input.iconName,
                            isBuiltIn: false,
                            pages: [{ cells: {} }]
                        };

                        d.catalogOrder.push(id);
                    });

                    if (input.placeFolderOnHome)
                        get().placeFolderOnHome(id);

                    return id;
                },

                updateCatalog: (id, patch) =>
                    mutate(d => {
                        if (!d.boards[id])
                            return;

                        if (d.colorSystem !== "custom") {
                            if (patch.gridOverride !== undefined)
                                d.boards[id].gridOverride = patch.gridOverride;
                            return;
                        }

                        Object.assign(d.boards[id], patch);

                        for (const tile of Object.values(d.tiles)) {
                            const assignment =
                                d.colorSystemConfigs.custom?.tileAssignments[tile.id];
                            const targetId =
                                assignment?.targetBoardId ?? tile.targetBoardId;

                            if (tile.kind !== "folder" || targetId !== id)
                                continue;

                            if (patch.name !== undefined)
                                tile.label = patch.name;

                            if (patch.iconName !== undefined)
                                tile.iconName = patch.iconName;
                        }
                    }),

                deleteCatalog: id =>
                    mutate(d => {
                        if (d.colorSystem !== "custom")
                            return;

                        if (!d.boards[id] || d.boards[id].isBuiltIn)
                            return;

                        delete d.boards[id];
                        d.catalogOrder = d.catalogOrder.filter(
                            c => c !== id
                        );

                        const cfg = d.colorSystemConfigs.custom;
                        const folderIds = new Set(
                            Object.values(d.tiles)
                                .filter(t => {
                                    if (t.kind !== "folder")
                                        return false;
                                    const targetId =
                                        cfg?.tileAssignments[t.id]?.targetBoardId ??
                                        t.targetBoardId;
                                    return targetId === id;
                                })
                                .map(t => t.id)
                        );

                        for (const b of Object.values(d.boards))
                            b.pages.forEach(p =>
                                Object.entries(p.cells).forEach(([k, v]) => {
                                    if (v && folderIds.has(v.tileId))
                                        delete p.cells[k as CellKey];
                                })
                            );

                        folderIds.forEach(k => delete d.tiles[k]);

                        if (cfg) {
                            folderIds.forEach(k => delete cfg.tileAssignments[k]);
                            Object.values(cfg.tileAssignments).forEach(a => {
                                if (a.categoryId === id)
                                    a.categoryId = "home";
                            });
                        }
                    }),

                reorderCatalog: (id, direction) =>
                    mutate(d => {
                        const a = d.catalogOrder.indexOf(id);
                        const b = a + direction;

                        if (
                            a >= 0 &&
                            b >= 0 &&
                            b < d.catalogOrder.length
                        ) {
                            [
                                d.catalogOrder[a],
                                d.catalogOrder[b]
                            ] = [
                                d.catalogOrder[b],
                                d.catalogOrder[a]
                            ];
                        }
                    }),

                addWordsToCatalog: (id, ids) =>
                    mutate(d => {
                        addToBoard(d, id, ids);

                        const cfg = d.colorSystemConfigs[d.colorSystem];
                        if (cfg && d.boards[id]) {
                            for (const tileId of ids) {
                                if (!d.tiles[tileId])
                                    continue;
                                const existing = cfg.tileAssignments[tileId];
                                cfg.tileAssignments[tileId] = {
                                    ...existing,
                                    categoryId: id,
                                    ...(d.colorSystem !== "custom" ? { colorKey: undefined } : {})
                                };
                            }
                        }
                    }),

                placeFolderOnHome: id =>
                    mutate(d => {
                        const b = d.boards[id];

                        if (!b)
                            return;

                        const tileId = `folder-${id}`;

                        if (!d.tiles[tileId]) {
                            d.tiles[tileId] = {
                                id: tileId,
                                kind: "folder",
                                label: b.name,
                                iconName: b.iconName
                            };
                        }

                        const cfg = d.colorSystemConfigs[d.colorSystem];
                        if (cfg) {
                            cfg.tileAssignments[tileId] = {
                                categoryId: d.colorSystem === "tobiiDynavox" ? "td-fringe" : id,
                                targetBoardId: id,
                                colorKey: undefined
                            };
                        }

                        addToBoard(d, "home", [tileId]);
                    })
            };
        }, {
            name: "wikahon-board-v2",
            version: 3,
            skipHydration: true,
            storage: createJSONStorage(() => ({
                getItem: key => {
                    const current = localStorage.getItem(key);

                    if (current)
                        return current;

                    const legacy = localStorage.getItem(
                        "wikahon-board-v1"
                    );

                    if (!legacy)
                        return null;

                    try {
                        const migratedV1 = migrateV1(JSON.parse(legacy).state);
                        return JSON.stringify({
                            state: migrateBoardData(migratedV1, 3),
                            version: 3
                        });
                    } catch {
                        return null;
                    }
                },

                setItem: (key, value) => {
                    try {
                        localStorage.setItem(key, value);
                    } catch {
                        /* Keep the board usable when browser storage is unavailable or full. */
                    }
                },

                removeItem: key => localStorage.removeItem(key)
            })),

            migrate: (value, version) => migrateBoardData(value, version),

            partialize: ({
                tiles,
                boards,
                catalogOrder,
                colorSystem,
                colorSystemConfigs,
                gridConfig,
                layoutMode,
                tileAppearance,
                speechConfig,
                accessConfig,
                sentence
            }) => ({
                tiles,
                boards,
                catalogOrder,
                colorSystem,
                colorSystemConfigs,
                gridConfig,
                layoutMode,
                tileAppearance,
                speechConfig,
                accessConfig,
                sentence
            })
        })
    );

export type BoardStore = ReturnType<typeof createBoardStore>;