"use client";
import { useRef } from "react";
import { useSentenceContext } from "@/viewmodels/useBoardShellViewModel";
import { useMediaUrl } from "@/viewmodels/useMediaUrl";
/* eslint-disable @next/next/no-img-element */
import { resolveTokenColor, type SentenceToken, type ColorMode, type ColorSystemId } from "@/lib/board";
import { palette } from "@/app/theme";

function TokenButton({
    token,
    index,
    colorMode,
    colorSystem,
    buttonRef,
    onRemove,
}: {
    token: SentenceToken;
    index: number;
    colorMode: ColorMode;
    colorSystem: ColorSystemId;
    buttonRef: (el: HTMLButtonElement | null) => void;
    onRemove: () => void;
}) {
    const { src } = useMediaUrl(token.iconName, token.mediaId);
    const color = resolveTokenColor(token, colorMode, colorSystem);
    return (
        <button
            ref={buttonRef}
            type="button"
            style={{ backgroundColor: palette[color].surface, borderColor: palette[color].border, color: palette[color].text }}
            onClick={onRemove}
            aria-label={`Remove ${token.label} at position ${index + 1}`}
        >
            {token.iconName === "speech" && !token.mediaId && <span aria-hidden="true">💬</span>}
            {src && <img src={src} alt="" width={30} height={30} />}
            {token.label}
        </button>
    );
}

type SentenceIconName = "speak" | "backspace" | "clear" | "stop";

function SentenceIcon({ name }: { name: SentenceIconName }) {
    const common = {
        width: 22,
        height: 22,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        "aria-hidden": true as const,
    };

    switch (name) {
        case "speak":
            return (
                <svg {...common}>
                    <path d="M8 5v14l11-7z" />
                </svg>
            );

        case "backspace":
            return (
                <svg {...common}>
                    <path d="M9 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" />
                    <path d="m12 9 6 6m0-6-6 6" />
                </svg>
            );

        case "clear":
            return (
                <svg {...common}>
                    <path d="m6 6 12 12M18 6 6 18" />
                </svg>
            );

        case "stop":
            return (
                <svg {...common}>
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
            );
    }
}

const actionButtonStyle: React.CSSProperties = {
    width: 42,
    height: 42,
    minWidth: 42,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
};

export default function SentenceStrip() {
    const { state: s, actions: a } = useSentenceContext();
    const tokenRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const undoRef = useRef<HTMLButtonElement | null>(null);

    const handleRemoveAt = (index: number) => {
        a.removeAt(index);
        queueMicrotask(() => {
            const next = tokenRefs.current[index] ?? tokenRefs.current[index - 1] ?? undoRef.current;
            next?.focus();
        });
    };

    return (
        <section className="sentence-strip" aria-label="Sentence strip" style={{ minHeight: 64, alignItems: "stretch", gap: 10 }}>
            <div className="sentence-tokens" aria-live="polite" aria-relevant="additions removals" style={{ minHeight: 54, padding: 6 }}>
                {s.isEmpty && <span className="sentence-placeholder">Tap words to build a sentence</span>}
                {s.tokens.map((t, i) => (
                    <TokenButton
                        key={t.instanceId}
                        token={t}
                        index={i}
                        colorMode={s.colorMode}
                        colorSystem={s.colorSystem}
                        buttonRef={el => {
                            tokenRefs.current[i] = el;
                        }}
                        onRemove={() => handleRemoveAt(i)}
                    />
                ))}
            </div>
            <div className="sentence-actions" style={{ gap: 6 }}>
                <button
                    type="button"
                    className="primary sentence-speak"
                    disabled={!s.isSpeaking && s.isEmpty}
                    onClick={s.isSpeaking ? a.stopSpeaking : a.speakAll}
                    aria-label={s.isSpeaking ? "Stop speaking" : "Speak sentence"}
                >
                    <SentenceIcon name={s.isSpeaking ? "stop" : "speak"} />
                    {s.isSpeaking ? "Stop" : "Speak"}
                </button>
                <button
                    type="button"
                    style={actionButtonStyle}
                    disabled={s.isEmpty}
                    onClick={a.backspace}
                    aria-label="Delete last word"
                    title="Delete last word"
                >
                    <SentenceIcon name="backspace" />
                </button>
                <button
                    ref={undoRef}
                    type="button"
                    disabled={!s.canUndo}
                    onClick={a.undo}
                    aria-label="Undo last sentence edit"
                    title="Undo last sentence edit"
                >
                    ↶ Undo
                </button>
                <button
                    type="button"
                    style={actionButtonStyle}
                    disabled={s.isEmpty}
                    onClick={a.clear}
                    aria-label="Clear sentence"
                    title="Clear sentence"
                >
                    <SentenceIcon name="clear" />
                </button>
            </div>
            {s.announcement && (
                <span className="sr-only" role="status" aria-live="polite">
                    {s.announcement}
                </span>
            )}
            {s.error && (
                <span role="status" className="speech-error">
                    {s.error}
                </span>
            )}
        </section>
    );
}
