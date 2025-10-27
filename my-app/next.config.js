/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Evita lag hydration modals
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://*.walletconnect.org https://api.web3modal.org https://cca-lite.coinbase.com https://*.coinbase.com https://raw.githubusercontent.com https://*.githubusercontent.com; img-src * data:;", // FIX: Permette API WC/Coinbase, icone GitHub, img-src tutto
          },
        ],
      },
    ];
  },
  experimental: {
    appDir: true,
  },
};

module.exports = nextConfig;
