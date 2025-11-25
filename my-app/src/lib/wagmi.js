import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';
import { http } from 'wagmi';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// RPC Alchemy dalla env (fallback a publicnode se non settata)
const alchemyRpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_BASE_URL || 'https://1rpc.io/base';
console.log('Alchemy RPC URL loaded:', alchemyRpcUrl); // Stampa in server console (non browser)

const config = getDefaultConfig({
  appName: 'Poorly drawn binders',
  projectId,
  chains: [base],
  ssr: true,
  transports: {
    [base.id]: http(alchemyRpcUrl),  // Ora usa Alchemy (stabile, no 503)
  },
  walletConnectOptions: {
    projectId,
    metadata: {
      name: 'Vibe.Market',
      description: 'NFT Marketplace su Base',
      url: process.env.NEXT_PUBLIC_APP_URL || 'https://vibemarketplace.vercel.app/',
      icons: [process.env.NEXT_PUBLIC_APP_URL + '/favicon.ico'],
    },
  },
});

// Fix: Aggiungi Farcaster connector solo in Mini App context (commenta per test browser)
if (typeof window !== 'undefined' && window.farcaster) {  // Check client-side
  config.connectors.push(farcasterMiniApp({
    chains: [base],
  }));
} else {
  console.log('Farcaster connector skipped (browser test)');
}

export { config };
export const chains = [base];
