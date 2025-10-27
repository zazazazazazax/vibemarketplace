'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { base } from 'wagmi/chains';
import { ConnectButton } from '@rainbow-me/rainbowkit'; // Nuovo: Modal connessioni

export const dynamic = 'force-dynamic'; // FIX: No prerender, evita SSR crash wagmi

export default function Home() {
  const router = useRouter();
  const { address, isConnected, isConnecting } = useAccount(); // FIX: Hooks unconditional
  const { signTypedDataAsync } = useSignTypedData();
  const [error, setError] = useState(null);
  const [hasSigned, setHasSigned] = useState(false); // No loop su signature

  // Trigger signature & redirect su connessione
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

      // Delay redirect
      setTimeout(() => router.push('/inventory'), 500);
    } catch (err) {
      // FIX: Check per MetaMask sbloccato
      if (err.message.includes('User rejected') || err.message.includes('password')) {
        setError('Sblocca MetaMask (inserisci password) prima di firmare.');
      } else {
        setError('Error signing: ' + err.message);
      }
      setHasSigned(true); // Blocca re-trigger
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Home Page</h1>
      <ConnectButton /> {/* Nuovo: Gestisce connect, chain switch, address display */}
      {error && <p className="text-red-500 mt-4">{error}</p>}
      {isConnected && !hasSigned && <p className="text-green-500 mt-4">Signing session...</p>}
      {isConnected && hasSigned && <p className="text-green-500 mt-4">Connected: {address.slice(0, 6)}...{address.slice(-4)}</p>}
    </main>
  );
}
