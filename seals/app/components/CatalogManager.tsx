"use client";

import { useState } from "react";
import {
    X,
    Plus,
    Trash2,
    ArrowUp,
    ArrowDown,
    FolderPlus,
    Pencil,
    Check
} from "lucide-react";
import { useBoardStore } from "@/store/BoardProvider";
import {
    ICONS,
    iconPath,
    COLOR_SYSTEMS,
    type ColorKey
} from "@/lib/board";
import { palette, COLOR_KEYS } from "@/app/theme";

interface CatalogManagerProps {
    open: boolean;
    onClose: () => void;
    onNavigateCatalog?: (id: string) => void;
}

export function CatalogManager({
    open,
    onClose,
    onNavigateCatalog
}: CatalogManagerProps) {
    const tiles = useBoardStore(s => s.tiles);
    const boards = useBoardStore(s => s.boards);
    const catalogOrder = useBoardStore(s => s.catalogOrder);
    const colorSystem = useBoardStore(s => s.colorSystem);
    const isPresetSystem = colorSystem !== "custom";
    const createCatalog = useBoardStore(s => s.createCatalog);
    const updateCatalog = useBoardStore(s => s.updateCatalog);
    const deleteCatalog = useBoardStore(s => s.deleteCatalog);
    const reorderCatalog = useBoardStore(s => s.reorderCatalog);
    const addWordsToCatalog = useBoardStore(s => s.addWordsToCatalog);
    const placeFolderOnHome = useBoardStore(s => s.placeFolderOnHome);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [shortName, setShortName] = useState("");
    const [colorKey, setColorKey] = useState<ColorKey>("teal");
    const [iconName, setIconName] = useState<string | null>("water");
    const [placeOnHome, setPlaceOnHome] = useState(true);

    const [addingToId, setAddingToId] = useState<string | null>(null);
    const [selectedTiles, setSelectedTiles] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");

    const startCreate = () => {
        if (isPresetSystem) return;
        setEditingId("new");
        setName("");
        setShortName("");
        setColorKey("teal");
        setIconName("water");
        setPlaceOnHome(true);
    };

    const startEdit = (id: string) => {
        if (isPresetSystem) return;
        const b = boards[id];
        if (!b) return;
        setEditingId(id);
        setName(b.name);
        setShortName(b.shortName);
        setColorKey(b.colorKey);
        setIconName(b.iconName);
    };

    const saveForm = () => {
        if (!name.trim()) return;
        if (editingId === "new") {
            const id = createCatalog({
                name,
                shortName: shortName || name,
                colorKey,
                iconName,
                placeFolderOnHome: placeOnHome
            });
            setEditingId(null);
            if (id) onNavigateCatalog?.(id);
        } else if (editingId) {
            updateCatalog(editingId, {
                name: name.trim(),
                shortName: (shortName || name).trim(),
                colorKey,
                iconName
            });
            setEditingId(null);
        }
    };

    const startAddWords = (id: string) => {
        setAddingToId(id);
        setSelectedTiles(new Set());
        setSearch("");
    };

    const commitAddWords = () => {
        if (!addingToId || selectedTiles.size === 0) return;
        addWordsToCatalog(addingToId, Array.from(selectedTiles));
        setAddingToId(null);
        setSelectedTiles(new Set());
    };

    if (!open) return null;

    const allWordTiles = Object.values(tiles).filter(
        t =>
            t.kind === "word" &&
            (!search || t.label.toLowerCase().includes(search.toLowerCase()))
    );

    const homePlacements = new Set(
        Object.values(boards.home?.pages[0]?.cells ?? {}).map(c => c?.tileId)
    );

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#465365]/40 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[#DCEEFF] bg-white shadow-2xl font-sans text-[#465365]"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-200 bg-[#FFF9EC] px-6 py-4">
                    <div>
                        <h2 className="font-nunito text-lg font-extrabold text-[#465365]">
                            Catalogs &amp; Boards
                        </h2>
                        <p className="text-xs text-[#465365]/75">
                            Organize vocabulary boards, create custom catalogs, and place folders on Home.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {isPresetSystem ? (
                            <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#465365]/75">
                                {COLOR_SYSTEMS[colorSystem].label} (fixed catalogs)
                            </span>
                        ) : (
                            <button
                                onClick={startCreate}
                                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#B6D8FA] bg-[#DCEEFF] px-3.5 text-sm font-bold text-[#465365] hover:bg-[#C6E2FF]"
                            >
                                <Plus className="h-4 w-4" />
                                New catalog
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            aria-label="Close catalog manager"
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#465365] hover:bg-[#DCEEFF]/50"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-6">
                    {catalogOrder.map((id, idx) => {
                        const b = boards[id];
                        if (!b) return null;
                        const p = palette[b.colorKey];
                        const src = iconPath(b.iconName);
                        const wordCount = b.pages.reduce(
                            (sum, page) => sum + Object.keys(page.cells).length,
                            0
                        );
                        const folderId = `folder-${id}`;
                        const isOnHome = homePlacements.has(folderId);

                        return (
                            <div
                                key={id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className="flex h-11 w-11 items-center justify-center rounded-xl border-2"
                                        style={{
                                            background: p.bg,
                                            borderColor: p.border
                                        }}
                                    >
                                        {src && (
                                            <img
                                                src={src}
                                                alt=""
                                                className="h-7 w-7 object-contain"
                                            />
                                        )}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-nunito font-bold text-[#465365]">
                                                {b.name}
                                            </span>
                                            {b.isBuiltIn && (
                                                <span className="rounded-md bg-[#FFF9EC] border border-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase text-[#465365]/75">
                                                    Built-in
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs text-[#465365]/70">
                                            {wordCount} {wordCount === 1 ? "tile" : "tiles"}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={() => startAddWords(id)}
                                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-[#465365] hover:bg-[#DCEEFF]/40"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Words
                                    </button>

                                    <button
                                        onClick={() => placeFolderOnHome(id)}
                                        disabled={isOnHome}
                                        className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-bold ${
                                            isOnHome
                                                ? "border-[#BCE0C7] bg-[#DDF1E3] text-[#465365]"
                                                : "border-slate-200 text-[#465365] hover:bg-[#DCEEFF]/40"
                                        }`}
                                    >
                                        <FolderPlus className="h-3.5 w-3.5" />
                                        {isOnHome ? "On Home" : "To Home"}
                                    </button>

                                    <button
                                        onClick={() => reorderCatalog(id, -1)}
                                        disabled={idx === 0}
                                        aria-label="Move up"
                                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-[#465365] hover:bg-[#DCEEFF]/40 disabled:opacity-30"
                                    >
                                        <ArrowUp className="h-3.5 w-3.5" />
                                    </button>

                                    <button
                                        onClick={() => reorderCatalog(id, 1)}
                                        disabled={idx === catalogOrder.length - 1}
                                        aria-label="Move down"
                                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-[#465365] hover:bg-[#DCEEFF]/40 disabled:opacity-30"
                                    >
                                        <ArrowDown className="h-3.5 w-3.5" />
                                    </button>

                                    {!isPresetSystem && (
                                        <button
                                            onClick={() => startEdit(id)}
                                            aria-label="Edit catalog"
                                            title="Edit"
                                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-[#465365] hover:bg-[#DCEEFF]/40"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {!isPresetSystem && editingId && (
                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-[#FFF9EC]/70 p-4">
                            <div className="flex items-center justify-between">
                                <span className="font-nunito text-xs font-bold uppercase tracking-wider text-[#465365]/75">
                                    {editingId === "new" ? "Create Catalog" : "Edit Catalog"}
                                </span>
                                <button
                                    onClick={() => setEditingId(null)}
                                    className="text-xs font-semibold text-[#465365]/75 hover:text-[#465365]"
                                >
                                    Cancel
                                </button>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="Catalog name (e.g. Food & Drinks)"
                                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-[#465365]"
                                />
                                <input
                                    type="text"
                                    value={shortName}
                                    onChange={e => setShortName(e.target.value)}
                                    placeholder="Short tab label (e.g. Food)"
                                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-[#465365]"
                                />
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {COLOR_KEYS.map(ck => (
                                    <button
                                        key={ck}
                                        type="button"
                                        onClick={() => setColorKey(ck)}
                                        className={`h-8 w-8 rounded-full border-2 ${
                                            colorKey === ck
                                                ? "scale-110 border-[#465365]"
                                                : "border-slate-200"
                                        }`}
                                        style={{ backgroundColor: palette[ck].surface }}
                                    />
                                ))}
                            </div>

                            <div className="grid max-h-28 grid-cols-6 gap-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 sm:grid-cols-8">
                                {ICONS.map(ic => (
                                    <button
                                        key={ic.name}
                                        type="button"
                                        onClick={() => setIconName(ic.name)}
                                        className={`flex flex-col items-center justify-center rounded-lg border p-1.5 ${
                                            iconName === ic.name
                                                ? "border-[#B6D8FA] bg-[#DCEEFF]"
                                                : "border-transparent hover:bg-[#FFF9EC]"
                                        }`}
                                    >
                                        <img
                                            src={ic.path}
                                            alt=""
                                            className="h-6 w-6 object-contain"
                                        />
                                    </button>
                                ))}
                            </div>

                            {editingId === "new" && (
                                <label className="flex items-center gap-2 text-xs font-semibold text-[#465365]">
                                    <input
                                        type="checkbox"
                                        checked={placeOnHome}
                                        onChange={e => setPlaceOnHome(e.target.checked)}
                                        className="accent-[#465365]"
                                    />
                                    Place folder tile on Home board
                                </label>
                            )}

                            <div className="flex items-center justify-between pt-1">
                                {editingId !== "new" && !boards[editingId]?.isBuiltIn ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            deleteCatalog(editingId);
                                            setEditingId(null);
                                        }}
                                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#F2C4B1] bg-[#FFDFD1] px-3 text-xs font-bold text-[#465365] hover:bg-[#FFDFD1]/80"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Delete catalog
                                    </button>
                                ) : (
                                    <span />
                                )}

                                <button
                                    type="button"
                                    onClick={saveForm}
                                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#B6D8FA] bg-[#DCEEFF] px-4 text-xs font-bold text-[#465365] hover:bg-[#C6E2FF]"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                    Save catalog
                                </button>
                            </div>
                        </div>
                    )}

                    {addingToId && boards[addingToId] && (
                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-[#FFF9EC]/70 p-4">
                            <div className="flex items-center justify-between">
                                <span className="font-nunito text-xs font-bold uppercase tracking-wider text-[#465365]/75">
                                    Add existing words to {boards[addingToId].name}
                                </span>
                                <button
                                    onClick={() => setAddingToId(null)}
                                    className="text-xs font-semibold text-[#465365]/75 hover:text-[#465365]"
                                >
                                    Cancel
                                </button>
                            </div>

                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Filter vocabulary..."
                                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-[#465365]"
                            />

                            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                                {allWordTiles.map(t => {
                                    const picked = selectedTiles.has(t.id);
                                    return (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => {
                                                const next = new Set(selectedTiles);
                                                if (picked) next.delete(t.id);
                                                else next.add(t.id);
                                                setSelectedTiles(next);
                                            }}
                                            className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
                                                picked
                                                    ? "border-[#B6D8FA] bg-[#DCEEFF] text-[#465365]"
                                                    : "border-slate-200 bg-white text-[#465365]/80 hover:bg-[#DCEEFF]/40"
                                            }`}
                                        >
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={commitAddWords}
                                    disabled={selectedTiles.size === 0}
                                    className="h-9 rounded-xl border border-[#B6D8FA] bg-[#DCEEFF] px-4 text-xs font-bold text-[#465365] hover:bg-[#C6E2FF] disabled:opacity-40"
                                >
                                    Add {selectedTiles.size} selected
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}