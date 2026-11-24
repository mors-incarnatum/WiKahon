"use client";

import { useScribblePracticeViewModel } from "@/viewmodels/useScribblePracticeViewModel";
import { useMediaUrl } from "@/viewmodels/useMediaUrl";
import ScribbleWritingPad from "./ScribbleWritingPad";
import ScribbleRecognitionSettings from "./ScribbleRecognitionSettings";

type TargetTile = NonNullable<
    ReturnType<typeof useScribblePracticeViewModel>["state"]["targetTile"]
>;

const choiceBase = "min-h-11 rounded-lg border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:opacity-50";
const choice = `${choiceBase} border-slate-300 bg-white text-slate-700 hover:bg-slate-100`;
const selectedChoice = `${choiceBase} border-sky-700 bg-sky-700 text-white hover:bg-sky-800`;
const modeButton = "min-h-11 rounded-md px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/* eslint-disable @next/next/no-img-element */
function TargetSymbol({ tile }: { tile: TargetTile }) {
    const { src, missingMedia } = useMediaUrl(tile.iconName, tile.mediaId);
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sky-950">
            {src ? (
                <img
                    src={src}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 shrink-0 object-contain"
                    draggable={false}
                />
            ) : tile.iconName === "speech" && !tile.mediaId ? (
                <span aria-hidden="true" className="text-3xl">💬</span>
            ) : null}
            <div className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wide">Trace this word</span>
                <strong className="break-words text-lg">{tile.label}</strong>
                {missingMedia && <span className="block text-xs">Photo unavailable</span>}
            </div>
        </div>
    );
}

export default function ScribblePracticeModal() {
    const { canvasRef, state: s, actions: a } = useScribblePracticeViewModel();
    const recentDrafts = Array.from(new Set(s.drafts.slice().reverse())).slice(0, 6);
    const canSpeak = Boolean(s.recognizedText.trim() || (s.mode === "tracing" && s.targetTile));
    const hasTargets = s.filteredWordTiles.length > 0;
    const traceScore = s.traceScore;

    return (
        <section
            aria-label="Scribble handwriting practice"
            className="scribble-workspace flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
        >
            <div className="min-h-0 flex-1 overflow-y-auto lg:scroll-pt-20">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-sky-700 px-3 py-2 text-white lg:sticky lg:top-0 lg:z-10">
                    <h1 className="text-lg font-bold">Scribble &amp; Handwriting Practice</h1>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div role="group" aria-label="Practice mode" className="flex flex-wrap gap-1 rounded-lg bg-white/15 p-1">
                            <button
                                type="button"
                                aria-pressed={s.mode === "freehand"}
                                onClick={() => a.setMode("freehand")}
                                className={`${modeButton} ${s.mode === "freehand" ? "bg-white text-sky-800" : "hover:bg-white/15"}`}
                            >
                                Freehand writing
                            </button>
                            <button
                                type="button"
                                aria-pressed={s.mode === "tracing"}
                                onClick={() => a.setMode("tracing")}
                                className={`${modeButton} ${s.mode === "tracing" ? "bg-white text-sky-800" : "hover:bg-white/15"}`}
                            >
                                Guided word tracing
                            </button>
                        </div>
                        <ScribbleRecognitionSettings engine={s.engine} onEngineChange={a.setEngine} />
                    </div>
                </div>

                <div className="space-y-3 p-3">
                    {s.mode === "tracing" && (
                        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Word category filter">
                                <button
                                    type="button"
                                    aria-pressed={s.categoryFilter === "all"}
                                    onClick={() => a.setCategoryFilter("all")}
                                    className={s.categoryFilter === "all" ? selectedChoice : choice}
                                >
                                    All
                                </button>
                                {s.categories.map(cat => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        aria-pressed={s.categoryFilter === cat.id}
                                        onClick={() => a.setCategoryFilter(cat.id)}
                                        className={s.categoryFilter === cat.id ? selectedChoice : choice}
                                    >
                                        {cat.label}
                                    </button>
                                ))}
                            </div>
                            {s.targetTile ? (
                                <TargetSymbol tile={s.targetTile} />
                            ) : (
                                <p role="status" className="text-sm text-slate-700">
                                    No words are available in this category. Choose another category to trace a word.
                                </p>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={a.prevTargetWord} disabled={!hasTargets} className={choice}>
                                    ← Previous
                                </button>
                                <select
                                    aria-label="Word to trace"
                                    value={s.targetWordId}
                                    disabled={!hasTargets}
                                    onChange={e => a.selectTargetWord(e.target.value)}
                                    className="min-h-11 min-w-32 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:opacity-50"
                                >
                                    {!hasTargets && <option value="">No words available</option>}
                                    {s.filteredWordTiles.map(tile => (
                                        <option key={tile.id} value={tile.id}>{tile.label}</option>
                                    ))}
                                </select>
                                <button type="button" onClick={a.nextTargetWord} disabled={!hasTargets} className={choice}>
                                    Next →
                                </button>
                                <button
                                    type="button"
                                    disabled={!s.targetTile}
                                    onClick={() => a.speakText(s.targetTile?.spokenText || s.targetTile?.label)}
                                    className={choice}
                                >
                                    🔊 Hear target
                                </button>
                            </div>
                            {s.targetTile && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <p role="status" className="text-sm font-semibold text-sky-900">
                                        {traceScore === null ? "Trace over the word" : `Tracing match: ${traceScore}%`}
                                    </p>
                                    <div aria-hidden="true" className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-slate-200">
                                        <div className="h-full rounded-full bg-sky-700" style={{ width: `${traceScore ?? 0}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <ScribbleWritingPad canvasRef={canvasRef} state={s} actions={a} />

                    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                        <p id="scribble-recognition-disclosure" className="text-sm text-slate-600">
                            {s.recognitionDisclosure}
                        </p>
                        {(s.errorMessage || s.statusMessage) && (
                            <p
                                role={s.errorMessage ? "alert" : "status"}
                                className={`rounded-lg px-3 py-2 text-sm ${
                                    s.errorMessage ? "bg-rose-50 text-rose-800" : "bg-sky-50 text-sky-900"
                                }`}
                            >
                                {s.errorMessage || s.statusMessage}
                            </p>
                        )}
                        <div aria-live="polite" className="text-sm text-slate-600">{s.recognitionOutcome}</div>
                        {s.suggestions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-700">Suggestions:</span>
                                {s.suggestions.map(word => (
                                    <button key={word} type="button" onClick={() => a.applySuggestion(word)} className={choice}>
                                        {word}
                                    </button>
                                ))}
                            </div>
                        )}
                        {recentDrafts.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-700">Recent drafts:</span>
                                {recentDrafts.map(draft => (
                                    <button key={draft} type="button" onClick={() => a.applySuggestion(draft)} className={choice}>
                                        {draft}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div
                role="group"
                aria-label="Scribble result"
                className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
            >
                <label htmlFor="scribble-result" className="sr-only">Review or type a word</label>
                <input
                    id="scribble-result"
                    name="scribble-result"
                    autoComplete="off"
                    value={s.recognizedText}
                    onChange={e => a.setRecognizedText(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && s.recognizedText.trim()) {
                            e.preventDefault();
                            a.addToSentence();
                        }
                    }}
                    placeholder="Type or edit a word…"
                    className="min-h-11 min-w-0 basis-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-base text-slate-900 focus:bg-white focus-visible:outline-2 focus-visible:outline-sky-700 sm:flex-1 sm:text-sm"
                />
                <button
                    type="button"
                    disabled={!canSpeak}
                    onClick={() => a.speakText()}
                    className="ml-auto min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-700 disabled:opacity-50 sm:ml-0"
                >
                    <span aria-hidden="true">🔊</span> Speak
                </button>
                <button
                    type="button"
                    disabled={!s.recognizedText.trim()}
                    onClick={a.addToSentence}
                    className="min-h-11 rounded-lg bg-sky-700 px-3 py-2 text-sm font-bold text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:opacity-50"
                >
                    + Add to sentence
                </button>
            </div>
        </section>
    );
}
