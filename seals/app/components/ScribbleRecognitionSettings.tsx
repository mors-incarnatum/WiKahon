import type { ScribbleOcrEngine } from "@/services/scribble/scribbleOcrService";

export default function ScribbleRecognitionSettings({
    engine,
    onEngineChange,
}: {
    engine: ScribbleOcrEngine;
    onEngineChange: (engine: ScribbleOcrEngine) => void;
}) {
    return (
        <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">
                Recognition settings
            </summary>
            <label className="mt-3 flex flex-wrap items-center gap-2">
                <span>Recognition provider</span>
                <select
                    value={engine}
                    onChange={event => onEngineChange(event.target.value as ScribbleOcrEngine)}
                    className="min-h-10 rounded-md border border-slate-300 bg-white px-2 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                >
                    <option value="puter">Puter.js cloud OCR</option>
                    <option value="tesseract">Tesseract.js on-device OCR</option>
                    <option value="local">Board vocabulary match</option>
                </select>
            </label>
        </details>
    );
}
