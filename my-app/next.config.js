/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // FIX: Evita lag/hydration issues con modals in dev (da GitHub #837)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' 'unsafe-eval';", // FIX: Permette stili inline RainbowKit su Vercel (da issue #1256)
          },
        ],
      },
    ];
  },
  experimental: {
    appDir: true, // Se non già, per app router
  },
};

module.exports = nextConfig;
