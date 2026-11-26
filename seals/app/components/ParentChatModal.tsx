"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { palette } from "@/app/theme";
import { resolveTokenColor, type ColorMode, type ColorSystemId, type SentenceToken } from "@/lib/board";
import type { ChatConnectionStatus } from "@/services/chat/chatSocketService";
import { isOwnChatMessage } from "@/store/useBoardStore";
import { useMediaUrl } from "@/viewmodels/useMediaUrl";
import { useParentChatViewModel } from "@/viewmodels/useParentChatViewModel";
import { useChatHistoryViewModel } from "@/viewmodels/useChatHistoryViewModel";
import Modal from "@/app/components/Modal";

function ChatLineIcon({ name }: { name: "words" | "speech" | "remove" }) {
    const common = {
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        "aria-hidden": true as const,
    };

    switch (name) {
        case "words":
            return (
                <svg {...common} width={18} height={18}>
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
            );
        case "speech":
            return (
                <svg {...common} width={16} height={16}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
            );
        case "remove":
            return (
                <svg {...common} width={14} height={14}>
                    <path d="m6 6 12 12M18 6 6 18" />
                </svg>
            );
    }
}

function ChatDraftTokenChip({
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
            onClick={onRemove}
            style={{
                backgroundColor: p.surface,
                borderColor: p.border,
                color: p.text,
            }}
            aria-label={`Remove ${token.label} from chat draft`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-700"
        >
            {token.iconName === "speech" && !token.mediaId && <ChatLineIcon name="speech" />}
            {src && <img src={src} alt="" width={20} height={20} className="h-5 w-5 shrink-0 object-contain" />}
            <span>{token.label}</span>
            <ChatLineIcon name="remove" />
        </button>
    );
}

const CONNECTION_STATUS_META: Record<ChatConnectionStatus, { label: string; dotClass: string }> = {
    connected: { label: "Connected", dotClass: "bg-emerald-400" },
    connecting: { label: "Connecting…", dotClass: "bg-amber-300 motion-safe:animate-pulse" },
    error: { label: "Chat unavailable", dotClass: "bg-rose-400" },
    disconnected: { label: "Offline", dotClass: "bg-rose-400" },
    unlinked: { label: "Sign in to chat", dotClass: "bg-slate-400" },
    unconfigured: { label: "Local mode", dotClass: "bg-slate-300" },
};

export default function ParentChatModal({ onClose }: { onClose?: () => void } = {}) {
    const { state: s, actions: a } = useParentChatViewModel(undefined, onClose);
    const {
        listRef,
        onScroll,
        loadOlder,
        showLatest,
        jumpToLatest,
        announcement,
    } = useChatHistoryViewModel(
        s.messages,
        s.currentUserId,
        s.senderRole,
        s.historyScope,
        a.loadOlderMessages,
    );

    const [confirmRemoval, setConfirmRemoval] = useState(false);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const clearButtonRef = useRef<HTMLButtonElement>(null);
    const clearDialogWasOpen = useRef(false);
    const status = CONNECTION_STATUS_META[s.connectionStatus];

    useEffect(() => {
        if (s.focusOnResume) {
            headingRef.current?.focus();
            a.consumeResumeFocus();
        }
    }, [s.focusOnResume, a]);

    useEffect(() => {
        if (clearDialogWasOpen.current && !s.isClearChatOpen) {
            if (s.canClearChat) clearButtonRef.current?.focus();
            else headingRef.current?.focus();
        }
        clearDialogWasOpen.current = s.isClearChatOpen;
    }, [s.isClearChatOpen, s.canClearChat]);

    return (
        <section
            aria-label="Parent-child chat"
            className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm"
        >
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                <div className="min-w-0">
                    <h2
                        ref={headingRef}
                        tabIndex={-1}
                        className="text-base font-bold focus-visible:outline-2 focus-visible:outline-sky-700"
                    >
                        Parent–child chat
                    </h2>
                    <p
                        role="status"
                        aria-live="polite"
                        className="flex items-center gap-1.5 text-xs text-slate-600"
                    >
                        <span
                            aria-hidden="true"
                            className={`h-2 w-2 shrink-0 rounded-full ${status.dotClass}`}
                        />
                        {status.label} · Sending as {s.senderRole === "guardian" ? "Guardian" : "Child"}
                    </p>
                </div>

                <div className="ml-auto flex items-center gap-2">
                    <button
                        ref={clearButtonRef}
                        type="button"
                        disabled={!s.canClearChat}
                        onClick={a.openClearChat}
                        className="min-h-11 rounded px-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Clear chat
                    </button>
                    <button
                        type="button"
                        onClick={a.onClose}
                        className="min-h-11 shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                    >
                        Back to board
                    </button>
                </div>
            </header>

            {(s.connectionStatus === "error" ||
                s.connectionStatus === "disconnected" ||
                (s.connectionStatus === "connected" && s.hasPendingMessages)) && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 text-sm text-amber-950">
                    <span>
                        {s.connectionStatus === "connected"
                            ? "Some messages are waiting to send."
                            : "Messages may be waiting to send."}
                    </span>
                    <button
                        type="button"
                        onClick={a.reconnect}
                        className="min-h-11 shrink-0 rounded px-2 font-semibold text-sky-800 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-sky-700"
                    >
                        {s.connectionStatus === "connected" ? "Retry pending" : "Reconnect"}
                    </button>
                </div>
            )}

            {(s.connectionStatus === "unconfigured" || s.connectionStatus === "unlinked") && (
                <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {s.connectionStatus === "unconfigured"
                        ? "Messages stay on this device."
                        : "Sign in with a linked cloud profile to send messages to another device."}
                </p>
            )}

            {s.legacyMessageCount > 0 && (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 border-b border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                    <span>
                        {s.legacyMessageCount} older local{" "}
                        {s.legacyMessageCount === 1 ? "message" : "messages"}
                    </span>

                    {confirmRemoval ? (
                        <div className="flex flex-wrap items-center gap-1">
                            <span>Remove these messages?</span>
                            <button
                                type="button"
                                onClick={() => {
                                    a.dismissLegacyMessages();
                                    setConfirmRemoval(false);
                                }}
                                className="min-h-11 rounded px-2 font-semibold text-rose-700 hover:bg-rose-50"
                            >
                                Remove
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmRemoval(false)}
                                className="min-h-11 rounded px-2 font-semibold text-sky-800 hover:bg-sky-100"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setConfirmRemoval(true)}
                            className="min-h-11 rounded px-2 font-semibold text-sky-800 hover:bg-sky-100"
                        >
                            Remove older local messages
                        </button>
                    )}
                </div>
            )}

            <div role="status" aria-live="polite" className="shrink-0 text-sm text-slate-700">
                {s.clearChatNotice && <p className="border-b border-slate-200 bg-slate-50 px-3 py-2">{s.clearChatNotice}</p>}
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                    ref={listRef}
                    onScroll={onScroll}
                    role="region"
                    aria-label="Message history"
                    tabIndex={0}
                    className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50 px-3 py-3 [overflow-anchor:none] focus-visible:outline-2 focus-visible:outline-sky-700 sm:px-4"
                >
                    {s.hasMoreHistory && (
                        <div className="flex flex-col items-center gap-1">
                            <button
                                type="button"
                                disabled={s.isLoadingOlder}
                                onClick={() => void loadOlder()}
                                className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-sky-800 hover:bg-slate-100 disabled:opacity-60"
                            >
                                {s.isLoadingOlder ? "Loading older messages…" : "Load older messages"}
                            </button>
                            {s.loadOlderError && (
                                <p role="alert" className="text-sm text-rose-700">
                                    {s.loadOlderError}
                                </p>
                            )}
                        </div>
                    )}

                    {s.messages.length === 0 ? (
                        <p className="py-8 text-center text-sm text-slate-600">No messages yet.</p>
                    ) : (
                        s.messages.map(m => {
                            const verified = m.verified === true;
                            const pending = !verified && !!m.pendingContext;
                            const own = isOwnChatMessage(m, s.currentUserId, s.senderRole);
                            const name = own
                                ? "You"
                                : !verified
                                  ? "Unverified sender"
                                  : m.senderName || (m.sender === "guardian" ? "Guardian" : "Child");

                            return (
                                <div
                                    key={m.id}
                                    data-chat-message-id={m.id}
                                    className={`flex ${own ? "justify-end" : "justify-start"}`}
                                >
                                    <div
                                        className={`flex max-w-[85%] flex-col ${own ? "items-end" : "items-start"}`}
                                    >
                                        <span className="max-w-full px-1 text-xs font-medium text-slate-600 [overflow-wrap:anywhere]">
                                            {name}
                                        </span>
                                        <div
                                            className={`w-full whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere] ${
                                                own
                                                    ? "rounded-br-sm bg-sky-700 text-white"
                                                    : "rounded-bl-sm border border-slate-200 bg-white text-slate-900"
                                            }`}
                                        >
                                            {m.text}
                                        </div>
                                        {!verified && (
                                            <span className="px-1 pt-0.5 text-xs text-slate-600">
                                                {pending ? "Waiting to send" : "Saved on this device"}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {showLatest && (
                    <button
                        type="button"
                        onClick={jumpToLatest}
                        className="absolute bottom-3 left-1/2 min-h-11 -translate-x-1/2 rounded-full border border-sky-700 bg-white px-4 text-sm font-semibold text-sky-800 shadow-md hover:bg-sky-50"
                    >
                        Jump to latest
                    </button>
                )}
            </div>

            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {announcement && <span key={announcement.id}>{announcement.text}</span>}
            </div>

            {s.sendError && (
                <p role="alert" className="shrink-0 border-t border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                    {s.sendError}
                </p>
            )}

            <form
                onSubmit={e => {
                    e.preventDefault();
                    void a.sendMessage();
                }}
                className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white p-2 sm:p-3"
            >
                {s.draftTokens.length > 0 && (
                    <div
                        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#DCEEFF] bg-[#F2F8FF] px-2.5 py-2"
                        role="group"
                        aria-label="Selected board words in draft"
                    >
                        {s.draftTokens.map(token => (
                            <ChatDraftTokenChip
                                key={token.instanceId}
                                token={token}
                                colorMode={s.colorMode}
                                colorSystem={s.colorSystem}
                                onRemove={() => a.removeDraftToken(token.instanceId)}
                            />
                        ))}
                    </div>
                )}
                <div className="flex min-w-0 items-center gap-2">
                    <input
                        value={s.draft}
                        onChange={e => a.setDraft(e.target.value)}
                        name="message"
                        autoComplete="off"
                        placeholder="Write a message…"
                        aria-label="Message to send"
                        className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-700"
                    />
                    <button
                        type="submit"
                        disabled={!s.draft.trim()}
                        className="min-h-11 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Send
                    </button>
                </div>
                <button
                    type="button"
                    onClick={a.useWords}
                    className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg border border-sky-700 px-3 text-sm font-semibold text-sky-800 hover:bg-sky-50"
                >
                    <ChatLineIcon name="words" />
                    <span>Use words</span>
                </button>
            </form>

            {s.isClearChatOpen && (
                <Modal label="Clear chat" onClose={a.cancelClearChat} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-300 bg-white p-5 text-slate-900 shadow-xl">
                    <h2 className="text-lg font-bold">Hide chat history on this device?</h2>
                    <p className="mt-2 text-sm text-slate-700">
                        Messages waiting to send will stay visible. Message copies are kept on this device and in shared history.
                    </p>
                    {s.clearChatError && <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{s.clearChatError}</p>}
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button type="button" autoFocus onClick={a.cancelClearChat} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">
                            Cancel
                        </button>
                        <button type="button" onClick={a.clearChat} className="min-h-11 rounded-lg border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-800 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">
                            Clear chat
                        </button>
                    </div>
                </Modal>
            )}
        </section>
    );
}
