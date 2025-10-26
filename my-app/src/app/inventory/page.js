'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi'; // V1 ok

export const dynamic = 'force-dynamic';

export default function Inventory() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  const { address: walletAddress, isConnected } = isMounted ? useAccount() : { address: null, isConnected: false };

  const [allInventory, setAllInventory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const cardsPerPage = 50;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
        <p>Loading...</p>
      </main>
    );
  }

  console.log('Inventory mounted and rendering - isConnected:', isConnected, 'address:', walletAddress);

  useEffect(() => {
    if (isConnected && walletAddress) {
      fetchAllInventory(walletAddress);
    }
  }, [isConnected, walletAddress]);

  const fetchAllInventory = async (address) => {
    console.log('Fetching inventory for', address);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api-inventory?address=${address}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      console.log('Inventory loaded, cards length:', data.cards?.length || 0);
      setAllInventory(data.cards || []);
      updateCurrentPage(data.cards || [], 1);
    } catch (err) {
      console.error('Fetch inventory error:', err);
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateCurrentPage = (cards, page) => {
    const safeCards = Array.isArray(cards) ? cards : [];
    const startIndex = (page - 1) * cardsPerPage;
    const endIndex = startIndex + cardsPerPage;
    const currentCards = safeCards.slice(startIndex, endIndex);
    setInventory(currentCards);
    setCurrentPage(page);
  };

  const totalPages = Math.ceil((Array.isArray(allInventory) ? allInventory.length : 0) / cardsPerPage);

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
      {!isConnected ? (
        <div>
          <p>Please connect your wallet on the home page to view inventory.</p>
          <button 
            onClick={() => router.push('/')} 
            className="bg-blue-500 text-white px-4 py-2 rounded mt-2"
          >
            Go to Home to Connect
          </button>
        </div>
      ) : (
        <>
          <p className="mb-4">
            Connected: {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
          </p>
          {error && <p className="text-red-500">{error}</p>}
          {loading && <p>Loading all pages...</p>}
          {Array.isArray(inventory) && inventory.length > 0 ? (
            <ul className="space-y-4">
              {inventory.map((card, index) => (
                <li key={index} className="border p-4 rounded">
                  Card {card.tokenId || index}
                </li>
              ))}
            </ul>
          ) : (
            <p>No opened cards found.</p>
          )}
          <div className="mt-4">
            <span>Page {currentPage} of {totalPages}</span>
          </div>
        </>
      )}
    </main>
  );
}
