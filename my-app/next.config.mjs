/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Fix per MetaMask SDK: Ignora dip React Native (non usate in web)
      config.resolve.fallback = {
        ...config.resolve.fallback,
        '@react-native-async-storage/async-storage': false,
      };
      // Fix per WalletConnect: Ignora pino-pretty (non essenziale per web, e WC è commentato)
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'pino-pretty': false,
      };
    }
    return config;
  },
};

export default nextConfig;
