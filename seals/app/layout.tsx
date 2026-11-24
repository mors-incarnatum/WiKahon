import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { BoardProvider } from "@/store/BoardProvider";
import OfflineServiceWorker from "./components/OfflineServiceWorker";
import "./globals.css";

const nunito = localFont({
    src: "../node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2",
    weight: "200 1000",
    variable: "--font-heading",
});
const nunitoSans = localFont({
    src: "../node_modules/@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-normal.woff2",
    weight: "200 1000",
    variable: "--font-aac",
});
const inter = localFont({
    src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    weight: "100 900",
    variable: "--font-ui",
});

export const metadata: Metadata = {
    title: "WiKahon",
    description: "Augmentative and Alternative Communication Board for non-verbal users",
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${nunito.variable} ${nunitoSans.variable} ${inter.variable} h-full antialiased`}>
            <body className="min-h-full flex flex-col">
                <OfflineServiceWorker />
                <BoardProvider>{children}</BoardProvider>
            </body>
        </html>
    );
}
