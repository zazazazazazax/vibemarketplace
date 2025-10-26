'use client';

import { createClient } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';
import { http } from 'viem'; // FIX V1: http da viem, non wagmi
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

const queryClient = new QueryClient();

export function Providers({ children }) {
  const client = createClient({
    chains: [base],
    transports: {
      [base.id]: http('https://base.publicnode.com'), // FIX V1: http() da viem
    },
    connectors: [
      injected({ target: 'metaMask' }),
      coinbaseWallet({ appName: 'Vibe.Market' }),
      // Ri-aggiungi walletConnect dopo test: import { walletConnect } from 'wagmi/connectors'; + walletConnect({ projectId: 'TUO_ID' })
    ],
  });

  return (
    <WagmiProvider client={client}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
