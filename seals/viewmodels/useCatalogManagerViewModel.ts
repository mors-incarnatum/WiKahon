"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useBoardStore } from "@/store/BoardProvider";
import type { CellKey, ColorKey } from "@/lib/board";

export function useCatalogManagerViewModel() {
    const pathname = usePathname();
    const router = useRouter();
    const boards = useBoardStore(s => s.boards);
    const tiles = useBoardStore(s => s.tiles);
    const order = useBoardStore(s => s.catalogOrder);
    const create = useBoardStore(s => s.createCatalog);
    const update = useBoardStore(s => s.updateCatalog);
    const remove = useBoardStore(s => s.deleteCatalog);
    const reorder = useBoardStore(s => s.reorderCatalog);
    const folder = useBoardStore(s => s.placeFolderOnHome);
    const assignSlot = useBoardStore(s => s.assignSlot);
    const colorSystem = useBoardStore(s => s.colorSystem ?? "custom");

    const [selected, setSelected] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [shortName, setShortName] = useState("");
    const [colorKey, setColor] = useState<ColorKey>("teal");
    const [iconName, setIcon] = useState<string | null>(null);
    const [placeOnHome, setPlace] = useState(true);
    const [confirmDelete, setDelete] = useState<string | null>(null);
    const [adding, setAdding] = useState<string | null>(null);
    const [message, setMessage] = useState("");

    const homeCatalogIds = useMemo(() => {
        const ids = new Set<string>();
        boards.home?.pages.forEach(page => {
            Object.values(page.cells).forEach(cell => {
                const tile = cell ? tiles[cell.tileId] : undefined;
                if (tile?.kind === "folder" && tile.targetBoardId) {
                    ids.add(tile.targetBoardId);
                }
            });
        });
        return ids;
    }, [boards.home, tiles]);

    const reset = () => {
        setSelected(null);
        setName("");
        setShortName("");
        setColor("teal");
        setIcon(null);
    };

    return {
        state: {
            catalogs: order.map(id => boards[id]).filter(Boolean),
            selected,
            name,
            shortName,
            colorKey,
            iconName,
            placeOnHome,
            confirmDelete,
            adding,
            message,
            colorSystem,
            homeCatalogIds,
        },
        actions: {
            setName,
            setShortName,
            setColor,
            setIcon,
            setPlace,
            setDelete,
            setAdding,
            reset,
            startCreate: () => {
                if (colorSystem !== "custom") return;
                setMessage("");
                reset();
                setPlace(true);
                setSelected("new");
            },
            select: (id: string) => {
                if (colorSystem !== "custom") return;
                const b = boards[id];
                if (!b) return;
                setMessage("");
                setSelected(id);
                setName(b.name);
                setShortName(b.shortName);
                setColor(b.colorKey);
                setIcon(b.iconName);
            },
            save: () => {
                if (!name.trim() || colorSystem !== "custom") return;
                if (selected && selected !== "new") {
                    update(selected, {
                        name: name.trim(),
                        shortName: shortName.trim() || name.trim(),
                        colorKey,
                        iconName,
                    });
                } else {
                    create({
                        name,
                        shortName,
                        colorKey,
                        iconName,
                        placeFolderOnHome: placeOnHome,
                    });
                }
                setMessage("Catalog saved");
                reset();
            },
            deleteConfirmed: () => {
                if (confirmDelete) {
                    const deletedId = confirmDelete;
                    remove(deletedId);
                    if (
                        pathname === `/board/${encodeURIComponent(deletedId)}` ||
                        pathname === `/board/${deletedId}`
                    ) {
                        router.replace("/board");
                    }
                    setMessage("Catalog deleted");
                }
                setDelete(null);
                reset();
            },
            reorder,
            placeFolder: (id: string) => {
                folder(id);
                setMessage("Folder placed on Home");
            },
            removeFolderFromHome: (id: string) => {
                const homePages = boards.home?.pages ?? [];
                const targets: { pageIndex: number; key: CellKey }[] = [];
                homePages.forEach((page, pageIndex) => {
                    Object.entries(page.cells).forEach(([key, cell]) => {
                        const tile = cell ? tiles[cell.tileId] : undefined;
                        if (tile?.kind === "folder" && tile.targetBoardId === id) {
                            targets.push({ pageIndex, key: key as CellKey });
                        }
                    });
                });
                targets
                    .sort((a, b) => b.pageIndex - a.pageIndex)
                    .forEach(({ pageIndex, key }) => assignSlot("home", pageIndex, key, null));
                if (targets.length > 0) {
                    setMessage("Folder removed from Home");
                }
            },
        },
    };
}
