import { getDefaultConfig, getWalletConnectConnector } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, walletConnectWallet, rainbowWallet, coinbaseWallet, injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { base } from 'wagmi/chains';
import { http } from 'wagmi';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://poorlydrawnbinders.vercel.app';
const appIcon = `${appUrl}/favicon.ico`;

// RPC Alchemy dalla env (fallback a publicnode se non settata)
const alchemyRpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_BASE_URL || 'https://1rpc.io/base';
console.log('Alchemy RPC URL loaded:', alchemyRpcUrl); // Stampa in server console (non browser)

const isMobileBrowser = () => (
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
);

const hasInjectedMetaMask = () => (
  typeof window !== 'undefined' &&
  Boolean(window.ethereum?.isMetaMask)
);

const metaMaskMobileWalletConnectWallet = (options) => {
  const defaultMetaMask = metaMaskWallet(options);
  if (!isMobileBrowser() || hasInjectedMetaMask()) return defaultMetaMask;

  const { projectId: walletConnectProjectId, walletConnectParameters } = options;
  const getMetaMaskUri = (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`;

  return {
    ...defaultMetaMask,
    installed: undefined,
    mobile: { getUri: getMetaMaskUri },
    qrCode: { getUri: getMetaMaskUri },
    createConnector: getWalletConnectConnector({
      projectId: walletConnectProjectId,
      walletConnectParameters,
    }),
  };
};

const config = getDefaultConfig({
  appName: 'Poorly Drawn Binders',
  appDescription: 'List and buy liquid trading cards!',
  appUrl,
  appIcon,
  projectId,
  chains: [base],
  ssr: true,
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [
        metaMaskMobileWalletConnectWallet,
        walletConnectWallet,
        rainbowWallet,
        coinbaseWallet,
        injectedWallet,
      ],
    },
  ],
  transports: {
    [base.id]: http(alchemyRpcUrl),  // Ora usa Alchemy (stabile, no 503)
  },
  walletConnectOptions: {
    projectId,
    metadata: {
      name: 'Poorly Drawn Binders',
      description: 'List and buy liquid trading cards!',
      url: appUrl,
      icons: [appIcon],
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
