import BoardShell from "@/app/components/BoardShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    return <BoardShell>{children}</BoardShell>;
}
