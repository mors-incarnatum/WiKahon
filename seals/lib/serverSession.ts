import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "wikahon_session";

/** Deletes the legacy custom session cookie on logout or migration. */
export async function deleteServerSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
}
