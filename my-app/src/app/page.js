'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { base } from 'wagmi/chains';
import { ConnectButton } from '@rainbow-me/rainbowkit'; // Per custom

export const dynamic = 'force-dynamic'; // No prerender crash

export default function Home() {
  const router = useRouter();
  const { address, isConnected, isConnecting } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [error, setError] = useState(null);
  const [hasSigned, setHasSigned] = useState(false);

  useEffect(() => {
    if (isConnected && address && !hasSigned) {
      handleSignatureAndRedirect();
    }
  }, [isConnected, address, hasSigned]);

  const handleSignatureAndRedirect = async () => {
    if (!address) return;

    try {
      setError(null);
      const domain = {
        name: 'Vibe.Marketplace',
        version: '1',
        chainId: base.id,
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
      setTimeout(() => router.push('/inventory'), 500);
    } catch (err) {
      if (err.message.includes('User rejected') || err.message.includes('password')) {
        setError('Sblocca MetaMask (inserisci password) prima di firmare.');
      } else {
        setError('Error signing: ' + err.message);
      }
      setHasSigned(true);
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
                flex flex-col items-center justify-center
              `}
            >
              {(() => {
                if (!connected) {
                  return (
                    <button
                      onClick={openConnectModal}
                      type="button"
                      className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      Connect Wallet
                    </button>
                  );
                }

                if (chain.unsupported) {
                  return (
                    <button onClick={openChainModal} type="button">
                      Wrong network
                    </button>
                  );
                }

                return (
                  <div className="flex flex-col items-center space-y-2">
                    <button
                      onClick={openChainModal}
                      type="button"
                      className="text-sm"
                    >
                      {chain.hasIcon && (
                        <div className="flex items-center">
                          <img
                            alt={chain.name ?? 'Chain icon'}
                            src={chain.iconUrl}
                            className="rounded-full w-4 h-4 mr-2"
                          />
                          {chain.name}
                        </div>
                      )}
                    </button>
                    <button
                      onClick={openAccountModal}
                      type="button"
                      className="bg-green-500 text-white px-4 py-2 rounded-lg"
                    >
                      {account.displayName}
                      {account.displayBalance
                        ? ` (${account.displayBalance})`
                        : ''}
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
