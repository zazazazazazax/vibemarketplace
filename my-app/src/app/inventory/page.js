'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useDisconnect, useChainId } from 'wagmi';
import { useQuery } from '@tanstack/react-query'; // Mantienilo importato, ma commenta uso

export const dynamic = 'force-dynamic'; // Forza dynamic rendering, evita static prerender

export default function Inventory() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  // Hooks Wagmi: Condizionati su isMounted, MINIMALI per test
  const { address: walletAddress, isConnected } = isMounted ? useAccount() : { address: null, isConnected: false };
  const { disconnect } = isMounted ? useDisconnect() : { disconnect: () => {} };
  const chainId = isMounted ? useChainId() : null;

  const [allInventory, setAllInventory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [prices, setPrices] = useState({});
  const [ethUsdPrice, setEthUsdPrice] = useState(0);
  const [isEthPriceLoaded, setIsEthPriceLoaded] = useState(false); // Mantieni per compatibilità
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [selectedCards, setSelectedCards] = useState([]);
  const debounceRef = useRef(null);

  const cardsPerPage = 50;

  // ... (tutti gli altri costanti come domain, types, nonce rimangono uguali)

  // FIX: Mount check
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

  // Debug log immediato
  console.log('Inventory mounted and rendering - isConnected:', isConnected, 'address:', walletAddress);

  // FIX: Commenta useQuery per ETH price (test isolato)
  // const { data: ethPriceData } = useQuery({
  //   queryKey: ['ethPrice'],
  //   queryFn: async () => {
  //     const response = await fetch('/api-inventory?endpoint=eth-price');
  //     if (!response.ok) throw new Error(`HTTP ${response.status}`);
  //     const data = await response.json();
  //     if (data.error) throw new Error(data.error);
  //     return data;
  //   },
  //   staleTime: 60000,
  //   retry: 3,
  // });

  // FIX: Commenta useEffect per ethPriceData
  // useEffect(() => {
  //   if (ethPriceData?.price) {
  //     setEthUsdPrice(ethPriceData.price);
  //     setIsEthPriceLoaded(true);
  //   }
  // }, [ethPriceData]);

  // Set manual per test (simula loaded)
  useEffect(() => {
    setIsEthPriceLoaded(true); // Hardcode per bypass
  }, []);

  // ... (resto del codice invariato: fetchAllInventory, preCalculatePrices, disconnectWallet, calculateCardPrice, handleMouseEnter, etc., fino al return)

  // Nel return, rimuovi {!isEthPriceLoaded && <p>Loading ETH/USD price...</p>} per ora, o lascialo (non blocca)

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
            Connected: {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}{' '}
            <button onClick={disconnectWallet} className="ml-2 bg-red-500 text-white px-2 py-1 rounded text-sm">
              Disconnect
            </button>
          </p>
          {error && <p className="text-red-500">{error}</p>}
          {loading && <p>Loading all pages...</p>}
          {/* {!isEthPriceLoaded && <p className="text-yellow-500 mb-4">Loading ETH/USD price...</p>}  <-- Commenta per test */}
          {Array.isArray(selectedCards) && selectedCards.length > 0 && (
            <button
              onClick={handleGoToListing}
              className="bg-green-500 text-white px-4 py-2 rounded mb-4"
            >
              Batch List {selectedCards.length} Cards
            </button>
          )}
          {Array.isArray(inventory) && inventory.length > 0 ? (
            // ... (UI cards invariata)
          ) : (
            <p>No opened cards found.</p>
          )}
        </>
      )}
    </main>
  );
}
