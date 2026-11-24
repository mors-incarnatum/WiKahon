import PasswordRecoveryView from "@/app/components/PasswordRecoveryView";

export default async function ForgotPasswordPage({ searchParams }: {
    searchParams: Promise<{ error?: string }>;
}) {
    const { error } = await searchParams;
    return <PasswordRecoveryView mode="request" invalidLink={error === "invalid-link"} />;
}
