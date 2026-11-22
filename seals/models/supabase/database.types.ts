import type { ColorKey, ColorSystemId, LanguageTag, WordClass } from "@/lib/board";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type ProfileMemberRole = "editor" | "viewer";
export type AppUserRole = "PARENT" | "CAREGIVER" | "CHILD";
export type LayoutMode = "manual" | "automatic";
export type ChatSenderRole = "guardian" | "child";
type Table<Row, Required extends keyof Row, Relations extends Relationship[] = []> = {
    Row: Row;
    Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
    Update: Partial<Row>;
    Relationships: Relations;
};
type Relationship = {
    foreignKeyName: string;
    columns: string[];
    isOneToOne: boolean;
    referencedRelation: string;
    referencedColumns: string[];
};
type ProfileRelation<Name extends string, One extends boolean = false> = {
    foreignKeyName: Name;
    columns: ["profile_id"];
    isOneToOne: One;
    referencedRelation: "profiles";
    referencedColumns: ["id"];
};

export type ProfileRow = { id: string; owner_id: string; name: string; revision: number };
export type ProfileMembershipRow = {
    profile_id: string;
    user_id: string;
    role: ProfileMemberRole;
};
export type BoardRow = {
    profile_id: string;
    id: string;
    name: string;
    short_name: string;
    color_key: ColorKey;
    icon_name: string | null;
    is_built_in: boolean;
    grid_override: Json | null;
    layout_mode_override: LayoutMode | null;
    catalog_system: ColorSystemId | null;
    pages: Json;
};
export type TileRow = {
    profile_id: string;
    id: string;
    kind: "word" | "folder";
    label: string;
    spoken_text: string | null;
    icon_name: string | null;
    media_id: string | null;
    language: LanguageTag;
    is_quick_phrase: boolean;
    category_id: string;
    target_board_id: string | null;
    color_key: ColorKey | null;
    word_class: WordClass | null;
    is_custom: boolean;
};
export type ProfileSettingsRow = {
    profile_id: string;
    catalog_order: string[];
    color_system: ColorSystemId;
    layout_mode: LayoutMode;
    inactive_catalog_layouts: Json;
    grid_config: Json;
    tile_appearance: Json;
    speech_config: Json;
    access_config: Json;
    feature_flags: Json;
};
export type UserAccountRow = {
    user_id: string;
    username: string;
    display_name: string;
    role: AppUserRole;
    guardian_id: string | null;
};
export type ProfileChatMessageRow = {
    id: string;
    profile_id: string;
    sender_user_id: string;
    sender_role: ChatSenderRole;
    sender_name: string;
    text: string;
    created_at: string;
};

/** Schema contract for 20261117000100_board_models.sql through 20261123000400_schema_audit_optimizations.sql (normalized to omit Timestamps) */
export type Database = {
    public: {
        Tables: {
            profiles: Table<ProfileRow, "name">;
            profile_memberships: Table<
                ProfileMembershipRow,
                "profile_id" | "user_id",
                [ProfileRelation<"profile_memberships_profile_id_fkey">]
            >;
            boards: Table<
                BoardRow,
                "profile_id" | "id" | "name" | "short_name" | "color_key",
                [ProfileRelation<"boards_profile_id_fkey">]
            >;
            tiles: Table<
                TileRow,
                "profile_id" | "id" | "label" | "category_id",
                [
                    ProfileRelation<"tiles_profile_id_fkey">,
                    {
                        foreignKeyName: "tiles_profile_id_category_id_fkey";
                        columns: ["profile_id", "category_id"];
                        isOneToOne: false;
                        referencedRelation: "boards";
                        referencedColumns: ["profile_id", "id"];
                    },
                    {
                        foreignKeyName: "tiles_profile_id_target_board_id_fkey";
                        columns: ["profile_id", "target_board_id"];
                        isOneToOne: false;
                        referencedRelation: "boards";
                        referencedColumns: ["profile_id", "id"];
                    },
                ]
            >;
            profile_settings: Table<
                ProfileSettingsRow,
                "profile_id",
                [ProfileRelation<"profile_settings_profile_id_fkey", true>]
            >;
            user_accounts: Table<UserAccountRow, "user_id" | "username" | "display_name">;
            profile_chat_messages: Table<
                ProfileChatMessageRow,
                "profile_id" | "sender_user_id" | "sender_role" | "sender_name" | "text",
                [ProfileRelation<"profile_chat_messages_profile_id_fkey">]
            >;
        };
        Views: { [_ in never]: never };
        Functions: {
            publish_profile_snapshot: {
                Args: {
                    p_profile_id: string;
                    p_expected_revision: number | null;
                    p_boards: Json;
                    p_tiles: Json;
                    p_words?: Json;
                    p_settings: Json;
                    p_profile_name?: string | null;
                };
                Returns: number;
            };
            resolve_login_email: {
                Args: {
                    p_identifier: string;
                };
                Returns: string | null;
            };
            send_profile_chat_message: {
                Args: {
                    p_profile_id: string;
                    p_text: string;
                    p_message_id?: string | null;
                };
                Returns: Json;
            };
        };
        Enums: {
            app_user_role: AppUserRole;
            profile_member_role: ProfileMemberRole;
            tile_kind: "word" | "folder";
            board_color: ColorKey;
            word_class: WordClass;
            language_tag: LanguageTag;
            chat_sender_role: ChatSenderRole;
            layout_mode: LayoutMode;
            color_system: ColorSystemId;
        };
        CompositeTypes: { [_ in never]: never };
    };
};
export type TableName = keyof Database["public"]["Tables"];
export type Row<Name extends TableName> = Database["public"]["Tables"][Name]["Row"];
export type Insert<Name extends TableName> = Database["public"]["Tables"][Name]["Insert"];
export type Update<Name extends TableName> = Database["public"]["Tables"][Name]["Update"];
