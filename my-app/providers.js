'use client';

import { createConfig, http } from 'wagmi'; // FIX: Aggiunto createConfig
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { createStorage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'; // Per modal/connect UI

const queryClient = new QueryClient();

export function Providers({ children }) {
  const config = createConfig({
    chains: [base],
    transports: {
      [base.id]: http('https://base.publicnode.com'),
    },
    connectors: [
      injected(),
      coinbaseWallet({ appName: 'Vibe.Market' }),
      walletConnect({ projectId: '8e4f39df88b73f8ff1e701f88b4fea0c' }),
    ],
    ssr: true,
    storage: createStorage({
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    }),
    autoConnect: true,
  });

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider chains={[base]}> {/* Chains hardcode per semplicità */}
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
