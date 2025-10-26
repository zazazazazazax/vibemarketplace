/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Fix MetaMask SDK: Ignora React Native deps
      config.resolve.fallback = {
        ...config.resolve.fallback || {},
        '@react-native-async-storage/async-storage': false,
      };
    }
    // Fix Pino/WC logger: Esternalizza pino-pretty (non bundle in serverless)
    config.externals = [...(config.externals || []), 'pino-pretty'];
    return config;
  },
};

export default nextConfig;
