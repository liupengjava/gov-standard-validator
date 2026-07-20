import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(__dirname, "../.."),
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    proxyClientMaxBodySize: process.env.SP_UPLOAD_MAX_MB ? `${process.env.SP_UPLOAD_MAX_MB}mb` : "300mb",
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
