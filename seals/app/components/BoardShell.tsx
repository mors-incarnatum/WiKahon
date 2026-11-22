"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BoardPageMemoryContext, createBoardPageMemory } from "@/viewmodels/boardPageMemory";
import { useEffect, useRef, useState } from "react";
import { resolveBoardTileColor, type Tile, type ColorKey } from "@/lib/board";
import { useMediaUrl } from "@/viewmodels/useMediaUrl";
import { ChatDraftContext } from "@/viewmodels/useChatDraftViewModel";
/* eslint-disable @next/next/no-img-element */
import { palette } from "@/app/theme";
import { useBoardShellViewModel, SentenceContext } from "@/viewmodels/useBoardShellViewModel";
import { EditContext } from "@/viewmodels/useEditModeViewModel";
import SentenceStrip from "./SentenceStrip";
import BoardSettings from "./BoardSettings";
import CatalogManager from "./CatalogManager";
import CategoryWheel from "./CategoryWheel";

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

function PinnedTile({ tile, color, onActivate }: { tile: Tile; color: ColorKey; onActivate: () => void }) {
    const { src, missingMedia } = useMediaUrl(tile.iconName, tile.mediaId);
    return (
        <button
            type="button"
            className="pinned-tile"
            style={{ backgroundColor: palette[color].surface, borderColor: palette[color].border, color: palette[color].text }}
            onClick={onActivate}
            aria-label={`${tile.label}${missingMedia ? ", photo unavailable" : ""}`}
        >
            {tile.iconName === "speech" && !tile.mediaId && <span aria-hidden="true">💬</span>}
            {src && <img src={src} alt="" draggable={false} width={32} height={32} />}
            {tile.label}
        </button>
    );
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

export default function BoardShell({ children }: { children: React.ReactNode }) {
    const vm = useBoardShellViewModel();
    const pathname = usePathname();
    const [pageMemory] = useState(createBoardPageMemory);
    const addWordsRef = useRef<HTMLButtonElement>(null);
    const cancelCompositionRef = useRef<HTMLButtonElement>(null);
    const isComposing = vm.chatDraft.state.isComposing;

    useEffect(() => {
        if (isComposing && !vm.state.isChatOpen && vm.state.currentUser) {
            const addButton = addWordsRef.current;
            (addButton && !addButton.disabled ? addButton : cancelCompositionRef.current)?.focus();
        }
    }, [isComposing, vm.state.isChatOpen, vm.state.currentUser]);

    useEffect(() => {
        if (pathname === "/chat" || pathname === "/scribble") {
            pageMemory.prepareReturn();
        } else if (!pathname.startsWith("/board")) {
            pageMemory.clear();
        }
    }, [pathname, pageMemory]);

    if (!vm.state.ready) {
        return <div role="status">Loading board…</div>;
    }

    if (!vm.state.currentUser) {
        return null;
    }

    return (
        <BoardPageMemoryContext.Provider value={pageMemory}>
        <ChatDraftContext.Provider value={vm.chatDraft}>
        <SentenceContext.Provider value={vm.sentence}>
            <EditContext.Provider value={vm.edit}>
                <div
                    className="board-shell"
                    onPointerDown={vm.edit.actions.touchActivity}
                    onKeyDown={vm.edit.actions.touchActivity}
                >
                    {!vm.state.isChatOpen && <header className="board-header" style={{ padding: "14px 12px", gap: 12 }}>
                        {vm.state.isScribbleOpen ? <button type="button" className="scribble-back" onClick={vm.actions.toggleScribble}>← Back to board</button> : <Link href="/board" className="brand" onClick={() => vm.actions.setPanel(null)}>
                            <b>W</b> WiKahon
                        </Link>}
                        <SentenceStrip />
                        {!vm.state.isScribbleOpen && <div className="header-tools">
                            {vm.state.isGuardian ? (
                                <>
                                    <span
                                        className="profile-badge"
                                        aria-label={`Signed in guardian: ${vm.state.currentUser.name}`}
                                    >
                                        🔑 {vm.state.currentUser.name}
                                    </span>
                                    <label className="volume-control" title="Volume">
                                        <HeaderIcon name="volume" />
                                        <input
                                            aria-label="Volume"
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.1"
                                            value={vm.sentence.state.volume}
                                            onChange={e => vm.sentence.actions.setVolume(Number(e.target.value))}
                                        />
                                    </label>
                                </>
                            ) : (
                                <span
                                    className="profile-badge"
                                    aria-label={`Signed in child: ${vm.state.currentUser.name}`}
                                >
                                    👶 {vm.state.currentUser.name}
                                </span>
                            )}
                            {vm.state.featureFlags?.scribblePractice && (
                                <button
                                    type="button"
                                    aria-pressed={vm.state.isScribbleOpen}
                                    onClick={vm.actions.toggleScribble}
                                >
                                    ✍ Scribble
                                </button>
                            )}
                            {vm.state.featureFlags?.parentChildChat && !isComposing && (
                                <button
                                    type="button"
                                    aria-pressed={vm.state.isChatOpen}
                                    aria-label={
                                        vm.state.unreadChatCount > 0
                                            ? `${vm.chatDraft.state.hasDraft ? "Resume chat" : "Chat"} (${vm.state.unreadChatCount} unread ${vm.state.unreadChatCount === 1 ? "message" : "messages"})`
                                            : vm.chatDraft.state.hasDraft ? "Resume chat" : "Chat"
                                    }
                                    onClick={vm.actions.toggleChat}
                                    className="inline-flex items-center gap-1.5"
                                >
                                    💬 {vm.chatDraft.state.hasDraft ? "Resume chat" : "Chat"}
                                    {vm.state.unreadChatCount > 0 && (
                                        <span
                                            aria-hidden="true"
                                            className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-bold leading-none"
                                        >
                                            {vm.state.unreadChatCount > 99 ? "99+" : vm.state.unreadChatCount}
                                        </span>
                                    )}
                                </button>
                            )}
                            {vm.state.isGuardian && (
                                <div className="guardian-tools" role="group" aria-label="Guardian board tools">
                                    <button
                                        type="button"
                                        style={iconButtonStyle}
                                        aria-label={vm.edit.state.isEditMode ? "Done editing" : "Edit"}
                                        title={vm.edit.state.isEditMode ? "Done editing" : "Edit"}
                                        aria-pressed={vm.edit.state.isEditMode}
                                        onClick={vm.edit.actions.toggle}
                                    >
                                        <HeaderIcon name={vm.edit.state.isEditMode ? "check" : "edit"} />
                                    </button>
                                    <button type="button" style={iconButtonStyle} aria-label="Catalogs" title="Catalogs" onClick={() => vm.actions.setPanel("catalogs")}>
                                        <HeaderIcon name="folder" />
                                    </button>
                                    <button type="button" style={iconButtonStyle} aria-label="Settings" title="Settings" onClick={() => vm.actions.setPanel("settings")}>
                                        <HeaderIcon name="settings" />
                                    </button>
                                </div>
                            )}
                            {vm.state.canSyncCloud && (
                                <button
                                    type="button"
                                    disabled={vm.state.syncingCloud}
                                    onClick={() => void vm.actions.syncCloudNow()}
                                    aria-label={vm.state.syncingCloud ? "Getting latest board" : "Get latest board from cloud"}
                                    title="Get latest board from cloud"
                                >
                                    {vm.state.syncingCloud ? "Getting board…" : "Get latest board"}
                                </button>
                            )}
                            <button type="button" onClick={vm.actions.logout}>
                                Log out
                            </button>
                        </div>}
                    </header>}

                    {!vm.state.isScribbleOpen && vm.state.syncStatus && (
                        <div className="edit-notice" role="status">
                            <span>{vm.state.syncStatus}</span>{" "}
                            <button type="button" onClick={vm.actions.clearSyncStatus}>
                                Dismiss
                            </button>
                        </div>
                    )}

                    {!vm.state.isScribbleOpen && vm.state.storageError && (
                        <div className="edit-notice" role="alert">
                            <span>{vm.state.storageError}</span>{" "}
                            {vm.state.isGuardian && (
                                <>
                                    <button type="button" onClick={() => vm.actions.setPanel("profiles")}>
                                        Open backup &amp; settings
                                    </button>{" "}
                                </>
                            )}
                            <button type="button" onClick={vm.actions.clearStorageError}>
                                Dismiss
                            </button>
                        </div>
                    )}

                    {!vm.state.isChatOpen && !vm.state.isScribbleOpen && vm.state.isGuardian && vm.edit.state.isEditMode && (
                        <p className="edit-notice" role="status">
                            Edit mode · Select a tile to customize, move, or hide it. Select an empty slot to add a word or folder.
                        </p>
                    )}

                    {!vm.state.isChatOpen && !vm.state.isScribbleOpen && vm.state.featureFlags?.pinnedVocabulary && vm.state.pinnedTiles.length > 0 && (
                        <nav
                            className="pinned-vocabulary"
                            aria-label="Pinned core vocabulary"
                        >
                            <span className="text-xs font-semibold text-slate-600 mr-1">Pinned:</span>
                            {vm.state.pinnedTiles.map(tile => {
                                const color = resolveBoardTileColor(
                                    tile,
                                    vm.state.boards,
                                    vm.state.tileAppearance.colorMode,
                                    vm.state.colorSystem,
                                );
                                return (
                                    <PinnedTile
                                        key={tile.id}
                                        tile={tile}
                                        color={color}
                                        onActivate={() => vm.sentence.actions.onTileActivate(tile)}
                                    />
                                );
                            })}
                        </nav>
                    )}

                    {isComposing && !vm.state.isChatOpen && !vm.state.isScribbleOpen && (
                        <div className="chat-composition-controls" role="group" aria-label="Add board words to chat">
                            <span>Select words for your chat message</span>
                            <button
                                ref={addWordsRef}
                                type="button"
                                className="primary"
                                disabled={!vm.chatDraft.state.hasUnusedWords}
                                onClick={vm.actions.addWordsToChat}
                            >
                                Add words to chat
                            </button>
                            <button ref={cancelCompositionRef} type="button" onClick={vm.actions.cancelChatComposition}>
                                Cancel and resume chat
                            </button>
                        </div>
                    )}

                    <main
                        className={vm.state.isChatOpen || vm.state.isScribbleOpen ? "board-main !pb-0" : "board-main"}
                        aria-label={
                            vm.state.isChatOpen
                                ? "Parent-child chat."
                                : vm.state.isScribbleOpen
                                  ? "Scribble handwriting practice."
                                  : vm.state.wheelEnabled
                                    ? "Communication board. Right-click or press Shift F10 for catalogs."
                                    : "Communication board."
                        }
                        tabIndex={0}
                        onContextMenu={vm.actions.onContextMenu}
                        onKeyDown={vm.actions.onKeyDown}
                    >
                        {children}
                    </main>

                    {vm.state.isGuardian && !vm.state.isChatOpen && !vm.state.isScribbleOpen && (
                        <button
                            type="button"
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
                    )}

                    {vm.state.wheelEnabled && vm.state.wheel && (
                        <CategoryWheel
                            coords={vm.state.wheel}
                            onClose={vm.actions.closeWheel}
                            onManage={vm.actions.openCatalogs}
                        />
                    )}
                    {vm.state.isGuardian && (vm.state.panel === "settings" || vm.state.panel === "profiles") && (
                        <BoardSettings
                            boardId={vm.state.boardId}
                            onClose={() => vm.actions.setPanel(null)}
                            initialTab={vm.state.panel === "profiles" ? "profiles" : "colorSystem"}
                        />
                    )}
                    {vm.state.isGuardian && vm.state.panel === "layout" && (
                        <BoardSettings
                            boardId={vm.state.boardId}
                            onClose={() => vm.actions.setPanel(null)}
                            initialTab="layout"
                        />
                    )}
                    {vm.state.isGuardian && vm.state.panel === "catalogs" && (
                        <CatalogManager onClose={() => vm.actions.setPanel(null)} />
                    )}
                </div>
            </EditContext.Provider>
        </SentenceContext.Provider>
        </ChatDraftContext.Provider>
        </BoardPageMemoryContext.Provider>
    );
}
