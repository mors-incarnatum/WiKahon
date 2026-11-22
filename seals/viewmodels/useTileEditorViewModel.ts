"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBoardStore } from "@/store/BoardProvider";
import {
    uid,
    resolveBoardTileColor,
    type Tile,
    type CellKey,
    type ColorKey,
    type WordClass,
    type LanguageTag,
} from "@/lib/board";
import { mediaRepository, validateAndProcessPhoto } from "@/services/storage/mediaRepository";
import { useSentenceContext } from "./useBoardShellViewModel";

export interface TileEditorTarget {
    boardId: string;
    page?: number;
    cell?: CellKey;
    tile?: Tile;
    multi?: boolean;
    onClose: () => void;
}

export function useTileEditorViewModel(target: TileEditorTarget) {
    const tiles = useBoardStore(s => s.tiles);
    const boards = useBoardStore(s => s.boards);
    const order = useBoardStore(s => s.catalogOrder);
    const colorSystem = useBoardStore(s => s.colorSystem ?? "custom");
    const colorMode = useBoardStore(s => s.tileAppearance.colorMode);
    const activeProfileId = useBoardStore(s => s.activeProfileId);
    const upsert = useBoardStore(s => s.upsertTile);
    const deleteTile = useBoardStore(s => s.deleteTile);
    const assign = useBoardStore(s => s.assignSlot);
    const add = useBoardStore(s => s.addWordsToCatalog);
    const createCatalog = useBoardStore(s => s.createCatalog);
    const sentence = useSentenceContext();

    const defaultCategoryId = target.boardId === "home" ? (order[0] ?? "home") : target.boardId;

    const [tab, setTab] = useState(
        target.tile?.kind === "folder" ? "folder" : target.tile ? "custom" : "existing",
    );
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [picked, setPicked] = useState<string[]>([]);
    const [selectedExisting, setSelectedExisting] = useState<Tile | null>(
        target.tile?.kind === "word" ? target.tile : null,
    );
    const [customDraft, setCustomDraft] = useState<Tile>(() =>
        target.tile?.kind === "word"
            ? { ...target.tile }
            : {
                  id: `custom-${uid()}`,
                  kind: "word",
                  label: "",
                  spokenText: "",
                  language: "fil",
                  categoryId: defaultCategoryId,
                  iconName: null,
                  mediaId: null,
                  isCustom: true,
              },
    );
    const [selectedFolder, setSelectedFolder] = useState<Tile | null>(
        target.tile?.kind === "folder" ? { ...target.tile } : null,
    );
    const [folderName, setFolderName] = useState("");
    const [cropSquare, setCropSquare] = useState(true);
    const [photoError, setPhotoError] = useState("");
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [confirmDeleteWord, setConfirmDeleteWord] = useState(false);

    const uncommittedMediaIds = useRef<Set<string>>(new Set());
    const profileIdRef = useRef(activeProfileId);

    useEffect(() => {
        profileIdRef.current = activeProfileId;
    }, [activeProfileId]);

    useEffect(() => {
        const pendingMediaIds = uncommittedMediaIds.current;
        return () => {
            for (const id of pendingMediaIds) {
                void mediaRepository.removeMedia(profileIdRef.current, id);
            }
            pendingMediaIds.clear();
        };
    }, []);

    const patch = (value: Partial<Tile>) => setCustomDraft(p => ({ ...p, ...value }));

    const removeUncommittedMedia = (mediaId: string | null | undefined) => {
        if (mediaId && uncommittedMediaIds.current.has(mediaId)) {
            void mediaRepository.removeMedia(activeProfileId, mediaId);
            uncommittedMediaIds.current.delete(mediaId);
        }
    };

    const saveTile = (tile: Tile) => {
        if (tile.mediaId) {
            uncommittedMediaIds.current.delete(tile.mediaId);
        }
        upsert(tile);
        if (target.cell) {
            assign(target.boardId, target.page ?? 0, target.cell, tile.id);
        } else {
            add(target.boardId, [tile.id]);
        }
        target.onClose();
    };

    const words = Object.values(tiles).filter(
        t =>
            t.kind === "word" &&
            t.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
            (filter === "all" ||
                t.categoryId === filter ||
                boards[filter]?.pages.some(p => Object.values(p.cells).some(c => c?.tileId === t.id))),
    );

    const alreadyOnBoardIds = useMemo(() => {
        const ids = new Set<string>();
        const board = boards[target.boardId];
        if (!board) return ids;
        for (const page of board.pages) {
            for (const cell of Object.values(page.cells)) {
                if (cell?.tileId) ids.add(cell.tileId);
            }
        }
        return ids;
    }, [boards, target.boardId]);

    const isEditingWord = Boolean(target.tile?.kind === "word" && tiles[target.tile.id]);
    const usageCount = useMemo(() => {
        if (!isEditingWord || !target.tile) return 0;
        const targetId = target.tile.id;
        let count = 0;
        for (const board of Object.values(boards)) {
            for (const page of board.pages) {
                for (const cell of Object.values(page.cells)) {
                    if (cell?.tileId === targetId) count += 1;
                }
            }
        }
        return count;
    }, [boards, isEditingWord, target.tile]);

    const uploadPhoto = async (file: File | null | undefined) => {
        if (!file) return;
        setPhotoError("");
        setUploadingPhoto(true);
        try {
            const processed = await validateAndProcessPhoto(file, cropSquare);
            if (!processed.ok) {
                setPhotoError(processed.error);
                return;
            }
            const newMediaId = `media-${uid()}`;
            const saved = await mediaRepository.saveMedia(activeProfileId, newMediaId, processed.data.blob, {
                mimeType: processed.data.mimeType,
                width: processed.data.width,
                height: processed.data.height,
            });
            if (!saved.ok) {
                setPhotoError(saved.error ?? "Failed to save photo.");
                return;
            }
            removeUncommittedMedia(customDraft.mediaId);
            uncommittedMediaIds.current.add(newMediaId);
            patch({ mediaId: newMediaId });
        } finally {
            setUploadingPhoto(false);
        }
    };

    const removePhoto = () => {
        setPhotoError("");
        removeUncommittedMedia(customDraft.mediaId);
        patch({ mediaId: null });
    };

    const preview: Tile =
        tab === "custom"
            ? customDraft
            : tab === "folder"
              ? (selectedFolder ?? {
                    id: "",
                    kind: "folder",
                    label: "",
                    categoryId: defaultCategoryId,
                    iconName: null,
                })
              : (selectedExisting ?? {
                    id: "",
                    kind: "word",
                    label: "",
                    spokenText: "",
                    language: "fil",
                    categoryId: defaultCategoryId,
                    iconName: null,
                    mediaId: null,
                });

    const canSave =
        tab === "custom"
            ? customDraft.label.trim().length > 0
            : tab === "existing"
              ? Boolean(selectedExisting && selectedExisting.label.trim().length > 0)
              : Boolean(selectedFolder?.kind === "folder" && selectedFolder.targetBoardId);

    return {
        state: {
            tab,
            query,
            filter,
            picked,
            preview,
            customDraft,
            selectedExisting,
            selectedFolder,
            previewColor: resolveBoardTileColor(preview, boards, colorMode, colorSystem, target.boardId),
            canCreateCatalog: colorSystem === "custom",
            folderName,
            words,
            alreadyOnBoardIds,
            catalogs: order.map(id => boards[id]).filter(Boolean),
            canSave,
            cropSquare,
            photoError,
            uploadingPhoto,
            isEditingWord,
            usageCount,
            confirmDeleteWord,
        },
        actions: {
            setTab,
            setQuery,
            setFilter,
            setFolderName,
            setCropSquare,
            setConfirmDeleteWord,
            patch,
            setColor: (colorKey: ColorKey) => patch({ colorKey }),
            setWordClass: (wordClass: WordClass) => patch({ wordClass }),
            setLanguage: (language: LanguageTag) => patch({ language }),
            uploadPhoto,
            removePhoto,
            chooseWord: (tile: Tile) => {
                if (target.multi && alreadyOnBoardIds.has(tile.id)) return;
                setSelectedExisting(tile);
                if (target.multi) {
                    setPicked(ids =>
                        ids.includes(tile.id) ? ids.filter(id => id !== tile.id) : [...ids, tile.id],
                    );
                }
            },
            saveExisting: () => {
                if (target.multi) {
                    add(target.boardId, picked);
                    target.onClose();
                } else if (selectedExisting && selectedExisting.label.trim()) {
                    saveTile(selectedExisting);
                }
            },
            saveCustom: () => {
                const trimmedLabel = customDraft.label.trim();
                if (!trimmedLabel) return;
                const { targetBoardId: _ignoredTarget, ...rest } = customDraft;
                void _ignoredTarget;
                saveTile({ ...rest, label: trimmedLabel, kind: "word" });
            },
            saveCustomAsCopy: () => {
                const trimmedLabel = customDraft.label.trim();
                if (!trimmedLabel) return;
                const { targetBoardId: _ignoredTarget, ...rest } = customDraft;
                void _ignoredTarget;
                saveTile({
                    ...rest,
                    id: `custom-${uid()}`,
                    label: trimmedLabel,
                    kind: "word",
                    isCustom: true,
                });
            },
            deleteWord: () => {
                if (!isEditingWord || !target.tile) return;
                deleteTile(target.tile.id);
                target.onClose();
            },
            chooseFolder: (id: string) => {
                const b = boards[id];
                if (!b) return;
                setSelectedFolder({
                    id: selectedFolder?.id || (target.tile?.kind === "folder" ? target.tile.id : `folder-${uid()}`),
                    kind: "folder",
                    label: b.name,
                    categoryId: id,
                    targetBoardId: id,
                    iconName: b.iconName,
                });
            },
            saveFolder: () => {
                if (selectedFolder?.kind === "folder") saveTile(selectedFolder);
            },
            createFolder: () => {
                if (colorSystem !== "custom" || !folderName.trim()) return;
                const id = createCatalog({
                    name: folderName,
                    colorKey: customDraft.colorKey ?? "teal",
                    iconName: null,
                });
                if (!id) return;
                setSelectedFolder({
                    id: selectedFolder?.id || (target.tile?.kind === "folder" ? target.tile.id : `folder-${uid()}`),
                    kind: "folder",
                    label: folderName.trim(),
                    categoryId: id,
                    targetBoardId: id,
                    iconName: null,
                });
                setFolderName("");
            },
            testSpeak: () => sentence.actions.testSpeak(preview.spokenText || preview.label),
        },
    };
}
