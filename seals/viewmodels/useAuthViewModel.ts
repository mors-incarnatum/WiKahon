
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
    loginServerAction,
    resendConfirmationEmailServerAction,
    signupServerAction,
} from "@/app/actions/auth";
import { isGuardianRole } from "@/models/auth";
import {
    validateLoginInput,
    validateSignupInput,
    type ValidationFieldErrors,
} from "@/lib/validation";
import { authService } from "@/services/auth/authService";
import { useBoardReady, useBoardSelector } from "@/store/BoardProvider";

export type AuthMode = "login" | "signup";
export type GuardianSignupRole = "CAREGIVER" | "PARENT";

/**
 * ViewModel for Supabase authentication, Zod-validated signup/login, and offline child mode.
 */
export function useAuthViewModel(initialMode: AuthMode = "login") {
    const pathname = usePathname();
    const router = useRouter();
    const ready = useBoardReady();
    const {
        currentUser,
        activeProfileName,
        authSessionExpiresAt,
        offlineDesignatedProfiles,
        applyAuthSession,
        enterOfflineChildMode: storeEnterOfflineChildMode,
        logout: storeLogout,
    } = useBoardSelector(s => ({
        currentUser: s.currentUser,
        activeProfileName: s.activeProfileName,
        authSessionExpiresAt: s.authSessionExpiresAt,
        offlineDesignatedProfiles: s.offlineDesignatedProfiles ?? [],
        applyAuthSession: s.applyAuthSession,
        enterOfflineChildMode: s.enterOfflineChildMode,
        logout: s.logout,
    }));

    const [mode, setModeState] = useState<AuthMode>(initialMode);
    const routeMode: AuthMode | null =
        pathname === "/register" ? "signup" : pathname === "/login" ? "login" : null;
    const activeMode: AuthMode = routeMode ?? mode;

    useEffect(() => {
        if (ready && currentUser && (pathname === "/login" || pathname === "/register")) {
            router.replace("/board");
        }
    }, [ready, currentUser, pathname, router]);

    // Login & shared password fields
    const [identifier, setIdentifierState] = useState("");
    const [password, setPasswordState] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    // Signup fields
    const [name, setNameState] = useState("");
    const [username, setUsernameState] = useState("");
    const [email, setEmailState] = useState("");
    const [role, setRoleState] = useState<GuardianSignupRole>("CAREGIVER");
    const [confirmPassword, setConfirmPasswordState] = useState("");
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // Offline child profile selection
    const [selectedOfflineProfileIdState, setSelectedOfflineProfileIdState] = useState(
        () => offlineDesignatedProfiles[0]?.localProfileId ?? "",
    );
    const selectedOfflineProfileId = offlineDesignatedProfiles.some(
        profile => profile.localProfileId === selectedOfflineProfileIdState,
    )
        ? selectedOfflineProfileIdState
        : (offlineDesignatedProfiles[0]?.localProfileId ?? "");

    const [error, setError] = useState("");
    const [infoMessage, setInfoMessage] = useState("");
    const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState("");
    const [isResending, setIsResending] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<ValidationFieldErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const clearFieldError = (...fields: string[]) => {
        if (error) setError("");
        if (infoMessage) setInfoMessage("");
        if (fields.some(field => Boolean(fieldErrors[field]))) {
            setFieldErrors(prev => {
                const next = { ...prev };
                for (const field of fields) {
                    delete next[field];
                }
                return next;
            });
        }
    };

    const setMode = (nextMode: AuthMode) => {
        setModeState(nextMode);
        setError("");
        setInfoMessage("");
        setPendingConfirmationEmail("");
        setFieldErrors({});
        setPasswordState("");
        setConfirmPasswordState("");
        setShowPassword(false);
        setShowConfirmPassword(false);
        if (nextMode === "signup" && pathname !== "/register") {
            router.push("/register");
        } else if (nextMode === "login" && pathname !== "/login") {
            router.push("/login");
        }
    };

    const login = async () => {
        if (isSubmitting) return;
        setError("");
        setInfoMessage("");
        setPendingConfirmationEmail("");
        setFieldErrors({});

        const validation = validateLoginInput({ identifier, password });
        if (!validation.ok) {
            setError(validation.error);
            setFieldErrors(validation.fieldErrors);
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await loginServerAction(validation.data);
            if (!res.ok || !res.session) {
                setError(res.error ?? "Invalid email/username or password.");
                setFieldErrors(res.fieldErrors ?? {});
                return;
            }
            await authService.syncBrowserSession(res.tokens);
            applyAuthSession(res.session);
            authService.broadcastSessionRefresh();
            setPasswordState("");
            setShowPassword(false);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to sign in right now. Check your connection or continue offline as Child.",
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    const signup = async () => {
        if (isSubmitting) return;
        setError("");
        setInfoMessage("");
        setPendingConfirmationEmail("");
        setFieldErrors({});

        const validation = validateSignupInput({
            name,
            username,
            email,
            role,
            password,
            confirmPassword,
        });
        if (!validation.ok) {
            setError(validation.error);
            setFieldErrors(validation.fieldErrors);
            return;
        }
        if (!validation.data.email) {
            const msg = "Email address is required for account registration.";
            setError(msg);
            setFieldErrors({ email: [msg] });
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await signupServerAction({
                ...validation.data,
                role,
            });
            if (!res.ok) {
                setError(res.error ?? "Unable to create account.");
                setFieldErrors(res.fieldErrors ?? {});
                return;
            }
            if (res.requiresEmailConfirmation) {
                setPendingConfirmationEmail(validation.data.email);
                setInfoMessage(
                    res.message ?? "Check your email to confirm your account before signing in.",
                );
                setPasswordState("");
                setConfirmPasswordState("");
                setShowPassword(false);
                setShowConfirmPassword(false);
                return;
            }
            if (!res.session) {
                setError(res.error ?? "Account created, but session could not be verified.");
                return;
            }
            await authService.syncBrowserSession(res.tokens);
            applyAuthSession(res.session);
            authService.broadcastSessionRefresh();
            setPasswordState("");
            setConfirmPasswordState("");
            setShowPassword(false);
            setShowConfirmPassword(false);
            router.replace("/board");
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to create account right now. Check your connection and try again.",
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    const resendConfirmation = async () => {
        if (isResending || !pendingConfirmationEmail) return;
        setError("");
        setIsResending(true);
        try {
            const res = await resendConfirmationEmailServerAction(pendingConfirmationEmail);
            if (!res.ok) {
                setError(res.error ?? "Unable to resend confirmation email right now.");
                return;
            }
            setInfoMessage(
                res.message ??
                    "If an unconfirmed account exists for that email, a new confirmation link has been sent.",
            );
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to resend confirmation email right now. Check your connection and try again.",
            );
        } finally {
            setIsResending(false);
        }
    };

    const enterOfflineChildMode = (localProfileId?: string) => {
        setError("");
        setInfoMessage("");
        setPendingConfirmationEmail("");
        setFieldErrors({});
        storeEnterOfflineChildMode(localProfileId ?? (selectedOfflineProfileId || undefined));
        router.replace("/board");
    };

    const logout = () => {
        storeLogout();
        router.replace("/login");
    };

    return {
        state: {
            ready,
            mode: activeMode,
            currentUser,
            isGuardian: isGuardianRole(currentUser?.role),
            activeProfileName,
            authSessionExpiresAt,
            offlineDesignatedProfiles,
            selectedOfflineProfileId,
            identifier,
            password,
            showPassword,
            name,
            username,
            email,
            role,
            confirmPassword,
            showConfirmPassword,
            error,
            infoMessage,
            pendingConfirmationEmail,
            isResending,
            fieldErrors,
            isSubmitting,
        },
        actions: {
            setMode,
            setSelectedOfflineProfileId: (localProfileId: string) => {
                setSelectedOfflineProfileIdState(localProfileId);
            },
            setIdentifier: (val: string) => {
                setIdentifierState(val);
                clearFieldError("identifier");
            },
            setPassword: (val: string) => {
                setPasswordState(val);
                clearFieldError("password");
            },
            toggleShowPassword: () => {
                setShowPassword(prev => !prev);
            },
            setName: (val: string) => {
                setNameState(val);
                clearFieldError("name");
            },
            setUsername: (val: string) => {
                setUsernameState(val);
                clearFieldError("username");
            },
            setEmail: (val: string) => {
                setEmailState(val);
                clearFieldError("email");
            },
            setRole: (val: GuardianSignupRole) => {
                setRoleState(val);
                clearFieldError("role", "email", "password");
            },
            setConfirmPassword: (val: string) => {
                setConfirmPasswordState(val);
                clearFieldError("confirmPassword");
            },
            toggleShowConfirmPassword: () => {
                setShowConfirmPassword(prev => !prev);
            },
            login,
            signup,
            resendConfirmation,
            enterOfflineChildMode,
            logout,
        },
    };
}
