import { type ColorKey } from "@/lib/board";

export const palette: Record<
    ColorKey,
    { bg: string; surface: string; border: string; text: string }
> = {
    rose: {
        bg: "#FFF5F6",
        surface: "#FCE4E8",
        border: "#F5C6CE",
        text: "#465365"
    },
    emerald: {
        bg: "#F2FAF5",
        surface: "#DDF1E3",
        border: "#BCE0C7",
        text: "#465365"
    },
    amber: {
        bg: "#FFF9EC",
        surface: "#FFE9A8",
        border: "#F0D382",
        text: "#465365"
    },
    yellow: {
        bg: "#FFFDF5",
        surface: "#FFE9A8",
        border: "#EDD17E",
        text: "#465365"
    },
    blue: {
        bg: "#F2F8FF",
        surface: "#DCEEFF",
        border: "#B6D8FA",
        text: "#465365"
    },
    violet: {
        bg: "#F6F3FC",
        surface: "#E9E3F8",
        border: "#D1C6EE",
        text: "#465365"
    },
    teal: {
        bg: "#F0FAF8",
        surface: "#D8F2ED",
        border: "#B3E0D8",
        text: "#465365"
    },
    orange: {
        bg: "#FFF6F2",
        surface: "#FFDFD1",
        border: "#F2C4B1",
        text: "#465365"
    },
    pink: {
        bg: "#FDF5F9",
        surface: "#F8E3EE",
        border: "#E8C5D8",
        text: "#465365"
    },
    white: {
        bg: "#FFFFFF",
        surface: "#FFF9EC",
        border: "#E6DEC8",
        text: "#465365"
    },
    slate: {
        bg: "#F8FAFC",
        surface: "#EEF2F6",
        border: "#D5DEE8",
        text: "#465365"
    }
};

export const COLOR_KEYS = Object.keys(palette) as ColorKey[];