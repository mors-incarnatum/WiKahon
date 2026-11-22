"use client";
import { useRef, useState } from "react";
import { COLOR_SYSTEMS, GRID_PRESETS, type ColorSystemId } from "@/lib/board";
import { useBoardSettingsViewModel } from "@/viewmodels/useBoardSettingsViewModel";
import type { BoardData } from "@/models/boardData";
import { isVibrationSupported } from "@/lib/haptics";
import Modal from "./Modal";

function getDimension(value: number | undefined) {
    return value === undefined || !Number.isFinite(value) ? 50 : Math.max(1, Math.min(100, Math.round(value)));
}

function Segmented<T extends string>({ label, value, options, onChange }: {
    label: string;
    value: T;
    options: { label: string; value: T }[];
    onChange: (value: T) => void;
}) {
    return (
        <div className="space-y-2" role="group" aria-label={label}>
            <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
            <div className="flex flex-wrap gap-2">
                {options.map(option => (
                    <button key={option.value} type="button" aria-pressed={value === option.value}
                        onClick={() => onChange(option.value)}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold ${value === option.value ? "border-[#B6D8FA] bg-[#DCEEFF]" : "border-slate-200 bg-[#FFF9EC]/50"}`}>
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function FieldErrors({ errors }: { errors?: string[] }) {
    if (!errors || errors.length === 0) return null;
    return (
        <ul role="alert" className="mt-1 space-y-0.5 text-xs text-rose-700">
            {errors.map(err => (
                <li key={err}>{err}</li>
            ))}
        </ul>
    );
}

export default function BoardSettings({
    boardId,
    onClose,
    initialTab = "colorSystem",
}: {
    boardId: string;
    onClose: () => void;
    initialTab?: "layout" | "colorSystem" | "speech" | "profiles";
}) {
    const { state: s, actions: a } = useBoardSettingsViewModel(boardId, initialTab);
    const importInputRef = useRef<HTMLInputElement | null>(null);

    const widthUnits = getDimension(s.appearance.tileWidth);
    const heightUnits = getDimension(s.appearance.tileHeight);

    const [resetProfileId, setResetProfileId] = useState<string | null>(null);
    const [resetStatus, setResetStatus] = useState<{ profileId: string; message: string } | null>(null);
    const confirmReset = resetProfileId === s.activeProfileId;
    const [widthDraft, setWidthDraft] = useState<string | null>(null);
    const [heightDraft, setHeightDraft] = useState<string | null>(null);

    const widthInput = widthDraft ?? String(widthUnits);
    const heightInput = heightDraft ?? String(heightUnits);

    const updateDimension = (
        dimension: "tileWidth" | "tileHeight",
        value: string,
    ) => {
        if (!/^\d{0,3}$/.test(value)) return;

        if (dimension === "tileWidth") setWidthDraft(value);
        else setHeightDraft(value);

        if (value === "") return;

        const number = Number(value);
        if (number < 1) return;

        a.setAppearance({
            ...s.appearance,
            [dimension]: Math.min(100, number),
        });
    };

    const finishDimensionInput = (dimension: "tileWidth" | "tileHeight") => {
        const value = dimension === "tileWidth" ? widthDraft : heightDraft;
        if (value === null) return;

        const currentValue = dimension === "tileWidth" ? widthUnits : heightUnits;
        const number = Math.max(
            1,
            Math.min(100, value === "" ? currentValue : Number(value)),
        );

        a.setAppearance({
            ...s.appearance,
            [dimension]: number,
        });

        if (dimension === "tileWidth") setWidthDraft(null);
        else setHeightDraft(null);
    };

    const changeDimension = (
        dimension: "tileWidth" | "tileHeight",
        value: number,
    ) => {
        if (dimension === "tileWidth") setWidthDraft(null);
        else setHeightDraft(null);

        a.setAppearance({
            ...s.appearance,
            [dimension]: value,
        });
    };

    return (
        <Modal
            label={initialTab === "layout" ? "Board layout" : "Board settings"}
            onClose={onClose}
            className="editor-modal"
            style={{ width: "min(672px, calc(100vw - 24px))", borderRadius: "24px", borderColor: "#DCEEFF", color: "#465365" }}
        >
            <div className="modal-heading rounded-2xl bg-[#FFF9EC] p-4">
                <h2>
                    {initialTab === "layout"
                        ? "Board Layout"
                        : "Board Settings"}
                </h2>
                <button type="button" onClick={onClose} aria-label="Close settings">
                    ✕
                </button>
            </div>

            {initialTab === "layout" && (
                <>
                    <div className="tab-row" role="tablist" aria-label="Board layout section">
                        <button type="button" role="tab" aria-selected={s.tab === "layout"} onClick={() => a.setTab("layout")}>Grid</button>
                        <button type="button" role="tab" aria-selected={s.tab === "appearance"} onClick={() => a.setTab("appearance")}>Appearance</button>
                    </div>
                    <fieldset hidden={s.tab !== "layout"}>
                        <legend>Board size</legend>

                        <div className="settings-section">
                            <label>
                                Apply to
                                <select value={s.scope} onChange={e => a.setScope(e.target.value)}>
                                    <option value="global">All boards using global layout</option>
                                    <option value="board">Specific board</option>
                                </select>
                            </label>

                            {s.scope === "board" && (
                                <div className="settings-section">
                                    <label>
                                        Board
                                        <select
                                            value={s.selected}
                                            onChange={e => a.selectBoard(e.target.value)}
                                        >
                                            {Object.values(s.boards).map(b => (
                                                <option key={b.id} value={b.id}>
                                                    {b.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={s.useGlobal}
                                            onChange={e => a.setUseGlobal(e.target.checked)}
                                        />
                                        Use global layout for this board
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="settings-section">
                            <label>Layout mode</label>

                            <div className="filter-pills">
                                <button
                                    type="button"
                                    aria-pressed={s.draftMode === "manual"}
                                    disabled={s.scope === "board" && s.useGlobal}
                                    onClick={() => a.setDraftMode("manual")}
                                >
                                    Manual grid
                                </button>

                                <button
                                    type="button"
                                    aria-pressed={s.draftMode === "automatic"}
                                    disabled={s.scope === "board" && s.useGlobal}
                                    onClick={() => a.setDraftMode("automatic")}
                                >
                                    Automatic fit
                                </button>
                            </div>
                        </div>

                        {s.draftMode === "manual" && (
                            <>
                                <div className="settings-section">
                                    <label>Grid presets</label>

                                    <div className="filter-pills">
                                        {GRID_PRESETS.map(g => (
                                            <button
                                                type="button"
                                                key={`${g.rows}:${g.cols}`}
                                                aria-pressed={
                                                    g.rows === s.draft.rows &&
                                                    g.cols === s.draft.cols
                                                }
                                                disabled={s.scope === "board" && s.useGlobal}
                                                title={
                                                    g.rows <= 3
                                                        ? "Emergent"
                                                        : g.rows >= 8
                                                          ? "Independent"
                                                          : "Context-dependent / transitional"
                                                }
                                                onClick={() => a.setDraft(g)}
                                            >
                                                {g.rows}×{g.cols}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="settings-section">
                                    <div className="field-row">
                                        <label>
                                            Rows
                                            <input
                                                type="number"
                                                min="1"
                                                max="16"
                                                disabled={s.scope === "board" && s.useGlobal}
                                                value={s.draft.rows}
                                                onChange={e =>
                                                    a.setDraft({
                                                        ...s.draft,
                                                        rows: Number(e.target.value),
                                                    })
                                                }
                                            />
                                        </label>

                                        <label>
                                            Columns
                                            <input
                                                type="number"
                                                min="1"
                                                max="16"
                                                disabled={s.scope === "board" && s.useGlobal}
                                                value={s.draft.cols}
                                                onChange={e =>
                                                    a.setDraft({
                                                        ...s.draft,
                                                        cols: Number(e.target.value),
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>

                                    <button
                                        type="button"
                                        disabled={s.scope === "board" && s.useGlobal}
                                        onClick={a.swapRowsCols}
                                    >
                                        ⇄ Swap orientation
                                    </button>
                                </div>

                                <div className="settings-section">
                                    <div
                                        className="grid-preview"
                                        aria-label={`${s.draft.rows} by ${s.draft.cols} layout preview`}
                                        style={{
                                            gridTemplateColumns: `repeat(${s.draft.cols}, 1fr)`,
                                        }}
                                    >
                                        {s.preview.map((_, i) => (
                                            <span key={i} />
                                        ))}
                                    </div>

                                    <p>Capacity: {s.draft.rows * s.draft.cols} slots per page.</p>
                                    <p>{s.overflow} tiles fall outside the new layout.</p>
                                    {s.overflow > 0 && <button type="button" onClick={a.reflow} disabled={s.scope === "board" && s.useGlobal}>Reflow now</button>}
                                </div>
                            </>
                        )}

                        {s.draftMode === "automatic" && (
                            <div className="settings-section rounded-2xl border border-slate-200 bg-[#FFF9EC] p-4">
                                <p>
                                    The board automatically adjusts its rows and columns according
                                    to the available space, tile dimensions, and grid gap.
                                </p>
                            </div>
                        )}
                    </fieldset>

                    <fieldset hidden={s.tab !== "appearance"}>
                        <legend>Tile appearance</legend>

                        <div className="settings-section">
                            <div className="tile-dimension-control">
                                <label htmlFor="tile-width-input">Tile width</label>

                                <div className="tile-dimension-buttons">
                                    <button
                                        type="button"
                                        aria-label="Decrease tile width"
                                        disabled={widthUnits <= 1}
                                        onClick={() => changeDimension("tileWidth", widthUnits - 1)}
                                    >
                                        −
                                    </button>

                                    <input
                                        id="tile-width-input"
                                        className="tile-size-input"
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={3}
                                        value={widthInput}
                                        onChange={e => updateDimension("tileWidth", e.target.value)}
                                        onBlur={() => finishDimensionInput("tileWidth")}
                                        aria-label="Tile width percentage"
                                    />

                                    <span>%</span>

                                    <button
                                        type="button"
                                        aria-label="Increase tile width"
                                        disabled={widthUnits >= 100}
                                        onClick={() => changeDimension("tileWidth", widthUnits + 1)}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div className="tile-dimension-control">
                                <label htmlFor="tile-height-input">Tile height</label>

                                <div className="tile-dimension-buttons">
                                    <button
                                        type="button"
                                        aria-label="Decrease tile height"
                                        disabled={heightUnits <= 1}
                                        onClick={() => changeDimension("tileHeight", heightUnits - 1)}
                                    >
                                        −
                                    </button>

                                    <input
                                        id="tile-height-input"
                                        className="tile-size-input"
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={3}
                                        value={heightInput}
                                        onChange={e => updateDimension("tileHeight", e.target.value)}
                                        onBlur={() => finishDimensionInput("tileHeight")}
                                        aria-label="Tile height percentage"
                                    />

                                    <span>%</span>

                                    <button
                                        type="button"
                                        aria-label="Increase tile height"
                                        disabled={heightUnits >= 100}
                                        onClick={() => changeDimension("tileHeight", heightUnits + 1)}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <label>Tile width: {widthUnits}%
                                    <input type="range" min="1" max="100" value={widthUnits} onChange={e => changeDimension("tileWidth", Number(e.target.value))} />
                                </label>
                                <label>Tile height: {heightUnits}%
                                    <input type="range" min="1" max="100" value={heightUnits} onChange={e => changeDimension("tileHeight", Number(e.target.value))} />
                                </label>
                                <Segmented label="Label position" value={s.appearance.labelPosition}
                                    options={[{ label: "Bottom", value: "bottom" }, { label: "Top", value: "top" }]}
                                    onChange={labelPosition => a.setAppearance({ labelPosition })} />
                                <Segmented label="Show icons" value={s.appearance.showIcons ? "yes" : "no"}
                                    options={[{ label: "Show", value: "yes" }, { label: "Hide", value: "no" }]}
                                    onChange={value => a.setAppearance({ showIcons: value === "yes" })} />
                                <Segmented label="Text size" value={s.appearance.fontScale}
                                    options={[{ label: "Small", value: "sm" }, { label: "Medium", value: "md" }, { label: "Large", value: "lg" }]}
                                    onChange={fontScale => a.setAppearance({ fontScale })} />
                                <Segmented label="Icon size" value={s.appearance.iconScale}
                                    options={[{ label: "Small", value: "sm" }, { label: "Medium", value: "md" }, { label: "Large", value: "lg" }]}
                                    onChange={iconScale => a.setAppearance({ iconScale })} />
                                <Segmented label="Grid spacing" value={s.appearance.gridGap}
                                    options={[{ label: "Compact", value: "compact" }, { label: "Normal", value: "normal" }, { label: "Relaxed", value: "relaxed" }]}
                                    onChange={gridGap => a.setAppearance({ gridGap })} />
                            </div>
                        </div>
                    </fieldset>

                    <div className="settings-section">
                        {s.canRollbackReflow && <button type="button" onClick={a.rollbackReflow}>Undo reflow</button>}
                        <button
                            type="button"
                            className="primary"
                            onClick={a.apply}
                        >
                            Apply Changes
                        </button>

                        {s.saved && <p role="status">Changes saved</p>}
                    </div>
                </>
            )}

            {initialTab !== "layout" && (
                <>
                    <div className="tab-row" role="tablist" aria-label="Settings section">
                        <button type="button" role="tab" aria-selected={s.tab === "colorSystem"} onClick={() => a.setTab("colorSystem")}>
                            Color Key
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={s.tab === "speech"}
                            onClick={() => a.setTab("speech")}
                        >
                            Speech
                        </button>
                        <button type="button" role="tab" aria-selected={s.tab === "access"} onClick={() => a.setTab("access")}>
                            Access
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={s.tab === "profiles"}
                            onClick={() => a.setTab("profiles")}
                        >
                            Profiles &amp; offline
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={s.tab === "experiments"}
                            onClick={() => a.setTab("experiments")}
                        >
                            Optional prototypes
                        </button>
                    </div>

                    <fieldset hidden={s.tab !== "colorSystem"}>
                        <legend>Color Key</legend>
                        <div className="settings-section">
                            <span>Color coding system</span>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                {(Object.keys(COLOR_SYSTEMS) as ColorSystemId[]).map(id => (
                                    <button key={id} type="button" aria-pressed={s.draftColorSystem === id} onClick={() => a.setDraftColorSystem(id)} className={`rounded-xl border px-3 py-2.5 text-xs font-bold ${s.draftColorSystem === id ? "border-[#B6D8FA] bg-[#DCEEFF]" : "border-slate-200 bg-[#FFF9EC]/50"}`}>
                                        {COLOR_SYSTEMS[id].label}
                                    </button>
                                ))}
                            </div>
                            <p>{s.draftColorSystem === "custom"
                                ? "Create and customize your own catalogs, tile colors, and word-class schemes."
                                : "Uses standard AAC color-coded catalogs. Your Custom Colors layout stays preserved."}</p>
                            <label>
                                Tile color mode
                                <select value={s.draftColorMode} disabled={s.draftColorSystem !== "custom"} onChange={e => a.setDraftColorMode(e.target.value as BoardData["tileAppearance"]["colorMode"])}>
                                    <option value="catalog">Catalog</option>
                                    <option value="wordClass">Word class</option>
                                    <option value="neutral">Neutral (no semantic color)</option>
                                </select>
                            </label>
                            <button type="button" className="primary" onClick={a.applyColorSettings}>Save changes</button>
                            {s.colorSaved && <p role="status">Changes saved</p>}
                        </div>
                    </fieldset>

                    <fieldset hidden={s.tab !== "speech"}>
                        <legend>Speech</legend>
                        <div className="settings-section">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={s.speech.speakOnTap}
                                    onChange={e => a.setSpeech({ speakOnTap: e.target.checked })}
                                />{" "}
                                Speak words on tap
                            </label>
                            <label>
                                Sentence auto-clear
                                <select
                                    value={s.speech.autoClear}
                                    onChange={e =>
                                        a.setSpeech({
                                            autoClear: e.target.value as BoardData["speechConfig"]["autoClear"],
                                        })
                                    }
                                >
                                    <option value="off">Keep until cleared</option>
                                    <option value="afterSpeak">Clear after speaking</option>
                                    <option value="nextTap">
                                        Clear on next activation after speaking
                                    </option>
                                </select>
                            </label>
                            <div className="field-row">
                                <span>Voice: Andrés (Mexican Spanish). Internet connection required.</span>
                                <button type="button" onClick={() => void a.previewSpeech()}>
                                    🔊 Preview voice
                                </button>
                            </div>
                            {s.speechPreviewError && <p role="alert">{s.speechPreviewError}</p>}
                            <label>
                                Volume: {Math.round((s.speech.volume ?? 1) * 100)}%
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={s.speech.volume ?? 1}
                                    onChange={e => a.setSpeech({ volume: Number(e.target.value) })}
                                />
                            </label>
                            <label>
                                Speech rate: {(s.speech.rate ?? 1).toFixed(2)}×
                                <input
                                    type="range"
                                    min="0.6"
                                    max="1.5"
                                    step="0.05"
                                    value={s.speech.rate ?? 1}
                                    onChange={e => a.setSpeech({ rate: Number(e.target.value) })}
                                />
                            </label>
                        </div>
                    </fieldset>

                    <fieldset hidden={s.tab !== "access"}>
                        <legend>Access</legend>
                        <div className="settings-section">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={s.access.longPressToEdit}
                                    onChange={e =>
                                        a.setAccess({ longPressToEdit: e.target.checked })
                                    }
                                />{" "}
                                Long press to edit
                            </label>
                            <label>
                                Hold duration: {s.access.holdDurationMs} ms
                                <input
                                    type="range"
                                    min="300"
                                    max="2000"
                                    step="50"
                                    value={s.access.holdDurationMs}
                                    onChange={e =>
                                        a.setAccess({ holdDurationMs: Number(e.target.value) })
                                    }
                                />
                            </label>
                            <label>
                                Movement tolerance: {s.access.moveTolerancePx} px
                                <input
                                    type="range"
                                    min="4"
                                    max="50"
                                    value={s.access.moveTolerancePx}
                                    onChange={e =>
                                        a.setAccess({ moveTolerancePx: Number(e.target.value) })
                                    }
                                />
                            </label>
                            <label>
                                Swipe threshold: {s.access.swipeThresholdPx ?? 60} px
                                <input
                                    type="range"
                                    min="30"
                                    max="160"
                                    value={s.access.swipeThresholdPx ?? 60}
                                    onChange={e =>
                                        a.setAccess({ swipeThresholdPx: Number(e.target.value) })
                                    }
                                />
                            </label>
                            <div className="rounded-2xl border border-[#F2C4B1] bg-[#FFDFD1]/50 p-4">
                                <p className="font-bold">Reset board data</p>
                                <p>Restores default catalogs, vocabulary, and grid, and removes custom layouts and pinned vocabulary for the active profile. The current sentence is cleared. Accounts, chat, and scribble data are kept.</p>
                                {!confirmReset ? (
                                    <button type="button" onClick={() => {
                                        setResetStatus(null);
                                        setResetProfileId(s.activeProfileId);
                                    }}>
                                        Reset board data
                                    </button>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" onClick={() => {
                                            const ok = a.resetBoardData();
                                            setResetStatus({
                                                profileId: s.activeProfileId,
                                                message: ok ? "Board data reset." : "Could not reset board data. Check your access and try again.",
                                            });
                                            setResetProfileId(null);
                                        }}>Confirm reset</button>
                                        <button type="button" onClick={() => setResetProfileId(null)}>Cancel</button>
                                    </div>
                                )}
                                {resetStatus?.profileId === s.activeProfileId && <p role="status">{resetStatus.message}</p>}
                            </div>
                        </div>
                    </fieldset>

                    <fieldset hidden={s.tab !== "profiles"}>
                        <legend>Child profiles &amp; offline backup</legend>
                        <label>
                            Active profile
                            <select
                                value={s.activeProfileId}
                                onChange={e => a.switchProfile(e.target.value)}
                            >
                                {s.profiles.map(p => (
                                    <option key={p.localProfileId} value={p.localProfileId}>
                                        {p.name}{p.cloudProfileId ? " (Cloud)" : ""}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="field-row">
                            <label>
                                Rename active profile
                                <input
                                    value={s.renameDraft}
                                    onChange={e => a.setRenameDraft(e.target.value)}
                                    placeholder="Profile name"
                                />
                            </label>
                            <button
                                type="button"
                                disabled={!s.renameDraft.trim() || s.renameDraft.trim() === s.activeProfileName}
                                onClick={a.saveProfileRename}
                            >
                                Rename
                            </button>
                        </div>
                        <div className="field-row">
                            <label>
                                New profile name
                                <input
                                    value={s.newProfileName}
                                    onChange={e => a.setNewProfileName(e.target.value)}
                                    placeholder="e.g., Child 2"
                                />
                            </label>
                            <button
                                type="button"
                                disabled={!s.newProfileName.trim()}
                                onClick={a.createProfile}
                            >
                                Create profile
                            </button>
                            {s.profiles.length > 1 && (
                                s.confirmDeleteProfileId !== s.activeProfileId ? (
                                    <button
                                        type="button"
                                        onClick={() => a.requestDeleteProfile(s.activeProfileId)}
                                    >
                                        Delete active profile
                                    </button>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" onClick={a.confirmDeleteProfile}>
                                            Confirm delete
                                        </button>
                                        <button type="button" onClick={a.cancelDeleteProfile}>
                                            Cancel
                                        </button>
                                    </div>
                                )
                            )}
                        </div>
                        <label>
                            <input
                                type="checkbox"
                                checked={s.isActiveProfileOfflineDesignated}
                                onChange={e => a.toggleActiveProfileOfflineDesignated(e.target.checked)}
                            />{" "}
                            Allow this board in Offline Child Mode on this device
                        </label>

                        {s.recoverableLegacyProfiles.length > 0 && (
                            <section>
                                <h3>Recover older boards on this device</h3>
                                <ul>
                                    {s.recoverableLegacyProfiles.map(lp => (
                                        <li key={lp.localProfileId}>
                                            <span>{lp.name}</span>{" "}
                                            <button
                                                type="button"
                                                disabled={s.recoveringId !== null}
                                                onClick={() => void a.recoverLegacyBoard(lp.localProfileId)}
                                            >
                                                Recover board
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                {s.recoveryStatus && <p>{s.recoveryStatus.message}</p>}
                            </section>
                        )}

                        <h3>Offline readiness (this device)</h3>
                        <ul>
                            <li>
                                App shell cached:{" "}
                                {s.offlineReadiness.appShellCached ? "Yes" : "Not yet"}
                            </li>
                            <li>
                                Local storage healthy:{" "}
                                {s.offlineReadiness.localStorageOk ? "Yes" : "Check storage warning"}
                            </li>
                            <li>Stored profile media: {s.offlineReadiness.mediaCount} item(s)</li>
                            <li>Offline speech fallback: Web Speech API</li>
                        </ul>
                        <button type="button" onClick={() => void a.refreshOfflineReadiness()}>
                            Re-check offline readiness
                        </button>

                        <h3>Export / import backup</h3>
                        <div className="field-row">
                            <button type="button" onClick={() => void a.downloadBackupFile()}>
                                Export profile backup (.json)
                            </button>
                            <button
                                type="button"
                                onClick={() => importInputRef.current?.click()}
                            >
                                Import backup as new profile
                            </button>
                            <input
                                ref={importInputRef}
                                type="file"
                                accept="application/json,.json"
                                hidden
                                onChange={e => {
                                    const file = e.target.files?.[0];
                                    e.currentTarget.value = "";
                                    void a.importBackupFile(file);
                                }}
                            />
                        </div>
                        {s.backupStatus && <p role="status">{s.backupStatus.message}</p>}

                        <h3>Guardian cloud account &amp; sync (Supabase)</h3>
                        {!s.cloudConfigured ? (
                            <p>
                                Cloud sync is not configured on this build. Local boards and backups
                                continue working offline.
                            </p>
                        ) : !s.cloudUser ? (
                            <p>
                                Sign in with a Supabase account on the main login screen to enable
                                cloud sync.
                            </p>
                        ) : (
                            <>
                                <p>
                                    Signed in as{" "}
                                    <strong>{s.cloudUser.email ?? s.cloudUser.id}</strong>.
                                </p>
                                {s.dirty && (
                                    <p role="status">
                                        Unpublished local changes are saved on this device.
                                    </p>
                                )}
                                {s.cloudConflict && (
                                    <div role="alert" className="settings-section">
                                        <p>
                                            {s.conflictProfile
                                                ? `Cloud profile "${s.conflictProfile.name}" is at revision ${s.conflictProfile.revision ?? 1}, which is newer than this device's revision ${s.cloudRevision ?? 0}. Your local draft is preserved.`
                                                : "This cloud profile was updated on another device. Your local draft is preserved."}
                                        </p>
                                        {s.conflictProfile && (
                                            <button
                                                type="button"
                                                disabled={s.cloudBusy}
                                                onClick={() =>
                                                    void a.downloadCloudProfile(s.conflictProfile!)
                                                }
                                            >
                                                Download cloud rev{" "}
                                                {s.conflictProfile.revision ?? 1} as separate copy
                                            </button>
                                        )}
                                    </div>
                                )}
                                <div className="field-row">
                                    <button
                                        type="button"
                                        className="primary"
                                        disabled={s.cloudBusy}
                                        onClick={() => void a.publishActiveProfile()}
                                    >
                                        {s.cloudProfileId
                                            ? `Publish active profile (rev ${s.cloudRevision ?? 1})`
                                            : "Publish active profile to cloud"}
                                    </button>
                                </div>
                                {s.cloudProfiles.length > 0 && (
                                    <>
                                        <h4>Cloud profiles</h4>
                                        <ul>
                                            {s.cloudProfiles.map(cp => {
                                                const isOwner = Boolean(s.cloudUser && cp.owner_id === s.cloudUser.id);
                                                const isConfirmingCloudDelete = s.confirmDeleteCloudProfileId === cp.id;
                                                return (
                                                    <li key={cp.id}>
                                                        {cp.name} (rev {cp.revision ?? 1}){" "}
                                                        <button
                                                            type="button"
                                                            disabled={s.cloudBusy}
                                                            onClick={() =>
                                                                void a.downloadCloudProfile(cp)
                                                            }
                                                        >
                                                            Download as local copy
                                                        </button>{" "}
                                                        {isOwner && (!isConfirmingCloudDelete ? (
                                                            <button
                                                                type="button"
                                                                disabled={s.cloudBusy}
                                                                onClick={() => a.requestDeleteCloudProfile(cp.id)}
                                                            >
                                                                Delete from cloud
                                                            </button>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    disabled={s.cloudBusy}
                                                                    onClick={() => void a.deleteCloudProfile(cp)}
                                                                >
                                                                    Confirm cloud delete
                                                                </button>{" "}
                                                                <button
                                                                    type="button"
                                                                    disabled={s.cloudBusy}
                                                                    onClick={a.cancelDeleteCloudProfile}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </>
                                                        ))}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </>
                                )}
                            </>
                        )}
                        {s.cloudStatus && <p role="status">{s.cloudStatus.message}</p>}

                        {s.cloudConfigured && s.cloudUser && (
                            <section className="settings-section">
                                <h3>Child accounts</h3>
                                <p>
                                    Create read-only child accounts and optionally assign one of
                                    your published cloud boards. Children sign in on the login
                                    screen using their username and password.
                                </p>

                                {s.childLoading && <p>Loading child accounts…</p>}

                                {s.childProvisioningError && (
                                    <p role="alert" className="text-rose-700">
                                        {s.childProvisioningError}
                                    </p>
                                )}

                                {s.provisionedChildren.length > 0 && (
                                    <>
                                        <h4>Child accounts</h4>
                                        <ul className="space-y-3">
                                            {s.provisionedChildren.map(child => {
                                                const isEditing = s.editingChildId === child.userId;
                                                const isResetting = s.resettingChildId === child.userId;
                                                const isConfirmingDelete = s.confirmDeleteChildId === child.userId;
                                                return (
                                                    <li key={child.userId} className="rounded-xl border border-slate-200 p-3">
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                            <span>
                                                                <strong>{child.name}</strong> (@{child.username}) —{" "}
                                                                {child.profileName ?? "No board assigned"}
                                                            </span>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled={s.childBusy}
                                                                    onClick={() => a.startEditChild(child)}
                                                                >
                                                                    Edit
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={s.childBusy}
                                                                    onClick={() => a.startResetChildPassword(child.userId)}
                                                                >
                                                                    Reset password
                                                                </button>
                                                                {child.profileId && (
                                                                    <button
                                                                        type="button"
                                                                        disabled={s.childBusy}
                                                                        onClick={() =>
                                                                            void a.removeChildProfileAccess(
                                                                                child.profileId!,
                                                                                child.userId,
                                                                            )
                                                                        }
                                                                    >
                                                                        Unassign board
                                                                    </button>
                                                                )}
                                                                {!isConfirmingDelete ? (
                                                                    <button
                                                                        type="button"
                                                                        disabled={s.childBusy}
                                                                        onClick={() => a.requestDeleteChild(child.userId)}
                                                                    >
                                                                        Delete account
                                                                    </button>
                                                                ) : (
                                                                    <>
                                                                        <button
                                                                            type="button"
                                                                            disabled={s.childBusy}
                                                                            onClick={() => void a.confirmDeleteChild()}
                                                                        >
                                                                            Confirm delete
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            disabled={s.childBusy}
                                                                            onClick={a.cancelDeleteChild}
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {isEditing && (
                                                            <form
                                                                noValidate
                                                                className="mt-3 space-y-2"
                                                                onSubmit={e => {
                                                                    e.preventDefault();
                                                                    void a.saveChildEdit();
                                                                }}
                                                            >
                                                                <label>
                                                                    Display name
                                                                    <input
                                                                        type="text"
                                                                        value={s.editChildName}
                                                                        aria-invalid={Boolean(s.editChildFieldErrors.name?.length)}
                                                                        onChange={e => a.setEditChildName(e.target.value)}
                                                                    />
                                                                    <FieldErrors errors={s.editChildFieldErrors.name} />
                                                                </label>
                                                                <label>
                                                                    Assigned cloud board (optional)
                                                                    <select
                                                                        value={s.editChildProfileId}
                                                                        aria-invalid={Boolean(s.editChildFieldErrors.profileId?.length)}
                                                                        onChange={e => a.setEditChildProfileId(e.target.value)}
                                                                    >
                                                                        <option value="">No board assigned</option>
                                                                        {s.ownedCloudProfiles.map(cp => (
                                                                            <option key={cp.id} value={cp.id}>
                                                                                {cp.name}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                    <FieldErrors errors={s.editChildFieldErrors.profileId} />
                                                                </label>
                                                                <div className="field-row">
                                                                    <button type="submit" className="primary" disabled={s.childBusy}>
                                                                        Save changes
                                                                    </button>
                                                                    <button type="button" disabled={s.childBusy} onClick={a.cancelEditChild}>
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            </form>
                                                        )}

                                                        {isResetting && (
                                                            <form
                                                                noValidate
                                                                className="mt-3 space-y-2"
                                                                onSubmit={e => {
                                                                    e.preventDefault();
                                                                    void a.submitChildPasswordReset();
                                                                }}
                                                            >
                                                                <label>
                                                                    New password (min 6 characters)
                                                                    <input
                                                                        type="password"
                                                                        autoComplete="new-password"
                                                                        value={s.resetChildPassword}
                                                                        aria-invalid={Boolean(s.resetChildFieldErrors.password?.length)}
                                                                        onChange={e => a.setResetChildPassword(e.target.value)}
                                                                    />
                                                                    <FieldErrors errors={s.resetChildFieldErrors.password} />
                                                                </label>
                                                                <label>
                                                                    Confirm new password
                                                                    <input
                                                                        type="password"
                                                                        autoComplete="new-password"
                                                                        value={s.resetChildConfirmPassword}
                                                                        aria-invalid={Boolean(s.resetChildFieldErrors.confirmPassword?.length)}
                                                                        onChange={e => a.setResetChildConfirmPassword(e.target.value)}
                                                                    />
                                                                    <FieldErrors errors={s.resetChildFieldErrors.confirmPassword} />
                                                                </label>
                                                                <div className="field-row">
                                                                    <button type="submit" className="primary" disabled={s.childBusy}>
                                                                        Update password
                                                                    </button>
                                                                    <button type="button" disabled={s.childBusy} onClick={a.cancelResetChildPassword}>
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            </form>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </>
                                )}

                                <form
                                    noValidate
                                    onSubmit={e => {
                                        e.preventDefault();
                                        void a.provisionChildAccount();
                                    }}
                                >
                                    <label>
                                        Assigned cloud board (optional)
                                        <select
                                            value={s.childProfileId}
                                            aria-invalid={Boolean(
                                                s.childFieldErrors.profileId?.length,
                                            )}
                                            onChange={e => a.setChildProfileId(e.target.value)}
                                        >
                                            <option value="">No board assigned (assign later)</option>
                                            {s.ownedCloudProfiles.map(cp => (
                                                <option key={cp.id} value={cp.id}>
                                                    {cp.name}
                                                </option>
                                            ))}
                                        </select>
                                        <FieldErrors errors={s.childFieldErrors.profileId} />
                                    </label>

                                    <label>
                                        Child name
                                        <input
                                            type="text"
                                            name="childName"
                                            autoComplete="off"
                                            value={s.childName}
                                            aria-invalid={Boolean(
                                                s.childFieldErrors.name?.length,
                                            )}
                                            onChange={e => a.setChildName(e.target.value)}
                                            placeholder="e.g., Lily"
                                        />
                                        <FieldErrors errors={s.childFieldErrors.name} />
                                    </label>

                                    <label>
                                        Username
                                        <input
                                            type="text"
                                            name="childUsername"
                                            autoComplete="off"
                                            value={s.childUsername}
                                            aria-invalid={Boolean(
                                                s.childFieldErrors.username?.length,
                                            )}
                                            onChange={e => a.setChildUsername(e.target.value)}
                                            placeholder="e.g., lily"
                                        />
                                        <FieldErrors errors={s.childFieldErrors.username} />
                                    </label>

                                    <label>
                                        Email (optional)
                                        <input
                                            type="email"
                                            name="childEmail"
                                            autoComplete="off"
                                            value={s.childEmail}
                                            aria-invalid={Boolean(
                                                s.childFieldErrors.email?.length,
                                            )}
                                            onChange={e => a.setChildEmail(e.target.value)}
                                            placeholder="Optional — child can sign in with username"
                                        />
                                        <FieldErrors errors={s.childFieldErrors.email} />
                                    </label>

                                    <label>
                                        Password (min 6 characters)
                                        <input
                                            type="password"
                                            name="childPassword"
                                            autoComplete="new-password"
                                            value={s.childPassword}
                                            aria-invalid={Boolean(
                                                s.childFieldErrors.password?.length,
                                            )}
                                            onChange={e => a.setChildPassword(e.target.value)}
                                            placeholder="Enter password"
                                        />
                                        <FieldErrors errors={s.childFieldErrors.password} />
                                    </label>

                                    <label>
                                        Confirm password
                                        <input
                                            type="password"
                                            name="childConfirmPassword"
                                            autoComplete="new-password"
                                            value={s.childConfirmPassword}
                                            aria-invalid={Boolean(
                                                s.childFieldErrors.confirmPassword?.length,
                                            )}
                                            onChange={e =>
                                                a.setChildConfirmPassword(e.target.value)
                                            }
                                            placeholder="Re-enter password"
                                        />
                                        <FieldErrors
                                            errors={s.childFieldErrors.confirmPassword}
                                        />
                                    </label>

                                    <div className="field-row">
                                        <button
                                            type="submit"
                                            className="primary"
                                            disabled={s.childBusy}
                                        >
                                            {s.childBusy
                                                ? "Creating child account…"
                                                : "Create child account"}
                                        </button>
                                    </div>
                                </form>

                                {s.childStatus && (
                                    <div className="space-y-1">
                                        <p
                                            role={s.childStatus.ok ? "status" : "alert"}
                                            className={
                                                s.childStatus.ok ? "text-emerald-800" : "text-rose-700"
                                            }
                                        >
                                            {s.childStatus.message}
                                        </p>
                                        {s.childStatus.ok && s.lastCreatedChild && (
                                            <div className="field-row">
                                                <button
                                                    type="button"
                                                    onClick={() => void a.copyChildSignInInfo()}
                                                >
                                                    Copy username
                                                </button>
                                                {s.childCopyFeedback && (
                                                    <span role="status" className="text-xs text-emerald-800">
                                                        {s.childCopyFeedback}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}
                    </fieldset>

                    <fieldset hidden={s.tab !== "experiments"}>
                        <legend>Optional feature prototypes (off by default)</legend>
                        <p>
                            Disabling a prototype hides its entry points without deleting saved
                            content.
                        </p>
                        <label>
                            <input
                                type="checkbox"
                                checked={s.featureFlags?.animation ?? false}
                                onChange={e =>
                                    a.setFeatureFlags({ animation: e.target.checked })
                                }
                            />{" "}
                            Animated GIF symbols (suppressed when reduced motion is enabled)
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={s.featureFlags?.vibration ?? false}
                                onChange={e =>
                                    a.setFeatureFlags({ vibration: e.target.checked })
                                }
                            />{" "}
                            Short tap vibration (
                            {isVibrationSupported()
                                ? "supported on this device"
                                : "not supported on this browser"}
                            )
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={s.featureFlags?.categoryWheel ?? false}
                                onChange={e =>
                                    a.setFeatureFlags({ categoryWheel: e.target.checked })
                                }
                            />{" "}
                            Category wheel (right-click / Shift+F10)
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={s.featureFlags?.scribblePractice ?? false}
                                onChange={e =>
                                    a.setFeatureFlags({ scribblePractice: e.target.checked })
                                }
                            />{" "}
                            Scribble &amp; handwriting practice area (Puter / Tesseract / Local OCR)
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={s.featureFlags?.parentChildChat ?? false}
                                onChange={e =>
                                    a.setFeatureFlags({ parentChildChat: e.target.checked })
                                }
                            />{" "}
                            Parent–child chat (real-time with local fallback)
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={s.featureFlags?.pinnedVocabulary ?? false}
                                onChange={e =>
                                    a.setFeatureFlags({ pinnedVocabulary: e.target.checked })
                                }
                            />{" "}
                            Pinned core vocabulary bar
                        </label>
                    </fieldset>
                </>
            )}
        </Modal>
    );
}
