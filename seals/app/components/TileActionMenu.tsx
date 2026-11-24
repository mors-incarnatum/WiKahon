"use client";
import Modal from "./Modal";

export default function TileActionMenu({
    label,
    hidden,
    canPin,
    pinned,
    onClose,
    onEdit,
    onReplace,
    onMove,
    onHide,
    onTogglePin,
    onRemove,
}: {
    label: string;
    hidden: boolean;
    canPin?: boolean;
    pinned?: boolean;
    onClose: () => void;
    onEdit: () => void;
    onReplace: () => void;
    onMove: () => void;
    onHide: () => void;
    onTogglePin?: () => void;
    onRemove: () => void;
}) {
    return (
        <Modal label={`Actions for ${label}`} onClose={onClose} className="editor-modal small-modal">
            <h2>{label}</h2>
            <div className="action-list">
                <button type="button" onClick={onEdit}>Edit Tile</button>
                <button type="button" onClick={onReplace}>Replace</button>
                <button type="button" onClick={onMove}>Move / Swap</button>
                <button type="button" onClick={onHide}>{hidden ? "Unhide" : "Hide"}</button>
                {canPin && onTogglePin && (
                    <button type="button" onClick={onTogglePin}>{pinned ? "Unpin word" : "Pin word"}</button>
                )}
                <button type="button" className="danger" onClick={onRemove}>
                    Remove from board
                </button>
                <button type="button" onClick={onClose}>Cancel</button>
            </div>
        </Modal>
    );
}
