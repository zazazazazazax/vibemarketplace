import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';
import {
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';

const projectId = '8e4f39df88b73f8ff1e701f88b4fea0c';

export const config = getDefaultConfig({
  appName: 'Vibe.Market',
  projectId,
  chains: [base],
  ssr: true, // Obbligatorio per Next.js SSR
  wallets: [
    {
      groupName: 'Recommended',  // Sostituisce "Popular" con "Recommended" nativo
      wallets: [
        metaMaskWallet({ projectId }),  // Fix detection "Installed" su desktop; mobile deep link via WC
        rainbowWallet({ projectId }),   // Fix "invalid address" su iOS Safari (usa universal link + WC fallback)
      ],
    },
    {
      groupName: 'Other',
      wallets: [
        coinbaseWallet({
          appName: 'Vibe.Market',
          appLogo: 'https://your-logo-url.png',  // Opzionale: aggiungi URL logo se hai
          darkMode: false,
        }),
        walletConnectWallet({ projectId }),  // Fix infinite loop: single instance WC v2 con metadata
      ],
    },
  ],
});
