"use client";

import { useScribblePracticeViewModel } from "@/viewmodels/useScribblePracticeViewModel";
import { useMediaUrl } from "@/viewmodels/useMediaUrl";
import ScribbleWritingPad from "./ScribbleWritingPad";
import ScribbleRecognitionSettings from "./ScribbleRecognitionSettings";

type TargetTile = NonNullable<
    ReturnType<typeof useScribblePracticeViewModel>["state"]["targetTile"]
>;

/* eslint-disable @next/next/no-img-element */
function TargetSymbol({ tile }: { tile: TargetTile }) {
    const { src, missingMedia } = useMediaUrl(tile.iconName, tile.mediaId);
    return (
        <div className="flex items-center gap-3 rounded-xl bg-sky-50 px-4 py-3 text-sky-950">
            {src ? (
                <img
                    src={src}
                    alt=""
                    width={56}
                    height={56}
                    className="h-14 w-14 object-contain"
                    draggable={false}
                />
            ) : tile.iconName === "speech" && !tile.mediaId ? (
                <span aria-hidden="true" className="text-3xl">💬</span>
            ) : null}
            <div>
                <span className="block text-xs font-semibold uppercase tracking-wide">Trace this word</span>
                <strong className="text-xl">{tile.label}</strong>
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
    const traceFeedback = s.traceScore === null
        ? "Trace over the word"
        : s.traceScore >= 70 ? "Great tracing!" : "Keep tracing";

    return (
        <section
            aria-label="Scribble handwriting practice"
            className="scribble-workspace flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50"
        >
            <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Scribble</h1>
                        <p className="text-sm text-slate-600">
                            Write a word, check it, then add it to your sentence.
                        </p>
                    </div>
                    <div role="group" aria-label="Practice mode" className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            aria-pressed={s.mode === "freehand"}
                            onClick={() => a.setMode("freehand")}
                            className={`scribble-choice ${s.mode === "freehand" ? "scribble-choice-active" : ""}`}
                        >
                            Freehand writing
                        </button>
                        <button
                            type="button"
                            aria-pressed={s.mode === "tracing"}
                            onClick={() => a.setMode("tracing")}
                            className={`scribble-choice ${s.mode === "tracing" ? "scribble-choice-active" : ""}`}
                        >
                            Guided word tracing
                        </button>
                    </div>
                </div>

                {s.mode === "tracing" && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Word category filter">
                            <button
                                type="button"
                                aria-pressed={s.categoryFilter === "all"}
                                onClick={() => a.setCategoryFilter("all")}
                                className={`scribble-choice ${s.categoryFilter === "all" ? "scribble-choice-active" : ""}`}
                            >
                                All
                            </button>
                            {s.categories.map(cat => (
                                <button
                                    key={cat.id}
                                    type="button"
                                    aria-pressed={s.categoryFilter === cat.id}
                                    onClick={() => a.setCategoryFilter(cat.id)}
                                    className={`scribble-choice ${s.categoryFilter === cat.id ? "scribble-choice-active" : ""}`}
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
                            <button type="button" onClick={a.prevTargetWord} disabled={!hasTargets} className="scribble-choice">
                                ← Previous
                            </button>
                            <select
                                aria-label="Word to trace"
                                value={s.targetWordId}
                                disabled={!hasTargets}
                                onChange={e => a.selectTargetWord(e.target.value)}
                                className="scribble-input min-w-36 flex-1"
                            >
                                {!hasTargets && <option value="">No words available</option>}
                                {s.filteredWordTiles.map(tile => (
                                    <option key={tile.id} value={tile.id}>{tile.label}</option>
                                ))}
                            </select>
                            <button type="button" onClick={a.nextTargetWord} disabled={!hasTargets} className="scribble-choice">
                                Next →
                            </button>
                            <button
                                type="button"
                                disabled={!s.targetTile}
                                onClick={() => a.speakText(s.targetTile?.spokenText || s.targetTile?.label)}
                                className="scribble-choice"
                            >
                                🔊 Hear target
                            </button>
                        </div>
                        {s.targetTile && (
                            <p role="status" className="text-sm font-semibold text-sky-900">{traceFeedback}</p>
                        )}
                    </div>
                )}

                <ScribbleWritingPad canvasRef={canvasRef} state={s} actions={a} />

                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            disabled={!s.hasStroke || s.isRecognizing}
                            aria-describedby="scribble-recognition-disclosure"
                            onClick={() => void a.recognize()}
                            className="scribble-primary"
                        >
                            {s.isRecognizing ? "Recognizing…" : "Recognize writing"}
                        </button>
                        <ScribbleRecognitionSettings engine={s.engine} onEngineChange={a.setEngine} />
                    </div>
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
                    <label htmlFor="scribble-result" className="block text-sm font-bold text-slate-800">
                        Review or type a word
                    </label>
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
                        className="scribble-input w-full"
                    />
                    {s.suggestions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-700">Suggestions:</span>
                            {s.suggestions.map(word => (
                                <button key={word} type="button" onClick={() => a.applySuggestion(word)} className="scribble-choice">
                                    {word}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!canSpeak} onClick={() => a.speakText()} className="scribble-choice">
                            🔊 Hear word
                        </button>
                        <button type="button" disabled={!s.recognizedText.trim()} onClick={a.addToSentence} className="scribble-primary">
                            + Add to sentence
                        </button>
                    </div>
                    {recentDrafts.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-700">Recent drafts:</span>
                            {recentDrafts.map(draft => (
                                <button key={draft} type="button" onClick={() => a.applySuggestion(draft)} className="scribble-choice">
                                    {draft}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
