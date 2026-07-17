/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
  // www.quantalyze.me is bound to this App Service (for anyone who types/
  // bookmarks it) but the canonical domain is the bare quantalyze.me — this
  // avoids ever completing an Entra OAuth redirect on the wrong host (the
  // app's redirect URI and AUTH_URL are both configured for the bare domain
  // only, found to matter when a stale DNS record for www briefly pointed
  // at a leftover Vercel deployment during the auth migration).
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.quantalyze.me" }],
        destination: "https://quantalyze.me/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
