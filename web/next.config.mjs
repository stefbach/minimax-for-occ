/** @type {import('next').NextConfig} */

/**
 * Global security headers applied to every route. The CSP intentionally keeps
 * `unsafe-inline`/`unsafe-eval` for scripts and styles because the Next.js
 * runtime and the in-page LiveKit/Supabase clients still rely on them. We
 * narrow `connect-src` to the third parties Axon actually talks to so any new
 * outbound origin has to be added explicitly.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(self)",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.livekit.cloud wss://*.livekit.cloud https://api.twilio.com https://api.openai.com https://api.minimax.io https://api.deepgram.com",
      "font-src 'self' data:",
      "frame-src 'self' https:",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
