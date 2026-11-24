"use client";

import type { CSSProperties } from "react";
import { useBoardGridViewModel } from "@/viewmodels/useBoardGridViewModel";
import { useEditContext } from "@/viewmodels/useEditModeViewModel";
import TileButton from "./TileButton";
import TileActionMenu from "./TileActionMenu";
import TileEditor from "./TileEditor";

export default function BoardGrid({ boardId }: { boardId: string }) {
    const edit = useEditContext();
    const { state: s, actions: a, scrollRef } = useBoardGridViewModel(boardId, edit.state.isEditMode);

    const tileWidth = s.appearance.tileWidth ?? 50;
    const tileHeight = s.appearance.tileHeight ?? 50;

    const boardSizeStyle = {
        "--tile-width-scale": s.automatic ? 1 : tileWidth / 50,
        "--tile-height-scale": s.automatic ? 1 : tileHeight / 50,
    } as CSSProperties;

    return (
        <>
            <div
                ref={scrollRef}
                className={s.automatic ? "board-scroll board-scroll-automatic" : "board-scroll"}
                role="region"
                aria-label="Scrollable communication board"
                tabIndex={0}
                style={boardSizeStyle}
                onScroll={a.onScroll}
                onKeyDown={a.onKeyDown}
            >
                {s.pages.map(p => (
                    <section key={p.page} className="board-page" data-board-page={p.page}>
                        <div
                            className={`board-grid gap-${s.appearance.gridGap}`}
                            role="group"
                            aria-label={`${s.board?.name} page ${p.page + 1} tiles, ${s.rows} rows, ${s.cols} columns`}
                            style={{
                                gridTemplateColumns: `repeat(${s.cols}, minmax(0, 1fr))`,
                                gridTemplateRows: `repeat(${s.rows}, minmax(0, 1fr))`,
                                touchAction: "pan-x pan-y",
                            }}
                        >
                            {p.cells.map(c => (
                                <TileButton
                                    key={`${c.sourcePage}/${c.key}`}
                                    tile={c.tile}
                                    hidden={!!c.placement?.hidden}
                                    editing={edit.state.isEditMode}
                                    moving={s.moving === c.key && s.movingPage === c.sourcePage}
                                    color={s.boards[c.tile?.categoryId ?? ""]?.colorKey ?? "slate"}
                                    boards={s.boards}
                                    boardId={boardId}
                                    appearance={s.appearance}
                                    onEdit={() => a.open(c.key, c.sourcePage)}
                                    onMove={
                                        s.moving && edit.state.isEditMode
                                            ? () => a.moveTo(c.key, c.sourcePage)
                                            : undefined
                                    }
                                />
                            ))}
                        </div>
                    </section>
                ))}
            </div>

            <div
                className="board-page-indicator"
                aria-live="polite"
                style={
                    edit.state.isEditMode && !s.automatic
                        ? { pointerEvents: "auto", display: "inline-flex", alignItems: "center", gap: 8 }
                        : undefined
                }
            >
                <span>
                    Page {s.page + 1} / {s.pageCount}
                </span>
                {edit.state.isEditMode && !s.automatic && (
                    <button
                        type="button"
                        onClick={a.addPage}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-700"
                    >
                        + Add page
                    </button>
                )}
            </div>

            {s.moving && (
                <p role="status">
                    Choose a destination slot (scroll for other pages) · Escape to cancel
                </p>
            )}

            {s.overflow > 0 && edit.state.isEditMode && (
                <p>
                    {s.overflow} tiles outside this layout. Enlarge in Settings or{" "}
                    <button type="button" onClick={a.reflow}>
                        Reflow
                    </button>
                </p>
            )}

            {s.target && !s.editor && edit.state.isEditMode && (
                <TileActionMenu
                    label={s.targetTile?.label ?? "Tile"}
                    hidden={!!s.placement?.hidden}
                    canPin={s.targetTile?.kind === "word"}
                    pinned={s.isTargetPinned}
                    onClose={a.close}
                    onEdit={() => a.setEditor("edit")}
                    onReplace={() => a.setEditor("replace")}
                    onMove={a.startMove}
                    onHide={a.toggleHidden}
                    onTogglePin={a.togglePinTarget}
                    onRemove={a.remove}
                />
            )}

            {s.target && s.editor && edit.state.isEditMode && (
                <TileEditor
                    boardId={boardId}
                    page={s.targetPage}
                    cell={s.target}
                    tile={s.editor === "edit" ? s.targetTile : undefined}
                    onClose={a.close}
                />
            )}
        </>
    );
}
