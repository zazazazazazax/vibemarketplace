/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Fix per MetaMask/RainbowKit: Fallback per deps non-web
      config.resolve.fallback = {
        ...config.resolve.fallback || {},
        '@react-native-async-storage/async-storage': false,
        'pino-pretty': false,
      };
      // Extra: Ignora Pino tools in WC logger (per RainbowKit)
      config.plugins = config.plugins || [];
      config.plugins.push(
        new config.webpack.DefinePlugin({
          'global.pinoTools': JSON.stringify(false),
        })
      );
    }
    return config;
  },
};

export default nextConfig;
