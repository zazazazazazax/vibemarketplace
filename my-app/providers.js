'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { createStorage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'; // Nuovo: darkTheme
import merge from 'lodash.merge'; // Per merge theme (installa se non presente)

const queryClient = new QueryClient();

// Custom theme: Modal centrato, shadows, rounded
const customTheme = merge(darkTheme(), {
  radii: {
    modal: '16px', // Rounded per modal
  },
  shadows: {
    dialog: '0 4px 20px rgba(0, 0, 0, 0.15)', // Shadow centrato
  },
  colors: {
    modalBackground: '#ffffff', // Bianco per desktop
    modalBorder: '#e0e0e0',
    accentColor: '#10b981', // Verde per Vibe.Market
  },
} as any);

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
        <RainbowKitProvider chains={[base]} theme={customTheme}> {/* Nuovo: Custom theme */}
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
