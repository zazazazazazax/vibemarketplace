'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { config, chains } from './src/lib/wagmi';
import '@rainbow-me/rainbowkit/styles.css';

// QueryClient ottimizzato per mobile
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const customTheme = {
  ...lightTheme({ accentColor: '#10b981' }),  // Base light per struttura, ma override dark colors
  radii: {
    modal: '16px',
    modalMobile: '12px',
    actionButton: '0px',
  },
  shadows: {
    dialog: '0 4px 20px rgba(255, 255, 255, 0.1)',  // Bianco tenue per dark
    selectedOption: 'none',
    walletLogo: 'none',
  },
  blurs: {
    modalOverlay: '8px',
  },
  colors: {
    modalBackground: '#000000',  // Nero per sfondo modal
    modalBorder: '#333333',  // Grigio scuro per bordi (contrasto su nero)
    accentColor: '#10b981',  // Verde invariato per "Learn more" e accenti
    modalTextSecondary: '#ffffff',  // Bianco per testi secondari (es. "Installed")
    modalTextDim: '#ffffff',  // Bianco per dim text (es. descrizioni wallet)
    modalText: '#ffffff',  // Bianco per titoli (es. "Connect a Wallet", "Recommended")
    connectButtonText: '#ffffff',  // Bianco per testo bottoni
    menuItemBackground: '#1a1a1a',  // Nero/grigio scuro per hover/menu items
    generalBorder: '#333333',  // Grigio scuro per bordi generali
    selectedOptionBorder: '#10b981',  // Verde per selected (opzionale, match accent)
    modalBackdrop: 'rgba(0, 0, 0, 0.8)',  // Nero più opaco per overlay
    closeButton: '#ffffff',  // Bianco per X close
  },
};

export function Providers({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          chains={chains}
          theme={customTheme} 
          modalSize="compact"
          showMore={true}
          showRecentTransactions={true}
          showWalletConnectScanner={true}
enableWalletConnectSessionStorage={true}
enableTelemetry={false}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
