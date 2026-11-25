"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { BoardPageMemoryContext, createBoardPageMemory } from "@/viewmodels/boardPageMemory";
import { resolveBoardTileColor, resolveTokenColor, type Tile, type ColorKey, type SentenceToken, type ColorMode, type ColorSystemId } from "@/lib/board";
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

type IconName =
    | "volume"
    | "edit"
    | "check"
    | "folder"
    | "settings"
    | "keyboard"
    | "chat"
    | "scribble"
    | "back"
    | "speech"
    | "remove";

function HeaderIcon({ name, size = 22 }: { name: IconName; size?: number }) {
    const common = {
        width: size,
        height: size,
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
                    <path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V4a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9z" />
                </svg>
            );
        case "keyboard":
            return (
                <svg {...common}>
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <path d="M6 9h1M10 9h1M14 9h1M17 9h1" />
                    <path d="M6 12.5h1M10 12.5h1M14 12.5h1M17 12.5h1" />
                    <path d="M8 16h8" />
                </svg>
            );
        case "chat":
        case "speech":
            return (
                <svg {...common}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
            );
        case "scribble":
            return (
                <svg {...common}>
                    <path d="M12 20h9" />
                    <path d="m16.5 3.5 4 4L8 20l-5 1 1-5z" />
                </svg>
            );
        case "back":
            return (
                <svg {...common}>
                    <path d="m15 18-6-6 6-6" />
                </svg>
            );
        case "remove":
            return (
                <svg {...common}>
                    <path d="m6 6 12 12M18 6 6 18" />
                </svg>
            );
    }
}

function SelectionTokenChip({
    token,
    colorMode,
    colorSystem,
    onRemove,
}: {
    token: SentenceToken;
    colorMode: ColorMode;
    colorSystem: ColorSystemId;
    onRemove: () => void;
}) {
    const { src } = useMediaUrl(token.iconName, token.mediaId);
    const color = resolveTokenColor(token, colorMode, colorSystem);
    const p = palette[color] ?? palette.slate;

    return (
        <button
            type="button"
            className="chat-selection-token"
            style={{
                backgroundColor: p.surface,
                borderColor: p.border,
                color: p.text,
            }}
            onClick={onRemove}
            aria-label={`Remove ${token.label}`}
        >
            {token.iconName === "speech" && !token.mediaId && <HeaderIcon name="speech" size={16} />}
            {src && <img src={src} alt="" width={20} height={20} draggable={false} />}
            <span>{token.label}</span>
            <HeaderIcon name="remove" size={14} />
        </button>
    );
}

function PinnedTile({
    tile,
    color,
    onActivate,
}: {
    tile: Tile;
    color: ColorKey;
    onActivate: () => void;
}) {
    const { src, missingMedia } = useMediaUrl(tile.iconName, tile.mediaId);

    return (
        <button
            type="button"
            className="pinned-tile"
            style={{
                backgroundColor: palette[color].surface,
                borderColor: palette[color].border,
                color: palette[color].text,
            }}
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
    const [sidebarOpen, setSidebarOpen] = useState(false);
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
                            <header
                                className="board-header"
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    flexWrap: "nowrap",
                                    padding: "10px 12px",
                                    gap: 10,
                                }}
                            >
                                <Link
                                    href="/board"
                                    className="brand"
                                    style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                                    onClick={() => vm.actions.setPanel(null)}
                                >
                                    <b>W</b> WiKahon
                                </Link>

                                {!vm.state.isChatOpen && !vm.state.isScribbleOpen && !isComposing && (
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <SentenceStrip />
                                    </div>
                                )}

                                {!vm.state.isScribbleOpen && !isComposing && (
                                    <div
                                        className="header-tools"
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {vm.state.isGuardian && (
                                            <>
                                                <label
                                                    className="volume-control"
                                                    title="Volume"
                                                    style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        gap: 4,
                                                    }}
                                                >
                                                    <HeaderIcon name="volume" />
                                                    <input
                                                        aria-label="Volume"
                                                        type="range"
                                                        min="0"
                                                        max="1"
                                                        step="0.1"
                                                        value={vm.sentence.state.volume}
                                                        onChange={e =>
                                                            vm.sentence.actions.setVolume(
                                                                Number(e.target.value),
                                                            )
                                                        }
                                                    />
                                                </label>

                                                <div
                                                    className="guardian-tools"
                                                    role="group"
                                                    aria-label="Guardian board tools"
                                                    style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                    }}
                                                >
                                                    <button
                                                        type="button"
                                                        style={iconButtonStyle}
                                                        aria-label={
                                                            vm.edit.state.isEditMode
                                                                ? "Done editing"
                                                                : "Edit"
                                                        }
                                                        title={
                                                            vm.edit.state.isEditMode
                                                                ? "Done editing"
                                                                : "Edit"
                                                        }
                                                        aria-pressed={vm.edit.state.isEditMode}
                                                        onClick={vm.edit.actions.toggle}
                                                    >
                                                        <HeaderIcon
                                                            name={
                                                                vm.edit.state.isEditMode
                                                                    ? "check"
                                                                    : "edit"
                                                            }
                                                        />
                                                    </button>
                                                    <button
                                                        type="button"
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
                                                        type="button"
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
                                            </>
                                        )}
                                    </div>
                                )}
                            </header>

                            <div
                                style={{
                                    display: "flex",
                                    flex: 1,
                                    minHeight: 0,
                                    width: "100%",
                                    position: "relative",
                                }}
                            >
                                <button
                                    type="button"
                                    aria-expanded={sidebarOpen}
                                    aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                                    title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                                    onClick={() => setSidebarOpen(open => !open)}
                                    style={{
                                        position: "absolute",
                                        left: sidebarOpen ? 240 : 0,
                                        top: "50%",
                                        transform: "translateY(-50%)",
                                        zIndex: 50,
                                        width: 24,
                                        height: 48,
                                        backgroundColor: palette.blue.bg,
                                        color: palette.blue.text,
                                        border: `1px solid ${palette.blue.border}`,
                                        borderLeft: sidebarOpen ? `1px solid ${palette.blue.border}` : "none",
                                        borderTopRightRadius: 6,
                                        borderBottomRightRadius: 6,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        cursor: "pointer",
                                        boxShadow: "2px 0 4px rgba(0,0,0,0.05)",
                                        transition: "left 0.2s ease",
                                    }}
                                >
                                    {sidebarOpen ? "<" : ">"}
                                </button>

                                {sidebarOpen && (
                                    <aside
                                        aria-label="Board sidebar"
                                        style={{
                                            width: 240,
                                            flexShrink: 0,
                                            borderRight: `1px solid ${palette.blue.border}`,
                                            backgroundColor: palette.blue.bg,
                                            color: palette.blue.text,
                                            padding: "16px 12px",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 12,
                                        }}
                                    >
                                        <div
                                            style={{
                                                padding: "4px 4px 14px",
                                                borderBottom: `1px solid ${palette.blue.border}`,
                                                display: "flex",
                                                justifyContent: "center",
                                            }}
                                        >
                                            <span
                                                className="profile-badge sidebar-user-title"
                                                aria-label={`${vm.state.isGuardian ? "Signed in guardian" : "Signed in child"}: ${vm.state.currentUser.name}`}
                                                style={{
                                                    backgroundColor: palette.blue.surface,
                                                    borderColor: palette.blue.border,
                                                    color: palette.blue.text,
                                                }}
                                            >
                                                {vm.state.currentUser.name}
                                            </span>
                                        </div>

                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                textAlign: "left",
                                            }}
                                        >
                                            {vm.state.featureFlags?.scribblePractice && (
                                                <button
                                                    type="button"
                                                    style={{
                                                        textAlign: "left",
                                                        width: "100%",
                                                        padding: "10px 8px",
                                                        background: "transparent",
                                                        border: "none",
                                                        borderBottom:
                                                            (vm.state.featureFlags?.parentChildChat &&
                                                                !isComposing) ||
                                                            vm.state.canSyncCloud
                                                                ? `1px solid ${palette.blue.surface}`
                                                                : "none",
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 8,
                                                        color: palette.blue.text,
                                                    }}
                                                    aria-pressed={vm.state.isScribbleOpen}
                                                    onClick={vm.actions.toggleScribble}
                                                >
                                                    <HeaderIcon
                                                        name={vm.state.isScribbleOpen ? "back" : "scribble"}
                                                        size={18}
                                                    />
                                                    <span>
                                                        {vm.state.isScribbleOpen
                                                            ? "Back to board"
                                                            : "Scribble"}
                                                    </span>
                                                </button>
                                            )}

                                            {!vm.state.isScribbleOpen &&
                                                vm.state.featureFlags?.parentChildChat &&
                                                !isComposing && (
                                                    <button
                                                        type="button"
                                                        style={{
                                                            textAlign: "left",
                                                            width: "100%",
                                                            padding: "10px 8px",
                                                            background: "transparent",
                                                            border: "none",
                                                            borderBottom: vm.state.canSyncCloud
                                                                ? `1px solid ${palette.blue.surface}`
                                                                : "none",
                                                            cursor: "pointer",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "space-between",
                                                            color: palette.blue.text,
                                                        }}
                                                        aria-pressed={vm.state.isChatOpen}
                                                        aria-label={
                                                            vm.state.unreadChatCount > 0
                                                                ? `${vm.chatDraft.state.hasDraft ? "Resume chat" : "Chat"} (${vm.state.unreadChatCount} unread ${vm.state.unreadChatCount === 1 ? "message" : "messages"})`
                                                                : vm.chatDraft.state.hasDraft
                                                                  ? "Resume chat"
                                                                  : "Chat"
                                                        }
                                                        onClick={vm.actions.toggleChat}
                                                    >
                                                        <span className="inline-flex items-center gap-2">
                                                            <HeaderIcon
                                                                name={vm.state.isChatOpen ? "back" : "chat"}
                                                                size={18}
                                                            />
                                                            <span>
                                                                {vm.state.isChatOpen
                                                                    ? "Back to board"
                                                                    : vm.chatDraft.state.hasDraft
                                                                      ? "Resume chat"
                                                                      : "Chat"}
                                                            </span>
                                                        </span>
                                                        {vm.state.unreadChatCount > 0 && (
                                                            <span
                                                                aria-hidden="true"
                                                                className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-bold leading-none"
                                                            >
                                                                {vm.state.unreadChatCount > 99
                                                                    ? "99+"
                                                                    : vm.state.unreadChatCount}
                                                            </span>
                                                        )}
                                                    </button>
                                                )}

                                            {!vm.state.isScribbleOpen && vm.state.canSyncCloud && (
                                                <button
                                                    type="button"
                                                    style={{
                                                        textAlign: "left",
                                                        width: "100%",
                                                        padding: "10px 8px",
                                                        background: "transparent",
                                                        border: "none",
                                                        borderBottom: "none",
                                                        cursor: "pointer",
                                                        color: palette.blue.text,
                                                    }}
                                                    disabled={vm.state.syncingCloud}
                                                    onClick={() => void vm.actions.syncCloudNow()}
                                                    aria-label={
                                                        vm.state.syncingCloud
                                                            ? "Getting latest board"
                                                            : "Get latest board from cloud"
                                                    }
                                                    title="Get latest board from cloud"
                                                >
                                                    {vm.state.syncingCloud
                                                        ? "Getting board…"
                                                        : "Get latest board"}
                                                </button>
                                            )}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={vm.actions.logout}
                                            style={{
                                                marginTop: "auto",
                                                textAlign: "left",
                                                width: "100%",
                                                padding: "10px 8px",
                                                background: "transparent",
                                                border: "none",
                                                borderTop: `1px solid ${palette.blue.border}`,
                                                color: "#991b1b",
                                                cursor: "pointer",
                                            }}
                                        >
                                            Log out
                                        </button>
                                    </aside>
                                )}

                                <div
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        display: "flex",
                                        flexDirection: "column",
                                        position: "relative",
                                    }}
                                >
                                    {!vm.state.isScribbleOpen && vm.state.syncStatus && (
                                        <div className="edit-notice" role="status">
                                            <span>{vm.state.syncStatus}</span>{" "}
                                            <button
                                                type="button"
                                                onClick={vm.actions.clearSyncStatus}
                                            >
                                                Dismiss
                                            </button>
                                        </div>
                                    )}

                                    {!vm.state.isScribbleOpen && vm.state.storageError && (
                                        <div className="edit-notice" role="alert">
                                            <span>{vm.state.storageError}</span>{" "}
                                            {vm.state.isGuardian && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            vm.actions.setPanel("profiles")
                                                        }
                                                    >
                                                        Open backup &amp; settings
                                                    </button>{" "}
                                                </>
                                            )}
                                            <button
                                                type="button"
                                                onClick={vm.actions.clearStorageError}
                                            >
                                                Dismiss
                                            </button>
                                        </div>
                                    )}

                                    {!vm.state.isChatOpen &&
                                        !vm.state.isScribbleOpen &&
                                        !isComposing &&
                                        vm.state.isGuardian &&
                                        vm.edit.state.isEditMode && (
                                            <p className="edit-notice" role="status">
                                                Edit mode · Select a tile to customize, move, or hide
                                                it. Select an empty slot to add a word or folder.
                                            </p>
                                        )}

                                    {!vm.state.isChatOpen &&
                                        !vm.state.isScribbleOpen &&
                                        vm.state.featureFlags?.pinnedVocabulary &&
                                        vm.state.pinnedTiles.length > 0 && (
                                            <nav
                                                className="pinned-vocabulary"
                                                aria-label="Pinned core vocabulary"
                                            >
                                                <span className="text-xs font-semibold text-slate-600 mr-1">
                                                    Pinned:
                                                </span>
                                                {vm.state.pinnedTiles.map((tile: Tile) => {
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
                                                            onActivate={() =>
                                                                isComposing
                                                                    ? vm.chatDraft.actions.selectTile(tile)
                                                                    : vm.sentence.actions.onTileActivate(tile)
                                                            }
                                                        />
                                                    );
                                                })}
                                            </nav>
                                        )}

                                    {isComposing &&
                                        !vm.state.isChatOpen &&
                                        !vm.state.isScribbleOpen && (
                                            <section
                                                className="chat-selection-panel"
                                                role="region"
                                                aria-label="Select words for chat"
                                            >
                                                <div className="chat-selection-header">
                                                    <span className="chat-selection-title">
                                                        Select words
                                                    </span>
                                                    <span className="chat-selection-subtitle">
                                                        For chat
                                                    </span>
                                                </div>
                                                <div
                                                    className="chat-selection-tokens"
                                                    aria-live="polite"
                                                    aria-relevant="additions removals"
                                                >
                                                    {vm.chatDraft.state.selectedTokens.length === 0 ? (
                                                        <span className="sentence-placeholder">
                                                            Tap board tiles to select words for chat
                                                        </span>
                                                    ) : (
                                                        vm.chatDraft.state.selectedTokens.map(token => (
                                                            <SelectionTokenChip
                                                                key={token.instanceId}
                                                                token={token}
                                                                colorMode={vm.sentence.state.colorMode}
                                                                colorSystem={vm.sentence.state.colorSystem}
                                                                onRemove={() =>
                                                                    vm.chatDraft.actions.removeSelectedToken(
                                                                        token.instanceId,
                                                                    )
                                                                }
                                                            />
                                                        ))
                                                    )}
                                                </div>
                                                <div className="chat-selection-actions">
                                                    <button
                                                        ref={addWordsRef}
                                                        type="button"
                                                        className="primary chat-selection-add"
                                                        disabled={!vm.chatDraft.state.hasSelectedWords}
                                                        onClick={vm.actions.addWordsToChat}
                                                    >
                                                        <HeaderIcon name="keyboard" size={20} />
                                                        <span>Add to chat</span>
                                                    </button>
                                                    <button
                                                        ref={cancelCompositionRef}
                                                        type="button"
                                                        className="chat-selection-cancel"
                                                        onClick={vm.actions.cancelChatComposition}
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </section>
                                        )}

                                    <main
                                        className={
                                            vm.state.isChatOpen ||
                                            vm.state.isScribbleOpen
                                                ? "board-main board-route-main !pb-0"
                                                : "board-main"
                                        }
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

                                    {vm.state.canConfigureLayout &&
                                        !vm.state.isChatOpen &&
                                        !vm.state.isScribbleOpen && (
                                            <button
                                                type="button"
                                                className="board-layout-control"
                                                aria-label="Configure board layout"
                                                title="Configure board layout"
                                                onClick={() =>
                                                    vm.actions.setPanel("layout")
                                                }
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
                                                    <rect
                                                        x="3"
                                                        y="3"
                                                        width="18"
                                                        height="18"
                                                        rx="2"
                                                    />
                                                    <rect
                                                        x="6"
                                                        y="6"
                                                        width="5"
                                                        height="5"
                                                        rx="1"
                                                    />
                                                    <rect
                                                        x="13"
                                                        y="6"
                                                        width="5"
                                                        height="5"
                                                        rx="1"
                                                    />
                                                    <rect
                                                        x="6"
                                                        y="13"
                                                        width="5"
                                                        height="5"
                                                        rx="1"
                                                    />
                                                    <rect
                                                        x="13"
                                                        y="13"
                                                        width="5"
                                                        height="5"
                                                        rx="1"
                                                    />
                                                </svg>
                                            </button>
                                        )}
                                </div>
                            </div>

                            {vm.state.wheelEnabled && vm.state.wheel && (
                                <CategoryWheel
                                    coords={vm.state.wheel}
                                    onClose={vm.actions.closeWheel}
                                    onManage={vm.actions.openCatalogs}
                                />
                            )}

                            {vm.state.isGuardian &&
                                (vm.state.panel === "settings" ||
                                    vm.state.panel === "profiles") && (
                                    <BoardSettings
                                        boardId={vm.state.boardId}
                                        onClose={() => vm.actions.setPanel(null)}
                                        initialTab={
                                            vm.state.panel === "profiles"
                                                ? "profiles"
                                                : "colorSystem"
                                        }
                                    />
                                )}

                            {vm.state.canConfigureLayout && vm.state.panel === "layout" && (
                                <BoardSettings
                                    boardId={vm.state.boardId}
                                    onClose={() => vm.actions.setPanel(null)}
                                    initialTab="layout"
                                />
                            )}

                            {vm.state.isGuardian && vm.state.panel === "catalogs" && (
                                <CatalogManager
                                    onClose={() => vm.actions.setPanel(null)}
                                />
                            )}
                        </div>
                    </EditContext.Provider>
                </SentenceContext.Provider>
            </ChatDraftContext.Provider>
        </BoardPageMemoryContext.Provider>
    );
}