'use client';

import { useEffect } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';  // Singleton
import { useFarcasterMiniApp } from './hooks/useFarcasterMiniApp';  // Hook per altre features

export default function ClientLayout({ children }) {
  useFarcasterMiniApp();  // Altre features (navigate, etc.)

  useEffect(() => {
    const callReady = async () => {
      console.log('ClientLayout: SDK check =', typeof sdk);  // Debug: Deve essere 'object'
      if (sdk && sdk.actions && typeof sdk.actions.ready === 'function') {
        await sdk.actions.ready();  // Awaited, sblocca splash
        console.log('Ready called from ClientLayout!');  // Deve apparire in console Mini App
      } else {
        console.warn('Ready not available yet—retrying in 500ms');
        setTimeout(callReady, 500);  // Retry fino a 5s max
      }
    };
    callReady();
  }, []);

  return children;
}
