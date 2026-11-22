"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/models/boardData";
import { isOwnChatMessage } from "@/store/useBoardStore";

type OlderAnchor = { scope: string; firstId: string | null; height: number; firstOffset: number | null };

function findMessage(list: HTMLDivElement, id: string | null): HTMLElement | undefined {
    return Array.from(list.querySelectorAll<HTMLElement>("[data-chat-message-id]"))
        .find(element => element.dataset.chatMessageId === id);
}

export function useChatHistoryViewModel(
    messages: ChatMessage[],
    userId: string | null,
    role: ChatMessage["sender"],
    scope: string,
    loadOlder: () => Promise<{ ok: boolean; loadedCount?: number }>,
) {
    const listRef = useRef<HTMLDivElement>(null);
    const previousLast = useRef<string | null>(null);
    const previousScope = useRef(scope);
    const initialized = useRef(false);
    const olderAnchor = useRef<OlderAnchor | null>(null);
    const nearBottom = useRef(true);
    const [latestScope, setLatestScope] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState<{ scope: string; id: string; text: string } | null>(null);

    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const last = messages[messages.length - 1];
        if (previousScope.current !== scope) {
            previousLast.current = null;
            initialized.current = false;
            olderAnchor.current = null;
            nearBottom.current = true;
            previousScope.current = scope;
            setLatestScope(null);
            setAnnouncement(null);
        }
        const isInitial = !initialized.current;
        const lastChanged = (last?.id ?? null) !== previousLast.current;
        const anchor = olderAnchor.current;
        const prepended = anchor && anchor.scope === scope && (messages[0]?.id ?? null) !== anchor.firstId;
        if (prepended) {
            const first = findMessage(list, anchor.firstId);
            const delta = first && anchor.firstOffset !== null
                ? first.offsetTop - anchor.firstOffset
                : list.scrollHeight - anchor.height;
            list.scrollTop += Math.max(0, delta);
            olderAnchor.current = null;
            if (lastChanged && !nearBottom.current) setLatestScope(scope);
        } else if (isInitial || (lastChanged && nearBottom.current)) {
            list.scrollTop = list.scrollHeight;
            setLatestScope(null);
        } else if (lastChanged) {
            setLatestScope(scope);
        }
        if (!isInitial && lastChanged && last && !isOwnChatMessage(last, userId, role)) {
            setAnnouncement({
                scope,
                id: last.id,
                text: `New message from ${last.senderName || (last.sender === "guardian" ? "Guardian" : "Child")}: ${last.text}`,
            });
        }
        initialized.current = true;
        previousLast.current = last?.id ?? null;
    }, [messages, userId, role, scope]);

    return {
        listRef,
        showLatest: latestScope === scope,
        announcement: announcement?.scope === scope ? announcement : null,
        onScroll: () => {
            const list = listRef.current;
            if (!list) return;
            nearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
            if (nearBottom.current) setLatestScope(null);
        },
        jumpToLatest: () => {
            const list = listRef.current;
            if (!list) return;
            list.scrollTop = list.scrollHeight;
            nearBottom.current = true;
            setLatestScope(null);
        },
        loadOlder: async () => {
            const list = listRef.current;
            const firstId = messages[0]?.id ?? null;
            const anchor: OlderAnchor = {
                scope,
                firstId,
                height: list?.scrollHeight ?? 0,
                firstOffset: list ? findMessage(list, firstId)?.offsetTop ?? null : null,
            };
            olderAnchor.current = anchor;
            const result = await loadOlder();
            if ((!result.ok || !result.loadedCount) && olderAnchor.current === anchor) olderAnchor.current = null;
        },
    };
}
