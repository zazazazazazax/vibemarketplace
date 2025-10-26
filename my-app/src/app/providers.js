'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

const queryClient = new QueryClient();

export function Providers({ children }) {
  const config = createConfig({
    chains: [base], // Solo Base (chainId 8453)
    transports: {
      [base.id]: http('https://base.publicnode.com'), // RPC pubblico per reads
    },
    connectors: [
      injected({ target: 'metaMask' }), // Copre MetaMask, Phantom EVM, Brave, etc.
      coinbaseWallet({ appName: 'Vibe.Market' }),
      walletConnect({ projectId: 'IL_TUO_WC_PROJECT_ID_QUI' }), // Sostituisci con ID reale
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
