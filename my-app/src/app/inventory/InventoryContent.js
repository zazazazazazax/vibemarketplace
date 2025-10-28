'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect, useDisconnect, useChainId } from 'wagmi';
import { useQuery } from '@tanstack/react-query';

export default function InventoryContent() {
  const router = useRouter();

  // Hooks Wagmi (sempre al top)
  const { address: walletAddress, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();

  // Stati (sempre al top)
  const [showUI, setShowUI] = useState(false);
  const [allInventory, setAllInventory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [prices, setPrices] = useState({});
  const [ethUsdPrice, setEthUsdPrice] = useState(0);
  const [isEthPriceLoaded, setIsEthPriceLoaded] = useState(false);
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [selectedCards, setSelectedCards] = useState([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [cardToList, setCardToList] = useState(null);
  const [isBatchListing, setIsBatchListing] = useState(false);
  const debounceRef = useRef(null);

  const cardsPerPage = 50;

  // useQuery per ETH price (sempre al top)
  const { data: ethPriceData } = useQuery({
    queryKey: ['ethPrice'],
    queryFn: async () => {
      const response = await fetch('/api/inventory?endpoint=eth-price');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    staleTime: 60000,
    retry: 3,
    enabled: true,
  });

  // useEffect per ETH price
  useEffect(() => {
    if (ethPriceData?.price) {
      setEthUsdPrice(ethPriceData.price);
      setIsEthPriceLoaded(true);
    }
  }, [ethPriceData]);

  // useEffect per showUI
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowUI(true);
    }, 1000);

    if (isConnected) {
      clearTimeout(timer);
      setShowUI(true);
    }

    return () => clearTimeout(timer);
  }, [isConnected]);

  // useEffect per fetch inventory (deps pulite, no cicli)
  useEffect(() => {
    if (isConnected && chainId === 8453 && walletAddress) {
      fetchAllInventory(walletAddress);
    } else if (isConnected && chainId !== 8453) {
      setError('Please switch to Base chain (ID: 8453)');
    } else if (!isConnected) {
      setError(null);
      setAllInventory([]);
      setPrices({});
      setSelectedCards([]);
    }
  }, [walletAddress, chainId, isConnected]);

  // useEffect per cleanup debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // useEffect per paginazione
  useEffect(() => {
    if (Array.isArray(allInventory) && allInventory.length > 0) {
      updateCurrentPage(allInventory, currentPage);
    }
  }, [currentPage, allInventory]);

  // Funzioni (dopo hooks, deps pulite)
  const fetchAllInventory = useCallback(async (address) => {
    console.log('Fetching inventory for', address);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/inventory?address=${address}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      console.log('Inventory loaded, cards length:', data.cards?.length || 0);
      setAllInventory(data.cards || []);
      updateCurrentPage(data.cards || [], 1);

      // TODO: Pre-calc prezzi disabilitato per evitare potenziali loop/setState durante fetch
      // if ((data.cards?.length || 0) > 0 && isEthPriceLoaded) { ... } // Commentato per debug
    } catch (err) {
      console.error('Fetch inventory error:', err);
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [isEthPriceLoaded]); // Rimosso 'prices' dalle deps per evitare ri-creazioni inutili

  const connectWallet = useCallback((connector) => {
    connect({ connector });
  }, [connect]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    localStorage.clear();
    setAllInventory([]);
    setPrices({});
    setSelectedCards([]);
    router.push('/');
  }, [disconnect, router]);

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
      const response = await fetch(`/api/inventory?${params}`);
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

  const handleMouseEnter = useCallback((card) => {
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
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.some(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress) 
        ? safePrev.filter(c => !(c.tokenId === card.tokenId && c.contractAddress === card.contractAddress))
        : [...safePrev, card]
    });
  }, []);

  const handleCardClick = useCallback((card) => {
    setCardToList(card);
    setIsBatchListing(false);
    setShowConfirmModal(true);
  }, []);

  const handleBatchClick = useCallback(() => {
    if (selectedCards.length > 0) {
      setIsBatchListing(true);
      setShowConfirmModal(true);
    }
  }, [selectedCards.length]);

  const confirmListing = useCallback(() => {
    const cardsToList = isBatchListing ? selectedCards : (cardToList ? [cardToList] : []);
    if (cardsToList.length > 0) {
      const safeCards = Array.isArray(cardsToList) ? cardsToList : [];
      const tokenIds = safeCards.map(c => c.tokenId).join(',');
      const collection = safeCards[0]?.contractAddress || '';
      const boosterToken = safeCards[0]?.contract?.tokenAddress || '';
      router.push(`/listing?tokenIds=${tokenIds}&collection=${collection}&boosterToken=${boosterToken}&action=create`);
      if (isBatchListing) {
        setSelectedCards([]); // Clear selection after batch listing
      }
    }
    setShowConfirmModal(false);
    setCardToList(null);
    setIsBatchListing(false);
  }, [isBatchListing, cardToList, selectedCards, router]);

  const updateCurrentPage = useCallback((cards, page) => {
    const safeCards = Array.isArray(cards) ? cards : [];
    const startIndex = (page - 1) * cardsPerPage;
    const endIndex = startIndex + cardsPerPage;
    const currentCards = safeCards.slice(startIndex, endIndex);
    setInventory(currentCards);
    setCurrentPage(page);
  }, []);

  const getWearCondition = (wearValue) => {
    const wear = parseFloat(wearValue);
    if (wear <= 0.1) return 'Pristine';
    if (wear <= 0.3) return 'Mint';
    if (wear <= 0.5) return 'Lightly Played';
    if (wear <= 0.8) return 'Moderately Played';
    return 'Heavily Played';
  };

  const totalPages = Math.ceil((Array.isArray(allInventory) ? allInventory.length : 0) / cardsPerPage);

  const goToPage = useCallback((page) => {
    if (page > 0 && page <= totalPages) {
      updateCurrentPage(allInventory, page);
    }
  }, [allInventory, totalPages, updateCurrentPage]);

  // Render
  if (!showUI) {
    return (
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
        <p>Loading wallet...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
      {!isConnected ? (
        <div>
          <p>Please connect your wallet to view inventory.</p>
          <div className="mt-2 space-x-2">
            {connectors
              .filter(c => c.ready)
              .map((connector) => (
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
            Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}{' '}
            <button onClick={disconnectWallet} className="ml-2 bg-red-500 text-white px-2 py-1 rounded text-sm">
              Disconnect
            </button>
          </p>
          {error && <p className="text-red-500">{error}</p>}
          {loading && <p>Loading all pages...</p>}
          {!isEthPriceLoaded && <p className="text-yellow-500 mb-4">Loading ETH/USD price...</p>}
          {selectedCards.length > 0 && (
            <button
              onClick={handleBatchClick}
              className="bg-green-500 text-white px-4 py-2 rounded mb-4"
            >
              Batch List {selectedCards.length} Cards
            </button>
          )}
          {inventory.length > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 w-full max-w-7xl">
                {inventory.map((card, index) => {
                  const cacheKey = `${card.tokenId}-${card.contractAddress}`;
                  const isSelected = selectedCards.some(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress);
                  const price = prices[cacheKey] || (hoveredCardId === cacheKey ? 'Calculating...' : 'Hover to calculate');
                  return (
                    <div
                      key={index}
                      className="group relative rounded-lg shadow-lg cursor-pointer border-2 border-gray-300 hover:border-blue-500 transition-all duration-300"
                      onMouseEnter={() => handleMouseEnter(card)}
                      onMouseLeave={handleMouseLeave}
                      onClick={() => handleCardClick(card)}
                    >
                      {/* Checkbox sovrapposta */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelect(card);
                        }}
                        className="absolute top-2 left-2 z-10 w-5 h-5 opacity-80 group-hover:opacity-100 transition-opacity duration-300"
                      />
                      {/* Immagine (no sfondo bianco, ingrandita) */}
                      <div className="w-full h-80 bg-transparent flex items-center justify-center overflow-hidden rounded-lg">
                        <img
                          src={card.metadata.imageUrl}
                          alt="Card"
                          className="max-w-full max-h-full object-contain transition-transform duration-300 group-hover:scale-105"
                        />
                      </div>
                      {/* Overlay dettagli sopra la carta, su hover */}
                      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center p-2 rounded-lg">
                        <div className="text-center text-white text-xs leading-tight max-w-full">
                          <p className="font-semibold mb-1">
                            <strong>Collection:</strong> {card.metadata.name.split(' #')[0] || 'Unknown'}
                          </p>
                          <p className="mb-1 truncate">
                            <strong>Contract:</strong> {card.contractAddress}
                          </p>
                          <p className="mb-1">
                            <strong>Token ID:</strong> {card.tokenId}
                          </p>
                          <p className="mb-1">
                            <strong>Token Addr:</strong> {card.contract?.tokenAddress || 'N/A'}
                          </p>
                          <p className="mb-1">
                            <strong>Wear:</strong> {getWearCondition(card.metadata.wear) || 'N/A'}
                          </p>
                          <p className="mb-1">
                            <strong>Foil:</strong> {card.metadata.foil === 'Normal' ? 'None' : card.metadata.foil || 'N/A'}
                          </p>
                          <p className="font-bold text-blue-200">
                            <strong>Est. Price:</strong> {price}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-center items-center space-x-4">
                <button
                  className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span className="text-lg">Page {currentPage} of {totalPages} (Total cards: {allInventory.length})</span>
                <button
                  className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400"
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
      {/* Modal conferma listing */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">Confirm Listing</h3>
            <p className="mb-6">
              Are you sure you want to sell {isBatchListing ? `these ${selectedCards.length} cards?` : 'this card?'}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setCardToList(null);
                  setIsBatchListing(false);
                }}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400 transition-colors"
              >
                No
              </button>
              <button
                onClick={confirmListing}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
