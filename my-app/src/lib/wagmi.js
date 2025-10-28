import { createConfig } from 'wagmi'
import { http } from 'viem'
import { base } from 'wagmi/chains'
import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'

const projectId = '8e4f39df88b73f8ff1e701f88b4fea0c'

const connectors = connectorsForWallets([
  {
    groupName: 'Recommended',
    wallets: [
      metaMaskWallet({ projectId }),
      rainbowWallet({ projectId }),
    ],
  },
  {
    groupName: 'Other',
    wallets: [
      coinbaseWallet({
        appName: 'Vibe.Market',
        // appLogo: 'https://your-logo-url.png',  // Aggiungi se hai un URL logo
      }),
      walletConnectWallet({ projectId }),
    ],
  },
], {
  appName: 'Vibe.Market',
  projectId,
  ssr: true,
})

export const config = createConfig({
  chains: [base],
  connectors,
  transports: {
    [base.id]: http(),
  },
  ssr: true,
})
