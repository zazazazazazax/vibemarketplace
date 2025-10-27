'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { createStorage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';

const queryClient = new QueryClient();

// Theme semplice: Rounded + shadow (per modal pulito)
const customTheme = {
  ...lightTheme(),
  radii: {
    modal: '16px',
  },
  shadows: {
    dialog: '0 4px 20px rgba(0, 0, 0, 0.15)',
  },
  colors: {
    modalBackground: '#ffffff',
    modalBorder: '#e0e0e0',
    accentColor: '#10b981', // Verde Vibe
  },
};

export function Providers({ children }) {
  const config = createConfig({
    chains: [base],
    transports: {
      [base.id]: http('https://base.publicnode.com'),
    },
    connectors: [
      injected(),
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
        <RainbowKitProvider chains={[base]} theme={customTheme}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
