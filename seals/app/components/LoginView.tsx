
"use client";

import Link from "next/link";
import { type AuthMode, type GuardianSignupRole, useAuthViewModel } from "@/viewmodels/useAuthViewModel";

function FieldErrors({ errors }: { errors?: string[] }) {
    if (!errors || errors.length === 0) return null;

    return (
        <ul role="alert" className="mt-1 space-y-0.5 text-xs font-normal text-rose-700">
            {errors.map(err => (
                <li key={err}>{err}</li>
            ))}
        </ul>
    );
}

function PasswordField({
    id,
    label,
    name,
    autoComplete,
    value,
    visible,
    placeholder,
    errors,
    toggleLabel,
    onChange,
    onToggleVisible,
}: {
    id: string;
    label: string;
    name: string;
    autoComplete: string;
    value: string;
    visible: boolean;
    placeholder: string;
    errors?: string[];
    toggleLabel: string;
    onChange: (value: string) => void;
    onToggleVisible: () => void;
}) {
    return (
        <div className="block min-w-0 text-sm font-semibold text-slate-800">
            <label htmlFor={id}>{label}</label>

            <div className="relative mt-1.5">
                <input
                    id={id}
                    type={visible ? "text" : "password"}
                    name={name}
                    autoComplete={autoComplete}
                    value={value}
                    aria-invalid={Boolean(errors?.length)}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 pr-16 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                />

                <button
                    type="button"
                    onClick={onToggleVisible}
                    aria-label={toggleLabel}
                    aria-pressed={visible}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-semibold text-slate-600 transition hover:text-slate-900"
                >
                    {visible ? "Hide" : "Show"}
                </button>
            </div>

            <FieldErrors errors={errors} />
        </div>
    );
}

export default function LoginView({ initialMode = "login" }: { initialMode?: AuthMode } = {}) {
    const { state: s, actions: a } = useAuthViewModel(initialMode);

    if (!s.ready) {
        return (
            <div
                role="status"
                className="flex min-h-dvh items-center justify-center bg-white text-sm text-slate-500"
            >
                Loading board…
            </div>
        );
    }

    if (s.currentUser) return null;

    return (
        <div className="flex min-h-dvh w-full flex-col bg-white text-slate-900">
            <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
                <section
                    aria-label="WiKahon authentication"
                    className="mx-auto w-full min-w-0 max-w-[440px]"
                >
                    <div className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-7 py-9 shadow-sm sm:px-11 sm:py-10">
                        {/* WiKahon logo */}
                        <div className="brand mb-6 flex items-center justify-center gap-2 text-xl">
                            <b>W</b> WiKahon
                        </div>

                        {(s.infoMessage || s.pendingConfirmationEmail) && (
                            <div
                                role="status"
                                className="mb-4 space-y-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                            >
                                {s.infoMessage && <p>{s.infoMessage}</p>}

                                {s.pendingConfirmationEmail && (
                                    <button
                                        type="button"
                                        disabled={s.isResending}
                                        onClick={() => void a.resendConfirmation()}
                                        className="rounded-md border border-emerald-700 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-60"
                                    >
                                        {s.isResending ? "Sending…" : "Resend confirmation email"}
                                    </button>
                                )}
                            </div>
                        )}

                        {s.mode === "login" ? (
                            <form
                                noValidate
                                className="space-y-3"
                                onSubmit={e => {
                                    e.preventDefault();
                                    void a.login();
                                }}
                            >
                                <label className="block min-w-0 text-sm font-semibold text-slate-800">
                                    Email or Username
                                    <input
                                        type="text"
                                        name="identifier"
                                        autoComplete="username"
                                        value={s.identifier}
                                        aria-invalid={Boolean(s.fieldErrors.identifier?.length)}
                                        onChange={e => a.setIdentifier(e.target.value)}
                                        placeholder="name@example.com or username"
                                        className="mt-1.5 w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                                    />
                                    <FieldErrors errors={s.fieldErrors.identifier} />
                                </label>

                                <PasswordField
                                    id="login-password"
                                    label="Password"
                                    name="password"
                                    autoComplete="current-password"
                                    value={s.password}
                                    visible={s.showPassword}
                                    placeholder="Enter password"
                                    errors={s.fieldErrors.password}
                                    toggleLabel={s.showPassword ? "Hide password" : "Show password"}
                                    onChange={a.setPassword}
                                    onToggleVisible={a.toggleShowPassword}
                                />

                                <div className="pt-0.5 text-right">
                                    <Link
                                        href="/forgot-password"
                                        className="text-xs font-semibold text-blue-700 transition hover:underline"
                                    >
                                        Forgot password?
                                    </Link>
                                </div>

                                {s.error && (
                                    <p
                                        role="alert"
                                        className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
                                    >
                                        {s.error}
                                    </p>
                                )}

                                <button
                                    type="submit"
                                    disabled={s.isSubmitting}
                                    className="primary w-full rounded-md border px-4 py-2.5 text-sm font-semibold transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {s.isSubmitting ? "Signing in…" : "Sign in"}
                                </button>
                            </form>
                        ) : (
                            <form
                                noValidate
                                className="space-y-3"
                                onSubmit={e => {
                                    e.preventDefault();
                                    void a.signup();
                                }}
                            >
                                <label className="block min-w-0 text-sm font-semibold text-slate-800">
                                    Full name
                                    <input
                                        type="text"
                                        name="name"
                                        autoComplete="name"
                                        value={s.name}
                                        aria-invalid={Boolean(s.fieldErrors.name?.length)}
                                        onChange={e => a.setName(e.target.value)}
                                        placeholder="e.g., Maria Santos"
                                        className="mt-1.5 w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                                    />
                                    <FieldErrors errors={s.fieldErrors.name} />
                                </label>

                                <label className="block min-w-0 text-sm font-semibold text-slate-800">
                                    Username
                                    <input
                                        type="text"
                                        name="username"
                                        autoComplete="username"
                                        value={s.username}
                                        aria-invalid={Boolean(s.fieldErrors.username?.length)}
                                        onChange={e => a.setUsername(e.target.value)}
                                        placeholder="e.g., maria.santos"
                                        className="mt-1.5 w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                                    />
                                    <FieldErrors errors={s.fieldErrors.username} />
                                </label>

                                <label className="block min-w-0 text-sm font-semibold text-slate-800">
                                    Email
                                    <input
                                        type="email"
                                        name="email"
                                        autoComplete="email"
                                        value={s.email}
                                        aria-invalid={Boolean(s.fieldErrors.email?.length)}
                                        onChange={e => a.setEmail(e.target.value)}
                                        placeholder="guardian@example.com"
                                        className="mt-1.5 w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                                    />
                                    <FieldErrors errors={s.fieldErrors.email} />
                                </label>

                                <label className="block min-w-0 text-sm font-semibold text-slate-800">
                                    Guardian Role
                                    <select
                                        name="role"
                                        value={s.role}
                                        aria-invalid={Boolean(s.fieldErrors.role?.length)}
                                        onChange={e => a.setRole(e.target.value as GuardianSignupRole)}
                                        className="mt-1.5 w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                                    >
                                        <option value="CAREGIVER">Caregiver</option>
                                        <option value="PARENT">Parent</option>
                                    </select>
                                    <FieldErrors errors={s.fieldErrors.role} />
                                </label>

                                <PasswordField
                                    id="signup-password"
                                    label="Password (min 8 chars, letter & number)"
                                    name="password"
                                    autoComplete="new-password"
                                    value={s.password}
                                    visible={s.showPassword}
                                    placeholder="Enter password"
                                    errors={s.fieldErrors.password}
                                    toggleLabel={s.showPassword ? "Hide password" : "Show password"}
                                    onChange={a.setPassword}
                                    onToggleVisible={a.toggleShowPassword}
                                />

                                <PasswordField
                                    id="signup-confirm-password"
                                    label="Confirm password"
                                    name="confirmPassword"
                                    autoComplete="new-password"
                                    value={s.confirmPassword}
                                    visible={s.showConfirmPassword}
                                    placeholder="Re-enter password"
                                    errors={s.fieldErrors.confirmPassword}
                                    toggleLabel={s.showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                                    onChange={a.setConfirmPassword}
                                    onToggleVisible={a.toggleShowConfirmPassword}
                                />

                                {s.error && (
                                    <p
                                        role="alert"
                                        className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
                                    >
                                        {s.error}
                                    </p>
                                )}

                                <button
                                    type="submit"
                                    disabled={s.isSubmitting}
                                    className="primary w-full rounded-md border px-4 py-2.5 text-sm font-semibold transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {s.isSubmitting ? "Creating account…" : "Create account"}
                                </button>
                            </form>
                        )}

                        {/* Offline mode */}
                        <div className="mt-5">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="h-px flex-1 bg-slate-200" />
                                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                                    Or
                                </span>
                                <div className="h-px flex-1 bg-slate-200" />
                            </div>

                            {s.offlineDesignatedProfiles.length > 1 ? (
                                <div className="space-y-2">
                                    <label className="block text-sm font-semibold text-slate-800">
                                        Offline Child Board
                                        <select
                                            name="offlineProfileId"
                                            value={s.selectedOfflineProfileId}
                                            onChange={e => a.setSelectedOfflineProfileId(e.target.value)}
                                            className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                                        >
                                            {s.offlineDesignatedProfiles.map(profile => (
                                                <option key={profile.localProfileId} value={profile.localProfileId}>
                                                    {profile.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <button
                                        type="button"
                                        onClick={() => a.enterOfflineChildMode(s.selectedOfflineProfileId)}
                                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                                    >
                                        Continue in Offline Child Mode
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => a.enterOfflineChildMode(s.offlineDesignatedProfiles[0]?.localProfileId)}
                                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                                >
                                    Continue in Offline Child Mode
                                </button>
                            )}
                        </div>

                        {/* Description at the bottom */}
                        <p className="mt-5 text-center text-xs leading-5 text-slate-500">
                            {s.mode === "login"
                                ? "Sign in with your email or username and password to sync boards and access your role."
                                : "Create a Parent or Caregiver account to manage AAC boards and cloud sync. Child accounts are provisioned by a guardian or can use Offline Child Mode below."}
                        </p>

                        {/* Account switch */}
                        <div className="mt-5 border-t border-slate-100 pt-4 text-center">
                            <p className="text-xs text-slate-500">
                                {s.mode === "login" ? "Don't have an account?" : "Already have an account?"}
                            </p>

                            <div className="mt-1 flex justify-center">
                                <div className="flex gap-1" role="tablist" aria-label="Authentication mode">
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={s.mode === "login"}
                                        onClick={() => a.setMode("login")}
                                        className={`text-xs font-semibold transition hover:underline ${
                                            s.mode === "login" ? "text-blue-700" : "text-slate-600"
                                        }`}
                                    >
                                        Sign In
                                    </button>

                                    <span className="text-xs text-slate-400">/</span>

                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={s.mode === "signup"}
                                        onClick={() => a.setMode("signup")}
                                        className={`text-xs font-semibold transition hover:underline ${
                                            s.mode === "signup" ? "text-blue-700" : "text-slate-600"
                                        }`}
                                    >
                                        Create Account
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
