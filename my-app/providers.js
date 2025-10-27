'use client';

import { http } from 'wagmi';
import { base } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { configureChains, createConfig } from 'wagmi';
import { publicProvider } from 'wagmi/providers'; // FIX: Path corretto per v2
import { injected, coinbaseWallet } from 'wagmi/connectors';
import { createStorage } from 'wagmi';

const queryClient = new QueryClient();

const { chains, publicClient } = configureChains(
  [base],
  [publicProvider()]
);

// Connectors manuali: Evita warning SDK/WalletConnect
const connectors = [
  injected(),
  coinbaseWallet({ appName: 'Vibe.Market' }),
];

const config = createConfig({
  chains,
  transports: {
    [base.id]: http('https://base.publicnode.com'),
  },
  connectors,
  ssr: true,
  storage: createStorage({
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  }),
  autoConnect: true,
});

export function Providers({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider chains={chains}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
