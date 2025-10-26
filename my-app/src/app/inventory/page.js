'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect, useDisconnect, useChainId, useConfig } from 'wagmi'; // FIX: useConfig invece di useConnectors
import { useQuery } from '@tanstack/react-query';

export const dynamic = 'force-dynamic'; // Forza dynamic rendering, evita static prerender

export default function Inventory() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false); // FIX: Check per hooks client-only

  // Hooks Wagmi: Condizionati su isMounted
  const { address: walletAddress, isConnected } = isMounted ? useAccount() : { address: null, isConnected: false };
  const { connect, error: connectError, isPending: isConnecting } = isMounted ? useConnect() : { connect: () => {}, error: null, isPending: false };
  // FIX: useConfig per connectors stabili dal root (mai undefined)
  const config = isMounted ? useConfig() : null;
  const connectors = config?.connectors || []; // Safe fallback
  const { disconnect } = isMounted ? useDisconnect() : { disconnect: () => {} };
  const chainId = isMounted ? useChainId() : null;

  const [allInventory, setAllInventory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [prices, setPrices] = useState({});
  const [ethUsdPrice, setEthUsdPrice] = useState(0);
  const [isEthPriceLoaded, setIsEthPriceLoaded] = useState(false);
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [selectedCards, setSelectedCards] = useState([]); // Inizializza sempre []
  const debounceRef = useRef(null);

  const cardsPerPage = 50;

  // EIP-712 per persistenza sessione (opzionale)
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

  // FIX: Mount check per useEffect che attiva hooks
  useEffect(() => {
    setIsMounted(true); // Attiva hooks solo dopo hydration client-side
  }, []);

  // Fallback UI durante mounting (evita flash/errors)
  if (!isMounted) {
    return (
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
        <p>Loading...</p>
      </main>
    );
  }

  // Debug log immediato per connectors (nel render, pre-useEffect)
  console.log('Inventory connectors from config:', connectors.length); // Dovrebbe log 3+ subito

  // Fetch ETH/USD con query caching
  const { data: ethPriceData } = useQuery({
    queryKey: ['ethPrice'],
    queryFn: async () => {
      const response = await fetch('/api-inventory?endpoint=eth-price');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    staleTime: 60000, // 1min
    retry: 3,
  });

  useEffect(() => {
    if (ethPriceData?.price) {
      setEthUsdPrice(ethPriceData.price);
      setIsEthPriceLoaded(true);
    }
  }, [ethPriceData]);

  // Fetch inventory su connect + chain check
  useEffect(() => {
    if (isConnected && chainId === 8453 && walletAddress) {
      fetchAllInventory(walletAddress);
    } else if (isConnected && chainId !== 8453) {
      setError('Please switch to Base chain (ID: 8453)');
    }
  }, [isConnected, chainId, walletAddress]);

  const fetchAllInventory = useCallback(async (address) => {
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

      if ((data.cards?.length || 0) > 0 && isEthPriceLoaded) {
        setTimeout(() => preCalculatePrices(data.cards || []), 3000);
      }
    } catch (err) {
      console.error('Fetch inventory error:', err);
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [isEthPriceLoaded]);

  const preCalculatePrices = useCallback(async (cards) => {
    const safeCards = cards || [];
    for (let i = 0; i < safeCards.length; i++) {
      const card = safeCards[i];
      const cacheKey = `${card.tokenId}-${card.contractAddress}`;
      if (!prices[cacheKey] && card.contract?.tokenAddress) {
        try {
          const price = await calculateCardPrice(card);
          setPrices(prev => ({ ...prev, [cacheKey]: price }));
        } catch (err) {
          console.error('Pre-calc error for card', card.tokenId, err);
        }
        if (i < safeCards.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }, [prices]);

  const connectWallet = useCallback((connector) => {
    console.log('Connecting with:', connector.name);
    connect({ connector });
  }, [connect]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    localStorage.clear();
    setAllInventory([]);
    setPrices({});
    setSelectedCards([]);
  }, [disconnect]);

  const calculateCardPrice = useCallback(async (card) => {
    const cacheKey = `${card.tokenId}-${card.contractAddress}`;
    if (prices[cacheKey]) return prices[cacheKey];

    if (!card.contract?.tokenAddress) return 'N/A';

    try {
      const cardData = JSON.stringify({
        metadata: card.metadata,
        rarity: card.rarity,
        contract: card.contract
      });
      const params = new URLSearchParams({
        endpoint: 'card-price',
        tokenId: card.tokenId,
        contractAddress: card.contractAddress,
        cardData: cardData
      });
      const response = await fetch(`/api-inventory?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      const price = data.price || 'N/A';
      setPrices(prev => ({ ...prev, [cacheKey]: price }));
      return price;
    } catch (err) {
      console.error('Error calculating price for card', card.tokenId, err);
      return 'N/A';
    }
  }, [prices]);

  const handleMouseEnter = useCallback(async (card) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}`;
      if (!prices[cacheKey] && card.contract?.tokenAddress && isEthPriceLoaded) {
        const price = await calculateCardPrice(card);
        setPrices(prev => ({ ...prev, [cacheKey]: price }));
      }
      setHoveredCardId(cacheKey);
    }, 0);
  }, [prices, isEthPriceLoaded, calculateCardPrice]);

  const handleMouseLeave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setHoveredCardId(null);
  }, []);

  const toggleSelect = useCallback((card) => {
    setSelectedCards(prev => {
      const safePrev = Array.isArray(prev) ? prev : []; // Extra safe per undefined
      return safePrev.some(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress) 
        ? safePrev.filter(c => !(c.tokenId === card.tokenId && c.contractAddress === card.contractAddress))
        : [...safePrev, card]
    });
  }, []);

  const handleGoToListing = useCallback(() => {
    const safeSelected = Array.isArray(selectedCards) ? selectedCards : []; // Extra safe
    const tokenIds = safeSelected.map(c => c.tokenId).join(',');
    const collection = safeSelected[0]?.contractAddress || '';
    const boosterToken = safeSelected[0]?.contract?.tokenAddress || '';
    router.push(`/listing?tokenIds=${tokenIds}&collection=${collection}&boosterToken=${boosterToken}&action=create`);
  }, [selectedCards, router]);

  const updateCurrentPage = useCallback((cards, page) => {
    const safeCards = Array.isArray(cards) ? cards : []; // Extra safe
    const startIndex = (page - 1) * cardsPerPage;
    const endIndex = startIndex + cardsPerPage;
    const currentCards = safeCards.slice(startIndex, endIndex);
    setInventory(currentCards);
    setCurrentPage(page);
  }, [cardsPerPage]);

  const getWearCondition = (wearValue) => {
    const wear = parseFloat(wearValue);
    if (wear <= 0.1) return 'Pristine';
    if (wear <= 0.3) return 'Mint';
    if (wear <= 0.5) return 'Lightly Played';
    if (wear <= 0.8) return 'Moderately Played';
    return 'Heavily Played';
  };

  const totalPages = Math.ceil((Array.isArray(allInventory) ? allInventory.length : 0) / cardsPerPage); // Extra safe

  const goToPage = useCallback((page) => {
    if (page > 0 && page <= totalPages) {
      updateCurrentPage(allInventory, page);
    }
  }, [allInventory, totalPages, updateCurrentPage]);

  useEffect(() => {
    if (Array.isArray(allInventory) && allInventory.length > 0) {
      updateCurrentPage(allInventory, currentPage);
    }
  }, [currentPage, allInventory, updateCurrentPage]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
      {!isConnected ? (
        <div>
          <p>Please connect your wallet to view inventory.</p>
          <div className="mt-2 space-x-2">
            {/* FIX: Safe .filter/.map su connectors da config */}
            {connectors.filter(c => c?.ready || true).map((connector) => ( // ready fallback per test
              <button
                key={connector.id}
                className="bg-blue-500 text-white px-4 py-2 rounded"
                onClick={() => connectWallet(connector)}
                disabled={isConnecting}
              >
                {isConnecting ? 'Connecting...' : `Connect ${connector.name}`}
              </button>
            ))}
          </div>
          {connectError && <p className="text-red-500 mt-2">{connectError.message}</p>}
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
          {!isEthPriceLoaded && <p className="text-yellow-500 mb-4">Loading ETH/USD price...</p>}
          {Array.isArray(selectedCards) && selectedCards.length > 0 && (
            <button
              onClick={handleGoToListing}
              className="bg-green-500 text-white px-4 py-2 rounded mb-4"
            >
              Batch List {selectedCards.length} Cards
            </button>
          )}
          {Array.isArray(inventory) && inventory.length > 0 ? (
            <>
              <ul className="space-y-4">
                {inventory.map((card, index) => {
                  const cacheKey = `${card.tokenId}-${card.contractAddress}`;
                  const isSelected = Array.isArray(selectedCards) && selectedCards.some(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress);
                  return (
                    <li key={index} className="border p-4 rounded flex" onMouseEnter={() => handleMouseEnter(card)} onMouseLeave={handleMouseLeave}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(card)}
                        className="mr-2 mt-1"
                      />
                      <img src={card.metadata?.imageUrl || ''} alt="Card" className="w-32 h-48 object-cover mr-4" />
                      <div className="flex-1">
                        <p><strong>Collection Name:</strong> {card.metadata?.name?.split(' #')[0] || 'Unknown Collection'}</p>
                        <p><strong>Contract Address:</strong> {card.contractAddress || 'N/A'}</p>
                        <p><strong>Token Address:</strong> {card.contract?.tokenAddress || 'N/A'}</p>
                        <p><strong>Token ID:</strong> {card.tokenId || 'N/A'}</p>
                        <p><strong>Wear:</strong> {getWearCondition(card.metadata?.wear) || 'N/A'}</p>
                        <p><strong>Foil:</strong> {card.metadata?.foil === 'Normal' ? 'None' : card.metadata?.foil || 'N/A'}</p>
                        <p><strong>Estimated Price:</strong> {hoveredCardId === cacheKey ? prices[cacheKey] || 'Calculating...' : 'Hover to calculate'}</p>
                        {hoveredCardId === cacheKey && prices[cacheKey] && prices[cacheKey] !== 'N/A' && (
                          <button
                            className="bg-green-500 text-white px-3 py-1 rounded mt-2"
                            onClick={() => {
                              setSelectedCards([card]);
                              handleGoToListing();
                            }}
                          >
                            List for {prices[cacheKey]}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4">
                <button
                  className="bg-blue-500 text-white px-2 py-1 rounded mr-2 disabled:bg-gray-400"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span>Page {currentPage} of {totalPages} (Total cards: {Array.isArray(allInventory) ? allInventory.length : 0})</span>
                <button
                  className="bg-blue-500 text-white px-2 py-1 rounded ml-2 disabled:bg-gray-400"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <p>No opened cards found.</p>
          )}
        </>
      )}
    </main>
  );
}
