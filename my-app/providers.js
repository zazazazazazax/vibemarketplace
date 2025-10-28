'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { config } from './src/lib/wagmi';  // Path ok se providers è in root e src/lib è sibling
import '@rainbow-me/rainbowkit/styles.css';

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
  // Estrai chains dal config per consistenza e SSR-safety
  const { chains } = config;

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          chains={chains}  // FIX: Usa config.chains invece di [base] hardcodato
          theme={customTheme} 
          modalSize="compact"  // Buono per fixare il modal "tagliato" (compact è default per mobile/desktop)
          showMore={true}  // Mostra più wallet se >6
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
