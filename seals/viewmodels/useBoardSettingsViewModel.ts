"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBoardSelector, useBoardStoreApi } from "@/store/BoardProvider";
import { clampGrid, inBounds, type GridConfig, type ColorSystemId } from "@/lib/board";
import { SpeechError, ttsService } from "@/services/tts/ttsService";
import { exportProfilePackage, validateAndPrepareImport } from "@/services/storage/backupService";
import { discardPreparedMedia, mediaRepository } from "@/services/storage/mediaRepository";
import { localProfileService } from "@/services/storage/localProfileService";
import { extractBoardData } from "@/store/useBoardStore";
import type { BoardData, FeatureFlags } from "@/models/boardData";
import { PROFILE_SCHEMA_VERSION } from "@/models/profile";
import { LOCAL_CHILD_SESSION, type ProvisionedChildAccount } from "@/models/auth";
import { cloudSyncService, type CloudUser } from "@/services/cloud/cloudSyncService";
import type { ProfileRow } from "@/models/supabase/database.types";
import {
    deleteChildAccountServerAction,
    listProvisionedChildAccountsServerAction,
    provisionChildAccountServerAction,
    removeChildProfileAccessServerAction,
    resetChildPasswordServerAction,
    updateChildAccountServerAction,
} from "@/app/actions/childAccounts";
import {
    validateChildPasswordResetInput,
    validateChildProvisionInput,
    validateChildUpdateInput,
    type ValidationFieldErrors,
} from "@/lib/validation";

export type SettingsTab = "layout" | "appearance" | "colorSystem" | "speech" | "access" | "profiles" | "experiments";

export interface OfflineReadiness {
    appShellCached: boolean;
    localStorageOk: boolean;
    mediaCount: number;
}

export interface LastCreatedChildInfo {
    name: string;
    username: string;
    profileName: string | null;
}

export function useBoardSettingsViewModel(boardId: string, initialTab: SettingsTab = "colorSystem") {
    const store = useBoardStoreApi();
    const router = useRouter();
    const {
        boards,
        global,
        globalMode,
        appearance,
        colorSystem,
        setColorSystem,
        resetBoardData,
        speech,
        access,
        featureFlags,
        currentUser,
        profiles,
        activeProfileId,
        activeProfileName,
        cloudProfileId,
        cloudRevision,
        dirty,
        localEditVersion,
        markCloudSynced,
        storageStatus,
        preReflowSnapshot,
        applyBoardSettings,
        setSpeech,
        setAccess,
        setFeatureFlags,
        reflow,
        rollbackReflow,
        switchProfile,
        createProfile,
        renameProfile,
        deleteProfile,
        importProfileDocument,
        offlineDesignatedProfiles,
        recoverableLegacyProfiles,
        setProfileOfflineDesignated,
        recoverLegacyProfile,
    } = useBoardSelector(s => ({
        boards: s.boards,
        global: s.gridConfig,
        globalMode: s.layoutMode ?? "manual",
        appearance: s.tileAppearance,
        colorSystem: s.colorSystem ?? "custom",
        setColorSystem: s.setColorSystem,
        resetBoardData: s.resetBoardData,
        speech: s.speechConfig,
        access: s.accessConfig,
        featureFlags: s.featureFlags,
        currentUser: s.currentUser,
        profiles: s.profiles,
        activeProfileId: s.activeProfileId,
        activeProfileName: s.activeProfileName,
        cloudProfileId: s.cloudProfileId,
        cloudRevision: s.cloudRevision,
        dirty: s.dirty,
        localEditVersion: s.localEditVersion,
        markCloudSynced: s.markCloudSynced,
        storageStatus: s.storageStatus,
        preReflowSnapshot: s.preReflowSnapshot,
        applyBoardSettings: s.applyBoardSettings,
        setSpeech: s.setSpeechConfig,
        setAccess: s.setAccessConfig,
        setFeatureFlags: s.setFeatureFlags,
        reflow: s.setGridConfigAndReflow,
        rollbackReflow: s.rollbackReflow,
        switchProfile: s.switchProfile,
        createProfile: s.createProfile,
        renameProfile: s.renameProfile,
        deleteProfile: s.deleteProfile,
        importProfileDocument: s.importProfileDocument,
        offlineDesignatedProfiles: s.offlineDesignatedProfiles ?? [],
        recoverableLegacyProfiles: s.recoverableLegacyProfiles ?? [],
        setProfileOfflineDesignated: s.setProfileOfflineDesignated,
        recoverLegacyProfile: s.recoverLegacyProfile,
    }));

    const [draftGeneration, setDraftGeneration] = useState(0);
    const draftKey = `${activeProfileId}:${colorSystem}:${draftGeneration}`;
    const [editorDrafts, setEditorDrafts] = useState(() => ({
        key: draftKey,
        scope: "global",
        selected: boards[boardId] ? boardId : "home",
        draft: global,
        draftMode: globalMode,
        draftAppearance: appearance,
        useGlobal: false,
        saved: false,
    }));
    const activeEditorDrafts = useMemo(() => {
        if (editorDrafts.key === draftKey) {
            if (boards[editorDrafts.selected]) {
                return editorDrafts;
            }
            return {
                ...editorDrafts,
                selected: "home",
                draft: editorDrafts.scope === "global" ? global : (boards.home?.gridOverride ?? global),
                draftMode: editorDrafts.scope === "global" ? globalMode : (boards.home?.layoutModeOverride ?? globalMode),
            };
        }
        const nextSelected = boards[editorDrafts.selected] ? editorDrafts.selected : "home";
        const targetBoard = boards[nextSelected];
        return {
            key: draftKey,
            scope: editorDrafts.scope,
            selected: nextSelected,
            draft: editorDrafts.scope === "global" ? global : (targetBoard?.gridOverride ?? global),
            draftMode: editorDrafts.scope === "global" ? globalMode : (targetBoard?.layoutModeOverride ?? globalMode),
            draftAppearance: appearance,
            useGlobal: false,
            saved: false,
        };
    }, [appearance, boards, draftKey, editorDrafts, global, globalMode]);

    const { scope, selected, draft, draftMode, draftAppearance, useGlobal, saved } = activeEditorDrafts;

    const [tab, setTab] = useState<SettingsTab>(initialTab);
    const [colorDraft, setColorDraft] = useState({
        profileId: activeProfileId,
        system: colorSystem,
        mode: appearance.colorMode,
        saved: false,
    });
    const currentColorDraft = colorDraft.profileId === activeProfileId
        ? colorDraft
        : { profileId: activeProfileId, system: colorSystem, mode: appearance.colorMode, saved: false };

    const [speechPreviewError, setSpeechPreviewError] = useState("");
    const [offlineSpeechStatus, setOfflineSpeechStatus] = useState("");
    const [offlineSpeechChecking, setOfflineSpeechChecking] = useState(false);

    const [newProfileName, setNewProfileName] = useState("");
    const renameKey = `${activeProfileId}:${activeProfileName}`;
    const [renameDraftState, setRenameDraftState] = useState({ key: renameKey, value: activeProfileName });
    const renameDraft = renameDraftState.key === renameKey ? renameDraftState.value : activeProfileName;
    const [confirmDeleteProfileId, setConfirmDeleteProfileId] = useState<string | null>(null);
    const activeConfirmDeleteProfileId = confirmDeleteProfileId === activeProfileId ? confirmDeleteProfileId : null;
    const [backupStatus, setBackupStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [recoveryStatus, setRecoveryStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [recoveringId, setRecoveringId] = useState<string | null>(null);
    const isActiveProfileOfflineDesignated = offlineDesignatedProfiles.some(
        p => p.localProfileId === activeProfileId,
    );
    const sessionCloudUser = useMemo<CloudUser | null>(
        () =>
            currentUser && currentUser.id !== LOCAL_CHILD_SESSION.user.id
                ? { id: currentUser.id, email: currentUser.email }
                : null,
        [currentUser],
    );
    const [cloudProfiles, setCloudProfiles] = useState<ProfileRow[]>([]);
    const [cloudStatus, setCloudStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [cloudBusy, setCloudBusy] = useState(false);
    const [confirmDeleteCloudProfileId, setConfirmDeleteCloudProfileId] = useState<string | null>(null);
    const [staleConflictProfileId, setStaleConflictProfileId] = useState<string | null>(null);

    const [provisionedChildren, setProvisionedChildren] = useState<ProvisionedChildAccount[]>([]);
    const [childLoading, setChildLoading] = useState(false);
    const [childProvisioningError, setChildProvisioningError] = useState<string | null>(null);
    const [childName, setChildNameState] = useState("");
    const [childUsername, setChildUsernameState] = useState("");
    const [childEmail, setChildEmailState] = useState("");
    const [childPassword, setChildPasswordState] = useState("");
    const [childConfirmPassword, setChildConfirmPasswordState] = useState("");
    const [selectedChildProfileId, setSelectedChildProfileIdState] = useState("");
    const [childFieldErrors, setChildFieldErrors] = useState<ValidationFieldErrors>({});
    const [childStatus, setChildStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [childBusy, setChildBusy] = useState(false);
    const [lastCreatedChild, setLastCreatedChild] = useState<LastCreatedChildInfo | null>(null);
    const [childCopyFeedback, setChildCopyFeedback] = useState<string | null>(null);
    const copyFeedbackTimerRef = useRef<number | null>(null);

    const [editingChildId, setEditingChildId] = useState<string | null>(null);
    const [editChildName, setEditChildNameState] = useState("");
    const [editChildProfileId, setEditChildProfileIdState] = useState("");
    const [editChildFieldErrors, setEditChildFieldErrors] = useState<ValidationFieldErrors>({});

    const [resettingChildId, setResettingChildId] = useState<string | null>(null);
    const [resetChildPassword, setResetChildPasswordState] = useState("");
    const [resetChildConfirmPassword, setResetChildConfirmPasswordState] = useState("");
    const [resetChildFieldErrors, setResetChildFieldErrors] = useState<ValidationFieldErrors>({});

    const [confirmDeleteChildId, setConfirmDeleteChildId] = useState<string | null>(null);

    const ownedCloudProfiles = useMemo(
        () => (sessionCloudUser ? cloudProfiles.filter(cp => cp.owner_id === sessionCloudUser.id) : []),
        [cloudProfiles, sessionCloudUser],
    );
    const childProfileId = useMemo(
        () =>
            selectedChildProfileId && ownedCloudProfiles.some(cp => cp.id === selectedChildProfileId)
                ? selectedChildProfileId
                : "",
        [ownedCloudProfiles, selectedChildProfileId],
    );
    const matchingCloudProfile = useMemo(
        () => (cloudProfileId ? cloudProfiles.find(cp => cp.id === cloudProfileId) ?? null : null),
        [cloudProfileId, cloudProfiles],
    );
    const cloudConflict = Boolean(
        (dirty && matchingCloudProfile && (matchingCloudProfile.revision ?? 1) > (cloudRevision ?? 0)) ||
        staleConflictProfileId === activeProfileId,
    );
    const [checkedOfflineProfileId, setCheckedOfflineProfileId] = useState<string | null>(null);
    const [offlineReadiness, setOfflineReadiness] = useState<OfflineReadiness>({
        appShellCached: false,
        localStorageOk: storageStatus === "ok",
        mediaCount: 0,
    });

    useEffect(() => () => {
        if (copyFeedbackTimerRef.current !== null) {
            window.clearTimeout(copyFeedbackTimerRef.current);
        }
    }, []);

    const refreshOfflineReadiness = useCallback(async () => {
        const media = await mediaRepository.listProfileMedia(activeProfileId);
        let appShellCached = false;
        if (typeof caches !== "undefined" && "serviceWorker" in navigator) {
            try {
                const registration = await navigator.serviceWorker.getRegistration("/board");
                const route = registration?.active?.state === "activated" && await caches.match("/board", { cacheName: "wikahon-shell-v5" });
                if (route) {
                    const html = await route.text();
                    const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match => match[1].replace(/&amp;/g, "&"));
                    appShellCached = assets.length > 0 && (await Promise.all(
                        assets.map(asset => caches.match(asset, { cacheName: "wikahon-shell-v5" })),
                    )).every(Boolean);
                }
            } catch {
                appShellCached = false;
            }
        }
        setOfflineReadiness({
            appShellCached,
            localStorageOk: storageStatus === "ok",
            mediaCount: media.length,
        });
        setCheckedOfflineProfileId(activeProfileId);
        if (cloudSyncService.isConfigured() && sessionCloudUser) {
            setChildLoading(true);
            try {
                const [res, childRes] = await Promise.all([
                    cloudSyncService.listCloudProfiles(sessionCloudUser.id),
                    listProvisionedChildAccountsServerAction().catch((err: unknown) => ({
                        ok: false,
                        children: [] as ProvisionedChildAccount[],
                        error: err instanceof Error ? err.message : "Could not load child accounts.",
                    })),
                ]);
                setCloudProfiles(res.profiles);
                if (childRes.ok) {
                    setProvisionedChildren(childRes.children);
                    setChildProvisioningError(null);
                } else {
                    setProvisionedChildren([]);
                    setChildProvisioningError(childRes.error ?? "Could not load child accounts.");
                }
            } finally {
                setChildLoading(false);
            }
        } else {
            setCloudProfiles([]);
            setProvisionedChildren([]);
            setChildProvisioningError(null);
            setChildLoading(false);
        }
    }, [activeProfileId, sessionCloudUser, storageStatus]);

    useEffect(() => {
        if (tab !== "profiles") return;
        let active = true;
        void Promise.resolve().then(() => {
            if (active) {
                void refreshOfflineReadiness();
            }
        });
        return () => {
            active = false;
        };
    }, [tab, refreshOfflineReadiness]);

    const clearChildFieldError = (...fields: string[]) => {
        if (childStatus) setChildStatus(null);
        if (fields.some(field => Boolean(childFieldErrors[field]))) {
            setChildFieldErrors(prev => {
                const next = { ...prev };
                for (const field of fields) {
                    delete next[field];
                }
                return next;
            });
        }
    };

    const clearEditChildFieldError = (...fields: string[]) => {
        if (fields.some(field => Boolean(editChildFieldErrors[field]))) {
            setEditChildFieldErrors(prev => {
                const next = { ...prev };
                for (const field of fields) {
                    delete next[field];
                }
                return next;
            });
        }
    };

    const clearResetChildFieldError = (...fields: string[]) => {
        if (fields.some(field => Boolean(resetChildFieldErrors[field]))) {
            setResetChildFieldErrors(prev => {
                const next = { ...prev };
                for (const field of fields) {
                    delete next[field];
                }
                return next;
            });
        }
    };

    const affectedBoards = Object.values(boards).filter(b =>
        scope === "global" ? !b.gridOverride : b.id === selected,
    );
    const overflowDetails = affectedBoards
        .map(b => ({
            id: b.id,
            name: b.name,
            count: b.pages.reduce(
                (m, p) => m + Object.keys(p.cells).filter(k => !inBounds(k, draft)).length,
                0,
            ),
        }))
        .filter(item => item.count > 0);
    const overflow = overflowDetails.reduce((n, item) => n + item.count, 0);

    const currentBoardData = () => extractBoardData(store.getState());

    const returnHomeIfCatalogClosed = () => {
        if (boardId !== "home" && !store.getState().boards[boardId]) router.replace("/board");
    };

    const resetTileDimensions = (appearanceValue: BoardData["tileAppearance"]) => ({
        ...appearanceValue,
        tileWidth: 50,
        tileHeight: 50,
    });

    const resetDrafts = (nextScope: string, nextSelected: string) => {
        const board = boards[nextSelected];
        setEditorDrafts({
            key: draftKey,
            scope: nextScope,
            selected: nextSelected,
            draft: nextScope === "global" ? global : board?.gridOverride ?? global,
            draftMode: nextScope === "global" ? globalMode : board?.layoutModeOverride ?? globalMode,
            draftAppearance: appearance,
            useGlobal: false,
            saved: false,
        });
    };

    const exportBackupJson = async (): Promise<string> => {
        const pkg = await exportProfilePackage(
            activeProfileId,
            activeProfileName,
            currentBoardData(),
        );
        const json = JSON.stringify(pkg, null, 2);
        setBackupStatus({ ok: true, message: `Exported backup (${pkg.manifest.length} media files).` });
        return json;
    };

    const importBackupJson = async (rawJson: string) => {
        if (!sessionCloudUser) return false;
        const res = await validateAndPrepareImport(rawJson);
        if (!res.ok) {
            setBackupStatus({ ok: false, message: res.error });
            return false;
        }
        try { importProfileDocument({ ...res.doc, ownerUserId: sessionCloudUser.id }); } catch (error) {
            await discardPreparedMedia(res.doc.localProfileId);
            setBackupStatus({ ok: false, message: error instanceof Error ? error.message : "Could not save imported profile." });
            return false;
        }
        setBackupStatus({ ok: true, message: `Imported "${res.doc.name}" as a new local profile.` });
        return true;
    };

    const downloadBackupFile = async () => {
        let json: string;
        try { json = await exportBackupJson(); } catch (error) {
            setBackupStatus({ ok: false, message: error instanceof Error ? error.message : "Backup export failed." });
            return;
        }
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        try {
            const link = document.createElement("a");
            link.href = url;
            link.download = `wikahon-backup-${activeProfileId}.json`;
            link.click();
        } finally {
            URL.revokeObjectURL(url);
        }
    };

    const importBackupFile = async (file: File | null | undefined) => {
        if (!file) return false;
        return importBackupJson(await file.text());
    };

    const refreshChildAccounts = async () => {
        const childRes = await listProvisionedChildAccountsServerAction().catch((err: unknown) => ({
            ok: false,
            children: [] as ProvisionedChildAccount[],
            error: err instanceof Error ? err.message : "Could not load child accounts.",
        }));
        if (childRes.ok) {
            setProvisionedChildren(childRes.children);
            setChildProvisioningError(null);
            return true;
        }
        setChildProvisioningError(childRes.error ?? "Could not load child accounts.");
        return false;
    };

    return {
        state: {
            tab,
            boards,
            scope,
            selected,
            draft,
            draftMode,
            appearance: draftAppearance,
            draftColorSystem: currentColorDraft.system,
            draftColorMode: currentColorDraft.mode,
            colorSaved: currentColorDraft.saved,
            speech,
            access,
            featureFlags,
            saved,
            useGlobal,
            overflow,
            overflowDetails,
            canRollbackReflow: Boolean(preReflowSnapshot),
            preview: Array.from({ length: draft.rows * draft.cols }),
            speechPreviewError,
            profiles,
            activeProfileId,
            activeProfileName,
            renameDraft,
            confirmDeleteProfileId: activeConfirmDeleteProfileId,
            cloudProfileId,
            cloudRevision,
            dirty,
            localEditVersion,
            cloudConflict,
            conflictProfile: matchingCloudProfile,
            cloudConfigured: cloudSyncService.isConfigured(),
            cloudUser: sessionCloudUser,
            cloudProfiles: sessionCloudUser ? cloudProfiles : [],
            ownedCloudProfiles,
            cloudStatus,
            cloudBusy,
            confirmDeleteCloudProfileId,
            provisionedChildren: sessionCloudUser ? provisionedChildren : [],
            childLoading,
            childProvisioningError,
            childName,
            childUsername,
            childEmail,
            childPassword,
            childConfirmPassword,
            childProfileId,
            childFieldErrors,
            childStatus,
            childBusy,
            lastCreatedChild,
            childCopyFeedback,
            editingChildId,
            editChildName,
            editChildProfileId,
            editChildFieldErrors,
            resettingChildId,
            resetChildPassword,
            resetChildConfirmPassword,
            resetChildFieldErrors,
            confirmDeleteChildId,
            newProfileName,
            backupStatus,
            offlineReadiness,
            offlineReadinessChecked: checkedOfflineProfileId === activeProfileId,
            offlineSpeechStatus,
            offlineSpeechChecking,
            offlineDesignatedProfiles,
            isActiveProfileOfflineDesignated,
            recoverableLegacyProfiles,
            recoveryStatus,
            recoveringId,
        },
        actions: {
            setTab: (nextTab: SettingsTab) => {
                setTab(nextTab);
            },
            setScope: (value: string) => {
                resetDrafts(value, selected);
            },
            selectBoard: (id: string) => {
                resetDrafts(scope, id);
            },
            setDraft: (grid: GridConfig) => {
                const nextGrid = clampGrid(grid);
                setEditorDrafts({
                    ...activeEditorDrafts,
                    draft: nextGrid,
                    draftAppearance: resetTileDimensions(activeEditorDrafts.draftAppearance),
                    saved: false,
                });
            },
            setDraftMode: (mode: "manual" | "automatic") => {
                setEditorDrafts({
                    ...activeEditorDrafts,
                    draftMode: mode,
                    draftAppearance:
                        mode !== draftMode
                            ? resetTileDimensions(activeEditorDrafts.draftAppearance)
                            : activeEditorDrafts.draftAppearance,
                    saved: false,
                });
            },
            swapRowsCols: () => {
                setEditorDrafts({
                    ...activeEditorDrafts,
                    draft: { rows: draft.cols, cols: draft.rows },
                    draftAppearance: resetTileDimensions(activeEditorDrafts.draftAppearance),
                    saved: false,
                });
            },
            setAppearance: (value: Partial<BoardData["tileAppearance"]> | BoardData["tileAppearance"]) => {
                setEditorDrafts({
                    ...activeEditorDrafts,
                    draftAppearance: { ...activeEditorDrafts.draftAppearance, ...value },
                    saved: false,
                });
            },
            setUseGlobal: (value: boolean) => {
                setEditorDrafts({
                    ...activeEditorDrafts,
                    useGlobal: value,
                    saved: false,
                });
            },
            apply: () => {
                applyBoardSettings(
                    draft,
                    draftAppearance,
                    draftMode,
                    scope === "global" ? undefined : selected,
                    scope !== "global" && useGlobal,
                );
                setEditorDrafts({
                    ...activeEditorDrafts,
                    saved: true,
                });
            },
            reflow: () => {
                setEditorDrafts({
                    ...activeEditorDrafts,
                    saved: reflow(draft, scope === "global" ? undefined : selected),
                });
            },
            rollbackReflow: () => {
                if (rollbackReflow() && preReflowSnapshot) {
                    const previousBoard = preReflowSnapshot.boards.find(board => board.boardId === selected);
                    setEditorDrafts({
                        ...activeEditorDrafts,
                        draft: scope === "global"
                            ? preReflowSnapshot.previousGlobalGrid
                            : previousBoard?.previousGrid ?? preReflowSnapshot.previousGlobalGrid,
                        saved: false,
                    });
                }
            },
            useGlobal: () => {
                setEditorDrafts({
                    ...activeEditorDrafts,
                    useGlobal: true,
                    saved: false,
                });
            },
            setDraftColorSystem: (value: ColorSystemId) => setColorDraft({ ...currentColorDraft, system: value, saved: false }),
            setDraftColorMode: (value: BoardData["tileAppearance"]["colorMode"]) => setColorDraft({ ...currentColorDraft, mode: value, saved: false }),
            applyColorSettings: () => {
                const savedColor = setColorSystem(currentColorDraft.system, currentColorDraft.mode);
                setColorDraft({ ...currentColorDraft, saved: savedColor });
                if (savedColor) returnHomeIfCatalogClosed();
            },
            resetBoardData: () => {
                const ok = resetBoardData();
                if (ok) {
                    setDraftGeneration(g => g + 1);
                    setColorDraft({ profileId: activeProfileId, system: "custom", mode: "catalog", saved: false });
                    returnHomeIfCatalogClosed();
                }
                return ok;
            },
            setSpeech,
            checkOfflineSpeech: async () => {
                if (navigator.onLine !== false) {
                    setOfflineSpeechStatus("Disconnect this device from the internet, then preview offline speech.");
                    return;
                }
                setOfflineSpeechChecking(true);
                setOfflineSpeechStatus("");
                try {
                    await ttsService.speak({ text: "Kumusta, gusto ko ng tubig", rate: speech.rate ?? 1, volume: speech.volume });
                    setOfflineSpeechStatus(navigator.onLine === false
                        ? "Speech preview completed while this device was offline. Confirm you heard it."
                        : "The connection changed during the preview. Disconnect and try again.");
                } catch (error) {
                    setOfflineSpeechStatus(error instanceof SpeechError && error.kind === "cancelled"
                        ? "Speech preview was cancelled. Try again while offline."
                        : "Offline speech could not be played. Check your device voice settings and try again.");
                } finally {
                    setOfflineSpeechChecking(false);
                }
            },
            setAccess,
            setFeatureFlags: (patch: Partial<FeatureFlags>) => setFeatureFlags(patch),
            previewSpeech: async () => {
                setSpeechPreviewError("");
                try {
                    await ttsService.speak({
                        text: "Kumusta, gusto ko ng tubig",
                        rate: speech.rate ?? 1,
                        volume: speech.volume,
                    });
                } catch (e) {
                    if (!(e instanceof SpeechError && e.kind === "cancelled")) {
                        setSpeechPreviewError(e instanceof Error ? e.message : "Speech preview failed.");
                    }
                }
            },
            setNewProfileName,
            setRenameDraft: (value: string) => setRenameDraftState({ key: renameKey, value }),
            saveProfileRename: () => {
                const trimmed = renameDraft.trim();
                if (!trimmed || trimmed === activeProfileName) return;
                renameProfile(activeProfileId, trimmed);
                setRenameDraftState({ key: `${activeProfileId}:${trimmed}`, value: trimmed });
            },
            switchProfile,
            createProfile: () => {
                if (!newProfileName.trim()) return;
                createProfile(newProfileName.trim());
                setNewProfileName("");
            },
            renameActiveProfile: (name: string) => renameProfile(activeProfileId, name),
            deleteProfile,
            requestDeleteProfile: (profileId: string) => {
                setConfirmDeleteProfileId(profileId);
            },
            cancelDeleteProfile: () => {
                setConfirmDeleteProfileId(null);
            },
            confirmDeleteProfile: () => {
                if (!confirmDeleteProfileId) return;
                deleteProfile(confirmDeleteProfileId);
                setConfirmDeleteProfileId(null);
            },
            toggleActiveProfileOfflineDesignated: (enabled: boolean) =>
                setProfileOfflineDesignated(activeProfileId, enabled),
            recoverLegacyBoard: async (legacyProfileId: string) => {
                setRecoveringId(legacyProfileId);
                try {
                    const res = await recoverLegacyProfile(legacyProfileId);
                    setRecoveryStatus({
                        ok: res.ok,
                        message: res.ok
                            ? "Recovered legacy board and photos into your account."
                            : (res.error ?? "Could not recover legacy board."),
                    });
                    await refreshOfflineReadiness();
                } finally {
                    setRecoveringId(null);
                }
            },
            exportBackupJson,
            importBackupJson,
            downloadBackupFile,
            importBackupFile,
            refreshOfflineReadiness,
            publishActiveProfile: async () => {
                if (!sessionCloudUser) return;
                setCloudBusy(true);
                setCloudStatus(null);
                const editVersionAtStart = localEditVersion;
                try {
                    const res = await cloudSyncService.publishProfile({
                        userId: sessionCloudUser.id,
                        localProfileId: activeProfileId,
                        profileName: activeProfileName,
                        cloudProfileId,
                        expectedRevision: cloudRevision,
                        boardData: currentBoardData(),
                    });
                    if (!res.ok || !res.cloudProfileId || !res.revision) {
                        if (!res.ok && res.isConflict) {
                            setStaleConflictProfileId(activeProfileId);
                            const listRes = await cloudSyncService.listCloudProfiles(sessionCloudUser.id);
                            if (listRes.ok) setCloudProfiles(listRes.profiles);
                        }
                        setCloudStatus({ ok: false, message: res.error ?? "Publish failed." });
                        return;
                    }
                    setStaleConflictProfileId(null);
                    markCloudSynced(activeProfileId, res.cloudProfileId, res.revision, editVersionAtStart);
                    const listRes = await cloudSyncService.listCloudProfiles(sessionCloudUser.id);
                    if (listRes.ok) setCloudProfiles(listRes.profiles);
                    setCloudStatus({ ok: true, message: `Published to cloud (revision ${res.revision}).` });
                } finally {
                    setCloudBusy(false);
                }
            },
            downloadCloudProfile: async (profile: ProfileRow) => {
                if (!sessionCloudUser) return;
                setCloudBusy(true);
                setCloudStatus(null);
                try {
                    const res = await cloudSyncService.downloadAsLocalCopy(profile, sessionCloudUser.id);
                    if (!res.ok || !res.doc) {
                        setCloudStatus({ ok: false, message: res.error ?? "Download failed." });
                        return;
                    }
                    const docToImport =
                        cloudProfileId === profile.id && dirty
                            ? {
                                  ...res.doc,
                                  name: `${res.doc.name} (Cloud rev ${res.doc.cloudRevision ?? 1})`,
                              }
                            : res.doc;
                    try { importProfileDocument(docToImport); } catch (error) {
                        await discardPreparedMedia(res.doc.localProfileId);
                        setCloudStatus({ ok: false, message: error instanceof Error ? error.message : "Could not save downloaded profile." });
                        return;
                    }
                    setStaleConflictProfileId(null);
                    setCloudStatus({
                        ok: true,
                        message: `Downloaded "${docToImport.name}" as a separate local profile. Your current local draft was kept intact.`,
                    });
                } finally {
                    setCloudBusy(false);
                }
            },
            requestDeleteCloudProfile: (profileId: string) => {
                setConfirmDeleteCloudProfileId(profileId);
            },
            cancelDeleteCloudProfile: () => {
                setConfirmDeleteCloudProfileId(null);
            },
            deleteCloudProfile: async (profile: ProfileRow) => {
                if (!sessionCloudUser || cloudBusy) return;
                setCloudBusy(true);
                setCloudStatus(null);
                try {
                    const res = await cloudSyncService.deleteCloudProfile(profile.id, sessionCloudUser.id);
                    if (!res.ok) {
                        setCloudStatus({ ok: false, message: res.error ?? "Could not delete cloud profile." });
                        return;
                    }
                    setConfirmDeleteCloudProfileId(null);
                    setStaleConflictProfileId(null);

                    const storeState = store.getState();
                    const linkedLocalProfiles = storeState.profiles.filter(p => p.cloudProfileId === profile.id);
                    if (linkedLocalProfiles.length > 0) {
                        for (const linked of linkedLocalProfiles) {
                            const loaded = localProfileService.loadProfileDocument(linked.localProfileId, sessionCloudUser.id);
                            if (loaded.doc) {
                                localProfileService.saveProfileDocument({
                                    ...loaded.doc,
                                    cloudProfileId: null,
                                    cloudRevision: null,
                                    dirty: true,
                                    localEditVersion: (loaded.doc.localEditVersion ?? 0) + 1,
                                });
                            }
                        }
                        localProfileService.saveActiveIndex(
                            {
                                schemaVersion: PROFILE_SCHEMA_VERSION,
                                activeProfileId: storeState.activeProfileId,
                                profiles: storeState.profiles.map(p =>
                                    p.cloudProfileId === profile.id ? { ...p, cloudProfileId: null } : p,
                                ),
                            },
                            sessionCloudUser.id,
                        );
                        storeState.reloadLocalProfiles();
                    }

                    const listRes = await cloudSyncService.listCloudProfiles(sessionCloudUser.id);
                    if (listRes.ok) {
                        setCloudProfiles(listRes.profiles);
                    } else {
                        setCloudProfiles(prev => prev.filter(cp => cp.id !== profile.id));
                    }
                    await refreshChildAccounts();
                    setCloudStatus({ ok: true, message: `Deleted "${profile.name}" from the cloud.` });
                } finally {
                    setCloudBusy(false);
                }
            },
            setChildName: (value: string) => {
                setChildNameState(value);
                clearChildFieldError("name");
            },
            setChildUsername: (value: string) => {
                setChildUsernameState(value);
                clearChildFieldError("username");
            },
            setChildEmail: (value: string) => {
                setChildEmailState(value);
                clearChildFieldError("email");
            },
            setChildPassword: (value: string) => {
                setChildPasswordState(value);
                clearChildFieldError("password");
            },
            setChildConfirmPassword: (value: string) => {
                setChildConfirmPasswordState(value);
                clearChildFieldError("confirmPassword");
            },
            setChildProfileId: (value: string) => {
                setSelectedChildProfileIdState(value);
                clearChildFieldError("profileId");
            },
            clearChildProvisionDraft: () => {
                setChildNameState("");
                setChildUsernameState("");
                setChildEmailState("");
                setChildPasswordState("");
                setChildConfirmPasswordState("");
                setSelectedChildProfileIdState("");
                setChildFieldErrors({});
                setChildStatus(previous => previous?.ok ? previous : null);
            },
            provisionChildAccount: async () => {
                if (!sessionCloudUser || childBusy) return false;
                setChildStatus(null);
                setChildFieldErrors({});

                const validation = validateChildProvisionInput({
                    name: childName,
                    username: childUsername,
                    email: childEmail,
                    password: childPassword,
                    confirmPassword: childConfirmPassword,
                    profileId: childProfileId,
                });
                if (!validation.ok) {
                    setChildFieldErrors(validation.fieldErrors);
                    setChildStatus({ ok: false, message: validation.error });
                    return false;
                }

                setChildBusy(true);
                try {
                    const res = await provisionChildAccountServerAction(validation.data);
                    if (!res.ok || !res.child) {
                        setChildFieldErrors(res.fieldErrors ?? {});
                        setChildStatus({
                            ok: false,
                            message: res.error ?? "Could not create child account.",
                        });
                        return false;
                    }

                    const createdChild = res.child;
                    setChildNameState("");
                    setChildUsernameState("");
                    setChildEmailState("");
                    setChildPasswordState("");
                    setChildConfirmPasswordState("");
                    setSelectedChildProfileIdState("");
                    setChildFieldErrors({});
                    setChildCopyFeedback(null);
                    setLastCreatedChild({
                        name: createdChild.name,
                        username: createdChild.username,
                        profileName: createdChild.profileName,
                    });
                    setChildStatus({
                        ok: true,
                        message: createdChild.profileName
                            ? `Created child account for ${createdChild.name} (username: "${createdChild.username}") linked to "${createdChild.profileName}". They can sign in on the login screen with their username and password.`
                            : `Created child account for ${createdChild.name} (username: "${createdChild.username}") with no board assigned yet. You can assign a cloud board anytime below.`,
                    });

                    const refreshed = await refreshChildAccounts();
                    if (!refreshed) {
                        setProvisionedChildren(prev => [...prev, createdChild]);
                    }
                    return true;
                } catch (err) {
                    setChildStatus({
                        ok: false,
                        message: err instanceof Error ? err.message : "Could not create child account.",
                    });
                    return false;
                } finally {
                    setChildBusy(false);
                }
            },
            copyChildSignInInfo: async () => {
                if (!lastCreatedChild) return;
                const summary = lastCreatedChild.profileName
                    ? `Username: ${lastCreatedChild.username}\nBoard: ${lastCreatedChild.profileName}`
                    : `Username: ${lastCreatedChild.username}`;
                try {
                    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(summary);
                        setChildCopyFeedback("Copied username & sign-in info.");
                    } else {
                        setChildCopyFeedback(`Username: ${lastCreatedChild.username}`);
                    }
                } catch {
                    setChildCopyFeedback(`Username: ${lastCreatedChild.username}`);
                }
                if (copyFeedbackTimerRef.current !== null) {
                    window.clearTimeout(copyFeedbackTimerRef.current);
                }
                copyFeedbackTimerRef.current = window.setTimeout(() => {
                    setChildCopyFeedback(null);
                    copyFeedbackTimerRef.current = null;
                }, 2500);
            },
            startEditChild: (child: ProvisionedChildAccount) => {
                setChildStatus(null);
                setEditChildFieldErrors({});
                setResettingChildId(null);
                setConfirmDeleteChildId(null);
                setEditingChildId(child.userId);
                setEditChildNameState(child.name);
                setEditChildProfileIdState(child.profileId ?? "");
            },
            cancelEditChild: () => {
                setEditingChildId(null);
                setEditChildNameState("");
                setEditChildProfileIdState("");
                setEditChildFieldErrors({});
            },
            setEditChildName: (value: string) => {
                setEditChildNameState(value);
                clearEditChildFieldError("name");
            },
            setEditChildProfileId: (value: string) => {
                setEditChildProfileIdState(value);
                clearEditChildFieldError("profileId");
            },
            saveChildEdit: async () => {
                if (!sessionCloudUser || !editingChildId || childBusy) return;
                setChildStatus(null);
                setEditChildFieldErrors({});

                const validation = validateChildUpdateInput({
                    childUserId: editingChildId,
                    name: editChildName,
                    profileId: editChildProfileId,
                });
                if (!validation.ok) {
                    setEditChildFieldErrors(validation.fieldErrors);
                    setChildStatus({ ok: false, message: validation.error });
                    return;
                }

                setChildBusy(true);
                try {
                    const res = await updateChildAccountServerAction(validation.data);
                    if (!res.ok || !res.child) {
                        setEditChildFieldErrors(res.fieldErrors ?? {});
                        setChildStatus({
                            ok: false,
                            message: res.error ?? "Could not update child account.",
                        });
                        return;
                    }
                    const updatedChild = res.child;
                    setProvisionedChildren(prev =>
                        prev.map(c => (c.userId === updatedChild.userId ? updatedChild : c)),
                    );
                    setEditingChildId(null);
                    setEditChildNameState("");
                    setEditChildProfileIdState("");
                    setEditChildFieldErrors({});
                    setChildStatus({
                        ok: true,
                        message: updatedChild.profileName
                            ? `Updated ${updatedChild.name} (@${updatedChild.username}) — assigned to "${updatedChild.profileName}".`
                            : `Updated ${updatedChild.name} (@${updatedChild.username}) — no board assigned.`,
                    });
                } catch (err) {
                    setChildStatus({
                        ok: false,
                        message: err instanceof Error ? err.message : "Could not update child account.",
                    });
                } finally {
                    setChildBusy(false);
                }
            },
            startResetChildPassword: (childUserId: string) => {
                setChildStatus(null);
                setResetChildFieldErrors({});
                setEditingChildId(null);
                setConfirmDeleteChildId(null);
                setResettingChildId(childUserId);
                setResetChildPasswordState("");
                setResetChildConfirmPasswordState("");
            },
            cancelResetChildPassword: () => {
                setResettingChildId(null);
                setResetChildPasswordState("");
                setResetChildConfirmPasswordState("");
                setResetChildFieldErrors({});
            },
            setResetChildPassword: (value: string) => {
                setResetChildPasswordState(value);
                clearResetChildFieldError("password");
            },
            setResetChildConfirmPassword: (value: string) => {
                setResetChildConfirmPasswordState(value);
                clearResetChildFieldError("confirmPassword");
            },
            submitChildPasswordReset: async () => {
                if (!sessionCloudUser || !resettingChildId || childBusy) return;
                setChildStatus(null);
                setResetChildFieldErrors({});

                const validation = validateChildPasswordResetInput({
                    childUserId: resettingChildId,
                    password: resetChildPassword,
                    confirmPassword: resetChildConfirmPassword,
                });
                if (!validation.ok) {
                    setResetChildFieldErrors(validation.fieldErrors);
                    setChildStatus({ ok: false, message: validation.error });
                    return;
                }

                setChildBusy(true);
                try {
                    const res = await resetChildPasswordServerAction(validation.data);
                    if (!res.ok) {
                        setResetChildFieldErrors(res.fieldErrors ?? {});
                        setChildStatus({
                            ok: false,
                            message: res.error ?? "Could not reset child password.",
                        });
                        return;
                    }
                    const target = provisionedChildren.find(c => c.userId === resettingChildId);
                    setResettingChildId(null);
                    setResetChildPasswordState("");
                    setResetChildConfirmPasswordState("");
                    setResetChildFieldErrors({});
                    setChildStatus({
                        ok: true,
                        message: target
                            ? `Updated password for ${target.name} (@${target.username}).`
                            : "Updated child account password.",
                    });
                } catch (err) {
                    setChildStatus({
                        ok: false,
                        message: err instanceof Error ? err.message : "Could not reset child password.",
                    });
                } finally {
                    setChildBusy(false);
                }
            },
            removeChildProfileAccess: async (profileId: string, childUserId: string) => {
                if (!sessionCloudUser || childBusy) return false;
                setChildStatus(null);
                setChildBusy(true);
                try {
                    const res = await removeChildProfileAccessServerAction({
                        profileId,
                        childUserId,
                    });
                    if (!res.ok) {
                        setChildStatus({
                            ok: false,
                            message: res.error ?? "Could not unassign board.",
                        });
                        return false;
                    }
                    setProvisionedChildren(prev =>
                        prev.map(c =>
                            c.userId === childUserId && c.profileId === profileId
                                ? { ...c, profileId: null, profileName: null }
                                : c,
                        ),
                    );
                    setChildStatus({
                        ok: true,
                        message: "Unassigned board from child account. The account remains active.",
                    });
                    return true;
                } catch (err) {
                    setChildStatus({
                        ok: false,
                        message: err instanceof Error ? err.message : "Could not unassign board.",
                    });
                    return false;
                } finally {
                    setChildBusy(false);
                }
            },
            requestDeleteChild: (childUserId: string) => {
                setChildStatus(null);
                setEditingChildId(null);
                setResettingChildId(null);
                setConfirmDeleteChildId(childUserId);
            },
            cancelDeleteChild: () => {
                setConfirmDeleteChildId(null);
            },
            confirmDeleteChild: async () => {
                if (!sessionCloudUser || !confirmDeleteChildId || childBusy) return;
                setChildStatus(null);
                setChildBusy(true);
                try {
                    const targetId = confirmDeleteChildId;
                    const target = provisionedChildren.find(c => c.userId === targetId);
                    const res = await deleteChildAccountServerAction({ childUserId: targetId });
                    if (!res.ok) {
                        setChildStatus({
                            ok: false,
                            message: res.error ?? "Could not delete child account.",
                        });
                        return;
                    }
                    setProvisionedChildren(prev => prev.filter(c => c.userId !== targetId));
                    setConfirmDeleteChildId(null);
                    setChildStatus({
                        ok: true,
                        message: target
                            ? `Deleted child account for ${target.name} (@${target.username}).`
                            : "Deleted child account.",
                    });
                } catch (err) {
                    setChildStatus({
                        ok: false,
                        message: err instanceof Error ? err.message : "Could not delete child account.",
                    });
                } finally {
                    setChildBusy(false);
                }
            },
        },
    };
}
