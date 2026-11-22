export const CATEGORY_IDS = ["needs", "actions", "people", "feelings"] as const;
export type CategoryId = typeof CATEGORY_IDS[number];
export interface WordTile {
    id: string;
    label: string;
    categoryId: CategoryId;
    iconName: string;
    isCustom?: boolean;
}
export interface GridSlot {
    slotIndex: number;
    tile: WordTile | null;
}
export const CATEGORIES = {
    needs: { label: "Needs / Emergency", wheel: "Needs", background: "#FDF2F4", fill: "#FCE4E8", color: "#7F1D1D" },
    actions: { label: "Actions / Response", wheel: "Actions", background: "#ECFDF5", fill: "#D1FAE5", color: "#064E3B" },
    people: { label: "People", wheel: "People", background: "#FEFCE8", fill: "#FEF3C7", color: "#78350F" },
    feelings: { label: "Feelings", wheel: "Feelings", background: "#EFF6FF", fill: "#DBEAFE", color: "#1E3A8A" },
} as const;
export const isCategoryId = (value: string): value is CategoryId => CATEGORY_IDS.some(id => id === value);
const seeds: Record<CategoryId, [string, string][]> = {
    needs: [["Kain", "eat"], ["Inom", "drink"], ["Tubig", "water"], ["Banyo", "toilet"], ["Tulong", "help"]],
    actions: [["Oo", "yes"], ["Hindi", "no"], ["Sandali", "wait"], ["Pakisuyo", "please"], ["Tapos na", "done"]],
    people: [["Nanay", "mother"], ["Tatay", "father"], ["Ate", "sister"], ["Kuya", "brother"], ["Guro", "teacher"]],
    feelings: [["Masaya", "happy"], ["Malungkot", "sad"], ["Galit", "angry"], ["Masakit", "pain"], ["Pagod", "tired"]],
};
export const INITIAL_DICTIONARY = Object.fromEntries(CATEGORY_IDS.map(categoryId => [categoryId, seeds[categoryId].map(([label, iconName], i) => ({ id: `${categoryId[0]}-${i + 1}`, label, categoryId, iconName }))])) as Record<CategoryId, WordTile[]>;
export const ICONS = Object.values(INITIAL_DICTIONARY).flat().map(tile => ({ name: tile.iconName, label: tile.label, path: `/gifs/${tile.label.toLowerCase().replaceAll(" ", "-")}.gif` }));
ICONS.push(...["tigil", "ayoko", "gusto-ko-pa"].map(name => ({ name, label: name.replaceAll("-", " "), path: `/gifs/${name}.gif` })));
export const iconPath = (name: string | null) => ICONS.find(icon => icon.name === name)?.path;

export type ColorKey =
    | "rose"
    | "emerald"
    | "amber"
    | "yellow"
    | "blue"
    | "violet"
    | "teal"
    | "orange"
    | "pink"
    | "white"
    | "slate";

export type ColorSystemId = "custom" | "modifiedFitzgerald" | "tobiiDynavox";

export const COLOR_SYSTEMS: Record<ColorSystemId, { label: string }> = {
    custom: { label: "Custom Colors" },
    modifiedFitzgerald: { label: "Modified Fitzgerald" },
    tobiiDynavox: { label: "Tobii Dynavox" },
};

export interface PresetCatalogSpec {
    id: string;
    name: string;
    shortName: string;
    colorKey: ColorKey;
    iconName: string | null;
}

export const MODIFIED_FITZGERALD_CATALOGS: PresetCatalogSpec[] = [
    { id: "mf-pronouns", name: "Pronouns & People", shortName: "People", colorKey: "yellow", iconName: "mother" },
    { id: "mf-verbs", name: "Verbs / Actions", shortName: "Verbs", colorKey: "emerald", iconName: "eat" },
    { id: "mf-descriptors", name: "Descriptors", shortName: "Descriptors", colorKey: "blue", iconName: "happy" },
    { id: "mf-nouns", name: "Nouns / Things", shortName: "Nouns", colorKey: "orange", iconName: "water" },
    { id: "mf-social", name: "Social Words", shortName: "Social", colorKey: "pink", iconName: "please" },
    { id: "mf-questions", name: "Question Words", shortName: "Questions", colorKey: "blue", iconName: "speech" },
    { id: "mf-little", name: "Little / Grammatical Words", shortName: "Little", colorKey: "pink", iconName: "wait" },
    { id: "mf-places", name: "Places", shortName: "Places", colorKey: "violet", iconName: "toilet" },
];

export const TOBII_DYNAVOX_CATALOGS: PresetCatalogSpec[] = [
    { id: "td-pronouns", name: "Pronouns & People", shortName: "People", colorKey: "yellow", iconName: "mother" },
    { id: "td-verbs", name: "Verbs / Actions", shortName: "Verbs", colorKey: "emerald", iconName: "eat" },
    { id: "td-questions", name: "Question Words", shortName: "Questions", colorKey: "blue", iconName: "speech" },
    { id: "td-little", name: "Little Words", shortName: "Little", colorKey: "orange", iconName: "wait" },
    { id: "td-descriptors", name: "Descriptors", shortName: "Descriptors", colorKey: "white", iconName: "happy" },
    { id: "td-fringe", name: "Fringe Vocabulary / Nouns", shortName: "Fringe", colorKey: "pink", iconName: "water" },
];

export type WordClass = "social" | "question" | "verb" | "pronoun" | "particle" | "modifier" | "place" | "noun" | "other";
export const WORD_COLORS: Record<WordClass, ColorKey> = { social: "rose", question: "slate", verb: "emerald", pronoun: "amber", particle: "pink", modifier: "blue", place: "violet", noun: "orange", other: "teal" };
export interface Tile {
    id: string;
    kind: "word" | "folder";
    label: string;
    spokenText?: string;
    iconName: string | null;
    categoryId?: string;
    targetBoardId?: string;
    colorKey?: ColorKey;
    wordClass?: WordClass;
    isCustom?: boolean;
}
export interface TileSystemAssignment {
    categoryId: string;
    targetBoardId?: string;
    colorKey?: ColorKey;
    wordClass?: WordClass;
}
export interface ColorSystemConfig {
    boards: Record<string, CatalogBoard>;
    catalogOrder: string[];
    tileAssignments: Record<string, TileSystemAssignment>;
    initialized: boolean;
}
export function resolveTileForSystem(
    tile: Tile,
    assignment: TileSystemAssignment | undefined,
    colorSystem: ColorSystemId,
    boards?: Record<string, CatalogBoard>
): Tile {
    let categoryId = assignment?.categoryId;

    if (!categoryId && boards) {
        for (const [boardId, board] of Object.entries(boards)) {
            if (boardId === "home")
                continue;

            const found = board.pages.some(page =>
                Object.values(page.cells).some(cell => cell?.tileId === tile.id)
            );

            if (found) {
                categoryId = boardId;
                break;
            }
        }
    }

    if (colorSystem === "custom") {
        const targetBoardId = assignment?.targetBoardId ?? tile.targetBoardId;
        return {
            ...tile,
            categoryId: categoryId ?? tile.categoryId ?? "",
            ...(targetBoardId !== undefined ? { targetBoardId } : {}),
            colorKey: assignment?.colorKey ?? tile.colorKey,
            wordClass: assignment?.wordClass ?? tile.wordClass,
        };
    }

    return {
        ...tile,
        categoryId: categoryId ?? "",
        ...(assignment?.targetBoardId !== undefined
            ? { targetBoardId: assignment.targetBoardId }
            : {}),
        colorKey: undefined,
        wordClass: assignment?.wordClass,
    };
}
export function resolveTileColorKey(
    tile: Tile,
    assignment: TileSystemAssignment | undefined,
    boards: Record<string, CatalogBoard>,
    colorSystem: ColorSystemId,
    colorMode: "catalog" | "wordClass"
): ColorKey {
    const resolved = resolveTileForSystem(tile, assignment, colorSystem, boards);

    if (colorSystem === "custom") {
        if (colorMode === "wordClass" && resolved.wordClass) {
            return WORD_COLORS[resolved.wordClass];
        }
        return (
            resolved.colorKey ??
            (resolved.categoryId ? boards[resolved.categoryId]?.colorKey : undefined) ??
            "slate"
        );
    }

    if (resolved.categoryId && boards[resolved.categoryId]) {
        return boards[resolved.categoryId].colorKey;
    }

    if (colorSystem === "tobiiDynavox" && tile.kind === "folder") {
        return "pink";
    }

    return "slate";
}
export type CellKey = `${number}:${number}`;
export interface CellPlacement {
    tileId: string;
    hidden?: boolean;
}
export interface BoardPage {
    cells: Partial<Record<CellKey, CellPlacement>>;
}
export interface GridConfig {
    rows: number;
    cols: number;
}
export interface CatalogBoard {
    id: string;
    name: string;
    shortName: string;
    colorKey: ColorKey;
    iconName: string | null;
    isBuiltIn: boolean;
    gridOverride?: GridConfig;
    layoutModeOverride?: "manual" | "automatic";
    pages: BoardPage[];
}
export interface SentenceToken {
    instanceId: string;
    tileId: string;
    label: string;
    spokenText: string;
    iconName: string | null;
    colorKey: ColorKey;
}
export const DEFAULT_GRID: GridConfig = { rows: 5, cols: 4 };
export const GRID_LIMITS = { minRows: 1, maxRows: 16, minCols: 1, maxCols: 16 };
export const GRID_PRESETS = [[2, 2], [3, 3], [3, 4], [4, 4], [5, 4], [5, 6], [6, 6], [6, 8], [7, 9], [8, 10], [9, 16]].map(([rows, cols]) => ({ rows, cols }));
export const cellKey = (row: number, col: number): CellKey => `${row}:${col}`;
export const inBounds = (cell: string, grid: GridConfig) => { const [r, c] = cell.split(":").map(Number); return r >= 0 && c >= 0 && r < grid.rows && c < grid.cols; };
export const clampGrid = (grid: GridConfig): GridConfig => ({ rows: Math.max(1, Math.min(16, Math.round(grid.rows) || 1)), cols: Math.max(1, Math.min(16, Math.round(grid.cols) || 1)) });
export const uid = () => crypto.randomUUID();