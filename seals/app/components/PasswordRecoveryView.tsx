"use client";

import Link from "next/link";
import { usePasswordRecoveryViewModel } from "@/viewmodels/usePasswordRecoveryViewModel";

export default function PasswordRecoveryView({ mode, invalidLink = false, canReset = true }: {
    mode: "request" | "reset";
    invalidLink?: boolean;
    canReset?: boolean;
}) {
    const { state: s, actions: a } = usePasswordRecoveryViewModel(mode);
    const isRequest = mode === "request";
    const expired = !isRequest && !canReset && !s.succeeded;
    const message = s.message || (expired ? "This reset link is invalid or has expired. Request a new link." : "") || (invalidLink ? "This reset link is invalid or has expired. Request a new link below." : "");

    return (
        <div className="min-h-dvh flex flex-col bg-slate-200 text-slate-900">
            <header className="bg-white border-b border-slate-300 px-4 py-3">
                <div className="brand"><b>W</b> WiKahon</div>
            </header>
            <main className="flex-1 flex items-center justify-center p-4">
                <section aria-labelledby="recovery-heading" className="w-full max-w-md bg-white border border-slate-300 rounded-xl p-6 shadow-sm">
                    <h1 id="recovery-heading" className="text-xl font-bold text-slate-900">
                        {isRequest ? "Forgot your password?" : "Set a new password"}
                    </h1>
                    <p className="text-sm text-slate-600 mt-1">
                        {isRequest ? "Enter your account email and we will send you a reset link." : "Choose a new password for your account."}
                    </p>
                    {message && (
                        <p role={s.succeeded ? "status" : "alert"} className={`mt-4 text-sm border rounded-md px-3 py-2 ${s.succeeded ? "text-emerald-900 bg-emerald-50 border-emerald-200" : "text-rose-800 bg-rose-50 border-rose-200"}`}>
                            {message}
                        </p>
                    )}
                    {!s.succeeded && !expired && (
                        <form method="post" className="mt-5 space-y-4" onSubmit={e => { e.preventDefault(); void a.submit(); }}>
                            {isRequest ? (
                                <label className="block text-sm font-semibold text-slate-800">
                                    Email
                                    <input type="email" name="email" autoComplete="email" required value={s.email} onChange={e => a.setEmail(e.target.value)} placeholder="guardian@example.com" className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal" />
                                </label>
                            ) : (
                                <>
                                    <label className="block text-sm font-semibold text-slate-800">
                                        New password (min 8 chars, letter &amp; number)
                                        <input type="password" name="password" autoComplete="new-password" required value={s.password} onChange={e => a.setPassword(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal" />
                                    </label>
                                    <label className="block text-sm font-semibold text-slate-800">
                                        Confirm new password
                                        <input type="password" name="confirmPassword" autoComplete="new-password" required value={s.confirmPassword} onChange={e => a.setConfirmPassword(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal" />
                                    </label>
                                </>
                            )}
                            <button type="submit" disabled={s.isSubmitting} className="primary w-full py-2.5 px-4 rounded-md font-semibold text-sm border">
                                {s.isSubmitting ? "Please wait…" : isRequest ? "Send reset link" : "Update password"}
                            </button>
                        </form>
                    )}
                    {expired && <p className="mt-5 text-sm text-center"><Link href="/forgot-password" className="font-semibold text-blue-700 hover:underline">Request a new reset link</Link></p>}
                    <p className="mt-5 text-sm text-center">
                        <Link href="/login" className="font-semibold text-blue-700 hover:underline">Back to sign in</Link>
                    </p>
                </section>
            </main>
        </div>
    );
}
