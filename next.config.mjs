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
    },
    // Prevent pdf-parse from being bundled by webpack (avoids test-file init issue)
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

export default nextConfig;
