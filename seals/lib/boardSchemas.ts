import { z } from "zod";
import { SAFE_MEDIA_ID_RE } from "@/models/boardData";

export const COLOR_KEYS = [
    "rose",
    "emerald",
    "amber",
    "yellow",
    "blue",
    "violet",
    "teal",
    "orange",
    "pink",
    "white",
    "slate",
] as const;

export const WORD_CLASSES = [
    "social",
    "question",
    "verb",
    "pronoun",
    "particle",
    "modifier",
    "place",
    "noun",
    "other",
] as const;

export const LANGUAGE_TAGS = ["fil", "en", "taglish"] as const;
export const TILE_KINDS = ["word", "folder"] as const;

export const ColorKeySchema = z.enum(COLOR_KEYS);
export const WordClassSchema = z.enum(WORD_CLASSES);
export const LanguageTagSchema = z.enum(LANGUAGE_TAGS);
export const TileKindSchema = z.enum(TILE_KINDS);
export const ColorModeSchema = z.enum(["catalog", "wordClass", "neutral"]);

export const MediaIdSchema = z.string().regex(SAFE_MEDIA_ID_RE, "Invalid mediaId");

export const TileSchema = z
    .object({
        id: z.string().min(1),
        kind: TileKindSchema,
        label: z.string().refine(v => v.trim().length > 0, "Label must be non-empty"),
        spokenText: z.string().optional(),
        iconName: z.string().nullable(),
        mediaId: MediaIdSchema.nullable().optional(),
        language: LanguageTagSchema.optional(),
        categoryId: z.string().min(1),
        targetBoardId: z.string().min(1).optional(),
        colorKey: ColorKeySchema.optional(),
        wordClass: WordClassSchema.optional(),
        isCustom: z.boolean().optional(),
        isQuickPhrase: z.boolean().optional(),
    })
    .superRefine((tile, ctx) => {
        if (tile.kind === "folder" && (!tile.targetBoardId || tile.targetBoardId.trim().length === 0)) {
            ctx.addIssue({
                code: "custom",
                path: ["targetBoardId"],
                message: "Folder tiles require a non-empty targetBoardId",
            });
        }
    });

export const SentenceTokenSchema = z.object({
    instanceId: z.string().min(1),
    tileId: z.string().min(1),
    label: z.string().refine(v => v.trim().length > 0, "Label must be non-empty"),
    spokenText: z.string(),
    iconName: z.string().nullable(),
    mediaId: MediaIdSchema.nullable().optional(),
    colorKey: ColorKeySchema,
    wordClass: WordClassSchema.optional(),
    displayColorKey: ColorKeySchema.optional(),
});

export const TileAppearanceSchema = z.object({
    labelPosition: z.enum(["top", "bottom"]),
    fontScale: z.enum(["sm", "md", "lg"]),
    iconScale: z.enum(["sm", "md", "lg"]),
    showIcons: z.boolean(),
    gridGap: z.enum(["compact", "normal", "relaxed"]),
    colorMode: ColorModeSchema,
    tileWidth: z.number().int().min(1).max(100),
    tileHeight: z.number().int().min(1).max(100),
});

export const SpeechConfigSchema = z.object({
    volume: z.number().finite().min(0).max(1),
    speakOnTap: z.boolean(),
    autoClear: z.enum(["off", "afterSpeak", "nextTap"]),
    rate: z.number().finite().min(0.5).max(2),
});

export const AccessConfigSchema = z.object({
    longPressToEdit: z.boolean(),
    holdDurationMs: z.number().finite().min(0),
    moveTolerancePx: z.number().finite().min(0),
    swipeThresholdPx: z.number().finite().min(0),
});

export const FeatureFlagsSchema = z.object({
    animation: z.boolean(),
    vibration: z.boolean(),
    categoryWheel: z.boolean(),
    scribblePractice: z.boolean(),
    parentChildChat: z.boolean(),
    pinnedVocabulary: z.boolean(),
    childBoardLayout: z.boolean(),
});

export const ChatMessageSchema = z.object({
    id: z.string().refine(v => v.trim().length > 0, "Message id must be non-empty"),
    sender: z.enum(["child", "guardian"]),
    text: z.string().refine(v => v.trim().length > 0, "Message text must be non-empty"),
    senderUserId: z.string().nullable().optional(),
    senderName: z.string().nullable().optional(),
    verified: z.boolean().optional(),
    pendingContext: z.object({ userId: z.string().min(1), localProfileId: z.string().min(1), cloudProfileId: z.string().min(1) }).optional(),
    createdAt: z.string().optional(),
});

export const ExperimentalDataSchema = z.object({
    scribbleDrafts: z.array(z.string()).optional(),
    chatMessages: z.array(ChatMessageSchema).optional(),
    pinnedTileIds: z.array(z.string().min(1)).optional(),
});
