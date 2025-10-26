'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { createStorage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

const queryClient = new QueryClient();

export function Providers({ children }) {
  const config = createConfig({
    chains: [base],
    transports: {
      [base.id]: http('https://base.publicnode.com'),
    },
    connectors: [
      injected({ target: 'metaMask' }),
      coinbaseWallet({ appName: 'Vibe.Market' }),
      walletConnect({ 
        projectId: '8e4f39df88b73f8ff1e701f88b4fea0c', // ID reale
        metadata: { // FIX: Metadata per prevenire multi-init su nav
          name: 'Vibe.Market',
          description: 'NFT Marketplace on Base',
          url: window.location.origin,
          icons: ['/favicon.ico'],
        },
      }),
    ],
    ssr: true,
    storage: createStorage({
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    }),
    autoConnect: true, // FIX: Persiste connection post-redirect (isConnected true in inventory)
  });

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
