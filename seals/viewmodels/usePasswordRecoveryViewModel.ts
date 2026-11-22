"use client";

import { useState } from "react";
import { requestPasswordReset, resetPassword } from "@/app/actions/passwordRecovery";

export function usePasswordRecoveryViewModel(mode: "request" | "reset") {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [message, setMessage] = useState("");
    const [succeeded, setSucceeded] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submit = async () => {
        if (isSubmitting) return;
        setMessage("");
        if (mode === "reset" && (password.length < 8 || password.length > 128 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))) {
            setMessage("Password must be 8 to 128 characters and include a letter and a number.");
            return;
        }
        if (mode === "reset" && password !== confirmPassword) {
            setMessage("Passwords do not match.");
            return;
        }
        setIsSubmitting(true);
        try {
            const result = mode === "request"
                ? await requestPasswordReset(email)
                : await resetPassword(password, confirmPassword);
            setMessage(result.message);
            setSucceeded(result.ok);
            if (result.ok && mode === "reset") {
                setPassword("");
                setConfirmPassword("");
            }
        } catch {
            setMessage("Unable to complete your request. Please check your connection and try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return { state: { email, password, confirmPassword, message, succeeded, isSubmitting },
        actions: { setEmail, setPassword, setConfirmPassword, submit } };
}
