'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { config } from './src/lib/wagmi';  // Path ok
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
    // FIX: Aggiungi questi per testo wallet più leggibile (grigio scuro invece di pallido)
    walletDetailsDescription: '#6b7280',  // Gray-500 Tailwind, contrasto buono su white
    secondary: '#6b7280',  // Per altri testi secondari nel modal
  },
};

export function Providers({ children }) {
  // Estrai chains dal config per consistenza e SSR-safety
  const { chains } = config;

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          chains={chains}  // Già fixato prima
          theme={customTheme} 
          modalSize="compact"  // Mantiene il modal compatto
          showMore={true}  // Mostra più wallet
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
