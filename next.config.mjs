/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  experimental: {
    // Include PDF files in the analyze route's serverless bundle
    outputFileTracingIncludes: {
      "/api/v1/analyze": [
        "./finance-agent/multiagent_analysis/all-pdfs/**",
      ],
      "/api/v1/available": [
        "./finance-agent/multiagent_analysis/all-pdfs/**",
      ],
      "/api/slack/command": [
        "./finance-agent/multiagent_analysis/all-pdfs/**",
      ],
    },
    // Prevent these Node-native packages from being bundled by webpack
    serverComponentsExternalPackages: ["pdf-parse", "node-html-parser"],
  },
};

export default nextConfig;
