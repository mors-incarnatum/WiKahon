"use client";
/* eslint-disable @next/next/no-img-element */
import {
    ICONS,
    WORD_COLORS,
    isSpeechIcon,
    type ColorKey,
    type WordClass,
    type LanguageTag,
    type Tile,
} from "@/lib/board";
import { palette } from "@/app/theme";
import { useTileEditorViewModel, type TileEditorTarget } from "@/viewmodels/useTileEditorViewModel";
import { useMediaUrl } from "@/viewmodels/useMediaUrl";
import { TileVisual } from "./TileButton";
import Modal from "./Modal";

function WordGalleryItem({
    tile,
    selected,
    disabled,
    onSelect,
}: {
    tile: Tile;
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
}) {
    const { src } = useMediaUrl(tile.iconName, tile.mediaId);
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={onSelect}
        >
            {isSpeechIcon(tile.iconName) && !tile.mediaId ? (
                <span aria-hidden="true" className="text-2xl">
                    💬
                </span>
            ) : src ? (
                <img src={src} alt="" />
            ) : null}
            <span>{tile.label}</span>
            {disabled && <span className="text-[10px] opacity-75">On board</span>}
        </button>
    );
}

export default function TileEditor(props: TileEditorTarget) {
    const { state: s, actions: a } = useTileEditorViewModel(props);
    const tabs = props.multi ? ["existing", "custom"] : ["existing", "custom", "folder"];
    return (
        <Modal label="Tile editor" onClose={props.onClose} className="editor-modal">
            <div className="modal-heading">
                <h2>{props.multi ? "Add words to catalog" : "Customize tile"}</h2>
                <button type="button" onClick={props.onClose} aria-label="Close tile editor">
                    ✕
                </button>
            </div>
            <div className="editor-columns">
                <div>
                    <div className="tab-row" role="tablist" aria-label="Tile type">
                        {tabs.map(tab => (
                            <button
                                key={tab}
                                type="button"
                                role="tab"
                                aria-selected={s.tab === tab}
                                onClick={() => a.setTab(tab)}
                            >
                                {tab === "existing" ? "Existing words" : tab === "custom" ? "Create / Edit word" : "Folder"}
                            </button>
                        ))}
                    </div>

                    {s.tab === "existing" && (
                        <>
                            <label>
                                Search words
                                <input value={s.query} onChange={e => a.setQuery(e.target.value)} />
                            </label>
                            <div className="filter-pills">
                                <button type="button" aria-pressed={s.filter === "all"} onClick={() => a.setFilter("all")}>
                                    All words
                                </button>
                                {s.catalogs.map(b => (
                                    <button
                                        key={b.id}
                                        type="button"
                                        aria-pressed={s.filter === b.id}
                                        onClick={() => a.setFilter(b.id)}
                                    >
                                        {b.shortName}
                                    </button>
                                ))}
                            </div>
                            <div className="word-gallery">
                                {s.words.map(t => (
                                    <WordGalleryItem
                                        key={t.id}
                                        tile={t}
                                        selected={props.multi ? s.picked.includes(t.id) : s.selectedExisting?.id === t.id}
                                        disabled={Boolean(props.multi && s.alreadyOnBoardIds.has(t.id))}
                                        onSelect={() => a.chooseWord(t)}
                                    />
                                ))}
                            </div>
                            {s.words.length === 0 && <p>No matching words.</p>}
                            <button
                                type="button"
                                className="primary"
                                disabled={props.multi ? !s.picked.length : !s.canSave}
                                onClick={a.saveExisting}
                            >
                                {props.multi ? `Add ${s.picked.length} selected words` : "Use selected word"}
                            </button>
                        </>
                    )}

                    {s.tab === "custom" && (
                        <>
                            {s.isEditingWord && s.usageCount > 1 && (
                                <p className="edit-notice" role="status">
                                    Used in {s.usageCount} board slots. Saving updates all placements, or save as a new copy.
                                </p>
                            )}
                            <label>
                                Label
                                <input value={s.customDraft.label} onChange={e => a.patch({ label: e.target.value })} />
                            </label>
                            <label>
                                Spoken text (optional)
                                <input
                                    value={s.customDraft.spokenText ?? ""}
                                    onChange={e => a.patch({ spokenText: e.target.value })}
                                    placeholder="Defaults to the label"
                                />
                            </label>
                            <div className="field-row">
                                <label>
                                    Language
                                    <select
                                        value={s.customDraft.language ?? "fil"}
                                        onChange={e => a.setLanguage(e.target.value as LanguageTag)}
                                    >
                                        <option value="fil">Filipino</option>
                                        <option value="en">English</option>
                                        <option value="taglish">Taglish</option>
                                    </select>
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(s.customDraft.isQuickPhrase)}
                                        onChange={e => a.patch({ isQuickPhrase: e.target.checked })}
                                    />{" "}
                                    Quick phrase
                                </label>
                            </div>
                            <label>
                                Catalog
                                <select value={s.customDraft.categoryId} onChange={e => a.patch({ categoryId: e.target.value })}>
                                    {s.customDraft.categoryId === "home" && <option value="home">Home</option>}
                                    {!s.catalogs.some(b => b.id === s.customDraft.categoryId) &&
                                        s.customDraft.categoryId !== "home" && (
                                            <option value={s.customDraft.categoryId}>{s.customDraft.categoryId}</option>
                                        )}
                                    {s.catalogs.map(b => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                Color
                                <select
                                    value={s.customDraft.colorKey ?? ""}
                                    onChange={e => a.patch({ colorKey: (e.target.value || undefined) as ColorKey | undefined })}
                                >
                                    <option value="">Use catalog color</option>
                                    {Object.keys(palette).map(c => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                Word class (modified palette)
                                <select
                                    value={s.customDraft.wordClass ?? "other"}
                                    onChange={e => a.setWordClass(e.target.value as WordClass)}
                                >
                                    {Object.keys(WORD_COLORS).map(c => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <fieldset>
                                <legend>Upload familiar photo (JPEG, PNG, WebP up to 10 MB)</legend>
                                <div className="field-row">
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        aria-label="Upload tile photo"
                                        onChange={e => {
                                            const file = e.target.files?.[0];
                                            e.currentTarget.value = "";
                                            void a.uploadPhoto(file);
                                        }}
                                    />
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={s.cropSquare}
                                            onChange={e => a.setCropSquare(e.target.checked)}
                                        />{" "}
                                        Crop square
                                    </label>
                                    {s.customDraft.mediaId && (
                                        <button type="button" onClick={a.removePhoto}>
                                            Remove photo
                                        </button>
                                    )}
                                </div>
                                {s.uploadingPhoto && <p role="status">Processing photo…</p>}
                                {s.photoError && <p role="alert">{s.photoError}</p>}
                            </fieldset>

                            <fieldset>
                                <legend>Choose a symbol</legend>
                                <div className="icon-gallery">
                                    <button
                                        type="button"
                                        aria-pressed={s.customDraft.iconName === null && !s.customDraft.mediaId}
                                        onClick={() => a.patch({ iconName: null })}
                                    >
                                        Text only
                                    </button>
                                    <button
                                        type="button"
                                        aria-pressed={isSpeechIcon(s.customDraft.iconName)}
                                        onClick={() => a.patch({ iconName: "speech" })}
                                    >
                                        💬 Speech
                                    </button>
                                    {ICONS.map(icon => (
                                        <button
                                            key={icon.name}
                                            type="button"
                                            aria-label={icon.label}
                                            aria-pressed={s.customDraft.iconName === icon.name}
                                            onClick={() => a.patch({ iconName: icon.name })}
                                        >
                                            <img src={icon.stillPath} alt="" />
                                            <span>{icon.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                            <div className="field-row">
                                <button type="button" className="primary" disabled={!s.canSave} onClick={a.saveCustom}>
                                    Save word
                                </button>
                                {s.isEditingWord && (
                                    <button type="button" disabled={!s.canSave} onClick={a.saveCustomAsCopy}>
                                        Save as new word
                                    </button>
                                )}
                                {s.isEditingWord && !s.confirmDeleteWord && (
                                    <button
                                        type="button"
                                        className="danger"
                                        onClick={() => a.setConfirmDeleteWord(true)}
                                    >
                                        Delete word
                                    </button>
                                )}
                            </div>
                            {s.isEditingWord && s.confirmDeleteWord && (
                                <div className="edit-notice" role="alert">
                                    <p>
                                        Delete &ldquo;{s.customDraft.label}&rdquo; permanently from your word library
                                        {s.usageCount > 0 ? ` (${s.usageCount} board ${s.usageCount === 1 ? "slot" : "slots"})` : ""}?
                                    </p>
                                    <div className="field-row">
                                        <button type="button" className="danger" onClick={a.deleteWord}>
                                            Confirm delete
                                        </button>
                                        <button type="button" onClick={() => a.setConfirmDeleteWord(false)}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {s.tab === "folder" && !props.multi && (
                        <>
                            <p>Open a catalog without clearing the sentence.</p>
                            <div className="filter-pills">
                                {s.catalogs.map(b => (
                                    <button
                                        key={b.id}
                                        type="button"
                                        aria-pressed={s.selectedFolder?.targetBoardId === b.id}
                                        onClick={() => a.chooseFolder(b.id)}
                                    >
                                        ▰ {b.name}
                                    </button>
                                ))}
                            </div>
                            {s.canCreateCatalog && (
                                <>
                                    <label>
                                        New catalog name
                                        <input value={s.folderName} onChange={e => a.setFolderName(e.target.value)} />
                                    </label>
                                    <button type="button" disabled={!s.folderName.trim()} onClick={a.createFolder}>
                                        Create catalog
                                    </button>
                                </>
                            )}
                            <button
                                type="button"
                                className="primary"
                                disabled={!s.canSave}
                                onClick={a.saveFolder}
                            >
                                Place folder
                            </button>
                        </>
                    )}
                </div>
                <aside className="preview-panel">
                    <h3>Live tile preview</h3>
                    <div className="tile-preview">
                        <TileVisual
                            tile={s.preview}
                            color={s.previewColor}
                        />
                    </div>
                    <p>{s.preview.spokenText || s.preview.label || "Choose a word or create your own."}</p>
                    <button
                        type="button"
                        disabled={!s.canSave || s.preview.kind === "folder"}
                        onClick={a.testSpeak}
                    >
                        🔊 Test speak
                    </button>
                </aside>
            </div>
        </Modal>
    );
}
