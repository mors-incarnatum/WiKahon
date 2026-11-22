"use client";

import Link from "next/link";
import {
    useBoardShellViewModel,
    SentenceContext,
} from "@/viewmodels/useBoardShellViewModel";
import { EditContext } from "@/viewmodels/useEditModeViewModel";
import SentenceStrip from "./SentenceStrip";
import { BoardSettings } from "./BoardSettings";
import { CatalogManager } from "./CatalogManager";
import CategoryWheel from "./CategoryWheel";
import Modal from "./Modal";

type IconName = "volume" | "edit" | "check" | "folder" | "settings";

function HeaderIcon({ name }: { name: IconName }) {
    const common = {
        width: 22,
        height: 22,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        "aria-hidden": true as const,
    };

    switch (name) {
        case "volume":
            return (
                <svg {...common}>
                    <path d="M11 5 6 9H3v6h3l5 4z" />
                    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
                </svg>
            );

        case "edit":
            return (
                <svg {...common}>
                    <path d="M12 20h9" />
                    <path d="m16.5 3.5 4 4L8 20l-5 1 1-5z" />
                </svg>
            );

        case "check":
            return (
                <svg {...common}>
                    <path d="m5 12 4 4L19 6" />
                </svg>
            );

        case "folder":
            return (
                <svg {...common}>
                    <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
            );

        case "settings":
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="3" />
                    <path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V4a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9z" />
                </svg>
            );
    }
}

const iconButtonStyle: React.CSSProperties = {
    width: 42,
    height: 42,
    minWidth: 42,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
};

export default function BoardShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const vm = useBoardShellViewModel();
    const isEditing = vm.edit.state.isEditMode;

    return (
        <SentenceContext.Provider value={vm.sentence}>
            <EditContext.Provider value={vm.edit}>
                <div className="board-shell">
                    <header
                        className="board-header"
                        style={{ padding: "14px 12px", gap: 12 }}
                    >
                        <Link href="/board" className="brand">
                            <b>W</b> WiKahon
                        </Link>

                        <SentenceStrip />

                        <div className="header-tools">
                            <label
                                className="volume-control"
                                title="Volume"
                                aria-label="Volume"
                                style={{ gap: 6 }}
                            >
                                <HeaderIcon name="volume" />
                                <input
                                    aria-label="Volume"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={vm.sentence.state.volume}
                                    onChange={(e) =>
                                        vm.sentence.actions.setVolume(
                                            Number(e.target.value)
                                        )
                                    }
                                />
                            </label>

                            <button
                                style={iconButtonStyle}
                                aria-label={
                                    isEditing ? "Done editing" : "Edit"
                                }
                                title={isEditing ? "Done editing" : "Edit"}
                                aria-pressed={isEditing}
                                onClick={vm.edit.actions.toggle}
                            >
                                <HeaderIcon
                                    name={isEditing ? "check" : "edit"}
                                />
                            </button>

                            <button
                                style={iconButtonStyle}
                                aria-label="Catalogs"
                                title="Catalogs"
                                onClick={() =>
                                    vm.actions.setPanel("catalogs")
                                }
                            >
                                <HeaderIcon name="folder" />
                            </button>

                            <button
                                style={iconButtonStyle}
                                aria-label="Settings"
                                title="Settings"
                                onClick={() =>
                                    vm.actions.setPanel("settings")
                                }
                            >
                                <HeaderIcon name="settings" />
                            </button>
                        </div>
                    </header>

                    {isEditing && (
                        <p className="edit-notice" role="status">
                            Edit mode · Select a tile to customize, move, or
                            hide it. Select an empty slot to add a word or
                            folder.
                        </p>
                    )}

                    <main
                        className="board-main"
                        aria-label="Communication board. Right-click or press Shift F10 for catalogs."
                        tabIndex={0}
                        onContextMenu={vm.actions.onContextMenu}
                        onKeyDown={vm.actions.onKeyDown}
                    >
                        {children}
                    </main>

                    <button
                        className="board-layout-control"
                        aria-label="Configure board layout"
                        title="Configure board layout"
                        onClick={() => vm.actions.setPanel("layout")}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="22"
                            height="22"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <rect x="6" y="6" width="5" height="5" rx="1" />
                            <rect x="13" y="6" width="5" height="5" rx="1" />
                            <rect x="6" y="13" width="5" height="5" rx="1" />
                            <rect x="13" y="13" width="5" height="5" rx="1" />
                        </svg>
                    </button>

                    {vm.state.wheel && (
                        <CategoryWheel
                            coords={vm.state.wheel}
                            onClose={vm.actions.closeWheel}
                            onManage={vm.actions.openCatalogs}
                        />
                    )}

                    {vm.state.panel === "settings" && (
                        <BoardSettings
                            open={true}
                            boardId={vm.state.boardId}
                            onClose={() => vm.actions.setPanel(null)}
                            mode="settings"
                        />
                    )}

                    {vm.state.panel === "layout" && (
                        <BoardSettings
                            open={true}
                            boardId={vm.state.boardId}
                            onClose={() => vm.actions.setPanel(null)}
                            mode="layout"
                        />
                    )}

                    {vm.state.panel === "catalogs" && (
                        <CatalogManager
                            open={true}
                            onClose={() => vm.actions.setPanel(null)}
                        />
                    )}

                    {vm.edit.state.pinDialog && (
                        <Modal
                            label="Unlock edit mode"
                            onClose={vm.edit.actions.closePin}
                            className="editor-modal small-modal"
                        >
                            <h2>Unlock edit mode</h2>
                            <label>
                                PIN
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    value={vm.edit.state.pin}
                                    onChange={(e) =>
                                        vm.edit.actions.setPin(e.target.value)
                                    }
                                />
                            </label>
                            <p role="alert">{vm.edit.state.error}</p>
                            <button onClick={vm.edit.actions.unlock}>
                                Unlock
                            </button>
                            <button onClick={vm.edit.actions.closePin}>
                                Cancel
                            </button>
                        </Modal>
                    )}
                </div>
            </EditContext.Provider>
        </SentenceContext.Provider>
    );
}