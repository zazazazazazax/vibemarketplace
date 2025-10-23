'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ethers } from 'ethers';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const connectWallet = async () => {
    setLoading(true);
    setError(null);
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        // Request signature for persistence
        const domain = {
          name: 'Vibe.Marketplace',
          version: '1',
          chainId: 8453,
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
        const signature = await signer.signTypedData(domain, types, message);

        // Save to localStorage
        localStorage.setItem('walletAddress', address);
        localStorage.setItem('walletSignature', signature);
        localStorage.setItem('walletNonce', nonce.toString());
        localStorage.setItem('walletTimestamp', Date.now().toString());

        // Redirect to inventory after connect
        router.push('/inventory');
      } catch (err) {
        setError('Error connecting: ' + err.message);
      }
    } else {
      setError('Install MetaMask!');
    }
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Home Page</h1>
      <button
        className="bg-blue-500 text-white px-4 py-2 rounded"
        onClick={connectWallet}
        disabled={loading}
      >
        {loading ? 'Connecting...' : 'Connect Wallet'}
      </button>
      {error && <p className="text-red-500 mt-4">{error}</p>}
    </main>
  );
}
