"use client";
/* Animated local symbols intentionally use img to preserve GIF playback when explicitly enabled. */
/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";
import { resolveBoardTileColor, type Tile, type ColorKey, type CatalogBoard } from "@/lib/board";
import { palette } from "@/app/theme";
import type { BoardData } from "@/store/useBoardStore";
import { useBoardStore } from "@/store/BoardProvider";
import { useTileInteractionViewModel } from "@/viewmodels/useTileInteractionViewModel";
import { useMediaUrl } from "@/viewmodels/useMediaUrl";

export function TileVisual({
    tile,
    color = "slate",
    appearance,
}: {
    tile: Tile;
    color?: ColorKey;
    appearance?: BoardData["tileAppearance"];
}) {
    const { src, missingMedia } = useMediaUrl(tile.iconName, tile.mediaId);
    const p = palette[color] ?? palette.slate;
    return (
        <span
            className={`tile-content label-${appearance?.labelPosition ?? "bottom"} font-${appearance?.fontScale ?? "md"} icon-${appearance?.iconScale ?? "md"}`}
            style={{ backgroundColor: p.surface, borderColor: p.border, color: p.text,
                "--tile-bg": p.bg, "--tile-surface": p.surface,
                "--tile-border": p.border, "--tile-text": p.text } as CSSProperties}
        >
            {tile.kind === "folder" && (
                <span className="folder-badge" aria-hidden="true">
                    ▰
                </span>
            )}
            {appearance?.showIcons !== false && tile.iconName === "speech" && !tile.mediaId && (
                <span aria-hidden="true" className="speech-symbol">
                    💬
                </span>
            )}
            {appearance?.showIcons !== false && src && <img src={src} alt="" draggable={false} />}
            <span className={`tile-label font-aac ${!src || appearance?.showIcons === false ? "text-only" : ""}`}>
                {tile.label}
                {missingMedia && <span className="sr-only"> (photo unavailable)</span>}
            </span>
        </span>
    );
}

export default function TileButton({
    tile,
    hidden,
    editing,
    moving,
    color,
    boards,
    boardId,
    appearance,
    onEdit,
    onMove,
}: {
    tile?: Tile;
    hidden: boolean;
    editing: boolean;
    moving: boolean;
    color: ColorKey;
    boards?: Record<string, Pick<CatalogBoard, "colorKey">>;
    boardId?: string;
    appearance: BoardData["tileAppearance"];
    onEdit: () => void;
    onMove?: () => void;
}) {
    const events = useTileInteractionViewModel(tile, hidden, onEdit, onMove, boardId);
    const colorSystem = useBoardStore(s => s.colorSystem);
    const allBoards = useBoardStore(s => s.boards);
    const actualColor = boards
        ? resolveBoardTileColor(tile, allBoards, appearance.colorMode, colorSystem, boardId)
        : appearance.colorMode === "neutral"
          ? "slate"
          : tile?.colorKey ?? color;

    const isInactiveSlot = !editing && (!tile || hidden);

    return (
        <button
            type="button"
            {...events}
            className={`aac-tile ${hidden ? "hidden-tile" : ""} ${moving ? "moving-tile" : ""}`}
            tabIndex={isInactiveSlot ? -1 : undefined}
            aria-label={
                hidden && !editing
                    ? "Empty slot"
                    : tile
                      ? `${tile.kind === "folder" ? "Open folder: " : ""}${tile.label}${hidden ? " (hidden)" : ""}${editing ? ", edit tile" : ""}`
                      : editing
                        ? "Add tile"
                        : "Empty slot"
            }
            aria-disabled={isInactiveSlot && !onMove}
        >
            {tile && (!hidden || editing) ? (
                <TileVisual tile={tile} color={actualColor} appearance={appearance} />
            ) : (
                <span aria-hidden="true" className="empty-slot">
                    {editing || onMove ? "+" : ""}
                </span>
            )}
        </button>
    );
}
