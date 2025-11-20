'use client';

import { createContext, useContext } from 'react';
import { useMetaMaskSDK } from '../hooks/useMetaMaskSDK';  // Relativo da components a hooks
import { useConnect } from 'wagmi';

const MetaMaskContext = createContext();

export function MetaMaskProvider({ children }) {
  const { sdk, error } = useMetaMaskSDK();
  const { connectAsync } = useConnect();

  const connectWithSDK = async () => {
    if (!sdk || error) {
      console.warn('SDK not ready or error:', error);
      return false;
    }

    try {
      const provider = await sdk.connect();
      if (provider) {
        await connectAsync({ connector: provider });
        return true;
      }
    } catch (err) {
      console.error('SDK Connect Error:', err);
      return false;
    }
    return false;
  };

  const value = { connectWithSDK, sdk, error };

  return (
    <MetaMaskContext.Provider value={value}>
      {children}
    </MetaMaskContext.Provider>
  );
}

export function useMetaMask() {
  return useContext(MetaMaskContext);
}