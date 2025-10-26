/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback || {},
        '@react-native-async-storage/async-storage': false,
      };
    }
    // Fix per Pino/WC logger: Esternalizza pino-pretty (non necessario in bundle)
    config.externals = config.externals || [];
    config.externals.push('pino-pretty');
    return config;
  },
};

export default nextConfig;
