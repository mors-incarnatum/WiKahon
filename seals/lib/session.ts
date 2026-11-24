/** Returns true when a session timestamp is missing, invalid, or in the past. */
export function isSessionExpired(expiresAt: string | number | undefined | null): boolean {
    if (expiresAt === undefined || expiresAt === null || expiresAt === "") return true;
    const timestamp = typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt);
    return !Number.isFinite(timestamp) || timestamp <= Date.now();
}
