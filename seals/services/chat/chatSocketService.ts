import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ChatMessage } from "@/models/boardData";
import { getSupabaseBrowserClient, type BoardSupabaseClient } from "@/models/supabase/client";

const MAX_SYNC_MESSAGES = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChatConnectionStatus =
    | "disconnected"
    | "connecting"
    | "connected"
    | "unconfigured"
    | "unlinked"
    | "error";

export interface ChatBindingContext {
    userId: string;
    localProfileId: string;
    cloudProfileId: string;
}

export function isSameChatBindingContext(
    a: ChatBindingContext | null | undefined,
    b: ChatBindingContext | null | undefined,
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        a.userId === b.userId &&
        a.localProfileId === b.localProfileId &&
        a.cloudProfileId === b.cloudProfileId
    );
}

export interface ChatHistoryMeta {
    hasMore: boolean;
    loadingOlder: boolean;
}

export interface ChatSocketListener {
    onMessages?: (messages: ChatMessage[], context?: ChatBindingContext) => void;
    onStatusChange?: (status: ChatConnectionStatus) => void;
    onHistoryMetaChange?: (meta: ChatHistoryMeta) => void;
    onSendError?: (message: string, context: ChatBindingContext) => void;
    getLocalMessages?: (context?: ChatBindingContext) => ChatMessage[];
}

export interface IChatSocketService {
    isConfigured(): boolean;
    getStatus(): ChatConnectionStatus;
    getHistoryMeta(): ChatHistoryMeta;
    subscribe(listener: ChatSocketListener): () => void;
    sendMessage(message: ChatMessage): Promise<{ ok: boolean; message?: ChatMessage; error?: string }>;
    loadOlderMessages(): Promise<{ ok: boolean; loadedCount: number; hasMore: boolean; error?: string }>;
    setActiveContext(context: ChatBindingContext | null): void;
    setActiveProfile(cloudProfileId: string | null): void;
    reconnect(): void;
    disconnect(): void;
}

export function isValidChatMessage(value: unknown): value is ChatMessage {
    if (!value || typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    if (
        typeof obj.id !== "string" ||
        obj.id.trim().length === 0 ||
        (obj.sender !== "child" && obj.sender !== "guardian") ||
        typeof obj.text !== "string" ||
        obj.text.trim().length === 0
    ) {
        return false;
    }
    if (obj.senderUserId !== undefined && obj.senderUserId !== null && typeof obj.senderUserId !== "string") {
        return false;
    }
    if (obj.senderName !== undefined && obj.senderName !== null && typeof obj.senderName !== "string") {
        return false;
    }
    if (obj.verified !== undefined && typeof obj.verified !== "boolean") {
        return false;
    }
    if (obj.createdAt !== undefined && typeof obj.createdAt !== "string") {
        return false;
    }
    return true;
}

/**
 * Parses either a `profile_chat_messages` table row or a server-verified
 * `send_profile_chat_message` RPC/broadcast payload into a normalized `ChatMessage`.
 */
export function parseVerifiedServerMessage(raw: unknown): ChatMessage | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id !== "string" || obj.id.trim().length === 0) return null;
    if (typeof obj.text !== "string" || obj.text.trim().length === 0) return null;

    let sender: ChatMessage["sender"];
    let senderUserId: string | null | undefined;
    let senderName: string | null | undefined;
    let createdAt: string | undefined;

    if (obj.sender_role === "guardian" || obj.sender_role === "child") {
        if (obj.verified === false) return null;
        sender = obj.sender_role;
        if (obj.sender_user_id !== undefined) {
            if (obj.sender_user_id !== null && typeof obj.sender_user_id !== "string") return null;
            senderUserId = obj.sender_user_id;
        }
        if (obj.sender_name !== undefined) {
            if (obj.sender_name !== null && typeof obj.sender_name !== "string") return null;
            senderName = obj.sender_name;
        }
        if (obj.created_at !== undefined) {
            if (typeof obj.created_at !== "string") return null;
            createdAt = obj.created_at;
        }
    } else if ((obj.sender === "guardian" || obj.sender === "child") && obj.verified === true) {
        sender = obj.sender;
        if (obj.senderUserId !== undefined) {
            if (obj.senderUserId !== null && typeof obj.senderUserId !== "string") return null;
            senderUserId = obj.senderUserId;
        }
        if (obj.senderName !== undefined) {
            if (obj.senderName !== null && typeof obj.senderName !== "string") return null;
            senderName = obj.senderName;
        }
        if (obj.createdAt !== undefined) {
            if (typeof obj.createdAt !== "string") return null;
            createdAt = obj.createdAt;
        }
    } else {
        return null;
    }

    const normalized: ChatMessage = {
        id: obj.id.trim(),
        sender,
        text: obj.text.trim(),
        verified: true,
    };
    if (senderUserId !== undefined) normalized.senderUserId = senderUserId;
    if (senderName !== undefined) normalized.senderName = senderName;
    if (createdAt !== undefined) normalized.createdAt = createdAt;

    return isValidChatMessage(normalized) ? normalized : null;
}

/**
 * Manages real-time parent–child chat transport over a Supabase Realtime
 * Broadcast WebSocket channel with reference-counted subscriptions,
 * pending-send queueing, RPC-verified sending, and DB-verified history sync.
 */
export class ChatSocketService implements IChatSocketService {
    private channel: RealtimeChannel | null = null;
    private status: ChatConnectionStatus = "disconnected";
    private readonly listeners = new Set<ChatSocketListener>();
    private activeContext: ChatBindingContext | null;
    private channelName: string | null;
    private flushingGen: number | null = null;
    private connectionGen = 0;
    private connectingGen: number | null = null;
    private oldestHistoryCursor: { createdAt: string; id: string } | null = null;
    private hasMoreHistory = false;
    private loadingOlderGen: number | null = null;

    constructor(
        private readonly getClient: () => BoardSupabaseClient | null = getSupabaseBrowserClient,
        channelName: string | null = null,
    ) {
        this.channelName = channelName;
        this.activeContext = channelName
            ? { userId: "", localProfileId: "", cloudProfileId: channelName }
            : null;
        this.status = !this.getClient()
            ? "unconfigured"
            : channelName
              ? "disconnected"
              : "unlinked";
    }

    isConfigured(): boolean {
        return this.getClient() !== null;
    }

    getStatus(): ChatConnectionStatus {
        if (!this.isConfigured()) {
            return "unconfigured";
        }
        if (!this.channelName || !this.activeContext) {
            return "unlinked";
        }
        return this.status;
    }

    getHistoryMeta(): ChatHistoryMeta {
        return {
            hasMore: this.hasMoreHistory,
            loadingOlder: this.loadingOlderGen !== null && this.loadingOlderGen === this.connectionGen,
        };
    }

    setActiveContext(context: ChatBindingContext | null): void {
        const normalized = context?.cloudProfileId ? { ...context } : null;
        if (isSameChatBindingContext(this.activeContext, normalized)) {
            if (!normalized && (this.channel || this.connectingGen !== null)) {
                this.disconnect();
            }
            return;
        }
        this.activeContext = normalized;
        this.channelName = normalized
            ? `wikahon:parent-child-chat:${normalized.cloudProfileId}`
            : null;
        this.disconnect();
        if (normalized && this.listeners.size > 0) {
            this.connect();
        }
    }

    setActiveProfile(cloudProfileId: string | null): void {
        if (!cloudProfileId) {
            this.setActiveContext(null);
            return;
        }
        this.setActiveContext({
            userId: "",
            localProfileId: "",
            cloudProfileId,
        });
    }

    subscribe(listener: ChatSocketListener): () => void {
        this.listeners.add(listener);
        if (this.channel || this.connectingGen !== null) {
            listener.onStatusChange?.(this.getStatus());
        } else {
            const prevStatus = this.status;
            this.connect();
            if (this.status === prevStatus) {
                listener.onStatusChange?.(this.getStatus());
            }
        }
        listener.onHistoryMetaChange?.(this.getHistoryMeta());
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0) {
                this.disconnect();
            }
        };
    }

    async sendMessage(message: ChatMessage): Promise<{ ok: boolean; message?: ChatMessage; error?: string }> {
        if (!isValidChatMessage(message) || !UUID_RE.test(message.id)) {
            return { ok: false, error: "Invalid chat message." };
        }
        const client = this.getClient();
        if (!client) {
            this.setStatus("unconfigured");
            return { ok: false, error: "Supabase is not configured." };
        }
        if (!this.channelName || !this.activeContext || this.status === "unlinked") {
            if (!this.channelName || !this.activeContext) {
                this.setStatus("unlinked");
            }
            return { ok: false, error: "Chat needs a signed-in account linked to this profile." };
        }
        const boundContext = { ...this.activeContext };
        if (!isSameChatBindingContext(message.pendingContext, boundContext)) {
            return { ok: false, error: "Message belongs to another chat profile." };
        }
        if (!this.channel && this.connectingGen === null && this.listeners.size > 0) {
            this.connect();
        }
        if (this.getStatus() === "unlinked" || !isSameChatBindingContext(this.activeContext, boundContext)) {
            return { ok: false, error: "Chat needs a signed-in account linked to this profile." };
        }
        const gen = this.connectingGen ?? this.connectionGen;
        if (this.status === "connecting" || !this.channel) {
            return { ok: false, error: "Message saved locally and will retry when chat reconnects." };
        }
        if (this.status !== "connected") {
            return { ok: false, error: "Chat is offline; message saved locally for retry." };
        }
        return this.deliverMessage(client, message, boundContext, gen);
    }

    async loadOlderMessages(): Promise<{ ok: boolean; loadedCount: number; hasMore: boolean; error?: string }> {
        const client = this.getClient();
        if (!client) {
            return { ok: false, loadedCount: 0, hasMore: false, error: "Supabase is not configured." };
        }
        if (!this.channelName || !this.activeContext || this.status === "unlinked") {
            return {
                ok: false,
                loadedCount: 0,
                hasMore: false,
                error: "Chat needs a signed-in account linked to this profile.",
            };
        }
        if (this.status !== "connected") {
            return {
                ok: false,
                loadedCount: 0,
                hasMore: this.hasMoreHistory,
                error: "Chat is offline; reconnect to load older messages.",
            };
        }
        if (!this.hasMoreHistory || !this.oldestHistoryCursor) {
            return { ok: true, loadedCount: 0, hasMore: false };
        }
        const gen = this.connectionGen;
        if (this.loadingOlderGen === gen) {
            return { ok: true, loadedCount: 0, hasMore: this.hasMoreHistory };
        }
        const context = { ...this.activeContext };
        const cursor = { ...this.oldestHistoryCursor };
        if (!UUID_RE.test(cursor.id) || typeof cursor.createdAt !== "string" || cursor.createdAt.length === 0) {
            this.oldestHistoryCursor = null;
            this.setHistoryMeta(false, null);
            return { ok: false, loadedCount: 0, hasMore: false, error: "Invalid chat history cursor." };
        }
        if (typeof client.from !== "function") {
            return {
                ok: false,
                loadedCount: 0,
                hasMore: this.hasMoreHistory,
                error: "Chat history is unavailable.",
            };
        }

        this.setHistoryMeta(this.hasMoreHistory, gen);
        try {
            const safeCreatedAt = JSON.stringify(cursor.createdAt);
            const { data, error } = await client
                .from("profile_chat_messages")
                .select("*")
                .eq("profile_id", context.cloudProfileId)
                .or(`created_at.lt.${safeCreatedAt},and(created_at.eq.${safeCreatedAt},id.lt.${cursor.id})`)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .limit(MAX_SYNC_MESSAGES + 1);

            if (!this.isActiveAttempt(gen, context)) {
                return { ok: false, loadedCount: 0, hasMore: false, error: "Chat account or profile changed." };
            }
            if (error || !Array.isArray(data)) {
                this.setHistoryMeta(this.hasMoreHistory, null);
                return {
                    ok: false,
                    loadedCount: 0,
                    hasMore: this.hasMoreHistory,
                    error: "Could not load older messages.",
                };
            }

            const hasMore = data.length > MAX_SYNC_MESSAGES;
            const pageRows = hasMore ? data.slice(0, MAX_SYNC_MESSAGES) : data;
            const verifiedMessages = pageRows
                .slice()
                .reverse()
                .map(row => parseVerifiedServerMessage(row))
                .filter((msg): msg is ChatMessage => msg !== null);

            const oldest = verifiedMessages[0];
            this.oldestHistoryCursor =
                oldest?.createdAt && UUID_RE.test(oldest.id)
                    ? { createdAt: oldest.createdAt, id: oldest.id }
                    : null;
            const nextHasMore = hasMore && verifiedMessages.length > 0 && this.oldestHistoryCursor !== null;

            this.notifyMessages(verifiedMessages, context, gen);
            this.setHistoryMeta(nextHasMore, null);
            return { ok: true, loadedCount: verifiedMessages.length, hasMore: nextHasMore };
        } catch {
            if (this.isActiveAttempt(gen, context)) {
                this.setHistoryMeta(this.hasMoreHistory, null);
            }
            return {
                ok: false,
                loadedCount: 0,
                hasMore: this.hasMoreHistory,
                error: "Could not load older messages.",
            };
        }
    }

    reconnect(): void {
        this.disconnect();
        if (this.listeners.size > 0) {
            this.connect();
        }
    }

    disconnect(): void {
        ++this.connectionGen;
        this.connectingGen = null;
        this.oldestHistoryCursor = null;
        this.setHistoryMeta(false, null);
        const channel = this.channel;
        this.channel = null;
        const client = this.getClient();
        if (channel && client) {
            void client.removeChannel(channel).catch(() => undefined);
        }
        this.setStatus(!client ? "unconfigured" : this.channelName && this.activeContext ? "disconnected" : "unlinked");
    }

    private isActiveAttempt(gen: number, context: ChatBindingContext): boolean {
        return this.connectionGen === gen && isSameChatBindingContext(this.activeContext, context);
    }

    private setStatus(next: ChatConnectionStatus): void {
        if (this.status === next) return;
        this.status = next;
        for (const listener of this.listeners) {
            listener.onStatusChange?.(next);
        }
    }

    private setHistoryMeta(hasMore: boolean, loadingOlderGen: number | null): void {
        const prev = this.getHistoryMeta();
        this.hasMoreHistory = hasMore;
        this.loadingOlderGen = loadingOlderGen;
        const next = this.getHistoryMeta();
        if (prev.hasMore === next.hasMore && prev.loadingOlder === next.loadingOlder) return;
        for (const listener of this.listeners) {
            listener.onHistoryMetaChange?.(next);
        }
    }

    private notifyMessages(messages: ChatMessage[], context: ChatBindingContext, gen: number): void {
        if (messages.length === 0 || !this.isActiveAttempt(gen, context)) return;
        const snapshot = { ...context };
        for (const listener of this.listeners) {
            if (!this.isActiveAttempt(gen, snapshot)) return;
            listener.onMessages?.(messages, snapshot);
        }
    }

    private async fetchVerifiedHistory(
        client: BoardSupabaseClient,
        context: ChatBindingContext,
        gen: number,
    ): Promise<void> {
        if (!this.isActiveAttempt(gen, context)) return;
        if (typeof client.from !== "function" || typeof client.rpc !== "function") {
            this.setStatus("error");
            return;
        }
        try {
            const { data, error } = await client
                .from("profile_chat_messages")
                .select("*")
                .eq("profile_id", context.cloudProfileId)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .limit(MAX_SYNC_MESSAGES + 1);
            if (!this.isActiveAttempt(gen, context)) return;
            if (error || !Array.isArray(data)) {
                this.setStatus("error");
                return;
            }
            const hasMore = data.length > MAX_SYNC_MESSAGES;
            const pageRows = hasMore ? data.slice(0, MAX_SYNC_MESSAGES) : data;
            const verifiedMessages = pageRows
                .slice()
                .reverse()
                .map(row => parseVerifiedServerMessage(row))
                .filter((msg): msg is ChatMessage => msg !== null);
            const oldest = verifiedMessages[0];
            const oldestCursor =
                oldest?.createdAt && UUID_RE.test(oldest.id)
                    ? { createdAt: oldest.createdAt, id: oldest.id }
                    : null;
            this.oldestHistoryCursor = oldestCursor;
            this.setHistoryMeta(hasMore && oldestCursor !== null, null);
            this.notifyMessages(verifiedMessages, context, gen);
            this.setStatus("connected");
            void this.flushPendingQueue(gen, context);
        } catch {
            if (this.isActiveAttempt(gen, context)) this.setStatus("error");
        }
    }

    private async deliverMessage(
        client: BoardSupabaseClient,
        message: ChatMessage,
        context: ChatBindingContext,
        gen: number,
    ): Promise<{ ok: boolean; message?: ChatMessage; error?: string }> {
        if (typeof client.rpc === "function") {
            try {
                const { data: sessionData } = await client.auth.getSession();
                if (!this.isActiveAttempt(gen, context) || sessionData.session?.user?.id !== context.userId) {
                    return { ok: false, error: "Chat account or profile changed." };
                }
                const profileId = context.cloudProfileId;
                const { data, error } = await client.rpc("send_profile_chat_message", {
                    p_profile_id: profileId,
                    p_text: message.text.trim(),
                    p_message_id: message.id,
                });
                if (error) {
                    if (this.isActiveAttempt(gen, context) && (error.code === "PGRST202" || error.code === "42883")) this.setStatus("error");
                    return { ok: false, error: "Could not send message. It remains saved locally for retry." };
                }
                const verifiedMsg = parseVerifiedServerMessage(data);
                if (!verifiedMsg || verifiedMsg.id !== message.id || verifiedMsg.text !== message.text.trim()) {
                    return { ok: false, error: "Server returned an invalid chat message." };
                }
                if (this.isActiveAttempt(gen, context)) {
                    this.notifyMessages([verifiedMsg], context, gen);
                }
                return { ok: true, message: verifiedMsg };
            } catch {
                return {
                    ok: false,
                    error: "Could not send message. It remains saved locally for retry.",
                };
            }
        }
        return { ok: false, error: "Chat sending is unavailable on this server." };
    }

    private async flushPendingQueue(gen: number, context: ChatBindingContext): Promise<void> {
        if (this.flushingGen === gen) return;
        const client = this.getClient();
        if (!client) return;
        this.flushingGen = gen;
        try {
            const pending = new Map<string, ChatMessage>();
            for (const listener of this.listeners) {
                for (const message of listener.getLocalMessages?.(context) ?? []) {
                    if (message.verified !== true && UUID_RE.test(message.id) &&
                        isSameChatBindingContext(message.pendingContext, context)) pending.set(message.id, message);
                }
            }
            let failed = false;
            for (const message of pending.values()) {
                if (!this.isActiveAttempt(gen, context) || this.status !== "connected") break;
                const result = await this.deliverMessage(client, message, context, gen);
                if (!result.ok) failed = true;
            }
            if (failed && this.isActiveAttempt(gen, context)) {
                for (const listener of this.listeners) listener.onSendError?.("Some messages could not be sent and remain saved locally for retry.", context);
            }
        } finally {
            if (this.flushingGen === gen) this.flushingGen = null;
        }
    }

    private async fetchBroadcastMessage(
        client: BoardSupabaseClient,
        context: ChatBindingContext,
        gen: number,
        id: string,
    ): Promise<void> {
        try {
            const { data, error } = await client
                .from("profile_chat_messages")
                .select("*")
                .eq("profile_id", context.cloudProfileId)
                .eq("id", id)
                .maybeSingle();
            if (error) return;
            const message = parseVerifiedServerMessage(data);
            if (message) this.notifyMessages([message], context, gen);
        } catch {
            // Rejoining the channel refreshes history after a failed read.
        }
    }

    private connect(): void {
        if (this.channel || this.connectingGen !== null) return;
        const client = this.getClient();
        if (!client) {
            this.setStatus("unconfigured");
            return;
        }
        const channelName = this.channelName;
        const context = this.activeContext ? { ...this.activeContext } : null;
        if (!channelName || !context) {
            this.setStatus("unlinked");
            return;
        }

        const gen = ++this.connectionGen;
        this.connectingGen = gen;
        this.setStatus("connecting");
        void this.openChannel(client, channelName, context, gen);
    }

    private async openChannel(
        client: BoardSupabaseClient,
        channelName: string,
        context: ChatBindingContext,
        gen: number,
    ): Promise<void> {
        let accessToken: string | undefined;
        try {
            const { data } = await client.auth.getSession();
            if (!this.isActiveAttempt(gen, context)) return;
            accessToken = data?.session?.user?.id === context.userId ? data.session.access_token : undefined;
        } catch {
            if (!this.isActiveAttempt(gen, context)) return;
            this.connectingGen = null;
            this.setStatus("unlinked");
            return;
        }

        if (!this.isActiveAttempt(gen, context) || this.channel) {
            return;
        }

        if (!accessToken || !this.channelName) {
            this.connectingGen = null;
            this.setStatus("unlinked");
            return;
        }

        try {
            await client.realtime.setAuth(accessToken);
        } catch {
            if (!this.isActiveAttempt(gen, context)) return;
            this.connectingGen = null;
            this.setStatus("error");
            return;
        }

        if (!this.isActiveAttempt(gen, context) || this.channel) {
            return;
        }
        this.connectingGen = null;

        const channel = client.channel(channelName, {
            config: { private: true, broadcast: { self: false, ack: true } },
        });
        this.channel = channel;

        channel
            .on("broadcast", { event: "chat:message" }, envelope => {
                if (this.channel !== channel || !this.isActiveAttempt(gen, context)) return;
                const payload = envelope.payload as { id?: unknown; message?: { id?: unknown } } | undefined;
                const id = payload?.id ?? payload?.message?.id;
                // Read the authoritative row through RLS. The broadcast supplies only a lookup ID.
                if (typeof id === "string" && UUID_RE.test(id)) {
                    void this.fetchBroadcastMessage(client, context, gen, id);
                }
            })
            .subscribe(status => {
                if (this.channel !== channel || !this.isActiveAttempt(gen, context)) return;
                if (status === "SUBSCRIBED") {
                    void this.fetchVerifiedHistory(client, context, gen);
                } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    this.setStatus("error");
                } else if (status === "CLOSED") {
                    this.setStatus("disconnected");
                }
            });
    }
}

export const chatSocketService = new ChatSocketService();
