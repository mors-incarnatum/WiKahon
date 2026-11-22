import { useState, useEffect, useRef } from "react";
import { useBoardStore } from "@/store/BoardProvider";
import {
    clampGrid,
    type GridConfig,
    type CatalogBoard,
    type ColorSystemId
} from "@/lib/board";
import type { BoardData } from "@/store/useBoardStore";

export function useBoardSettingsViewModel(
    open: boolean,
    boardId?: string,
    onBoardReset?: () => void
) {
    const board = useBoardStore(s => (boardId ? s.boards[boardId] : undefined));
    const gridConfig = useBoardStore(s => s.gridConfig);
    const layoutMode = useBoardStore(s => s.layoutMode);
    const colorSystem = useBoardStore(s => s.colorSystem);
    const tileAppearance = useBoardStore(s => s.tileAppearance);
    const speechConfig = useBoardStore(s => s.speechConfig);
    const accessConfig = useBoardStore(s => s.accessConfig);
    const boards = useBoardStore(s => s.boards);
    const applyBoardSettings = useBoardStore(s => s.applyBoardSettings);
    const reflowOutOfBoundsTiles = useBoardStore(s => s.reflowOutOfBoundsTiles);
    const setColorSystem = useBoardStore(s => s.setColorSystem);
    const setTileAppearance = useBoardStore(s => s.setTileAppearance);
    const setSpeechConfig = useBoardStore(s => s.setSpeechConfig);
    const setAccessConfig = useBoardStore(s => s.setAccessConfig);

    const hasBoardOverride = Boolean(board?.gridOverride || board?.layoutModeOverride);
    const [scope, setScope] = useState<"this" | "all">(hasBoardOverride ? "this" : "all");

    const currentGridForScope = (s: "this" | "all", b?: CatalogBoard) =>
        s === "this" && b?.gridOverride ? b.gridOverride : gridConfig;
    const currentModeForScope = (s: "this" | "all", b?: CatalogBoard) =>
        s === "this" && b?.layoutModeOverride ? b.layoutModeOverride : layoutMode;

    const [draftGrid, setDraftGrid] = useState<GridConfig>(() =>
        currentGridForScope(scope, board)
    );
    const [draftMode, setDraftMode] = useState<"manual" | "automatic">(() =>
        currentModeForScope(scope, board)
    );
    const [draftAppearance, setDraftAppearance] = useState(tileAppearance);
    const [draftSpeech, setDraftSpeech] = useState(speechConfig);
    const [draftAccess, setDraftAccess] = useState(accessConfig);
    const [draftColorSystem, setDraftColorSystem] = useState<ColorSystemId>(colorSystem);
    const [pinInput, setPinInput] = useState("");
    const [pinError, setPinError] = useState("");
    const [savedNotice, setSavedNotice] = useState(false);

    const wasOpen = useRef(false);

    useEffect(() => {
        if (open && !wasOpen.current) {
            const initialScope = board?.gridOverride || board?.layoutModeOverride ? "this" : "all";
            setScope(initialScope);
            setDraftGrid(currentGridForScope(initialScope, board));
            setDraftMode(currentModeForScope(initialScope, board));
            setDraftAppearance(tileAppearance);
            setDraftSpeech(speechConfig);
            setDraftAccess(accessConfig);
            setDraftColorSystem(colorSystem);
            setPinInput("");
            setPinError("");
            setSavedNotice(false);
        }
        wasOpen.current = open;
    });

    const changeScope = (nextScope: "this" | "all") => {
        setScope(nextScope);
        setDraftGrid(currentGridForScope(nextScope, board));
        setDraftMode(currentModeForScope(nextScope, board));
        setSavedNotice(false);
    };

    const changeDraftMode = (mode: "manual" | "automatic") => {
        setDraftMode(mode);
        setSavedNotice(false);
    };

    const changeDraftGrid = (grid: GridConfig) => {
        setDraftGrid(clampGrid(grid));
        setSavedNotice(false);
    };

    const changeDraftColorSystem = (nextSystem: ColorSystemId) => {
        setDraftColorSystem(nextSystem);
        setSavedNotice(false);
    };

    const patchAppearance = (patch: Partial<BoardData["tileAppearance"]>) => {
        setDraftAppearance(prev => ({ ...prev, ...patch }));
        setSavedNotice(false);
    };

    const patchSpeech = (patch: Partial<BoardData["speechConfig"]>) => {
        setDraftSpeech(prev => ({ ...prev, ...patch }));
        setSavedNotice(false);
    };

    const patchAccess = (patch: Partial<BoardData["accessConfig"]>) => {
        setDraftAccess(prev => ({ ...prev, ...patch }));
        setSavedNotice(false);
    };

    const affectedBoards =
        scope === "this" && board
            ? [board]
            : Object.values(boards).filter(b => !b.gridOverride);

    const isAutomatic = draftMode === "automatic";
    const totalAffectedTiles = affectedBoards.reduce((sum, b) => {
        const count = b.pages.reduce(
            (pageSum, p) =>
                pageSum + Object.values(p.cells).filter(c => Boolean(c)).length,
            0
        );
        return sum + count;
    }, 0);

    const capacity = draftGrid.rows * draftGrid.cols;
    const estimatedPages = isAutomatic
        ? 1
        : Math.max(1, Math.ceil(totalAffectedTiles / Math.max(1, capacity)));

    const outOfBoundsTiles = isAutomatic
        ? 0
        : affectedBoards.reduce((sum, b) => {
              const firstPage = b.pages[0]?.cells ?? {};
              const overflow = Object.entries(firstPage).filter(([cell, placement]) => {
                  if (!placement) return false;
                  const [r, c] = cell.split(":").map(Number);
                  return r >= draftGrid.rows || c >= draftGrid.cols;
              }).length;
              return sum + overflow;
          }, 0);

    const applyAllChanges = () => {
        const systemChanged = draftColorSystem !== colorSystem;
        if (systemChanged) {
            setColorSystem(draftColorSystem);
        }

        const targetBoardId =
            scope === "this" && (!systemChanged || boardId === "home") ? boardId : undefined;

        applyBoardSettings(
            draftGrid,
            draftAppearance,
            draftMode,
            targetBoardId,
            scope === "all" && Boolean(boardId) && hasBoardOverride
        );

        setSpeechConfig(draftSpeech);
        setAccessConfig(draftAccess);
        setSavedNotice(true);
    };

    const reflowTiles = () => {
        if (scope === "this" && boardId) {
            reflowOutOfBoundsTiles(boardId);
        } else {
            Object.values(boards)
                .filter(b => !b.gridOverride)
                .forEach(b => reflowOutOfBoundsTiles(b.id));
        }
        setSavedNotice(true);
    };

    const savePin = () => {
        if (!/^\d{4}$/.test(pinInput)) {
            setPinError("Enter a 4-digit numeric PIN.");
            return;
        }
        setPinError("");
        setPinInput("");
        patchAccess({ editPin: pinInput });
        setAccessConfig({ editPin: pinInput });
        setSavedNotice(true);
    };

    const removePin = () => {
        setPinError("");
        setPinInput("");
        patchAccess({ editPin: null });
        setAccessConfig({ editPin: null });
        setSavedNotice(true);
    };

    const resetEverything = () => {
        if (typeof window !== "undefined") {
            localStorage.removeItem("wikahon-board-v2");
            localStorage.removeItem("wikahon-board-v1");
            window.location.reload();
        }
        onBoardReset?.();
    };

    return {
        board,
        scope,
        hasBoardOverride,
        draftGrid,
        draftMode,
        draftAppearance,
        draftSpeech,
        draftAccess,
        draftColorSystem,
        pinInput,
        pinError,
        savedNotice,
        isAutomatic,
        estimatedPages,
        outOfBoundsTiles,
        setPinInput,
        changeScope,
        changeDraftMode,
        changeDraftGrid,
        changeDraftColorSystem,
        patchAppearance,
        patchSpeech,
        patchAccess,
        applyAllChanges,
        reflowTiles,
        savePin,
        removePin,
        resetEverything
    };
}