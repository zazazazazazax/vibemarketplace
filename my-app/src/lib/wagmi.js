import { configureChains, createConfig } from 'wagmi'
import { http } from 'viem'
import { base } from 'wagmi/chains'
import { publicProvider } from 'wagmi/providers/public'

import {
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import {
  connectorsForWallets,
  // RainbowKitChain
} from '@rainbow-me/rainbowkit'

const { chains, publicClient } = configureChains(
  [base],
  [
    publicProvider()
  ]
)

const projectId = '8e4f39df88b73f8ff1e701f88b4fea0c'

const connectors = connectorsForWallets([
  {
    groupName: 'Recommended',  // Sostituisce "Popular" con "Recommended" nativo
    wallets: [
      metaMaskWallet({ projectId, chains }),  // Fix detection "Installed" su desktop; mobile deep link via WC
      rainbowWallet({ projectId, chains }),   // Fix "invalid address" su iOS Safari (usa universal link + WC fallback)
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
])

export const config = createConfig({
  autoConnect: true,
  connectors,
  publicClient,
  ssr: true,  // Per Next.js SSR
})
export { chains }
