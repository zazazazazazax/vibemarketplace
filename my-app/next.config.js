/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://*.walletconnect.org wss://relay.walletconnect.org https://api.web3modal.org https://cca-lite.coinbase.com https://*.coinbase.com https://raw.githubusercontent.com https://*.githubusercontent.com; img-src 'self' https://*.githubusercontent.com https://*.coinbase.com data: blob: *;", // FIX: Aggiunto wss://relay.walletconnect.org per WS WC, img-src espanso per icone GitHub
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
