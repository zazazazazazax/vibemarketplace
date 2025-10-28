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
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://*.walletconnect.org wss://relay.walletconnect.org https://pulse.walletconnect.org https://api.web3modal.org https://cca-lite.coinbase.com https://*.coinbase.com https://raw.githubusercontent.com https://*.githubusercontent.com; img-src 'self' data: blob: https://phantom.app https://rainbow.me https://metamask.io https://www.coinbase.com https://walletconnect.com *;", // FIX: img-src per favicon.ico
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
