import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';
import { http } from 'wagmi';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// RPC Alchemy dalla env (fallback a publicnode se non settata)
const alchemyRpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_BASE_URL || 'https://1rpc.io/base';
console.log('Alchemy RPC URL loaded:', alchemyRpcUrl); // Stampa in server console (non browser)

export const config = getDefaultConfig({
  appName: 'Vibe.Market',
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
    // Fix: No storage – Default in-memory (new session on reconnect, deep link sempre triggerato)
  },
});

export const chains = [base];