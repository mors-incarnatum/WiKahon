"use client";

import Link from "next/link";
import { type AuthMode, type GuardianSignupRole, useAuthViewModel } from "@/viewmodels/useAuthViewModel";

function FieldErrors({ errors }: { errors?: string[] }) {
    if (!errors || errors.length === 0) return null;
    return (
        <ul role="alert" className="mt-1 space-y-0.5 text-xs text-rose-700 font-normal">
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
        <div className="block text-sm font-semibold text-slate-800">
            <label htmlFor={id}>{label}</label>
            <div className="relative mt-1">
                <input
                    id={id}
                    type={visible ? "text" : "password"}
                    name={name}
                    autoComplete={autoComplete}
                    value={value}
                    aria-invalid={Boolean(errors?.length)}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 pr-16 border border-slate-400 rounded-md bg-white text-slate-900 font-normal"
                />
                <button
                    type="button"
                    onClick={onToggleVisible}
                    aria-label={toggleLabel}
                    aria-pressed={visible}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-semibold text-slate-700 hover:text-slate-900"
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

    if (s.currentUser) return null;

    return (
        <div className="min-h-dvh flex flex-col bg-slate-200 text-slate-900">
            <header className="bg-white border-b border-slate-300 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="brand">
                    <b>W</b> WiKahon
                </div>
            </header>

            <main className="flex-1 flex items-center justify-center p-4">
                <section
                    aria-labelledby="login-heading"
                    className="w-full max-w-md bg-white border border-slate-300 rounded-xl p-6 shadow-sm"
                >
                    <div className="flex gap-2 mb-4" role="tablist" aria-label="Authentication mode">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={s.mode === "login"}
                            onClick={() => a.setMode("login")}
                            className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md border ${
                                s.mode === "login"
                                    ? "primary"
                                    : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                            }`}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={s.mode === "signup"}
                            onClick={() => a.setMode("signup")}
                            className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md border ${
                                s.mode === "signup"
                                    ? "primary"
                                    : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                            }`}
                        >
                            Create Account
                        </button>
                    </div>

                    <h1 id="login-heading" className="text-xl font-bold text-slate-900">
                        {s.mode === "login" ? "Sign in to WiKahon" : "Create a Guardian Account"}
                    </h1>
                    <p className="text-sm text-slate-600 mt-1">
                        {s.mode === "login"
                            ? "Sign in with your email or username and password to sync boards and access your role."
                            : "Create a Parent or Caregiver account to manage AAC boards and cloud sync. Child accounts are provisioned by a guardian or can use Offline Child Mode below."}
                    </p>

                    {(s.infoMessage || s.pendingConfirmationEmail) && (
                        <div
                            role="status"
                            className="mt-4 text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 space-y-2"
                        >
                            {s.infoMessage && <p>{s.infoMessage}</p>}
                            {s.pendingConfirmationEmail && (
                                <button
                                    type="button"
                                    disabled={s.isResending}
                                    onClick={() => void a.resendConfirmation()}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-700 bg-white text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                                >
                                    {s.isResending ? "Sending…" : "Resend confirmation email"}
                                </button>
                            )}
                        </div>
                    )}

                    {s.mode === "login" ? (
                        <form
                            noValidate
                            className="mt-5 space-y-4"
                            onSubmit={e => {
                                e.preventDefault();
                                void a.login();
                            }}
                        >
                            <label className="block text-sm font-semibold text-slate-800">
                                Email or Username
                                <input
                                    type="text"
                                    name="identifier"
                                    autoComplete="username"
                                    value={s.identifier}
                                    aria-invalid={Boolean(s.fieldErrors.identifier?.length)}
                                    onChange={e => a.setIdentifier(e.target.value)}
                                    placeholder="name@example.com or username"
                                    className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal"
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

                            <div className="text-right">
                                <Link href="/forgot-password" className="text-sm font-semibold text-blue-700 hover:underline">
                                    Forgot password?
                                </Link>
                            </div>

                            {s.error && (
                                <p
                                    role="alert"
                                    className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2"
                                >
                                    {s.error}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={s.isSubmitting}
                                className="primary w-full py-2.5 px-4 rounded-md font-semibold text-sm border"
                            >
                                {s.isSubmitting ? "Signing in…" : "Sign in"}
                            </button>
                        </form>
                    ) : (
                        <form
                            noValidate
                            className="mt-5 space-y-3"
                            onSubmit={e => {
                                e.preventDefault();
                                void a.signup();
                            }}
                        >
                            <label className="block text-sm font-semibold text-slate-800">
                                Full name
                                <input
                                    type="text"
                                    name="name"
                                    autoComplete="name"
                                    value={s.name}
                                    aria-invalid={Boolean(s.fieldErrors.name?.length)}
                                    onChange={e => a.setName(e.target.value)}
                                    placeholder="e.g., Maria Santos"
                                    className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal"
                                />
                                <FieldErrors errors={s.fieldErrors.name} />
                            </label>

                            <label className="block text-sm font-semibold text-slate-800">
                                Username
                                <input
                                    type="text"
                                    name="username"
                                    autoComplete="username"
                                    value={s.username}
                                    aria-invalid={Boolean(s.fieldErrors.username?.length)}
                                    onChange={e => a.setUsername(e.target.value)}
                                    placeholder="e.g., maria.santos"
                                    className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal"
                                />
                                <FieldErrors errors={s.fieldErrors.username} />
                            </label>

                            <label className="block text-sm font-semibold text-slate-800">
                                Email
                                <input
                                    type="email"
                                    name="email"
                                    autoComplete="email"
                                    value={s.email}
                                    aria-invalid={Boolean(s.fieldErrors.email?.length)}
                                    onChange={e => a.setEmail(e.target.value)}
                                    placeholder="guardian@example.com"
                                    className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal"
                                />
                                <FieldErrors errors={s.fieldErrors.email} />
                            </label>

                            <label className="block text-sm font-semibold text-slate-800">
                                Guardian Role
                                <select
                                    name="role"
                                    value={s.role}
                                    aria-invalid={Boolean(s.fieldErrors.role?.length)}
                                    onChange={e => a.setRole(e.target.value as GuardianSignupRole)}
                                    className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal"
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
                                    className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2"
                                >
                                    {s.error}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={s.isSubmitting}
                                className="primary w-full py-2.5 px-4 rounded-md font-semibold text-sm border"
                            >
                                {s.isSubmitting ? "Creating account…" : "Create account"}
                            </button>
                        </form>
                    )}

                    <div className="mt-5 pt-4 border-t border-slate-200 space-y-3">
                        {s.offlineDesignatedProfiles.length > 1 ? (
                            <div className="space-y-2">
                                <label className="block text-sm font-semibold text-slate-800">
                                    Offline Child Board
                                    <select
                                        name="offlineProfileId"
                                        value={s.selectedOfflineProfileId}
                                        onChange={e => a.setSelectedOfflineProfileId(e.target.value)}
                                        className="mt-1 w-full px-3 py-2 border border-slate-400 rounded-md bg-white text-slate-900 font-normal"
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
                                    className="w-full py-2.5 px-4 rounded-md font-semibold text-sm border border-slate-400 bg-slate-100 text-slate-900 hover:bg-slate-200"
                                >
                                    Continue in Offline Child Mode
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => a.enterOfflineChildMode(s.offlineDesignatedProfiles[0]?.localProfileId)}
                                className="w-full py-2.5 px-4 rounded-md font-semibold text-sm border border-slate-400 bg-slate-100 text-slate-900 hover:bg-slate-200"
                            >
                                Continue in Offline Child Mode
                            </button>
                        )}
                        <p className="text-xs text-slate-600 text-center">
                            Zod Schema Validation · Supabase Auth Session · Offline Local AAC Mode
                        </p>
                    </div>
                </section>
            </main>
        </div>
    );
}
