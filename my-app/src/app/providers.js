'use client';

import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';

export const config = createConfig({
  chains: [base], // Solo Base (chainId 8453)
  transports: {
    [base.id]: http('https://base.publicnode.com'), // RPC pubblico per reads
  },
  connectors: [
    injected({ target: 'metaMask' }), // Copre MetaMask, Phantom EVM, Brave, etc.
    coinbaseWallet({ appName: 'Vibe.Market' }),
    walletConnect({ projectId: 'YOUR_WC_PROJECT_ID' }), // Iscriviti su walletconnect.com/cloud per ID gratuito
  ],
});
