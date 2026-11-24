import type { ScribbleOcrEngine } from "@/services/scribble/scribbleOcrService";

export default function ScribbleRecognitionSettings({
    engine,
    onEngineChange,
}: {
    engine: ScribbleOcrEngine;
    onEngineChange: (engine: ScribbleOcrEngine) => void;
}) {
    return (
        <select
            aria-label="Recognition provider"
            aria-describedby="scribble-recognition-disclosure"
            value={engine}
            onChange={event => onEngineChange(event.target.value as ScribbleOcrEngine)}
            className="min-h-11 max-w-full rounded-lg border border-sky-200 bg-white px-3 text-sm font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
            <option value="puter">Puter.js cloud OCR</option>
            <option value="tesseract">Tesseract.js on-device OCR</option>
            <option value="local">Board vocabulary match</option>
        </select>
    );
}
