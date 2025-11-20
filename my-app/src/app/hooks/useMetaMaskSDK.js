'use client';

import { useState, useEffect } from 'react';
import MetaMaskSDK from '@metamask/sdk';

export function useMetaMaskSDK() {
  const [sdk, setSdk] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const MMSDK = new MetaMaskSDK({
          dappMetadata: {
            name: 'Vibe.Market',
            url: process.env.NEXT_PUBLIC_APP_URL || 'https://vibemarketplace.vercel.app/',
            icons: [process.env.NEXT_PUBLIC_APP_URL + '/favicon.ico'],
          },
          injectProvider: false,  // Solo connect, no inject
          dappMetadataMessages: true,  // Prompt "Connect to Vibe.Market?"
          preferDesktop: false,  // Forza mobile deep link
        });
        setSdk(MMSDK);
      } catch (err) {
        setError(err.message);
        console.warn('MetaMask SDK Init Error:', err);
      }
    }
  }, []);

  return { sdk, error };
}