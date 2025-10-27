'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'; // Solo Provider, no getDefaultWallets
import { configureChains, createConfig } from 'wagmi';
import { publicProvider } from 'wagmi/providers/public';
import { createStorage } from 'wagmi';
import { 
  coinbaseWallet, 
  injected, 
  // walletConnect  // Decommenta sotto se vuoi
} from 'wagmi/connectors';

const queryClient = new QueryClient();

const { chains, publicClient } = configureChains(
  [base],
  [publicProvider()]
);

// FIX: Connectors manuali – NESSUN MetaMask SDK, solo injected base
const connectors = [
  injected({ target: 'metaMask' }), // MetaMask senza SDK (fix warning async-storage)
  coinbaseWallet({ appName: 'Vibe.Market' }),
  // walletConnect({ 
  //   projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', // Decommenta per WC
  // }),
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
        <RainbowKitProvider chains={chains} connectors={connectors}> {/* Passa connectors manuali */}
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
