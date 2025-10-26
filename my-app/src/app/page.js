'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  // Redirect a inventory se già connesso
  useEffect(() => {
    if (isConnected) {
      router.push('/inventory');
    }
  }, [isConnected, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Vibe.Market - NFT Marketplace</h1>
      <p className="mb-8">Connect your wallet to get started.</p>
      {!isConnected ? (
        <ConnectButton />  // FIX: Modal RainbowKit con selezione wallet (Phantom, MetaMask, WC, etc.)
      ) : (
        <div>
          <p>Already connected! Redirecting...</p>
          <button
            onClick={() => disconnect()}  // Opzionale: Disconnect manuale
            className="bg-red-500 text-white px-4 py-2 rounded mt-4"
          >
            Disconnect
          </button>
        </div>
      )}
    </main>
  );
}
