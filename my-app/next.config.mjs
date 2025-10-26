/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Fix per MetaMask/RainbowKit: Ignora React Native deps (solo client)
      config.resolve.fallback = {
        ...config.resolve.fallback || {},
        '@react-native-async-storage/async-storage': false,
        'pino-pretty': false,
      };
    }
    return config;
  },
};

export default nextConfig;
