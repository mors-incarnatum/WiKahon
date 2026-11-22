"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { isGuardianRole } from "@/models/auth";
import { useBoardStore } from "@/store/BoardProvider";

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

export function useEditModeViewModel() {
    const activeProfileId = useBoardStore(s => s.activeProfileId);
    const currentUser = useBoardStore(s => s.currentUser);

    const isGuardian = isGuardianRole(currentUser?.role);

    const [editTarget, setEditTarget] = useState<{ userId: string; profileId: string } | null>(null);
    const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isEditMode =
        isGuardian &&
        Boolean(currentUser) &&
        editTarget?.userId === currentUser?.id &&
        editTarget?.profileId === activeProfileId;

    const lockAll = useCallback(() => {
        setEditTarget(null);
    }, []);

    // A profile or account change ends editing, even if the previous target returns.
    useEffect(() => () => lockAll(), [currentUser?.id, activeProfileId, isGuardian, lockAll]);

    const resetInactivityTimer = useCallback(() => {
        if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
        if (isGuardian && isEditMode) {
            inactivityTimer.current = setTimeout(() => {
                lockAll();
            }, INACTIVITY_TIMEOUT_MS);
        }
    }, [isGuardian, isEditMode, lockAll]);

    useEffect(() => {
        resetInactivityTimer();
        return () => {
            if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
        };
    }, [resetInactivityTimer]);

    const enter = () => {
        if (!isGuardian || !currentUser) return;
        setEditTarget({ userId: currentUser.id, profileId: activeProfileId });
    };

    return {
        state: {
            isGuardian,
            isEditMode,
        },
        actions: {
            enter,
            toggle: () => {
                if (!isGuardian) return;
                if (isEditMode) {
                    lockAll();
                } else {
                    enter();
                }
            },
            lock: lockAll,
            touchActivity: resetInactivityTimer,
        },
    };
}

export const EditContext = createContext<ReturnType<typeof useEditModeViewModel> | null>(null);

export function useEditContext() {
    const vm = useContext(EditContext);
    if (!vm) throw new Error("Edit provider required");
    return vm;
}
