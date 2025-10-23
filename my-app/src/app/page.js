'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';

export default function Home() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // EIP-712 typed data for signature
  const domain = {
    name: 'Vibe.Marketplace',
    version: '1',
    chainId: 8453, // Base
    verifyingContract: '0x0000000000000000000000000000000000000000' // Dummy
  };
  const types = {
    Message: [
      { name: 'content', type: 'string' },
      { name: 'nonce', type: 'uint256' }
    ]
  };
  const nonce = Math.floor(Date.now() / 1000 / 3600); // Hourly nonce

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        // Request signature for persistence
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

        setWalletAddress(address);
        router.push('/inventory'); // Redirect to inventory after connect
      } catch (err) {
        setError('Error connecting: ' + err.message);
      }
    } else {
      setError('Install MetaMask!');
    }
  };

  // Auto-reconnect and redirect to inventory
  useEffect(() => {
    const checkAutoConnect = async () => {
      if (!window.ethereum || !window.ethereum.isConnected()) return;

      const storedAddress = localStorage.getItem('walletAddress');
      const storedSignature = localStorage.getItem('walletSignature');
      const storedNonce = localStorage.getItem('walletNonce');
      const storedTimestamp = localStorage.getItem('walletTimestamp');

      if (storedAddress && storedSignature && storedNonce && storedTimestamp) {
        const now = Date.now();
        const expiry = 24 * 60 * 60 * 1000; // 24 hours
        if (now - parseInt(storedTimestamp) < expiry) {
          try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            await provider.send('eth_requestAccounts', []);
            const signer = await provider.getSigner();
            const address = await signer.getAddress();

            const message = {
              content: 'Sign to persist your Vibe.Marketplace session for 24 hours.',
              nonce: parseInt(storedNonce)
            };
            const recoveredAddress = ethers.verifyTypedData(domain, types, message, storedSignature);
            if (recoveredAddress.toLowerCase() === address.toLowerCase()) {
              setWalletAddress(address);
              router.push('/inventory'); // Redirect to inventory
              return;
            }
          } catch (err) {
            console.error('Auto-reconnect failed:', err);
          }
        }
        localStorage.clear();
      }
    };

    setTimeout(checkAutoConnect, 2000);
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
      {!walletAddress ? (
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded"
          onClick={connectWallet}
        >
          Connect Wallet
        </button>
      ) : (
        <p>Connected: {walletAddress}</p>
      )}
      {error && <p className="text-red-500">{error}</p>}
    </main>
  );
}
