"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useBoardStore } from "@/store/BoardProvider";
import { useSentenceContext } from "./useBoardShellViewModel";
import { useEditContext } from "./useEditModeViewModel";
import { resolveTileForSystem, type Tile } from "@/lib/board";

export function useTileInteractionViewModel(
    tile: Tile | undefined,
    hidden: boolean,
    onEdit: () => void,
    onMove: (() => void) | undefined
) {
    const router = useRouter();
    const sentence = useSentenceContext();
    const edit = useEditContext();
    const config = useBoardStore(s => s.accessConfig);
    const colorSystem = useBoardStore(s => s.colorSystem);
    const colorSystemConfigs = useBoardStore(s => s.colorSystemConfigs);
    const boards = useBoardStore(s => s.boards);

    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const start = useRef<{ x: number; y: number } | null>(null);
    const held = useRef(false);

    const cancel = () => {
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = null;
    };

    useEffect(() => {
        return () => {
            if (timer.current)
                clearTimeout(timer.current);
        };
    }, []);

    const activate = () => {
        if (held.current) {
            held.current = false;
            return;
        }

        if (onMove) {
            onMove();
            return;
        }

        if (edit.state.isEditMode) {
            onEdit();
            return;
        }

        if (!tile || hidden)
            return;

        if (tile.kind === "folder") {
            const assignment =
                colorSystemConfigs[colorSystem]?.tileAssignments?.[tile.id];
            const resolved = resolveTileForSystem(
                tile,
                assignment,
                colorSystem,
                boards
            );
            const target = resolved.targetBoardId;
            if (target) {
                router.push(`/board/${encodeURIComponent(target)}`);
            }
        } else {
            sentence.actions.onTileActivate(tile);
        }
    };

    return {
        onClick: activate,
        onPointerDown: (e: React.PointerEvent) => {
            if (e.button !== 0)
                return;
            cancel();
            held.current = false;
            start.current = { x: e.clientX, y: e.clientY };

            if (config.longPressToEdit) {
                timer.current = setTimeout(() => {
                    held.current = true;
                    if (edit.state.isEditMode)
                        onEdit();
                    else
                        edit.actions.enter();
                }, config.holdDurationMs);
            }
        },
        onPointerMove: (e: React.PointerEvent) => {
            if (
                start.current &&
                Math.hypot(
                    e.clientX - start.current.x,
                    e.clientY - start.current.y
                ) > config.moveTolerancePx
            ) {
                cancel();
                held.current = true;
            }
        },
        onPointerUp: cancel,
        onPointerLeave: cancel,
        onPointerCancel: () => {
            cancel();
            held.current = true;
        },
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ")
                held.current = false;

            if (e.key === "F2") {
                e.preventDefault();
                if (edit.state.isEditMode)
                    onEdit();
                else
                    edit.actions.enter();
            }
        }
    };
}