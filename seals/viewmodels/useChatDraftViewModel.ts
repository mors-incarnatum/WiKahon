"use client";

import { createContext, useContext, useState } from "react";
import type { SentenceToken } from "@/lib/board";

/** Kept by the shared board layout while navigating between the board and chat. */
export function useChatDraftViewModel(scope: string, tokens: SentenceToken[], returnToBoard: () => void) {
    const empty = { scope, text: "", usedIds: [] as string[], isComposing: false, focusOnResume: false };
    const [entry, setEntry] = useState(empty);
    const current = entry.scope === scope ? entry : empty;
    return {
        state: {
            text: current.text,
            hasDraft: Boolean(current.text.trim()),
            isComposing: current.isComposing,
            focusOnResume: current.focusOnResume,
            hasUnusedWords: tokens.some(token => !current.usedIds.includes(token.instanceId)),
        },
        actions: {
            returnToBoard,
            setText: (text: string) => setEntry(previous => ({
                ...(previous.scope === scope ? previous : empty), text,
            })),
            beginComposition: () => setEntry(previous => ({
                ...(previous.scope === scope ? previous : empty), isComposing: true, focusOnResume: false,
            })),
            cancelComposition: () => setEntry(previous => ({
                ...(previous.scope === scope ? previous : empty), isComposing: false, focusOnResume: true,
            })),
            consumeResumeFocus: () => setEntry(previous => previous.scope === scope
                ? { ...previous, focusOnResume: false }
                : previous),
            clearAfterSend: () => setEntry(previous => ({
                ...(previous.scope === scope ? previous : empty), text: "", usedIds: [],
            })),
            useWords: () => setEntry(previous => {
                const existing = previous.scope === scope ? previous : empty;
                const used = new Set(existing.usedIds);
                const fresh = tokens.filter(token => !used.has(token.instanceId));
                if (!fresh.length) return { ...existing, isComposing: false, focusOnResume: true };
                const words = fresh.map(token => token.spokenText).join(" ");
                return {
                    ...existing,
                    text: existing.text ? `${existing.text}${/\s$/.test(existing.text) ? "" : " "}${words}` : words,
                    usedIds: [...existing.usedIds, ...fresh.map(token => token.instanceId)],
                    isComposing: false,
                    focusOnResume: true,
                };
            }),
        },
    };
}

export const ChatDraftContext = createContext<ReturnType<typeof useChatDraftViewModel> | null>(null);
export function useChatDraftContext() {
    const value = useContext(ChatDraftContext);
    if (!value) throw new Error("Chat draft provider required");
    return value;
}
