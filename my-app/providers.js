'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors'; // FIX: Rimosso walletConnect temporaneamente per test
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { useState } from 'react'; // FIX: Per QueryClient persistente

export function Providers({ children }) {
  // FIX: Crea QueryClient dentro con useState (persiste across re-renders, no sharing issues)
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 min cache default
      },
    },
  }));

  const config = createConfig({
    chains: [base], // Solo Base (chainId 8453)
    transports: {
      [base.id]: http('https://base.publicnode.com'), // RPC pubblico per reads
    },
    connectors: [
      injected({ target: 'metaMask' }), // Copre MetaMask, Phantom EVM, Brave, etc.
      coinbaseWallet({ appName: 'Vibe.Market' }),
      // walletConnect rimosso per test - ri-aggiungi sotto dopo
    ],
  });

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
