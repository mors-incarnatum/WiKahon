import { canResetPassword } from "@/app/actions/passwordRecovery";
import PasswordRecoveryView from "@/app/components/PasswordRecoveryView";

export default async function ResetPasswordPage() {
    const canReset = await canResetPassword();
    return <PasswordRecoveryView mode="reset" canReset={canReset} />;
}
