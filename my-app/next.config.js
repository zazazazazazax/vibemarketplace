/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // FIX: Transpile per RainbowKit/Wagmi
  transpilePackages: ['@rainbow-me/rainbowkit', 'wagmi'],

  // FIX: Webpack fallback per module not found
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        '@react-native-async-storage/async-storage': false,
        'pino-pretty': false,
      };
    }
    return config;
  },

  // Headers per CSP e COOP (esistente)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.walletconnect.org wss://relay.walletconnect.org https://pulse.walletconnect.org https://api.web3modal.org https://cca-lite.coinbase.com https://*.coinbase.com https://raw.githubusercontent.com https://*.githubusercontent.com ws://localhost:3000 https://mainnet.base.org https://*.base.org https://base-mainnet.g.alchemy.com https://1rpc.io/base https://base.publicnode.com https://*.metamask.io https://metamask-sdk.api.cx.metamask.io https://mm-sdk-analytics.api.cx.metamask.io; img-src 'self' data: blob: https://phantom.app https://rainbow.me https://metamask.io https://www.coinbase.com https://walletconnect.com *;",
          },
          // FIX Base SDK/Handover iOS: COOP per popup MetaMask (no 500 error)
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
    ];
  },

  // Nuovo: Redirect temporaneo per Farcaster manifest (al top-level, separato da headers)
//  async redirects() {
//    return [
//      {
//        source: '/.well-known/farcaster.json',
//        has: [],  // No conditions
//        destination: '/.well-known/farcaster.json',
//        permanent: false,  // 307 Temporary Redirect (non 308 permanente)
//      },
//    ];
//  },
};

module.exports = nextConfig;
