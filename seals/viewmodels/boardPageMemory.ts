"use client";

import { createContext } from "react";

type PagePosition = { userId: string; profileId: string; boardId: string; page: number };

export function createBoardPageMemory() {
    let last: PagePosition | null = null;
    let restoreOnReturn = false;
    return {
        prepareReturn: () => { restoreOnReturn = true; },
        clear: () => { restoreOnReturn = false; last = null; },
        save: (position: PagePosition) => { last = position; },
        claim: (userId: string, profileId: string, boardId: string) => {
            const page = restoreOnReturn && last?.userId === userId && last.profileId === profileId && last.boardId === boardId
                ? last.page : null;
            restoreOnReturn = false;
            return page;
        },
    };
}

export const BoardPageMemoryContext = createContext<ReturnType<typeof createBoardPageMemory> | null>(null);
