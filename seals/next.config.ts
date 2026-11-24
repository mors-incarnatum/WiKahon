import type { NextConfig } from "next";
const nextConfig: NextConfig = {
    distDir: process.env.WIKAHON_BUILD_DIR || ".next",
    devIndicators: false,
    allowedDevOrigins: ["192.168.254.125"],
};
export default nextConfig;
