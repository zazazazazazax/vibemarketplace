'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { createStorage } from 'wagmi';
import { RainbowKitProvider, getDefaultWallets } from '@rainbow-me/rainbowkit';

const queryClient = new QueryClient();

export function Providers({ children }) {
  const { chains, publicClient } = createConfig({
    chains: [base],
  });

  const config = createConfig({
    chains,
    connectors: [
      ...getDefaultWallets({
        chains,
        projectId: '8e4f39df88b73f8ff1e701f88b4fea0c', // Il tuo WalletConnect projectId
      }).accounts,
      // Opzionale: Aggiungi Coinbase se vuoi, ma RainbowKit copre già injected + WC
    ],
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
