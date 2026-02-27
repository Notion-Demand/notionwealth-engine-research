import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow images from Supabase storage if needed
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
