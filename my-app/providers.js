'use client';

import { WagmiConfig, createConfig, configureChains } from 'wagmi';
import { base } from 'wagmi/chains';
import { publicProvider } from 'wagmi/providers/public';
import { InjectedConnector } from 'wagmi/connectors/injected';
import { CoinbaseWalletConnector } from 'wagmi/connectors/coinbaseWallet'; // FIX V1: Import individual
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

export function Providers({ children }) {
  // FIX V1: configureChains per chains + client
  const { chains, publicClient } = configureChains(
    [base],
    [publicProvider()], // Usa RPC pubblico Base
  );

  const config = createConfig({
    autoConnect: true,
    publicClient,
    chains,
    connectors: [
      new InjectedConnector({ chains, target: 'metaMask' }), // FIX V1: new InjectedConnector
      new CoinbaseWalletConnector({ chains, appName: 'Vibe.Market' }), // FIX V1: new CoinbaseWalletConnector
      // Ri-aggiungi WalletConnect dopo test: new WalletConnectConnector({ chains, options: { projectId: 'TUO_ID' } })
    ],
  });

  return (
    <WagmiConfig config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiConfig>
  );
}
