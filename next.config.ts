import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Data here is live and per-request (board, agent runs), so we opt out of
  // Cache Components and mark API routes `force-dynamic` explicitly.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
