'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { base } from 'wagmi/chains'; // FIX: Import base per chainId
import { ConnectButton } from '@rainbow-me/rainbowkit';

export const dynamic = 'force-dynamic'; // No prerender

export default function Home() {
  const router = useRouter();
  const { address, isConnected, isConnecting } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [error, setError] = useState(null);
  const [hasSigned, setHasSigned] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showSyncButton, setShowSyncButton] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2;
  const connectStartTime = useState(Date.now())[0]; // Track quando inizia connecting

  // Detect mobile (touch-enabled device)
  useEffect(() => {
    const mobileCheck = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setIsMobile(mobileCheck);
  }, []);

  // Show sync button after 5s of connecting on mobile
  useEffect(() => {
    if (isMobile && isConnecting && Date.now() - connectStartTime > 5000) {
      setShowSyncButton(true);
    } else if (!isConnecting) {
      setShowSyncButton(false);
      connectStartTime = Date.now(); // Reset timer
    }
  }, [isConnecting, isMobile]);

  // Auto-trigger signature on connect (existing)
  useEffect(() => {
    if (isConnected && address && !hasSigned) {
      handleSignatureAndRedirect();
    }
  }, [isConnected, address, hasSigned]);

  const handleSignatureAndRedirect = async (retry = false) => {
    if (!address) return;

    try {
      setError(null);
      const domain = {
        name: 'Vibe.Marketplace',
        version: '1',
        chainId: base.id, // Ora base è definito
        verifyingContract: '0x0000000000000000000000000000000000000000'
      };
      const types = {
        Message: [
          { name: 'content', type: 'string' },
          { name: 'nonce', type: 'uint256' }
        ]
      };
      const nonce = Math.floor(Date.now() / 1000 / 3600);
      const message = {
        content: 'Sign to persist your Vibe.Marketplace session for 24 hours.',
        nonce: nonce
      };

      const signature = await signTypedDataAsync({ 
        domain, 
        types, 
        message, 
        primaryType: 'Message' 
      });

      localStorage.setItem('walletAddress', address);
      localStorage.setItem('walletSignature', signature);
      localStorage.setItem('walletNonce', nonce.toString());
      localStorage.setItem('walletTimestamp', Date.now().toString());

      setHasSigned(true);
      setRetryCount(0); // Reset retries
      setTimeout(() => router.push('/inventory'), 500);
    } catch (err) {
      if (retryCount < maxRetries && !err.message.includes('User rejected')) {
        // Retry signature (for intermittent WC delays)
        setRetryCount(prev => prev + 1);
        setTimeout(() => handleSignatureAndRedirect(true), 2000);
        return;
      }
      if (err.message.includes('User rejected') || err.message.includes('password')) {
        setError('Unlock MetaMask (enter password) before signing.');
      } else {
        setError('Error signing: ' + err.message + (retryCount > 0 ? ' (Retry failed)' : ''));
      }
      setHasSigned(true);
      setRetryCount(0);
    }
  };

  const handleSyncClick = () => {
    // Force re-poll: dispatch custom event to trigger wagmi reactivity
    window.dispatchEvent(new CustomEvent('wallet-sync'));
    // Reset connecting state indirectly by re-checking
    setShowSyncButton(false);
    // If connected now, trigger signature
    if (isConnected && address && !hasSigned) {
      handleSignatureAndRedirect();
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Home Page</h1>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          mounted,
        }) => {
          const ready = mounted;
          const connected = ready && account && chain;

          return (
            <div
              className={`
                ${ready ? 'opacity-100' : 'opacity-0'}
                flex flex-col items-center justify-center space-y-2
              `}
            >
              {(() => {
                if (isConnecting) {
                  return (
                    <div className="flex flex-col items-center space-y-2">
                      <button
                        disabled
                        className="bg-blue-500 text-white px-6 py-3 rounded-lg inline-flex items-center space-x-2"
                      >
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Connecting...
                      </button>
                      {showSyncButton && (
                        <button
                          onClick={handleSyncClick}
                          className="bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 text-sm"
                        >
                          Sync Connection (iOS Fix)
                        </button>
                      )}
                    </div>
                  );
                }

                if (!connected) {
                  return (
                    <div className="flex flex-col items-center space-y-2">
                      <button
                        onClick={openConnectModal}
                        type="button"
                        className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors"
                      >
                        Connect Wallet
                      </button>
                      <a
                        href="https://ethereum.org/en/wallets/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        What is a wallet?
                      </a>
                    </div>
                  );
                }

                if (chain.unsupported) {
                  return (
                    <button onClick={openChainModal} type="button" className="text-red-500">
                      Switch to Base
                    </button>
                  );
                }

                return (
                  <div className="flex flex-col items-center space-y-2">
                    <button
                      onClick={openChainModal}
                      type="button"
                      className="text-sm text-gray-500"
                    >
                      {chain.name}
                    </button>
                    <button
                      onClick={openAccountModal}
                      type="button"
                      className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
                    >
                      {account.displayName || `${address.slice(0, 6)}...${address.slice(-4)}`}
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        }}
      </ConnectButton.Custom>

      {error && <p className="text-red-500 mt-4">{error}</p>}
      {isConnected && !hasSigned && <p className="text-green-500 mt-4">Signing session...</p>}
      {isConnected && hasSigned && <p className="text-green-500 mt-4">Connected: {address?.slice(0, 6)}...{address?.slice(-4)}</p>}
    </main>
  );
}
