import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/models/supabase/database.types";

const SESSION_COOKIE_NAME = "wikahon_session";

/** Refreshes Supabase Auth session cookies without blocking or redirecting /board offline routes. */
export async function proxy(request: NextRequest) {
    let response = NextResponse.next({
        request,
    });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (url && key) {
        const supabase = createServerClient<Database>(url, key, {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    for (const { name, value } of cookiesToSet) {
                        request.cookies.set(name, value);
                    }
                    response = NextResponse.next({
                        request,
                    });
                    for (const { name, value, options } of cookiesToSet) {
                        response.cookies.set(name, value, options);
                    }
                },
            },
        });

        try {
            await supabase.auth.getUser();
        } catch {
            // Offline mode or transient network failures must never block app-shell rendering.
        }
    }

    if (request.cookies.has(SESSION_COOKIE_NAME)) {
        response.cookies.delete(SESSION_COOKIE_NAME);
    }

    return response;
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|symbols/|gifs/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif)$).*)",
    ],
};
