"use client";

import { useState, type ReactNode } from "react";
import {
    X,
    Check,
    Sliders,
    Grid3X3,
    Volume2,
    Lock,
    RotateCcw,
    AlertTriangle,
    Palette
} from "lucide-react";
import {
    GRID_LIMITS,
    GRID_PRESETS,
    COLOR_SYSTEMS,
    type ColorSystemId
} from "@/lib/board";
import { useBoardSettingsViewModel } from "@/viewmodels/useBoardSettingsViewModel";

type SettingsTab = "grid" | "appearance" | "speech" | "access" | "colorSystem";

interface BoardSettingsProps {
    open: boolean;
    onClose: () => void;
    boardId?: string;
    onBoardReset?: () => void;
    mode?: "settings" | "layout";
}

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
    { id: "colorSystem", label: "Color Key", icon: <Palette className="h-4 w-4" /> },
    { id: "speech", label: "Speech", icon: <Volume2 className="h-4 w-4" /> },
    { id: "access", label: "Access", icon: <Lock className="h-4 w-4" /> }
];

const LAYOUT_TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
    { id: "grid", label: "Grid", icon: <Grid3X3 className="h-4 w-4" /> },
    { id: "appearance", label: "Appearance", icon: <Sliders className="h-4 w-4" /> }
];

export function BoardSettings({
    open,
    onClose,
    boardId,
    onBoardReset,
    mode = "settings"
}: BoardSettingsProps) {
    const defaultTab = mode === "layout" ? "grid" : "colorSystem";
    const [tab, setTab] = useState<SettingsTab>(defaultTab);
    const [confirmReset, setConfirmReset] = useState(false);

    const tabs = mode === "layout" ? LAYOUT_TABS : SETTINGS_TABS;

    const {
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
    } = useBoardSettingsViewModel(open, boardId, onBoardReset);

    if (!open) return null;

    const handleSave = () => {
        applyAllChanges();
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#465365]/40 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[#DCEEFF] bg-white shadow-2xl font-sans text-[#465365]"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-200 bg-[#FFF9EC] px-6 py-4">
                    <div>
                        <h2 className="font-nunito text-lg font-extrabold text-[#465365]">
                            {mode === "layout" ? "Board Layout" : "Board Settings"}
                        </h2>
                        <p className="font-sans text-xs text-[#465365]/75">
                            {mode === "layout"
                                ? "Configure grid layout and tile appearance."
                                : "Configure color coding systems, speech, and caregiver access."}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close modal"
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#465365] hover:bg-[#DCEEFF]/50"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div
                    className="grid gap-1.5 border-b border-slate-200 bg-[#FFF9EC]/60 px-6 py-2.5"
                    style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
                >
                    {tabs.map(item => {
                        const active = tab === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setTab(item.id)}
                                className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all ${
                                    active
                                        ? "border border-[#B6D8FA] bg-[#DCEEFF] text-[#465365] shadow-sm"
                                        : "text-[#465365]/70 hover:bg-[#DCEEFF]/40 hover:text-[#465365]"
                                }`}
                            >
                                {item.icon}
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 space-y-5 overflow-y-auto p-6 font-sans">
                    {tab === "grid" && (
                        <>
                            {board && (
                                <div className="space-y-2">
                                    <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                                        Scope
                                    </span>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => changeScope("this")}
                                            className={`rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition-all ${
                                                scope === "this"
                                                    ? "border-[#B6D8FA] bg-[#DCEEFF] text-[#465365]"
                                                    : "border-slate-200 bg-[#FFF9EC]/50 text-[#465365]/80 hover:bg-[#DCEEFF]/40"
                                            }`}
                                        >
                                            This board ({board.name})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => changeScope("all")}
                                            className={`rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition-all ${
                                                scope === "all"
                                                    ? "border-[#B6D8FA] bg-[#DCEEFF] text-[#465365]"
                                                    : "border-slate-200 bg-[#FFF9EC]/50 text-[#465365]/80 hover:bg-[#DCEEFF]/40"
                                            }`}
                                        >
                                            All boards (global default)
                                        </button>
                                    </div>
                                    {hasBoardOverride && scope === "all" && (
                                        <p className="text-xs text-[#465365]">
                                            Saving under All boards will remove the custom grid override on{" "}
                                            <strong>{board.name}</strong>.
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="space-y-2">
                                <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                                    Layout mode
                                </span>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => changeDraftMode("manual")}
                                        className={`rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition-all ${
                                            draftMode === "manual"
                                                ? "border-[#B6D8FA] bg-[#DCEEFF] text-[#465365]"
                                                : "border-slate-200 bg-[#FFF9EC]/50 text-[#465365]/80 hover:bg-[#DCEEFF]/40"
                                        }`}
                                    >
                                        Manual grid
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => changeDraftMode("automatic")}
                                        className={`rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition-all ${
                                            draftMode === "automatic"
                                                ? "border-[#B6D8FA] bg-[#DCEEFF] text-[#465365]"
                                                : "border-slate-200 bg-[#FFF9EC]/50 text-[#465365]/80 hover:bg-[#DCEEFF]/40"
                                        }`}
                                    >
                                        Automatic fit
                                    </button>
                                </div>
                            </div>

                            {!isAutomatic ? (
                                <>
                                    <div className="space-y-2">
                                        <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                                            Grid presets
                                        </span>
                                        <div className="flex flex-wrap gap-2">
                                            {GRID_PRESETS.map(preset => {
                                                const active =
                                                    draftGrid.rows === preset.rows &&
                                                    draftGrid.cols === preset.cols;
                                                return (
                                                    <button
                                                        key={`${preset.rows}x${preset.cols}`}
                                                        type="button"
                                                        onClick={() => changeDraftGrid(preset)}
                                                        className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                                                            active
                                                                ? "border-[#B6D8FA] bg-[#DCEEFF] text-[#465365]"
                                                                : "border-slate-200 bg-white text-[#465365]/80 hover:bg-[#DCEEFF]/40"
                                                        }`}
                                                    >
                                                        {preset.rows} × {preset.cols}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <Stepper
                                            label="Rows"
                                            value={draftGrid.rows}
                                            min={GRID_LIMITS.minRows}
                                            max={GRID_LIMITS.maxRows}
                                            onChange={rows =>
                                                changeDraftGrid({ ...draftGrid, rows })
                                            }
                                        />
                                        <Stepper
                                            label="Columns"
                                            value={draftGrid.cols}
                                            min={GRID_LIMITS.minCols}
                                            max={GRID_LIMITS.maxCols}
                                            onChange={cols =>
                                                changeDraftGrid({ ...draftGrid, cols })
                                            }
                                        />
                                    </div>

                                    <div className="rounded-2xl border border-[#F0D382] bg-[#FFF9EC] p-4 text-xs text-[#465365]">
                                        <p className="font-bold text-[#465365]">
                                            Capacity: {draftGrid.rows * draftGrid.cols} slots per page ·
                                            Estimated pages: {estimatedPages}
                                        </p>
                                        {outOfBoundsTiles > 0 && (
                                            <div className="mt-2 flex items-center justify-between gap-2">
                                                <span>
                                                    {outOfBoundsTiles} tile(s) sit outside{" "}
                                                    {draftGrid.rows} × {draftGrid.cols}.
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={reflowTiles}
                                                    className="rounded-lg border border-[#F0D382] bg-[#FFE9A8] px-2.5 py-1 font-bold text-[#465365] hover:bg-[#FFE9A8]/80"
                                                >
                                                    Reflow now
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="rounded-2xl border border-slate-200 bg-[#FFF9EC] p-4 text-xs text-[#465365]">
                                    Automatic mode fits all tiles on a single responsive page based on
                                    your tile width and height percentages.
                                </div>
                            )}
                        </>
                    )}

                    {tab === "appearance" && (
                        <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Segmented
                                    label="Label position"
                                    value={draftAppearance.labelPosition}
                                    options={[
                                        { label: "Bottom", value: "bottom" },
                                        { label: "Top", value: "top" }
                                    ]}
                                    onChange={labelPosition =>
                                        patchAppearance({ labelPosition })
                                    }
                                />
                                <Segmented
                                    label="Show icons"
                                    value={draftAppearance.showIcons ? "yes" : "no"}
                                    options={[
                                        { label: "Show", value: "yes" },
                                        { label: "Hide", value: "no" }
                                    ]}
                                    onChange={v => patchAppearance({ showIcons: v === "yes" })}
                                />
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <Segmented
                                    label="Text size"
                                    value={draftAppearance.fontScale}
                                    options={[
                                        { label: "Small", value: "sm" },
                                        { label: "Medium", value: "md" },
                                        { label: "Large", value: "lg" }
                                    ]}
                                    onChange={fontScale => patchAppearance({ fontScale })}
                                />
                                <Segmented
                                    label="Icon size"
                                    value={draftAppearance.iconScale}
                                    options={[
                                        { label: "Small", value: "sm" },
                                        { label: "Medium", value: "md" },
                                        { label: "Large", value: "lg" }
                                    ]}
                                    onChange={iconScale => patchAppearance({ iconScale })}
                                />
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <Segmented
                                    label="Grid spacing"
                                    value={draftAppearance.gridGap}
                                    options={[
                                        { label: "Compact", value: "compact" },
                                        { label: "Normal", value: "normal" },
                                        { label: "Relaxed", value: "relaxed" }
                                    ]}
                                    onChange={gridGap => patchAppearance({ gridGap })}
                                />
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <DimensionSlider
                                    label="Tile width"
                                    value={draftAppearance.tileWidth}
                                    onChange={tileWidth => patchAppearance({ tileWidth })}
                                />
                                <DimensionSlider
                                    label="Tile height"
                                    value={draftAppearance.tileHeight}
                                    onChange={tileHeight => patchAppearance({ tileHeight })}
                                />
                            </div>
                        </div>
                    )}

                    {tab === "colorSystem" && (
                        <div className="space-y-5">
                            <div className="space-y-2">
                                <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                                    Color Coding System
                                </span>
                                <div className="grid grid-cols-3 gap-2">
                                    {(Object.keys(COLOR_SYSTEMS) as ColorSystemId[]).map(
                                        systemId => {
                                            const active = draftColorSystem === systemId;
                                            return (
                                                <button
                                                    key={systemId}
                                                    type="button"
                                                    onClick={() => changeDraftColorSystem(systemId)}
                                                    className={`rounded-xl border px-3 py-2.5 text-center text-xs font-bold transition-all ${
                                                        active
                                                            ? "border-[#B6D8FA] bg-[#DCEEFF] text-[#465365] shadow-sm"
                                                            : "border-slate-200 bg-[#FFF9EC]/50 text-[#465365]/80 hover:bg-[#DCEEFF]/40"
                                                    }`}
                                                >
                                                    {COLOR_SYSTEMS[systemId].label}
                                                </button>
                                            );
                                        }
                                    )}
                                </div>
                                <p className="text-xs leading-relaxed text-[#465365]/75">
                                    {draftColorSystem === "custom"
                                        ? "Create and customize your own catalogs, tile colors, and word-class schemes."
                                        : "Uses standard AAC color-coded catalogs. Your Custom Colors layout stays preserved. Click Save changes to apply."}
                                </p>
                            </div>

                            <div className="space-y-3">
                                <Segmented
                                    label="Tile color mode"
                                    value={draftAppearance.colorMode}
                                    disabled={draftColorSystem !== "custom"}
                                    options={[
                                        { label: "Catalog", value: "catalog" },
                                        { label: "Word class", value: "wordClass" }
                                    ]}
                                    onChange={colorMode => patchAppearance({ colorMode })}
                                />
                            </div>
                        </div>
                    )}

                    {tab === "speech" && (
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                                        Speech volume
                                    </span>
                                    <span className="text-xs font-bold text-[#465365]">
                                        {Math.round(draftSpeech.volume * 100)}%
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={draftSpeech.volume}
                                    onChange={e =>
                                        patchSpeech({ volume: Number(e.target.value) })
                                    }
                                    className="w-full accent-[#465365]"
                                />
                            </div>

                            <Segmented
                                label="Speak tile when tapped"
                                value={draftSpeech.speakOnTap ? "yes" : "no"}
                                options={[
                                    { label: "Enabled", value: "yes" },
                                    { label: "Silent", value: "no" }
                                ]}
                                onChange={v => patchSpeech({ speakOnTap: v === "yes" })}
                            />

                            <Segmented
                                label="Auto-clear sentence strip"
                                value={draftSpeech.autoClear}
                                options={[
                                    { label: "Off", value: "off" },
                                    { label: "After speak", value: "afterSpeak" },
                                    { label: "On next tap", value: "nextTap" }
                                ]}
                                onChange={autoClear => patchSpeech({ autoClear })}
                            />
                        </div>
                    )}

                    {tab === "access" && (
                        <div className="space-y-5">
                            <div className="space-y-2">
                                <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                                    Edit mode PIN
                                </span>
                                {draftAccess.editPin ? (
                                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-[#FFF9EC] px-4 py-3">
                                        <span className="text-xs font-bold text-[#465365]">
                                            4-digit PIN protection is active
                                        </span>
                                        <button
                                            type="button"
                                            onClick={removePin}
                                            className="rounded-xl border border-[#F2C4B1] bg-[#FFDFD1] px-3 py-1.5 text-xs font-bold text-[#465365] hover:bg-[#FFDFD1]/80"
                                        >
                                            Remove PIN
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <input
                                            type="password"
                                            inputMode="numeric"
                                            maxLength={4}
                                            value={pinInput}
                                            onChange={e =>
                                                setPinInput(e.target.value.replace(/\D/g, ""))
                                            }
                                            placeholder="Enter 4-digit PIN"
                                            className="h-11 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-[#465365] focus:border-[#B6D8FA] focus:outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={savePin}
                                            className="h-11 rounded-xl border border-[#B6D8FA] bg-[#DCEEFF] px-4 text-xs font-bold text-[#465365] hover:bg-[#C6E2FF]"
                                        >
                                            Set PIN
                                        </button>
                                    </div>
                                )}
                                {pinError && (
                                    <p className="text-xs font-semibold text-[#465365]">
                                        {pinError}
                                    </p>
                                )}
                            </div>

                            <Segmented
                                label="Long-press tile to edit"
                                value={draftAccess.longPressToEdit ? "yes" : "no"}
                                options={[
                                    { label: "Enabled", value: "yes" },
                                    { label: "Disabled", value: "no" }
                                ]}
                                onChange={v =>
                                    patchAccess({ longPressToEdit: v === "yes" })
                                }
                            />

                            <div className="grid gap-4 sm:grid-cols-3">
                                <Stepper
                                    label="Hold (ms)"
                                    value={draftAccess.holdDurationMs}
                                    min={250}
                                    max={2000}
                                    step={50}
                                    onChange={holdDurationMs =>
                                        patchAccess({ holdDurationMs })
                                    }
                                />
                                <Stepper
                                    label="Tolerance (px)"
                                    value={draftAccess.moveTolerancePx}
                                    min={4}
                                    max={40}
                                    step={2}
                                    onChange={moveTolerancePx =>
                                        patchAccess({ moveTolerancePx })
                                    }
                                />
                                <Stepper
                                    label="Swipe (px)"
                                    value={draftAccess.swipeThresholdPx}
                                    min={20}
                                    max={150}
                                    step={5}
                                    onChange={swipeThresholdPx =>
                                        patchAccess({ swipeThresholdPx })
                                    }
                                />
                            </div>

                            <div className="rounded-2xl border border-[#F2C4B1] bg-[#FFDFD1]/50 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="font-nunito text-xs font-extrabold text-[#465365]">
                                            Reset board data
                                        </p>
                                        <p className="mt-0.5 text-xs text-[#465365]/80">
                                            Restores default catalogs, vocabulary, and grid settings.
                                        </p>
                                    </div>
                                    {!confirmReset ? (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmReset(true)}
                                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#F2C4B1] bg-white px-3 py-2 text-xs font-bold text-[#465365] hover:bg-[#FFDFD1]"
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                            Reset
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={resetEverything}
                                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#F2C4B1] bg-[#FFDFD1] px-3 py-2 text-xs font-bold text-[#465365] hover:bg-[#FFDFD1]/80"
                                        >
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            Confirm reset
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 bg-[#FFF9EC] px-6 py-4">
                    <span className="text-xs font-bold text-[#465365]">
                        {savedNotice ? "Settings saved" : ""}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-[#465365]/80 hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-[#B6D8FA] bg-[#DCEEFF] px-5 text-sm font-bold text-[#465365] hover:bg-[#C6E2FF]"
                        >
                            <Check className="h-4 w-4" />
                            Save changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Stepper({
    label,
    value,
    min,
    max,
    step = 1,
    onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
}) {
    return (
        <div className="space-y-1.5">
            <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                {label}
            </span>
            <div className="flex h-11 items-center justify-between rounded-xl border border-slate-200 bg-white px-2">
                <button
                    type="button"
                    onClick={() => onChange(Math.max(min, value - step))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-[#465365] hover:bg-[#DCEEFF]/50"
                >
                    -
                </button>
                <span className="text-sm font-bold text-[#465365]">{value}</span>
                <button
                    type="button"
                    onClick={() => onChange(Math.min(max, value + step))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-[#465365] hover:bg-[#DCEEFF]/50"
                >
                    +
                </button>
            </div>
        </div>
    );
}

function DimensionSlider({
    label,
    value,
    onChange
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                    {label}
                </span>
                <span className="text-xs font-bold text-[#465365]">{value}%</span>
            </div>
            <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="w-full accent-[#465365]"
            />
        </div>
    );
}

function Segmented<T extends string>({
    label,
    value,
    options,
    disabled = false,
    onChange
}: {
    label: string;
    value: T;
    options: { label: string; value: T }[];
    disabled?: boolean;
    onChange: (value: T) => void;
}) {
    return (
        <div className="space-y-1.5">
            <span className="font-nunito text-[11px] font-bold uppercase tracking-wider text-[#465365]/70">
                {label}
            </span>
            <div
                className="grid gap-1.5 rounded-xl bg-[#FFF9EC] border border-slate-200/70 p-1"
                style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
            >
                {options.map(option => {
                    const active = option.value === value;
                    const stateClasses = active
                        ? "border border-[#B6D8FA] bg-[#DCEEFF] text-[#465365] shadow-sm"
                        : "text-[#465365]/75 hover:text-[#465365] hover:bg-white/60";
                    return (
                        <button
                            key={option.value}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                                if (!disabled) onChange(option.value);
                            }}
                            className={`rounded-lg py-2 text-xs font-bold transition-all ${stateClasses} ${
                                disabled ? "cursor-not-allowed opacity-50" : ""
                            }`}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}