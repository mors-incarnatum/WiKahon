"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loginServerAction, signupServerAction } from "@/app/actions/auth";
import { isGuardianRole } from "@/models/auth";
import {
    validateLoginInput,
    validateSignupInput,
    type ValidationFieldErrors,
} from "@/lib/validation";
import { authService } from "@/services/auth/authService";
import { useBoardSelector } from "@/store/BoardProvider";

export type AuthMode = "login" | "signup";
export type GuardianSignupRole = "CAREGIVER" | "PARENT";

/**
 * ViewModel for Supabase authentication, Zod-validated signup/login, and offline child mode.
 */
export function useAuthViewModel(initialMode: AuthMode = "login") {
    const pathname = usePathname();
    const router = useRouter();
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
        if (currentUser && (pathname === "/login" || pathname === "/register")) {
            router.replace("/board");
        }
    }, [currentUser, pathname, router]);

    // Login & shared password fields
    const [identifier, setIdentifierState] = useState("");
    const [password, setPasswordState] = useState("");

    // Signup fields
    const [name, setNameState] = useState("");
    const [username, setUsernameState] = useState("");
    const [email, setEmailState] = useState("");
    const [role, setRoleState] = useState<GuardianSignupRole>("CAREGIVER");
    const [confirmPassword, setConfirmPasswordState] = useState("");

    const [error, setError] = useState("");
    const [infoMessage, setInfoMessage] = useState("");
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
        setFieldErrors({});
        setPasswordState("");
        setConfirmPasswordState("");
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
            router.replace("/board");
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
                setInfoMessage(
                    res.message ?? "Check your email to confirm your account before signing in.",
                );
                setPasswordState("");
                setConfirmPasswordState("");
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

    const enterOfflineChildMode = (localProfileId?: string) => {
        setError("");
        setInfoMessage("");
        setFieldErrors({});
        storeEnterOfflineChildMode(localProfileId);
        router.replace("/board");
    };

    const logout = () => {
        storeLogout();
        router.replace("/login");
    };

    return {
        state: {
            mode: activeMode,
            currentUser,
            isGuardian: isGuardianRole(currentUser?.role),
            activeProfileName,
            authSessionExpiresAt,
            offlineDesignatedProfiles,
            identifier,
            password,
            name,
            username,
            email,
            role,
            confirmPassword,
            error,
            infoMessage,
            fieldErrors,
            isSubmitting,
        },
        actions: {
            setMode,
            setIdentifier: (val: string) => {
                setIdentifierState(val);
                clearFieldError("identifier");
            },
            setPassword: (val: string) => {
                setPasswordState(val);
                clearFieldError("password");
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
            login,
            signup,
            enterOfflineChildMode,
            logout,
        },
    };
}
