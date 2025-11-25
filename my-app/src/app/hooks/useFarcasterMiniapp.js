'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';  // Import singleton (disponibile solo in Farcaster clients)
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

export function useFarcasterMiniApp() {
  const [context, setContext] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState(null);  // Per handle errors
  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    const initSDK = async () => {
      if (typeof window !== 'undefined') {
console.log('SDK check: typeof sdk =', typeof sdk);  // NUOVO: Debug
      console.log('SDK actions available?', !!sdk?.actions);  // NUOVO: Debug
        try {
          // Fix: Check se in Farcaster context (sdk disponibile solo lì; skip in browser normale)
          if (typeof sdk === 'undefined' || !sdk.actions) {
            console.log('Not in Farcaster Mini App context - skipping SDK init (normal for browser test)');
            return;  // Skip in browser normale, no error/crash
          }

          const ctx = await sdk.context.get();  // Get context
          setContext(ctx);

          // Auto-connect se wallet Farcaster già linked
          if (ctx?.wallet?.isConnected) {
            const provider = sdk.wallet.getEthereumProvider();
            if (provider && typeof provider.request === 'function') {
              connect({ connector: provider });  // Usa provider direttamente
            }
          }

          // Signal ready a Farcaster (obbligatorio per modal)
          await sdk.actions.ready();
          console.log('Farcaster SDK ready!');  // Debug log

          // Event listener per wallet
          sdk.events.on('wallet_connected', () => setAuthenticated(true));
        } catch (err) {
          console.warn('Farcaster SDK init error (expected in browser test):', err.message);
          setError(err.message);  // Silent error in browser
        }
      }
    };
    initSDK();
  }, [connect]);

  // Connect: Usa RainbowKit modal, ma prioritizza embedded
  const connectWallet = async () => {
    if (sdk && context?.wallet && typeof sdk.wallet.connect === 'function') {
      try {
        await sdk.wallet.connect();  // Embedded prima
      } catch (err) {
        console.warn('Embedded connect failed:', err);
        openConnectModal();  // Fallback
      }
    } else {
      openConnectModal();  // Fallback a RainbowKit (sempre disponibile)
    }
  };

  // Navigate: Routing interno nel modal (es. /inventory)
  const navigateTo = (path) => {
    if (sdk && sdk.actions && typeof sdk.actions.navigate === 'function') {
      sdk.actions.navigate({ url: new URL(path, window.location.origin).href });
    } else {
      console.warn('Navigate not available outside Mini App');
    }
  };

  // Signing: Integra con tuo useWalletSignature se serve (usa address da Wagmi)
  const signWithFarcaster = async (message) => {
    if (sdk && address) {
      const provider = sdk.wallet.getEthereumProvider();
      if (provider && typeof provider.request === 'function') {
        return provider.request({ method: 'personal_sign', params: [message, address] });
      }
    }
    throw new Error('Signing not available outside Mini App');
  };

  return { 
    sdk, 
    context, 
    authenticated: isConnected && authenticated, 
    connectWallet, 
    navigateTo, 
    signWithFarcaster,
    error  // Espone error per debug opzionale
  };
}
