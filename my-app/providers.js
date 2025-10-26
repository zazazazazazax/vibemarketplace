'use client';

import { createClient } from 'wagmi';
import { publicProvider } from 'wagmi/providers/public';
import { InjectedConnector } from 'wagmi/connectors/injected';
import { CoinbaseWalletConnector } from 'wagmi/connectors/coinbaseWallet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiConfig } from 'wagmi';

const queryClient = new QueryClient();

export function Providers({ children }) {
  const client = createClient({
    autoConnect: true, // FIX: Ripristina session post-redirect
    connectors: [
      new InjectedConnector(), // MetaMask, etc. (no chains needed)
      new CoinbaseWalletConnector({
        appName: 'Vibe.Market',
      }),
      // Ri-aggiungi WalletConnect dopo test: import { WalletConnectConnector } from 'wagmi/connectors/walletConnect'; + new WalletConnectConnector({ options: { projectId: 'TUO_ID' } })
    ],
    provider: publicProvider(), // FIX V1: Default RPC (usa Base se auto-detect)
  });

  return (
    <WagmiConfig client={client}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiConfig>
  );
}
