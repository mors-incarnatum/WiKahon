"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { ICONS, SPEECH_ICON_NAME, iconPath, isSpeechIcon, COLOR_SYSTEMS } from "@/lib/board";
import { palette, COLOR_KEYS } from "@/app/theme";
import { useCatalogManagerViewModel } from "@/viewmodels/useCatalogManagerViewModel";
import { useEditContext } from "@/viewmodels/useEditModeViewModel";
import Modal from "./Modal";
import TileEditor from "./TileEditor";

export default function CatalogManager({ onClose }: { onClose: () => void }) {
    const { state: s, actions: a } = useCatalogManagerViewModel();
    const edit = useEditContext();
    const canManage = edit.state.isGuardian;
    const isPreset = s.colorSystem !== "custom";
    const formRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (s.selected) {
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [s.selected]);

    return (
        <Modal
            label="Catalogs and boards"
            onClose={onClose}
            className="w-full max-w-2xl max-h-[90dvh] overflow-hidden rounded-3xl border border-[#DCEEFF] bg-white p-0 text-[#465365] shadow-2xl"
        >
            <div className="flex items-center justify-between gap-3 border-b border-[#DCEEFF] bg-[#F2F8FF] px-6 py-4">
                <div>
                    <h2 className="font-heading text-lg font-extrabold">Catalogs &amp; Boards</h2>
                    <p className="text-xs text-[#465365]/75">
                        Organize vocabulary boards, create custom catalogs, and place folders on Home.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {isPreset ? (
                        <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">
                            {COLOR_SYSTEMS[s.colorSystem].label} (fixed catalogs)
                        </span>
                    ) : canManage && (
                        <button type="button" onClick={a.startCreate} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#B6D8FA] bg-[#DCEEFF] px-3.5 text-sm font-bold">
                            <span aria-hidden="true">+</span> New catalog
                        </button>
                    )}
                    <button type="button" onClick={onClose} aria-label="Close catalog manager" className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white">
                        <span aria-hidden="true">✕</span>
                    </button>
                </div>
            </div>
            <div className="max-h-[calc(90dvh-6rem)] space-y-3 overflow-y-auto p-6">
                {s.catalogs.map((b, index) => {
                    const p = palette[b.colorKey];
                    const src = iconPath(b.iconName);
                    const count = b.pages.reduce((sum, page) => sum + Object.keys(page.cells).length, 0);
                    const onHome = s.homeCatalogIds.has(b.id);
                    return (
                        <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                            <Link href={`/board/${encodeURIComponent(b.id)}`} onClick={onClose} className="flex items-center gap-3">
                                <span className="flex h-11 w-11 items-center justify-center rounded-xl border-2" style={{ background: p.bg, borderColor: p.border }}>
                                    {isSpeechIcon(b.iconName) ? (
                                        <span aria-hidden="true" className="text-xl">💬</span>
                                    ) : (
                                        src && <img src={src} alt="" className="h-7 w-7 object-contain" />
                                    )}
                                </span>
                                <span>
                                    <span className="block font-heading font-bold">
                                        {b.name} {b.isBuiltIn && <span className="rounded-md border border-[#DCEEFF] bg-[#F2F8FF] px-2 py-0.5 text-[10px] uppercase">Built-in</span>}
                                    </span>
                                    <span className="text-xs text-[#465365]/70">{count} {count === 1 ? "tile" : "tiles"}</span>
                                </span>
                            </Link>
                            {canManage && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <button type="button" onClick={() => a.setAdding(b.id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold">
                                        <span aria-hidden="true">+</span> Words
                                    </button>
                                    {onHome ? (
                                        <button
                                            type="button"
                                            onClick={() => a.removeFolderFromHome(b.id)}
                                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-[#DDF1E3] px-2.5 text-xs font-bold"
                                        >
                                            <span aria-hidden="true">▰</span> Remove from Home
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => a.placeFolder(b.id)}
                                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold"
                                        >
                                            <span aria-hidden="true">▰</span> To Home
                                        </button>
                                    )}
                                    <button type="button" onClick={() => a.reorder(b.id, -1)} disabled={index === 0} aria-label={`Move ${b.name} earlier`} className="rounded-lg border border-slate-200 p-2 disabled:opacity-30">
                                        <span aria-hidden="true">↑</span>
                                    </button>
                                    <button type="button" onClick={() => a.reorder(b.id, 1)} disabled={index === s.catalogs.length - 1} aria-label={`Move ${b.name} later`} className="rounded-lg border border-slate-200 p-2 disabled:opacity-30">
                                        <span aria-hidden="true">↓</span>
                                    </button>
                                    {!isPreset && (
                                        <button type="button" onClick={() => a.select(b.id)} aria-label={`Edit ${b.name}`} className="rounded-lg border border-slate-200 p-2">
                                            <span aria-hidden="true">✎</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                {s.message && <p role="status">{s.message}</p>}
                {canManage && !isPreset && s.selected && (
                    <div ref={formRef} className="space-y-3 rounded-2xl border border-[#DCEEFF] bg-[#F2F8FF] p-4">
                        <div className="flex justify-between">
                            <h3 className="font-heading text-xs font-bold uppercase">{s.selected === "new" ? "Create catalog" : "Edit catalog"}</h3>
                            <button type="button" onClick={a.reset} className="text-xs font-semibold">Cancel</button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs">
                                Name
                                <input value={s.name} onChange={e => a.setName(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" />
                            </label>
                            <label className="text-xs">
                                Short wheel label
                                <input value={s.shortName} onChange={e => a.setShortName(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" />
                            </label>
                        </div>
                        <fieldset>
                            <legend className="text-xs">Color</legend>
                            <div className="flex flex-wrap gap-2">
                                {COLOR_KEYS.map(key => (
                                    <button key={key} type="button" aria-label={key} aria-pressed={s.colorKey === key} onClick={() => a.setColor(key)}
                                        className={`h-8 w-8 rounded-full border-2 ${s.colorKey === key ? "scale-110 border-[#465365]" : "border-slate-200"}`}
                                        style={{ backgroundColor: palette[key].surface }} />
                                ))}
                            </div>
                        </fieldset>
                        <fieldset>
                            <legend className="text-xs">Icon</legend>
                            <div className="grid max-h-28 grid-cols-6 gap-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 sm:grid-cols-8">
                                <button type="button" aria-pressed={s.iconName === null} onClick={() => a.setIcon(null)} className="text-xs">Text only</button>
                                <button type="button" aria-label="Speech" aria-pressed={isSpeechIcon(s.iconName)} onClick={() => a.setIcon(SPEECH_ICON_NAME)}
                                    className={`flex items-center justify-center rounded-lg border p-1.5 text-base ${isSpeechIcon(s.iconName) ? "border-[#B6D8FA] bg-[#DCEEFF]" : "border-transparent"}`}>
                                    💬
                                </button>
                                {ICONS.map(icon => (
                                    <button key={icon.name} type="button" aria-label={icon.label} aria-pressed={s.iconName === icon.name} onClick={() => a.setIcon(icon.name)}
                                        className={`flex justify-center rounded-lg border p-1.5 ${s.iconName === icon.name ? "border-[#B6D8FA] bg-[#DCEEFF]" : "border-transparent"}`}>
                                        <img src={icon.stillPath} alt="" className="h-6 w-6 object-contain" />
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        {s.selected === "new" && (
                            <label className="flex items-center gap-2 text-xs font-semibold">
                                <input type="checkbox" checked={s.placeOnHome} onChange={e => a.setPlace(e.target.checked)} />
                                Place folder tile on Home board
                            </label>
                        )}
                        <div className="flex justify-between">
                            {s.selected !== "new" && !s.catalogs.find(b => b.id === s.selected)?.isBuiltIn ? (
                                <button type="button" onClick={() => a.setDelete(s.selected)} className="inline-flex items-center gap-1 rounded-xl border border-[#F2C4B1] bg-[#FFDFD1] px-3 py-2 text-xs font-bold">
                                    <span aria-hidden="true">✕</span> Delete catalog
                                </button>
                            ) : <span />}
                            <button type="button" disabled={!s.name.trim()} onClick={a.save} className="inline-flex items-center gap-1 rounded-xl border border-[#B6D8FA] bg-[#DCEEFF] px-4 py-2 text-xs font-bold disabled:opacity-40">
                                <span aria-hidden="true">✓</span> Save catalog
                            </button>
                        </div>
                    </div>
                )}
            </div>
            {s.confirmDelete && canManage && (
                <Modal label="Delete catalog" onClose={() => a.setDelete(null)} className="editor-modal small-modal">
                    <h2>Delete this catalog?</h2>
                    <p>Folder links will be removed. Words remain in the library.</p>
                    <button className="danger" onClick={a.deleteConfirmed}>Delete catalog</button>
                    <button onClick={() => a.setDelete(null)}>Cancel</button>
                </Modal>
            )}
            {s.adding && canManage && (
                <TileEditor boardId={s.adding} multi onClose={() => a.setAdding(null)} />
            )}
        </Modal>
    );
}
