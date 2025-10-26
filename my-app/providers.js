'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { createStorage } from 'wagmi'; // FIX: Per persistence
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
      walletConnect({ projectId: 'IL_TUO_WC_PROJECT_ID_QUI' }),
    ],
    ssr: true, // FIX: Per Next.js hydration
    storage: createStorage({
      storage: typeof window !== 'undefined' ? window.localStorage : undefined, // Persistence localStorage
    }),
  });

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
