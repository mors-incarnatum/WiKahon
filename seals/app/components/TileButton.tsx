"use client";
/* Animated local symbols intentionally use img to preserve GIF playback when explicitly enabled. */
/* eslint-disable @next/next/no-img-element */
import { useContext, type CSSProperties } from "react";
import { resolveBoardTileColor, type Tile, type ColorKey, type CatalogBoard } from "@/lib/board";
import { palette } from "@/app/theme";
import type { BoardData } from "@/store/useBoardStore";
import { useBoardStore } from "@/store/BoardProvider";
import { ChatDraftContext } from "@/viewmodels/useChatDraftViewModel";
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
    const chatDraft = useContext(ChatDraftContext);
    const isSelectingForChat = Boolean(chatDraft?.state.isComposing);
    const selectedCount =
        isSelectingForChat && tile && tile.kind === "word" && !hidden
            ? (chatDraft?.state.selectedTileCounts[tile.id] ?? 0)
            : 0;
    const isChatSelected = selectedCount > 0;
    const colorSystem = useBoardStore(s => s.colorSystem);
    const allBoards = useBoardStore(s => s.boards);
    const actualColor = boards
        ? resolveBoardTileColor(tile, allBoards, appearance.colorMode, colorSystem, boardId)
        : appearance.colorMode === "neutral"
          ? "slate"
          : tile?.colorKey ?? color;

    const effectiveEditing = editing && !isSelectingForChat;
    const isInactiveSlot = !effectiveEditing && (!tile || hidden);

    return (
        <button
            type="button"
            {...events}
            className={`aac-tile ${hidden ? "hidden-tile" : ""} ${moving && !isSelectingForChat ? "moving-tile" : ""} ${isChatSelected ? "chat-selected-tile" : ""}`}
            tabIndex={isInactiveSlot ? -1 : undefined}
            aria-pressed={isSelectingForChat && tile?.kind === "word" && !hidden ? isChatSelected : undefined}
            aria-label={
                hidden && !effectiveEditing
                    ? "Empty slot"
                    : tile
                      ? `${tile.kind === "folder" ? "Open folder: " : ""}${tile.label}${hidden ? " (hidden)" : ""}${isChatSelected ? `, selected (${selectedCount})` : ""}${effectiveEditing ? ", edit tile" : ""}`
                      : effectiveEditing
                        ? "Add tile"
                        : "Empty slot"
            }
            aria-disabled={isInactiveSlot && (!onMove || isSelectingForChat)}
        >
            {tile && (!hidden || effectiveEditing) ? (
                <div className="relative h-full w-full">
                    <TileVisual tile={tile} color={actualColor} appearance={appearance} />
                    {isChatSelected && (
                        <span className="chat-tile-badge" aria-hidden="true">
                            {selectedCount > 1 ? selectedCount : (
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="m5 12 4 4L19 6" />
                                </svg>
                            )}
                        </span>
                    )}
                </div>
            ) : (
                <span aria-hidden="true" className="empty-slot">
                    {effectiveEditing || (onMove && !isSelectingForChat) ? "+" : ""}
                </span>
            )}
        </button>
    );
}
