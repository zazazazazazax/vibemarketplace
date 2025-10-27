'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors';
import { createStorage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, getDefaultWallets, lightTheme } from '@rainbow-me/rainbowkit';

const queryClient = new QueryClient();

const customTheme = {
  ...lightTheme(),
  radii: {
    modal: '16px',
    modalMobile: '12px',
  },
  shadows: {
    dialog: '0 4px 20px rgba(0, 0, 0, 0.15)',
  },
  colors: {
    modalBackground: '#ffffff',
    modalBorder: '#e0e0e0',
    accentColor: '#10b981',
  },
};

export function Providers({ children }) {
  const { chains } = { chains: [base] };
  const projectId = '8e4f39df88b73f8ff1e701f88b4fea0c';
  const { connectors } = getDefaultWallets({
    appName: 'Vibe.Market',
    projectId,
    chains: [base],
  });

  const fullConnectors = [
    ...connectors,
    coinbaseWallet({ appName: 'Vibe.Market' }),
  ];

  const config = createConfig({
    chains: [base],
    transports: {
      [base.id]: http('https://base.publicnode.com'),
    },
    connectors: fullConnectors,
    ssr: true,
    storage: createStorage({
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    }),
    autoConnect: true,
  });

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          chains={[base]} 
          theme={customTheme} 
          modalSize="compact" // Compact per centrato
          showMore={true} // FIX: Mostra tutte le icone fin da subito (no lazy/secondo click)
          locale="it-IT" // FIX: Layout EU meno buggy su desktop
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
