import { CANVAS_WIDTH, CANVAS_HEIGHT, type useScribblePracticeViewModel } from "@/viewmodels/useScribblePracticeViewModel";

type PadProps = Pick<ReturnType<typeof useScribblePracticeViewModel>, "canvasRef" | "state" | "actions">;

export default function ScribbleWritingPad({ canvasRef, state: s, actions: a }: PadProps) {
    const button = "min-h-11 min-w-11 rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50";
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2">
                <div className="flex flex-wrap items-center gap-2">
                    <div role="group" aria-label="Drawing tool" className="inline-flex rounded-lg bg-slate-100 p-0.5">
                        {(["pen", "eraser"] as const).map(tool => (
                            <button key={tool} type="button" aria-pressed={s.tool === tool} onClick={() => a.setTool(tool)}
                                className={`${button} ${s.tool === tool ? "bg-sky-700 text-white" : "text-slate-700 hover:bg-slate-200"}`}>
                                {tool === "pen" ? "Pen" : "Eraser"}
                            </button>
                        ))}
                    </div>
                    <div role="group" aria-label="Pen size" className="inline-flex rounded-lg bg-slate-100 p-0.5">
                        {([ ["sm", "Small"], ["md", "Medium"], ["lg", "Large"] ] as const).map(([size, label]) => (
                            <button key={size} type="button" aria-label={`${label} pen size`} aria-pressed={s.penSize === size} onClick={() => a.setPenSize(size)}
                                className={`${button} ${s.penSize === size ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-200"}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-700">
                        <input type="checkbox" checked={s.showGuides} onChange={e => a.setShowGuides(e.target.checked)} className="h-5 w-5 accent-sky-700" />
                        Lined guides
                    </label>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!s.canUndo || s.isRecognizing} onClick={a.undoStroke} className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}>
                        Undo
                    </button>
                    <button type="button" disabled={!s.hasStroke || s.isRecognizing} onClick={a.clearCanvas} className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}>
                        Clear pad
                    </button>
                    <button
                        type="button"
                        disabled={!s.hasStroke || s.isRecognizing}
                        aria-describedby="scribble-recognition-disclosure"
                        onClick={() => void a.recognize()}
                        className={`${button} bg-sky-700 text-white hover:bg-sky-800`}
                    >
                        {s.isRecognizing ? "Recognizing…" : "Recognize writing"}
                    </button>
                </div>
            </div>
            <div className="overflow-hidden rounded-xl border-2 border-slate-300 bg-white shadow-inner">
                <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} aria-label="Handwriting practice canvas"
                    className="block h-auto w-full touch-none cursor-crosshair bg-white"
                    onPointerDown={a.startDraw} onPointerMove={a.moveDraw} onPointerUp={a.endDraw} onPointerCancel={a.endDraw} onLostPointerCapture={a.endDraw} />
            </div>
        </div>
    );
}
