"use client";

import { useEffect, useState } from "react";
import { isGuardianRole } from "@/models/auth";
import { useBoardStore, useBoardStoreApi } from "@/store/BoardProvider";
import { createBoundChatSocketHandlers, matchesChatBindingContext, resolveChatBindingContext } from "@/store/useBoardStore";
import { useChatDraftContext } from "@/viewmodels/useChatDraftViewModel";
import type { ChatMessage } from "@/models/boardData";
import {
    chatSocketService,
    type ChatConnectionStatus,
    type ChatHistoryMeta,
    type IChatSocketService,
} from "@/services/chat/chatSocketService";

const EMPTY_MESSAGES: ChatMessage[] = [];

/**
 * ViewModel for the Parent-Child Chat modal, managing draft state,
 * board composition, live socket connection status, and sending/receiving messages.
 */
export function useParentChatViewModel(
    socketService: IChatSocketService = chatSocketService,
    onClose?: () => void,
) {
    const chatDraft = useChatDraftContext();
    const storeApi = useBoardStoreApi();
    const currentUser = useBoardStore(s => s.currentUser);
    const activeProfileId = useBoardStore(s => s.activeProfileId);
    const cloudProfileId = useBoardStore(s => s.cloudProfileId);
    const messages = useBoardStore(s => s.experimentalData?.chatMessages) ?? EMPTY_MESSAGES;
    const addChatMessage = useBoardStore(s => s.addChatMessage);
    const dismissLegacyMessages = useBoardStore(s => s.dismissLegacyChatMessages);
    const scope = JSON.stringify([currentUser?.id, activeProfileId, cloudProfileId]);
    const [errorEntry, setErrorEntry] = useState<{ scope: string; text: string; messageId?: string } | null>(null);
    const [loadOlderErrorEntry, setLoadOlderErrorEntry] = useState<{ scope: string; text: string } | null>(null);
    const draft = chatDraft.state.text;
    const sendError = errorEntry?.scope === scope ? errorEntry.text : null;
    const loadOlderError = loadOlderErrorEntry?.scope === scope ? loadOlderErrorEntry.text : null;
    const [connectionStatus, setConnectionStatus] = useState<ChatConnectionStatus>(() =>
        socketService.getStatus(),
    );
    const [historyMeta, setHistoryMeta] = useState<ChatHistoryMeta>(() =>
        socketService.getHistoryMeta(),
    );

    const boundChatContext = resolveChatBindingContext(currentUser, activeProfileId, cloudProfileId);
    const boundUserId = boundChatContext?.userId ?? null;
    const boundLocalProfileId = boundChatContext?.localProfileId ?? null;
    const boundCloudProfileId = boundChatContext?.cloudProfileId ?? null;

    useEffect(() => {
        const activeContext =
            boundUserId && boundLocalProfileId && boundCloudProfileId
                ? {
                      userId: boundUserId,
                      localProfileId: boundLocalProfileId,
                      cloudProfileId: boundCloudProfileId,
                  }
                : null;
        socketService.setActiveContext(activeContext);
        const handlers = createBoundChatSocketHandlers(() => storeApi.getState(), activeContext);
        return socketService.subscribe({
            ...handlers,
            onMessages: (incoming, context) => {
                handlers.onMessages?.(incoming, context);
                if (context && matchesChatBindingContext(storeApi.getState(), context)) {
                    setErrorEntry(previous => previous?.scope === scope &&
                        previous.messageId && incoming.some(message => message.id === previous.messageId)
                        ? null
                        : previous);
                }
            },
            onSendError: (error, context) => {
                if (matchesChatBindingContext(storeApi.getState(), context)) setErrorEntry({ scope, text: error });
            },
            onStatusChange: setConnectionStatus,
            onHistoryMetaChange: setHistoryMeta,
        });
    }, [socketService, storeApi, scope, boundUserId, boundLocalProfileId, boundCloudProfileId]);

    const senderRole: ChatMessage["sender"] = isGuardianRole(currentUser?.role) ? "guardian" : "child";
    const setDraft = chatDraft.actions.setText;
    const setSendError = (text: string, messageId?: string) => setErrorEntry({ scope, text, messageId });

    const sendMessage = async () => {
        const trimmed = draft.trim();
        if (!trimmed) return;
        if ([...trimmed].length > 1000) {
            setSendError("Messages must be 1,000 characters or fewer.");
            return;
        }
        setErrorEntry(null);

        if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
            setSendError("This device cannot create a secure message ID.");
            return;
        }
        const created = addChatMessage(senderRole, trimmed, boundChatContext, crypto.randomUUID());
        if (!created) {
            setSendError("Could not save the message on this device.");
            return;
        }
        chatDraft.actions.clearAfterSend();
        if (!boundChatContext) {
            return;
        }
        const res = await socketService.sendMessage(created);
        if (!res.ok && matchesChatBindingContext(storeApi.getState(), boundChatContext)) {
            const verified = storeApi.getState().experimentalData?.chatMessages?.some(
                message => message.id === created.id && message.verified === true,
            );
            if (!verified) setSendError(res.error ?? "Failed to send message.", created.id);
        }
    };

    const reconnect = () => {
        setErrorEntry(null);
        socketService.reconnect();
    };

    const loadOlderMessages = async () => {
        setLoadOlderErrorEntry(null);
        const res = await socketService.loadOlderMessages();
        if (!res.ok && boundChatContext && matchesChatBindingContext(storeApi.getState(), boundChatContext)) {
            setLoadOlderErrorEntry({
                scope,
                text: res.error ?? "Could not load older messages.",
            });
        }
        return res;
    };

    const handleClose = () => {
        if (onClose) {
            onClose();
        } else {
            chatDraft.actions.returnToBoard();
        }
    };

    return {
        state: {
            messages,
            legacyMessageCount: messages.filter(m => m.verified !== true && !m.pendingContext).length,
            hasPendingMessages: messages.some(m => m.verified !== true && m.pendingContext),
            hasMoreHistory: historyMeta.hasMore,
            isLoadingOlder: historyMeta.loadingOlder,
            loadOlderError,
            draft,
            senderRole,
            currentUserId: currentUser?.id ?? null,
            scope,
            focusOnResume: chatDraft.state.focusOnResume,
            connectionStatus,
            isConnected: connectionStatus === "connected",
            sendError,
        },
        actions: {
            onClose: handleClose,
            setDraft,
            useWords: () => {
                chatDraft.actions.beginComposition();
                handleClose();
            },
            consumeResumeFocus: chatDraft.actions.consumeResumeFocus,
            sendMessage,
            sendAsChild: sendMessage,
            loadOlderMessages,
            reconnect,
            dismissLegacyMessages: () => {
                if (!dismissLegacyMessages()) setSendError("Could not remove local messages from this device.");
            },
        },
    };
}
