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
    // Keys precedenti per testo (mantieni, funzionano alla grande)
    modalTextSecondary: '#6b7280',  // Secondary labels (es. "Popular")
    modalTextDim: '#6b7280',  // Dimmed text
    modalText: '#374151',  // Primary text (nomi wallet)
    connectButtonText: '#374151',  // Testo connect button
    // FIX NUOVO: Per outline icons e hover "scurire"
    generalBorder: '#f9fafb',  // Super light gray (quasi invisibile su white icons come MetaMask)
    selectedOptionBorder: '#9ca3af',  // Gray-400: Su hover, border più scuro/enfatizzato (simula "scurire" riquadro)
  },
};

export function Providers({ children }) {
  // Estrai chains dal config per consistenza e SSR-safety
  const { chains } = config;

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          chains={chains}
          theme={customTheme} 
          modalSize="compact"
          showMore={true}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
