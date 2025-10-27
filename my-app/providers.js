'use client';

import { http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { createStorage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { configureChains, createConfig } from 'wagmi';
import { publicProvider } from 'wagmi/providers'; // FIX: Path corretto (assoluto, da wagmi package)

const queryClient = new QueryClient();

// Configura chains una volta (fixa multi-init WalletConnect in prerender)
const { chains, publicClient } = configureChains(
  [base],
  [publicProvider()]
);

export function Providers({ children }) {
  const config = createConfig({
    chains,
    transports: {
      [base.id]: http('https://base.publicnode.com'),
    },
    connectors: [
      injected(), // Generico: MetaMask, Phantom, etc.
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
        <RainbowKitProvider chains={chains}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
