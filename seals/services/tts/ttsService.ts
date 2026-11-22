export interface SpeakRequest {
    text: string;
    rate?: number;
    volume?: number;
}

export type SpeechFailureKind = "cancelled" | "provider-failed" | "playback-failed";

export class SpeechError extends Error {
    constructor(public readonly kind: SpeechFailureKind, message: string) {
        super(message);
        this.name = "SpeechError";
    }
}

export interface ITTSService {
    speak(request: SpeakRequest | string, volume?: number): Promise<void>;
    stop(): void;
}

type CloudSynthesize = (text: string) => Promise<HTMLAudioElement>;

async function synthesizeCloud(text: string): Promise<HTMLAudioElement> {
    const { puter } = await import("@heyputer/puter.js");
    return puter.ai.txt2speech(text, {
        provider: "aws-polly",
        voice: "Andres",
        engine: "neural",
        language: "es-MX",
    });
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export class TTSService implements ITTSService {
    private audio: HTMLAudioElement | null = null;
    private generation = 0;
    private cancelPlayback: (() => void) | null = null;

    constructor(private synthesize: CloudSynthesize = synthesizeCloud) {}

    stop(): void {
        this.generation++;
        this.audio?.pause();
        this.audio = null;
        this.cancelPlayback?.();
        this.cancelPlayback = null;
    }

    async speak(requestOrText: SpeakRequest | string, volumeArg?: number): Promise<void> {
        this.stop();
        const generation = this.generation;
        const request = typeof requestOrText === "string"
            ? { text: requestOrText, volume: volumeArg ?? 1 }
            : requestOrText;
        const text = request.text.trim();
        if (!text) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            throw new SpeechError("provider-failed", "Speech requires an internet connection.");
        }
        try {
            let cancelSynthesis: (() => void) | null = null;
            const cancelled = new Promise<never>((_, reject) => {
                cancelSynthesis = () => reject(new SpeechError("cancelled", "Speech cancelled."));
                this.cancelPlayback = cancelSynthesis;
            });
            let audio: HTMLAudioElement;
            try {
                audio = await Promise.race([this.synthesize(text), cancelled]);
            } finally {
                if (this.cancelPlayback === cancelSynthesis) this.cancelPlayback = null;
            }
            if (generation !== this.generation) throw new SpeechError("cancelled", "Speech cancelled.");
            this.audio = audio;
            const volume = request.volume ?? 1;
            const rate = request.rate ?? 1;
            audio.volume = clamp(Number.isFinite(volume) ? volume : 1, 0, 1);
            audio.playbackRate = clamp(Number.isFinite(rate) ? rate : 1, 0.5, 2);
            await new Promise<void>((resolve, reject) => {
                let settled = false;
                const finish = (error?: SpeechError) => {
                    if (settled) return;
                    settled = true;
                    audio.onended = null;
                    audio.onerror = null;
                    if (this.cancelPlayback === cancel) this.cancelPlayback = null;
                    if (this.audio === audio) this.audio = null;
                    if (error) reject(error); else resolve();
                };
                const cancel = () => finish(new SpeechError("cancelled", "Speech cancelled."));
                this.cancelPlayback = cancel;
                audio.onended = () => finish();
                audio.onerror = () => finish(new SpeechError("playback-failed", "Cloud audio playback failed."));
                try {
                    void audio.play().catch(() => finish(new SpeechError("playback-failed", "Could not start audio playback.")));
                } catch {
                    finish(new SpeechError("playback-failed", "Could not start audio playback."));
                }
            });
        } catch (error) {
            if (generation !== this.generation) throw new SpeechError("cancelled", "Speech cancelled.");
            throw error instanceof SpeechError ? error : new SpeechError("provider-failed", "Cloud speech is unavailable. Please try again.");
        }
    }
}

export const ttsService: ITTSService = new TTSService();
