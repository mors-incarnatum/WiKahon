"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { SentenceToken, Tile } from "@/lib/board";

export type ChatSelectionMode = "idle" | "selecting";

interface ChatDraftEntry {
    scope: string;
    mode: ChatSelectionMode;
    text: string;
    draftTokens: SentenceToken[];
    selectedTokens: SentenceToken[];
    focusOnResume: boolean;
}

function reconcileDraftTokens(tokens: SentenceToken[], text: string): SentenceToken[] {
    if (!text.trim() || tokens.length === 0) return [];
    const lower = text.toLowerCase();
    let cursor = 0;
    const kept: SentenceToken[] = [];
    for (const token of tokens) {
        const needle = (token.spokenText || token.label).trim().toLowerCase();
        if (!needle) continue;
        const idx = lower.indexOf(needle, cursor);
        if (idx !== -1) {
            kept.push(token);
            cursor = idx + needle.length;
        }
    }
    return kept;
}

function removeTokenText(tokens: SentenceToken[], targetIndex: number, text: string): string {
    const joined = tokens.map(t => t.spokenText || t.label).join(" ");
    if (text.trim().toLowerCase() === joined.trim().toLowerCase()) {
        return tokens
            .filter((_, idx) => idx !== targetIndex)
            .map(t => t.spokenText || t.label)
            .join(" ");
    }
    const lower = text.toLowerCase();
    let cursor = 0;
    for (let i = 0; i < tokens.length; i++) {
        const needle = (tokens[i].spokenText || tokens[i].label).trim().toLowerCase();
        if (!needle) continue;
        const idx = lower.indexOf(needle, cursor);
        if (idx === -1) break;
        if (i === targetIndex) {
            const before = text.slice(0, idx).replace(/\s+$/, "");
            const after = text.slice(idx + needle.length).replace(/^\s+/, "");
            if (!before) return after;
            if (!after) return before;
            return `${before} ${after}`;
        }
        cursor = idx + needle.length;
    }
    return text;
}

/** Kept by the shared board layout while navigating between the board and chat. */
export function useChatDraftViewModel(
    scope: string,
    returnToBoard: () => void,
    createToken: (tile: Tile, boardId?: string) => SentenceToken,
) {
    const empty: ChatDraftEntry = {
        scope,
        mode: "idle",
        text: "",
        draftTokens: [],
        selectedTokens: [],
        focusOnResume: false,
    };
    const [entry, setEntry] = useState<ChatDraftEntry>(empty);
    const current = entry.scope === scope ? entry : empty;

    const selectedTileCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const token of current.selectedTokens) {
            counts[token.tileId] = (counts[token.tileId] ?? 0) + 1;
        }
        return counts;
    }, [current.selectedTokens]);

    return {
        state: {
            mode: current.mode,
            text: current.text,
            draftTokens: current.draftTokens,
            selectedTokens: current.selectedTokens,
            selectedTileCounts,
            hasDraft: Boolean(current.text.trim() || current.draftTokens.length > 0),
            isComposing: current.mode === "selecting",
            focusOnResume: current.focusOnResume,
            hasSelectedWords: current.selectedTokens.length > 0,
        },
        actions: {
            returnToBoard,
            setText: (text: string) =>
                setEntry(previous => {
                    const existing = previous.scope === scope ? previous : empty;
                    return {
                        ...existing,
                        text,
                        draftTokens: reconcileDraftTokens(existing.draftTokens, text),
                    };
                }),
            removeDraftToken: (instanceId: string) =>
                setEntry(previous => {
                    const existing = previous.scope === scope ? previous : empty;
                    const idx = existing.draftTokens.findIndex(t => t.instanceId === instanceId);
                    if (idx === -1) return existing;
                    const nextText = removeTokenText(existing.draftTokens, idx, existing.text);
                    const nextTokens = existing.draftTokens.filter(t => t.instanceId !== instanceId);
                    return {
                        ...existing,
                        text: nextText,
                        draftTokens: nextTokens,
                    };
                }),
            beginComposition: () =>
                setEntry(previous => ({
                    ...(previous.scope === scope ? previous : empty),
                    mode: "selecting",
                    selectedTokens: [],
                    focusOnResume: false,
                })),
            selectTile: (tile: Tile, boardId?: string) =>
                setEntry(previous => {
                    const existing = previous.scope === scope ? previous : empty;
                    if (existing.mode !== "selecting") return existing;
                    const token = createToken(tile, boardId);
                    return {
                        ...existing,
                        selectedTokens: [...existing.selectedTokens, token],
                    };
                }),
            removeSelectedToken: (instanceId: string) =>
                setEntry(previous => {
                    const existing = previous.scope === scope ? previous : empty;
                    if (existing.mode !== "selecting") return existing;
                    return {
                        ...existing,
                        selectedTokens: existing.selectedTokens.filter(t => t.instanceId !== instanceId),
                    };
                }),
            cancelComposition: () =>
                setEntry(previous => ({
                    ...(previous.scope === scope ? previous : empty),
                    mode: "idle",
                    selectedTokens: [],
                    focusOnResume: true,
                })),
            exitSelectionMode: () =>
                setEntry(previous => {
                    if (previous.scope !== scope || previous.mode !== "selecting") return previous;
                    return {
                        ...previous,
                        mode: "idle",
                        selectedTokens: [],
                    };
                }),
            consumeResumeFocus: () =>
                setEntry(previous =>
                    previous.scope === scope ? { ...previous, focusOnResume: false } : previous,
                ),
            clearAfterSend: () =>
                setEntry(previous => ({
                    ...(previous.scope === scope ? previous : empty),
                    mode: "idle",
                    text: "",
                    draftTokens: [],
                    selectedTokens: [],
                })),
            useWords: () =>
                setEntry(previous => {
                    const existing = previous.scope === scope ? previous : empty;
                    if (existing.mode !== "selecting" || existing.selectedTokens.length === 0) {
                        return {
                            ...existing,
                            mode: "idle",
                            selectedTokens: [],
                            focusOnResume: true,
                        };
                    }
                    const fresh = existing.selectedTokens;
                    const words = fresh.map(token => token.spokenText || token.label).join(" ");
                    return {
                        ...existing,
                        mode: "idle",
                        text: existing.text
                            ? `${existing.text}${/\s$/.test(existing.text) ? "" : " "}${words}`
                            : words,
                        draftTokens: [...existing.draftTokens, ...fresh],
                        selectedTokens: [],
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
