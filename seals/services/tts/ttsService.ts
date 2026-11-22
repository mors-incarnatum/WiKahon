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

function pickBrowserVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    if (voices.length === 0) return null;
    const filipino = voices.find(v => /^(fil|tl)(-|_|$)/i.test(v.lang));
    if (filipino) return filipino;
    const english = voices.find(v => /^en(-|_|$)/i.test(v.lang));
    if (english) return english;
    return voices.find(v => v.default) ?? voices[0] ?? null;
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
        if (typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis) {
            try {
                window.speechSynthesis.cancel();
            } catch {
                // Ignore browser speech cancellation errors.
            }
        }
        this.cancelPlayback?.();
        this.cancelPlayback = null;
    }

    private speakWithWebSpeech(
        text: string,
        volume: number,
        rate: number,
        generation: number,
    ): Promise<void> {
        if (
            typeof window === "undefined" ||
            !("speechSynthesis" in window) ||
            !window.speechSynthesis ||
            typeof SpeechSynthesisUtterance === "undefined"
        ) {
            return Promise.reject(new SpeechError("provider-failed", "Speech is unavailable on this device."));
        }

        const synth = window.speechSynthesis;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.volume = clamp(Number.isFinite(volume) ? volume : 1, 0, 1);
        utterance.rate = clamp(Number.isFinite(rate) ? rate : 1, 0.5, 2);

        const voices = typeof synth.getVoices === "function" ? synth.getVoices() : [];
        const voice = pickBrowserVoice(voices);
        if (voice) {
            utterance.voice = voice;
            if (voice.lang) utterance.lang = voice.lang;
        }

        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: SpeechError) => {
                if (settled) return;
                settled = true;
                utterance.onend = null;
                utterance.onerror = null;
                if (this.cancelPlayback === cancel) this.cancelPlayback = null;
                if (error) reject(error); else resolve();
            };
            const cancel = () => finish(new SpeechError("cancelled", "Speech cancelled."));
            this.cancelPlayback = cancel;

            if (generation !== this.generation) {
                finish(new SpeechError("cancelled", "Speech cancelled."));
                return;
            }

            utterance.onend = () => finish();
            utterance.onerror = event => {
                const errCode = (event as SpeechSynthesisErrorEvent | undefined)?.error;
                if (generation !== this.generation || errCode === "canceled" || errCode === "interrupted") {
                    finish(new SpeechError("cancelled", "Speech cancelled."));
                    return;
                }
                finish(new SpeechError("playback-failed", "Device speech playback failed."));
            };

            try {
                synth.speak(utterance);
            } catch {
                finish(new SpeechError("playback-failed", "Could not start device speech playback."));
            }
        });
    }

    async speak(requestOrText: SpeakRequest | string, volumeArg?: number): Promise<void> {
        this.stop();
        const generation = this.generation;
        const request = typeof requestOrText === "string"
            ? { text: requestOrText, volume: volumeArg ?? 1 }
            : requestOrText;
        const text = request.text.trim();
        if (!text) return;

        const volume = request.volume ?? 1;
        const rate = request.rate ?? 1;

        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            try {
                await this.speakWithWebSpeech(text, volume, rate, generation);
                return;
            } catch (fallbackError) {
                if (generation !== this.generation || (fallbackError instanceof SpeechError && fallbackError.kind === "cancelled")) {
                    throw new SpeechError("cancelled", "Speech cancelled.");
                }
                throw new SpeechError("provider-failed", "Speech requires an internet connection.");
            }
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
            if (generation !== this.generation || (error instanceof SpeechError && error.kind === "cancelled")) {
                throw new SpeechError("cancelled", "Speech cancelled.");
            }
            try {
                await this.speakWithWebSpeech(text, volume, rate, generation);
            } catch (fallbackError) {
                if (
                    generation !== this.generation ||
                    (fallbackError instanceof SpeechError && fallbackError.kind === "cancelled")
                ) {
                    throw new SpeechError("cancelled", "Speech cancelled.");
                }
                throw error instanceof SpeechError
                    ? error
                    : new SpeechError("provider-failed", "Cloud speech is unavailable. Please try again.");
            }
        }
    }
}

export const ttsService: ITTSService = new TTSService();
