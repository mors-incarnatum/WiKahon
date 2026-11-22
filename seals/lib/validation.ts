import { z } from "zod";

export const LoginFormSchema = z.object({
    identifier: z
        .string()
        .trim()
        .min(2, "Username or email must be at least 2 characters.")
        .max(100, "Username or email must be at most 100 characters.")
        .refine(
            val => /^[a-zA-Z0-9._-]+$/.test(val) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
            "Enter a valid username or email address.",
        ),
    password: z
        .string()
        .min(4, "Password or PIN must be at least 4 characters.")
        .max(128, "Password must be at most 128 characters."),
});

export const SignupFormSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Name must be at least 2 characters long.")
            .max(60, "Name must be at most 60 characters."),
        username: z
            .string()
            .trim()
            .toLowerCase()
            .min(3, "Username must be at least 3 characters.")
            .max(32, "Username must be at most 32 characters.")
            .regex(
                /^[a-z0-9._-]+$/,
                "Username may only contain letters, numbers, dots, underscores, or hyphens.",
            ),
        email: z
            .string()
            .trim()
            .toLowerCase()
            .default("")
            .refine(
                val => val === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
                "Please enter a valid email address.",
            ),
        role: z.enum(["PARENT", "CAREGIVER", "CHILD"]),
        password: z
            .string()
            .min(4, "Password or PIN must be at least 4 characters.")
            .max(128, "Password must be at most 128 characters."),
        confirmPassword: z.string(),
    })
    .superRefine((data, ctx) => {
        if (data.role === "PARENT" || data.role === "CAREGIVER") {
            if (!data.email) {
                ctx.addIssue({
                    code: "custom",
                    path: ["email"],
                    message: "Email is required for guardian accounts.",
                });
            }
            if (data.password.length < 8 || !/[a-zA-Z]/.test(data.password) || !/[0-9]/.test(data.password)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["password"],
                    message: "Guardian password must be at least 8 characters and include a letter and a number.",
                });
            }
        }
        if (data.password !== data.confirmPassword) {
            ctx.addIssue({
                code: "custom",
                path: ["confirmPassword"],
                message: "Passwords do not match.",
            });
        }
    });


export const ChildProvisionSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Name must be at least 2 characters long.")
            .max(60, "Name must be at most 60 characters."),
        username: z
            .string()
            .trim()
            .toLowerCase()
            .min(3, "Username must be at least 3 characters.")
            .max(32, "Username must be at most 32 characters.")
            .regex(
                /^[a-z0-9._-]+$/,
                "Username may only contain letters, numbers, dots, underscores, or hyphens.",
            )
            .refine(
                val => val !== "guardian" && val !== "child",
                "Usernames 'guardian' and 'child' are reserved.",
            ),
        email: z
            .string()
            .trim()
            .toLowerCase()
            .default("")
            .refine(
                val => val === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
                "Please enter a valid email address.",
            ),
        password: z
            .string()
            .min(6, "Password must be at least 6 characters.")
            .max(128, "Password must be at most 128 characters."),
        confirmPassword: z.string(),
        profileId: z
            .string()
            .trim()
            .regex(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
                "Select a published cloud board profile.",
            ),
    })
    .superRefine((data, ctx) => {
        if (data.password !== data.confirmPassword) {
            ctx.addIssue({
                code: "custom",
                path: ["confirmPassword"],
                message: "Passwords do not match.",
            });
        }
    });


export type LoginFormInput = z.infer<typeof LoginFormSchema>;
export type SignupFormInput = z.infer<typeof SignupFormSchema>;
export type ChildProvisionInput = z.infer<typeof ChildProvisionSchema>;
export type ValidationFieldErrors = Record<string, string[]>;

export type ValidationResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string; fieldErrors: ValidationFieldErrors };

function collectValidationErrors<T>(result: z.ZodSafeParseResult<T>): ValidationResult<T> {
    if (result.success) {
        return { ok: true, data: result.data };
    }
    const fieldErrors: ValidationFieldErrors = {};
    for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!fieldErrors[key]) {
            fieldErrors[key] = [];
        }
        if (!fieldErrors[key].includes(issue.message)) {
            fieldErrors[key].push(issue.message);
        }
    }
    const firstError = result.error.issues[0]?.message ?? "Please check the highlighted fields.";
    return { ok: false, error: firstError, fieldErrors };
}

/** Validates login credentials with the Zod LoginFormSchema. */
export function validateLoginInput(input: unknown): ValidationResult<LoginFormInput> {
    return collectValidationErrors(LoginFormSchema.safeParse(input));
}

/** Validates new account registration fields with the Zod SignupFormSchema. */
export function validateSignupInput(input: unknown): ValidationResult<SignupFormInput> {
    return collectValidationErrors(SignupFormSchema.safeParse(input));
}

/** Validates guardian-provisioned child account fields with the Zod ChildProvisionSchema. */
export function validateChildProvisionInput(input: unknown): ValidationResult<ChildProvisionInput> {
    return collectValidationErrors(ChildProvisionSchema.safeParse(input));
}
