'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useConnect, useAccount, useSignTypedData } from 'wagmi';
import { base } from 'wagmi/chains';

export default function Home() {
  const router = useRouter();
  const { address, isConnected, isConnecting } = useAccount();
  const { connect, connectors, error: connectError, isPending } = useConnect();
  const { signTypedDataAsync } = useSignTypedData();
  const [error, setError] = useState(null);

  const connectWallet = async () => {
    setError(null);
    if (isConnected) {
      await handleSignatureAndRedirect();
      return;
    }

    const { connector } = await connect({ chainId: base.id, connector: connectors[0] });
    const { connector } = result || {};
    if (connector) {
      await handleSignatureAndRedirect();
    }
  };

  const handleSignatureAndRedirect = async () => {
    if (!address) return;

    try {
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

      const signature = await signTypedDataAsync({ domain, types, message });

      localStorage.setItem('walletAddress', address);
      localStorage.setItem('walletSignature', signature);
      localStorage.setItem('walletNonce', nonce.toString());
      localStorage.setItem('walletTimestamp', Date.now().toString());

      // FIX: Delay redirect per Wagmi storage save (persistence)
      setTimeout(() => router.push('/inventory'), 500);
    } catch (err) {
      setError('Error signing: ' + err.message);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Home Page</h1>
      <button
        className="bg-blue-500 text-white px-4 py-2 rounded"
        onClick={connectWallet}
        disabled={isPending || isConnecting}
      >
        {isConnected ? 'Sign & Continue' : isPending ? 'Connecting...' : 'Connect Wallet'}
      </button>
      {connectError && <p className="text-red-500 mt-4">{connectError.message}</p>}
      {error && <p className="text-red-500 mt-4">{error}</p>}
      {isConnected && <p className="text-green-500 mt-4">Connected: {address.slice(0, 6)}...{address.slice(-4)}</p>}
    </main>
  );
}
