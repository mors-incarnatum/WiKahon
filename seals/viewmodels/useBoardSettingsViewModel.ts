"use client";
import { useCallback, useMemo, useState } from "react";
import { useBoardSelector } from "@/store/BoardProvider";
import { clampGrid, inBounds, type GridConfig } from "@/lib/board";
import { SpeechError, ttsService } from "@/services/tts/ttsService";
import { exportProfilePackage, validateAndPrepareImport } from "@/services/storage/backupService";
import { discardPreparedMedia, mediaRepository } from "@/services/storage/mediaRepository";
import { extractBoardData } from "@/store/useBoardStore";
import type { BoardData, FeatureFlags } from "@/models/boardData";
import { LOCAL_CHILD_SESSION, type ProvisionedChildAccount } from "@/models/auth";
import { cloudSyncService, type CloudUser } from "@/services/cloud/cloudSyncService";
import type { ProfileRow } from "@/models/supabase/database.types";
import {
    listProvisionedChildAccountsServerAction,
    provisionChildAccountServerAction,
    removeChildProfileAccessServerAction,
} from "@/app/actions/childAccounts";
import { validateChildProvisionInput, type ValidationFieldErrors } from "@/lib/validation";

export type SettingsTab = "layout" | "speech" | "profiles" | "experiments";

export interface OfflineReadiness {
    appShellCached: boolean;
    localStorageOk: boolean;
    mediaCount: number;
}

export function useBoardSettingsViewModel(boardId: string, initialTab: SettingsTab = "speech") {
    const {
        boards,
        global,
        globalMode,
        appearance,
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
        tiles,
        catalogOrder,
        experimentalData,
        sentence,
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
        tiles: s.tiles,
        catalogOrder: s.catalogOrder,
        experimentalData: s.experimentalData,
        sentence: s.sentence,
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

    const [scope, setScope] = useState("global");
    const [selected, setSelected] = useState(boards[boardId] ? boardId : "home");
    const [draft, setDraft] = useState(global);
    const [draftMode, setDraftMode] = useState<"manual" | "automatic">(globalMode);
    const [draftAppearance, setDraftAppearance] = useState(appearance);
    const [useGlobal, setUseGlobal] = useState(false);
    const [saved, setSaved] = useState(false);
    const [tab, setTab] = useState<SettingsTab>(initialTab);

    const [speechPreviewError, setSpeechPreviewError] = useState("");

    const [newProfileName, setNewProfileName] = useState("");
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
    const [staleConflictProfileId, setStaleConflictProfileId] = useState<string | null>(null);
    const [provisionedChildren, setProvisionedChildren] = useState<ProvisionedChildAccount[]>([]);
    const [childName, setChildNameState] = useState("");
    const [childUsername, setChildUsernameState] = useState("");
    const [childEmail, setChildEmailState] = useState("");
    const [childPassword, setChildPasswordState] = useState("");
    const [childConfirmPassword, setChildConfirmPasswordState] = useState("");
    const [selectedChildProfileId, setSelectedChildProfileIdState] = useState("");
    const [childFieldErrors, setChildFieldErrors] = useState<ValidationFieldErrors>({});
    const [childStatus, setChildStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [childBusy, setChildBusy] = useState(false);

    const ownedCloudProfiles = useMemo(
        () => (sessionCloudUser ? cloudProfiles.filter(cp => cp.owner_id === sessionCloudUser.id) : []),
        [cloudProfiles, sessionCloudUser],
    );
    const childProfileId = useMemo(() => {
        if (ownedCloudProfiles.some(cp => cp.id === selectedChildProfileId)) {
            return selectedChildProfileId;
        }
        if (cloudProfileId && ownedCloudProfiles.some(cp => cp.id === cloudProfileId)) {
            return cloudProfileId;
        }
        return ownedCloudProfiles[0]?.id ?? "";
    }, [ownedCloudProfiles, selectedChildProfileId, cloudProfileId]);
    const matchingCloudProfile = useMemo(
        () => (cloudProfileId ? cloudProfiles.find(cp => cp.id === cloudProfileId) ?? null : null),
        [cloudProfileId, cloudProfiles],
    );
    const cloudConflict = Boolean(
        (dirty && matchingCloudProfile && (matchingCloudProfile.revision ?? 1) > (cloudRevision ?? 0)) ||
        staleConflictProfileId === activeProfileId,
    );
    const [offlineReadiness, setOfflineReadiness] = useState<OfflineReadiness>({
        appShellCached: false,
        localStorageOk: storageStatus === "ok",
        mediaCount: 0,
    });

    const refreshOfflineReadiness = useCallback(async () => {
        const media = await mediaRepository.listProfileMedia(activeProfileId);
        let appShellCached = false;
        if (typeof caches !== "undefined" && "serviceWorker" in navigator) {
            try {
                const registration = await navigator.serviceWorker.getRegistration("/board");
                const route = registration?.active?.state === "activated" && await caches.match("/board", { cacheName: "wikahon-shell-v4" });
                if (route) {
                    const html = await route.text();
                    const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match => match[1].replace(/&amp;/g, "&"));
                    appShellCached = assets.length > 0 && (await Promise.all(
                        assets.map(asset => caches.match(asset, { cacheName: "wikahon-shell-v4" })),
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
        if (cloudSyncService.isConfigured() && sessionCloudUser) {
            const [res, childRes] = await Promise.all([
                cloudSyncService.listCloudProfiles(sessionCloudUser.id),
                listProvisionedChildAccountsServerAction().catch(() => ({
                    ok: false,
                    children: [] as ProvisionedChildAccount[],
                })),
            ]);
            setCloudProfiles(res.profiles);
            setProvisionedChildren(childRes.ok ? childRes.children : []);
        } else {
            setCloudProfiles([]);
            setProvisionedChildren([]);
        }
    }, [activeProfileId, sessionCloudUser, storageStatus]);

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

    const currentBoardData = () =>
        extractBoardData({
            tiles,
            boards,
            catalogOrder,
            gridConfig: global,
            layoutMode: globalMode,
            tileAppearance: appearance,
            speechConfig: speech,
            accessConfig: access,
            featureFlags,
            experimentalData,
            sentence,
        });

    const resetTileDimensions = () => {
        setDraftAppearance(current => ({
            ...current,
            tileWidth: 50,
            tileHeight: 50,
        }));
    };

    const resetDrafts = (nextScope: string, nextSelected: string) => {
        const board = boards[nextSelected];
        setDraft(nextScope === "global" ? global : board?.gridOverride ?? global);
        setDraftMode(
            nextScope === "global" ? globalMode : board?.layoutModeOverride ?? globalMode,
        );
        setDraftAppearance(appearance);
        setUseGlobal(false);
        setSaved(false);
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

    return {
        state: {
            tab,
            boards,
            scope,
            selected,
            draft,
            draftMode,
            appearance: draftAppearance,
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
            provisionedChildren: sessionCloudUser ? provisionedChildren : [],
            childName,
            childUsername,
            childEmail,
            childPassword,
            childConfirmPassword,
            childProfileId,
            childFieldErrors,
            childStatus,
            childBusy,
            newProfileName,
            backupStatus,
            offlineReadiness,
            offlineDesignatedProfiles,
            isActiveProfileOfflineDesignated,
            recoverableLegacyProfiles,
            recoveryStatus,
            recoveringId,
        },
        actions: {
            setTab: (nextTab: SettingsTab) => {
                setTab(nextTab);
                if (nextTab === "profiles") {
                    void refreshOfflineReadiness();
                }
            },
            setScope: (value: string) => {
                setScope(value);
                resetDrafts(value, selected);
            },
            selectBoard: (id: string) => {
                setSelected(id);
                resetDrafts(scope, id);
            },
            setDraft: (grid: GridConfig) => {
                const nextGrid = clampGrid(grid);
                setDraft(nextGrid);
                resetTileDimensions();
                setSaved(false);
            },
            setDraftMode: (mode: "manual" | "automatic") => {
                if (mode !== draftMode) {
                    resetTileDimensions();
                }
                setDraftMode(mode);
                setSaved(false);
            },
            swapRowsCols: () => {
                setDraft({ rows: draft.cols, cols: draft.rows });
                resetTileDimensions();
                setSaved(false);
            },
            setAppearance: (value: Partial<BoardData["tileAppearance"]> | BoardData["tileAppearance"]) => {
                setDraftAppearance(current => ({ ...current, ...value }));
                setSaved(false);
            },
            setUseGlobal: (value: boolean) => {
                setUseGlobal(value);
                setSaved(false);
            },
            apply: () => {
                applyBoardSettings(
                    draft,
                    draftAppearance,
                    draftMode,
                    scope === "global" ? undefined : selected,
                    scope !== "global" && useGlobal,
                );
                setSaved(true);
            },
            reflow: () => {
                setSaved(reflow(draft, scope === "global" ? undefined : selected));
            },
            rollbackReflow: () => {
                if (rollbackReflow() && preReflowSnapshot) {
                    const previousBoard = preReflowSnapshot.boards.find(board => board.boardId === selected);
                    setDraft(scope === "global"
                        ? preReflowSnapshot.previousGlobalGrid
                        : previousBoard?.previousGrid ?? preReflowSnapshot.previousGlobalGrid);
                    setSaved(false);
                }
            },
            useGlobal: () => {
                setUseGlobal(true);
                setSaved(false);
            },
            setSpeech,
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
            switchProfile,
            createProfile: () => {
                if (!newProfileName.trim()) return;
                createProfile(newProfileName.trim());
                setNewProfileName("");
            },
            renameActiveProfile: (name: string) => renameProfile(activeProfileId, name),
            deleteProfile,
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
            provisionChildAccount: async () => {
                if (!sessionCloudUser || childBusy) return;
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
                    return;
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
                        return;
                    }

                    const createdChild = res.child;
                    setChildNameState("");
                    setChildUsernameState("");
                    setChildEmailState("");
                    setChildPasswordState("");
                    setChildConfirmPasswordState("");
                    setChildFieldErrors({});
                    setChildStatus({
                        ok: true,
                        message: `Created child account for ${createdChild.name} (username: "${createdChild.username}") linked to "${createdChild.profileName}". They can sign in on the login screen with their username and password.`,
                    });

                    const listRes = await listProvisionedChildAccountsServerAction().catch(() => ({
                        ok: false,
                        children: [] as ProvisionedChildAccount[],
                    }));
                    if (listRes.ok) {
                        setProvisionedChildren(listRes.children);
                    } else {
                        setProvisionedChildren(prev => [...prev, createdChild]);
                    }
                } catch (err) {
                    setChildStatus({
                        ok: false,
                        message: err instanceof Error ? err.message : "Could not create child account.",
                    });
                } finally {
                    setChildBusy(false);
                }
            },
            removeChildProfileAccess: async (profileId: string, childUserId: string) => {
                if (!sessionCloudUser || childBusy) return;
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
                            message: res.error ?? "Could not remove child access.",
                        });
                        return;
                    }
                    setProvisionedChildren(prev =>
                        prev.filter(c => !(c.profileId === profileId && c.userId === childUserId)),
                    );
                    setChildStatus({
                        ok: true,
                        message: "Removed child access from that board profile.",
                    });
                } catch (err) {
                    setChildStatus({
                        ok: false,
                        message: err instanceof Error ? err.message : "Could not remove child access.",
                    });
                } finally {
                    setChildBusy(false);
                }
            },
        },
    };
}
