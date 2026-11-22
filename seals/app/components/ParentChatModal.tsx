"use client";
import { useLayoutEffect, useRef } from "react";
import type { ChatConnectionStatus } from "@/services/chat/chatSocketService";
import { isOwnChatMessage } from "@/store/useBoardStore";
import { useParentChatViewModel } from "@/viewmodels/useParentChatViewModel";

const CONNECTION_STATUS_META: Record<
    ChatConnectionStatus,
    { label: string; dotClass: string }
> = {
    connected: { label: "Connected", dotClass: "bg-emerald-400" },
    connecting: { label: "Connecting…", dotClass: "bg-amber-300 animate-pulse" },
    error: { label: "Chat unavailable", dotClass: "bg-rose-400" },
    disconnected: { label: "Offline", dotClass: "bg-rose-400" },
    unlinked: { label: "Sign in to chat", dotClass: "bg-slate-400" },
    unconfigured: { label: "Local Mode", dotClass: "bg-slate-300" },
};

export default function ParentChatModal({ onClose }: { onClose?: () => void } = {}) {
    const { state: s, actions: a } = useParentChatViewModel(undefined, onClose);
    const listRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const prevLastMessageIdRef = useRef<string | null>(null);
    const prevScrollHeightRef = useRef<number | null>(null);
    const statusMeta = CONNECTION_STATUS_META[s.connectionStatus];

    useLayoutEffect(() => {
        const lastId = s.messages[s.messages.length - 1]?.id ?? null;
        if (prevScrollHeightRef.current !== null && listRef.current) {
            if (lastId === prevLastMessageIdRef.current) {
                const delta = listRef.current.scrollHeight - prevScrollHeightRef.current;
                if (delta > 0) {
                    listRef.current.scrollTop += delta;
                }
            }
            prevScrollHeightRef.current = null;
        } else if (lastId !== prevLastMessageIdRef.current) {
            bottomRef.current?.scrollIntoView({
                behavior: prevLastMessageIdRef.current ? "smooth" : "auto",
            });
        }
        prevLastMessageIdRef.current = lastId;
    }, [s.messages]);

    const handleLoadOlder = async () => {
        prevScrollHeightRef.current = listRef.current?.scrollHeight ?? null;
        const res = await a.loadOlderMessages();
        if (!res.ok || res.loadedCount === 0) {
            prevScrollHeightRef.current = null;
        }
    };

    return (
        <section
            aria-label="Parent-child chat"
            className="flex-1 min-h-0 w-full rounded-xl border border-slate-300 bg-white p-0 shadow-xs overflow-hidden flex flex-col"
        >
            <div className="bg-[#0369a1] text-white px-3.5 py-2.5 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold shrink-0">
                        G
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold leading-tight truncate">
                            Parent–child chat
                        </h2>
                        <p className="text-[11px] text-sky-100 leading-tight truncate flex items-center gap-1.5">
                            <span
                                aria-hidden="true"
                                className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusMeta.dotClass}`}
                            />
                            <span className="truncate">
                                {statusMeta.label} · {s.senderRole === "guardian" ? "Sending as Guardian" : "Sending as Child"}
                            </span>
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {(s.connectionStatus === "error" || s.connectionStatus === "disconnected" ||
                        (s.connectionStatus === "connected" && s.hasPendingMessages)) && (
                        <button
                            type="button"
                            onClick={a.reconnect}
                            className="px-2 py-1 rounded-full bg-white/15 hover:bg-white/25 text-[11px] font-semibold text-white transition-colors cursor-pointer"
                        >
                            {s.connectionStatus === "connected" ? "Retry pending" : "Reconnect"}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={a.onClose}
                        aria-label="Close chat"
                        className="min-w-11 min-h-11 rounded-full hover:bg-white/15 flex items-center justify-center text-white/90 hover:text-white transition-colors shrink-0 cursor-pointer"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {s.legacyMessageCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-x-2 border-b border-slate-200 bg-slate-50 px-3 text-xs text-slate-600 shrink-0">
                    <span>{s.legacyMessageCount} older local {s.legacyMessageCount === 1 ? "message" : "messages"}</span>
                    <button
                        type="button"
                        onClick={a.dismissLegacyMessages}
                        className="min-h-11 rounded px-2 font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer"
                    >
                        Remove older local messages
                    </button>
                </div>
            )}

            <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
                <p className="text-[11px] text-slate-500 text-center bg-slate-200/70 rounded-lg px-2.5 py-1.5">
                    {s.connectionStatus === "unconfigured"
                        ? "Messages stay on this device."
                        : s.connectionStatus === "unlinked"
                          ? "Sign in with a linked cloud profile to send messages to another device."
                          : "Tap Send to share your message."}
                </p>

                {s.hasMoreHistory && (
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                        <button
                            type="button"
                            disabled={s.isLoadingOlder}
                            onClick={() => void handleLoadOlder()}
                            className="min-h-11 px-3 py-1.5 rounded-full border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-60 text-xs font-semibold text-sky-800 transition-colors cursor-pointer disabled:cursor-not-allowed"
                        >
                            {s.isLoadingOlder ? "Loading older messages…" : "Load older messages"}
                        </button>
                        {s.loadOlderError && (
                            <p role="alert" className="text-[11px] font-medium text-rose-700 text-center">
                                {s.loadOlderError}
                            </p>
                        )}
                    </div>
                )}

                {s.messages.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">
                        No messages yet.
                    </p>
                ) : (
                    s.messages.map(m => {
                        const isVerified = m.verified === true;
                        const isPending = !isVerified && !!m.pendingContext;
                        const isOwn = isOwnChatMessage(m, s.currentUserId, s.senderRole);
                        const otherBadge = !isVerified
                            ? "?"
                            : m.sender === "guardian"
                              ? "G"
                              : "C";
                        const otherTitle = !isVerified
                            ? "Unverified (saved locally)"
                            : m.senderName || (m.sender === "guardian" ? "Guardian" : "Child");
                        return (
                            <div
                                key={m.id}
                                className={`flex items-end gap-1.5 ${isOwn ? "justify-end" : "justify-start"}`}
                            >
                                {!isOwn && (
                                    <div
                                        className="w-6 h-6 rounded-full bg-slate-300 text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0"
                                        title={otherTitle}
                                    >
                                        {otherBadge}
                                    </div>
                                )}
                                <div className={`max-w-[78%] flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
                                    <div
                                        className={`px-3 py-1.5 w-full text-sm leading-snug break-words shadow-xs ${
                                            isOwn
                                                ? "bg-[#0369a1] text-white rounded-2xl rounded-br-sm"
                                                : "bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm"
                                        }`}
                                    >
                                        {m.text}
                                    </div>
                                    {!isVerified && (
                                        <span className="mt-0.5 px-1 text-[10px] text-slate-400">
                                            {isPending ? "Waiting to send" : "Saved on this device"}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={bottomRef} />
            </div>

            {s.sendError && (
                <p
                    role="alert"
                    className="px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 border-t border-rose-200 shrink-0"
                >
                    {s.sendError}
                </p>
            )}

            <div className="border-t border-slate-200 bg-white px-2.5 py-2 flex items-center gap-1.5 shrink-0">
                <button
                    type="button"
                    onClick={a.copyCurrentSentence}
                    disabled={s.isSentenceEmpty}
                    title="Copy current sentence"
                    aria-label="Copy current sentence"
                    className="min-w-11 min-h-11 rounded-full text-sky-700 hover:bg-sky-50 disabled:text-slate-300 disabled:hover:bg-transparent flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                </button>
                <input
                    value={s.draft}
                    onChange={e => a.setDraft(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter" && s.draft.trim()) {
                            e.preventDefault();
                            void a.sendMessage();
                        }
                    }}
                    placeholder="Aa"
                    aria-label="Message to send"
                    className="flex-1 min-w-0 bg-slate-100 hover:bg-slate-200/70 focus:bg-white border border-transparent focus:border-sky-500 rounded-full px-3.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition-colors"
                />
                <button
                    type="button"
                    disabled={!s.draft.trim()}
                    onClick={() => void a.sendMessage()}
                    title="Send message"
                    aria-label="Send message"
                    className="min-w-11 min-h-11 rounded-full bg-[#0369a1] text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-sky-800 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current translate-x-[1px]">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                </button>
            </div>
        </section>
    );
}
