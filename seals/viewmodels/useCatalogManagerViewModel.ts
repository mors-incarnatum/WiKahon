"use client";

import { useState } from "react";
import { useBoardStore } from "@/store/BoardProvider";
import type { ColorKey } from "@/lib/board";

export function useCatalogManagerViewModel() {
    const boards = useBoardStore(s => s.boards);
    const order = useBoardStore(s => s.catalogOrder);
    const create = useBoardStore(s => s.createCatalog);
    const update = useBoardStore(s => s.updateCatalog);
    const remove = useBoardStore(s => s.deleteCatalog);
    const reorder = useBoardStore(s => s.reorderCatalog);
    const folder = useBoardStore(s => s.placeFolderOnHome);
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
            homePlacements: new Set(boards.home?.pages.flatMap(page => Object.values(page.cells).map(c => c?.tileId)) ?? []),
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
                reset();
                setPlace(true);
                setSelected("new");
            },
            select: (id: string) => {
                if (colorSystem !== "custom") return;
                const b = boards[id];
                if (!b) return;
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
                if (confirmDelete) remove(confirmDelete);
                setDelete(null);
                reset();
            },
            reorder,
            placeFolder: (id: string) => {
                folder(id);
                setMessage("Folder placed on Home");
            },
        },
    };
}
