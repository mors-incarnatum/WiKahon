"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseRecoveryClient } from "@/models/supabase/server";

type RecoveryResult = { ok: boolean; message: string };

const ResetEmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const NewPasswordSchema = z.string().min(8).max(128).regex(/[a-zA-Z]/).regex(/[0-9]/);
const unavailable = "Password reset is unavailable right now. Please try again later.";
const invalidLink = "This reset link is invalid or has expired. Request a new link and try again.";

export async function requestPasswordReset(email: string): Promise<RecoveryResult> {
    const validated = ResetEmailSchema.safeParse(email);
    if (!validated.success) {
        return { ok: false, message: "Enter a valid email address." };
    }

    const requestHeaders = await headers();
    const origin = requestHeaders.get("origin");
    const callback = origin && URL.canParse(origin) ? new URL(origin) : null;
    // Require the browser origin to match the app host checked by Next.js for server actions.
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (!callback || callback.host !== host || !["http:", "https:"].includes(callback.protocol)) {
        return { ok: false, message: unavailable };
    }

    const supabase = await createSupabaseRecoveryClient();
    if (!supabase) return { ok: false, message: unavailable };

    await supabase.auth.resetPasswordForEmail(validated.data, {
        redirectTo: new URL("/reset-password/confirm", callback.origin).href,
    });

    // The public response must be the same whether or not the account can receive mail.
    return {
        ok: true,
        message: "If an account uses that address, you’ll receive a reset link. Open it in the same browser you used to request it.",
    };
}

export async function canResetPassword(): Promise<boolean> {
    const supabase = await createSupabaseRecoveryClient();
    if (!supabase) return false;

    const { data, error } = await supabase.auth.getUser();
    return !error && Boolean(data.user);
}

export async function resetPassword(password: string, confirmPassword: string): Promise<RecoveryResult> {
    const validated = NewPasswordSchema.safeParse(password);
    if (!validated.success) {
        return { ok: false, message: "Use 8 to 128 characters, including a letter and a number." };
    }
    if (validated.data !== confirmPassword) {
        return { ok: false, message: "Passwords do not match." };
    }

    const supabase = await createSupabaseRecoveryClient();
    if (!supabase) return { ok: false, message: unavailable };

    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) return { ok: false, message: invalidLink };

    const { error } = await supabase.auth.updateUser({ password: validated.data });
    if (error) {
        if (error.code === "same_password") {
            return { ok: false, message: "Choose a password different from your current one." };
        }
        if (error.code === "weak_password") {
            return { ok: false, message: "Choose a stronger password that you haven’t used elsewhere." };
        }
        return { ok: false, message: "Couldn’t update your password. Try again or request a new reset link." };
    }

    await supabase.auth.signOut({ scope: "local" });
    return { ok: true, message: "Password updated. You can now sign in with your new password." };
}
