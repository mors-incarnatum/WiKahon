"use client";
/* Animated local symbols intentionally use img to preserve GIF playback offline. */
/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";
import {
    iconPath,
    resolveTileColorKey,
    type Tile,
    type ColorKey
} from "@/lib/board";
import { palette } from "@/app/theme";
import type { BoardData } from "@/store/useBoardStore";
import { useBoardStore } from "@/store/BoardProvider";
import { useTileInteractionViewModel } from "@/viewmodels/useTileInteractionViewModel";

export function TileVisual({
    tile,
    color = "slate",
    appearance
}: {
    tile: Tile;
    color?: ColorKey;
    appearance?: BoardData["tileAppearance"];
}) {
    const src = iconPath(tile.iconName);
    const p = palette[color] ?? palette.slate;

    return (
        <span
            className={`tile-content label-${appearance?.labelPosition ?? "bottom"} font-${appearance?.fontScale ?? "md"} icon-${appearance?.iconScale ?? "md"}`}
            style={{
                backgroundColor: p.surface,
                borderColor: p.border,
                color: p.text,
                "--tile-bg": p.bg,
                "--tile-surface": p.surface,
                "--tile-border": p.border,
                "--tile-text": p.text
            } as CSSProperties}
        >
            {tile.kind === "folder" && (
                <span className="folder-badge" aria-hidden="true">
                    ▰
                </span>
            )}

            {appearance?.showIcons !== false && tile.iconName === "speech" && (
                <span aria-hidden="true" className="speech-symbol">
                    💬
                </span>
            )}

            {appearance?.showIcons !== false && src && (
                <img src={src} alt="" draggable={false} />
            )}

            <span
                className={`tile-label font-aac ${!src || appearance?.showIcons === false ? "text-only" : ""}`}
            >
                {tile.label}
            </span>
        </span>
    );
}

export default function TileButton({
    tile,
    hidden,
    editing,
    moving,
    appearance,
    onEdit,
    onMove
}: {
    tile?: Tile;
    hidden: boolean;
    editing: boolean;
    moving: boolean;
    appearance: BoardData["tileAppearance"];
    onEdit: () => void;
    onMove?: () => void;
}) {
    const colorSystem = useBoardStore(s => s.colorSystem);
    const colorSystemConfigs = useBoardStore(s => s.colorSystemConfigs);
    const boards = useBoardStore(s => s.boards);

    const assignment =
        tile && colorSystemConfigs[colorSystem]?.tileAssignments
            ? colorSystemConfigs[colorSystem]?.tileAssignments[tile.id]
            : undefined;

    const actualColor = tile
        ? resolveTileColorKey(
              tile,
              assignment,
              boards,
              colorSystem,
              appearance.colorMode
          )
        : "slate";

    const events = useTileInteractionViewModel(tile, hidden, onEdit, onMove);

    return (
        <button
            type="button"
            {...events}
            className={`aac-tile ${hidden ? "hidden-tile" : ""} ${moving ? "moving-tile" : ""}`}
            aria-label={
                hidden && !editing
                    ? "Empty slot"
                    : tile
                      ? `${tile.kind === "folder" ? "Open folder: " : ""}${tile.label}${hidden ? " (hidden)" : ""}${editing ? ", edit tile" : ""}`
                      : editing
                        ? "Add tile"
                        : "Empty slot"
            }
            aria-disabled={(!tile || hidden) && !editing && !onMove}
        >
            {tile && (!hidden || editing) ? (
                <TileVisual
                    tile={tile}
                    color={actualColor}
                    appearance={appearance}
                />
            ) : (
                <span aria-hidden="true" className="empty-slot">
                    {editing || onMove ? "+" : ""}
                </span>
            )}
        </button>
    );
}