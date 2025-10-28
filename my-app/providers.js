'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { config } from './src/lib/wagmi';  // Path ok
import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

const customTheme = {
  ...lightTheme(),
  borderRadius: 'none',  // Rimuove bordi arrotondati su wallet options/cards (fixa contorno icone Popular a riposo)
  radii: {
    modal: '16px',
    modalMobile: '12px',
  },
  shadows: {
    dialog: '0 4px 20px rgba(0, 0, 0, 0.15)',
    // FIX PER OUTLINE ICONS (MetaMask & Popular)
    walletLogo: 'none',  // Rimuove shadow/outline su icons SVG (fixa border visibile in default)
  },
  blurs: {
    // FIX PER BLUR/OPACIZZA DIETRO MODAL (riporta effetto originale)
    modalOverlay: '8px',  // Blur soft su home dietro modal
  },
  colors: {
    modalBackground: '#ffffff',
    modalBorder: '#e0e0e0',
    accentColor: '#00000000',  // Transparent: rimuove highlight colorato su selezione/hover (opzionale, ma aiuta a pulire)
    // Keys precedenti per testo (mantieni leggibili)
    modalTextSecondary: '#6b7280',  // Secondary labels (es. "Popular")
    modalTextDim: '#6b7280',  // Dimmed text
    modalText: '#374151',  // Primary text (nomi wallet)
    connectButtonText: '#374151',  // Testo connect button
    // FIX PER HOVER PRE-SELEZIONE (gray-200)
    menuItemBackground: '#e5e7eb',  // Gray-200: scurisce riquadro su hover
    // FIX PER RIMUOVERE BORDI DEFAULT SU ICONE/OPTIONS (inclusi Popular/Recommended)
    generalBorder: 'transparent',  // Rimuove bordi generali (default era visible su options)
    selectedOptionBorder: 'transparent',  // Rimuove border su selezione/hover (era '#9ca3af')
    // FIX PER OVERLAY OPACIZZA + 'X' CLOSE
    modalBackdrop: 'rgba(0, 0, 0, 0.5)',  // Opacità semi-trasparente su home
    closeButton: '#374151',  // 'X' grigio scuro, visibile
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
