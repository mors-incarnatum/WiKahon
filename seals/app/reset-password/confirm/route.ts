import { type NextRequest } from "next/server";
import { createSupabaseRecoveryClient } from "@/models/supabase/server";

export async function GET(request: NextRequest) {
    const code = request.nextUrl.searchParams.get("code");
    let location = "/forgot-password?error=invalid-link";

    if (code) {
        const supabase = await createSupabaseRecoveryClient();
        if (supabase) {
            // Only reset requests create PKCE verifiers in this client's cookie namespace.
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            if (!error && data.session) {
                location = "/reset-password";
            }
        }
    }

    return new Response(null, {
        status: 303,
        headers: {
            Location: location,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
        },
    });
}
