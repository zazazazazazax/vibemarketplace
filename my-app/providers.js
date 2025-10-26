'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { createStorage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, getDefaultWallets } from '@rainbow-me/rainbowkit'; // Nuovo
import { base as baseNetwork } from 'wagmi/chains'; // Per RainbowKit

const queryClient = new QueryClient();

export function Providers({ children }) {
  const { chains, publicClient } = createConfig({
    chains: [base],
    transports: {
      [base.id]: http('https://base.publicnode.com'),
    },
    connectors: [
      ...(getDefaultWallets({
        chains,
        projectId: '8e4f39df88b73f8ff1e701f88b4fea0c', // Il tuo WC projectId
      })).accounts, // Auto-aggiunge injected + WC con icone
      coinbaseWallet({ appName: 'Vibe.Market' }),
    ],
  });

  const config = createConfig({
    chains,
    connectors,
    transports: {
      [base.id]: http('https://base.publicnode.com'),
    },
    ssr: true,
    storage: createStorage({
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    }),
    autoConnect: true,
  });

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
