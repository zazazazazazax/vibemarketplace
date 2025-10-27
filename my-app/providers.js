'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors'; // Tieni i tuoi extra
import { createStorage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, getDefaultWallets, lightTheme } from '@rainbow-me/rainbowkit'; // Aggiunto getDefaultWallets per più wallet + icone/QR

const queryClient = new QueryClient();

// Theme semplice: Rounded + shadow (il tuo è buono, lo mantengo)
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
  // FIX: Usa getDefaultWallets per includere tutti i wallet (Phantom, Rainbow, etc.) con icone uniformi e QR/download per non-installati
  const { chains } = { chains: [base] }; // Dummy per compatibilità
  const projectId = '8e4f39df88b73f8ff1e701f88b4fea0c'; // Il tuo projectId
  const { connectors } = getDefaultWallets({
    appName: 'Vibe.Market',
    projectId,
    chains: [base],
  });

  // Aggiungi i tuoi connectors extra (Coinbase) se non già inclusi
  const fullConnectors = [
    ...connectors,
    coinbaseWallet({ appName: 'Vibe.Market' }), // Evita duplicati se già in default
  ];

  const config = createConfig({
    chains: [base],
    transports: {
      [base.id]: http('https://base.publicnode.com'),
    },
    connectors: fullConnectors, // Ora include tutto: injected (MetaMask), Phantom, etc. + QR
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
          modalSize="compact" // FIX: 'compact' per popup centrato su desktop (non tagliato)
          showMore={false} // FIX: Nasconde "Show more" per layout pulito come nell'esempio
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
