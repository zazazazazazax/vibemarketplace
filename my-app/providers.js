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
    // FIX PER Tondeggiante hover (se supportato in v2.1; altrimenti CSS dopo)
    menuRadius: '12px',  // Arrotonda menu items (riquadri wallet, incluso hover)
  },
  shadows: {
    dialog: '0 4px 20px rgba(0, 0, 0, 0.15)',
    // FIX PER OUTLINE ICONS (MetaMask & Popular)
    walletLogo: 'none',  // Rimuove shadow/outline su icons SVG (fixa border visibile)
  },
  colors: {
    modalBackground: '#ffffff',
    modalBorder: '#e0e0e0',
    accentColor: '#10b981',
    // Keys precedenti per testo (mantieni leggibili)
    modalTextSecondary: '#6b7280',  // Secondary labels (es. "Popular")
    modalTextDim: '#6b7280',  // Dimmed text
    modalText: '#374151',  // Primary text (nomi wallet)
    connectButtonText: '#374151',  // Testo connect button
    // FIX PER HOVER PRE-SELEZIONE (gray-200)
    menuItemBackground: '#e5e7eb',  // Gray-200: scurisce riquadro su hover
    selectedOptionBorder: '#9ca3af',  // Gray-400: border hover definito
    // FIX PER 'X' CLOSE BUTTON (grigio scuro, visibile)
    closeButton: '#374151',  // Rende 'X' netta (key valida per header close)
  },
};

export function Providers({ children }) {
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
