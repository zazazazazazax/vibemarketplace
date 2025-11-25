'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';  // Singleton (disponibile solo in Mini App)
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

export function useFarcasterMiniApp() {
  const [context, setContext] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState(null);
  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    const initSDK = async () => {
      if (typeof window !== 'undefined') {
        console.log('SDK check: typeof sdk =', typeof sdk);  // Debug
        try {
          if (typeof sdk === 'undefined') {
            console.log('SDK undefined - skipping (normal for browser)');
            return;
          }

          if (sdk.context) {
            const ctx = await sdk.context.get();
            setContext(ctx);
          }

          if (sdk.wallet && sdk.wallet.isConnected) {
            const provider = sdk.wallet.getEthereumProvider();
            if (provider && typeof provider.request === 'function') {
              connect({ connector: provider });
            }
          }

          if (sdk.actions && typeof sdk.actions.ready === 'function') {
            await sdk.actions.ready();
            console.log('Farcaster SDK ready!');
          }

          if (sdk.events) {
            sdk.events.on('wallet_connected', () => setAuthenticated(true));
          }
        } catch (err) {
          console.warn('SDK init error:', err.message);
          setError(err.message);
        }
      }
    };
    initSDK();
  }, [connect]);

  const connectWallet = async () => {
    if (sdk && sdk.wallet && typeof sdk.wallet.connect === 'function') {
      try {
        await sdk.wallet.connect();
      } catch (err) {
        console.warn('Embedded connect failed:', err);
        openConnectModal();
      }
    } else {
      openConnectModal();
    }
  };

  const navigateTo = (path) => {
    if (sdk && sdk.actions && typeof sdk.actions.navigate === 'function') {
      sdk.actions.navigate({ url: new URL(path, window.location.origin).href });
    } else {
      console.warn('Navigate not available');
    }
  };

  const signWithFarcaster = async (message) => {
    if (sdk && address) {
      const provider = sdk.wallet.getEthereumProvider();
      if (provider && typeof provider.request === 'function') {
        return provider.request({ method: 'personal_sign', params: [message, address] });
      }
    }
    throw new Error('Signing not available');
  };

  return { 
    sdk, 
    context, 
    authenticated: isConnected && authenticated, 
    connectWallet, 
    navigateTo, 
    signWithFarcaster,
    error 
  };
}
