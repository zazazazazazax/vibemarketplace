import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';

const projectId = '8e4f39df88b73f8ff1e701f88b4fea0c';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [
        rainbowWallet({ projectId }),
        metaMaskWallet({ projectId }),
      ],
    },
    {
      groupName: 'Other',
      wallets: [
        coinbaseWallet({
          appName: 'Vibe.Market',
        }),
        walletConnectWallet({ projectId }),
      ],
    },
  ],
  {
    appName: 'Vibe.Market',
    projectId,
  }
);

export const config = getDefaultConfig({
  appName: 'Vibe.Market',
  projectId,
  chains: [base],
  connectors,
  ssr: true, // Obbligatorio per Next.js SSR
});
