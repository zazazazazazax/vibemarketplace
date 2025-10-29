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
  const [listingPrice, setListingPrice] = useState('');
  const [minPrice, setMinPrice] = useState(0);
  const [multiMode, setMultiMode] = useState(false);
  const [fixedPriceMode, setFixedPriceMode] = useState(true); // Nuovo: default on
  const debounceRef = useRef(null);

  const cardsPerPage = 50;

  // useQuery per ETH price
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
    const timer = setTimeout(() => setShowUI(true), 1000);
    if (isConnected) {
      clearTimeout(timer);
      setShowUI(true);
    }
    return () => clearTimeout(timer);
  }, [isConnected]);

  // useEffect per fetch inventory
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
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // useEffect per paginazione
  useEffect(() => {
    if (Array.isArray(allInventory) && allInventory.length > 0) {
      updateCurrentPage(allInventory, currentPage);
    }
  }, [currentPage, allInventory]);

  // Funzioni
  const fetchAllInventory = useCallback(async (address) => {
    console.log('Fetching inventory for', address);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/inventory?address=${address}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setAllInventory(data.cards || []);
      updateCurrentPage(data.cards || [], 1);
      // Pre-calc prezzi (con delay per evitare overload)
      if ((data.cards?.length || 0) > 0 && isEthPriceLoaded) {
        data.cards.forEach((card, i) => {
          if (i < 10) { // Limit initial pre-calc
            setTimeout(() => calculateCardPrice(card), i * 500);
          }
        });
      }
    } catch (err) {
      console.error('Fetch inventory error:', err);
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [isEthPriceLoaded]);

  const connectWallet = useCallback((connector) => connect({ connector }), [connect]);

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
      const cardData = JSON.stringify({ metadata: card.metadata, rarity: card.rarity, contract: card.contract });
      const params = new URLSearchParams({ endpoint: 'card-price', tokenId: card.tokenId, contractAddress: card.contractAddress, cardData });
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
      const isSelected = safePrev.some(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress);
      return isSelected 
        ? safePrev.filter(c => !(c.tokenId === card.tokenId && c.contractAddress === card.contractAddress))
        : [...safePrev, card];
    });
  }, []);

  const handleCardClick = useCallback((card) => {
    if (multiMode) {
      toggleSelect(card);
    } else {
      setCardToList(card);
      setIsBatchListing(false);
      const autoPrice = prices[`${card.tokenId}-${card.contractAddress}`];
      if (fixedPriceMode) {
        // Modal semplice per fixed price
        setListingPrice(autoPrice || '0.001');
        setMinPrice(parseFloat(autoPrice) || 0.001);
        setShowConfirmModal(true);
      } else {
        // Modal con input
        setListingPrice(autoPrice || '');
        setMinPrice(parseFloat(autoPrice) || 0.001);
        setShowConfirmModal(true);
      }
    }
  }, [multiMode, fixedPriceMode, prices, toggleSelect]);

  const handleBatchClick = useCallback(() => {
    if (selectedCards.length > 0 && multiMode) {
      setIsBatchListing(true);
      const autoPrice = prices[`${selectedCards[0].tokenId}-${selectedCards[0].contractAddress}`];
      setListingPrice(autoPrice || '');
      setMinPrice(parseFloat(autoPrice) || 0.001);
      setShowConfirmModal(true);
    }
  }, [selectedCards, multiMode, prices]);

  const toggleMultiMode = useCallback(() => {
    setMultiMode(prev => !prev);
    if (selectedCards.length > 0) setSelectedCards([]);
  }, [selectedCards.length]);

  const toggleFixedPriceMode = useCallback(() => {
    setFixedPriceMode(prev => !prev);
  }, []);

  const confirmListing = useCallback(() => {
    let inputVal;
    if (fixedPriceMode && !isBatchListing) {
      inputVal = minPrice; // Usa auto per fixed
    } else {
      inputVal = parseFloat(listingPrice);
      if (inputVal < minPrice) {
        alert(`Price must be at least ${minPrice} ETH (auto estimated)`);
        return;
      }
    }
    const cardsToList = isBatchListing ? selectedCards : (cardToList ? [cardToList] : []);
    if (cardsToList.length > 0) {
      const tokenIds = cardsToList.map(c => c.tokenId).join(',');
      const collection = cardsToList[0]?.contractAddress || '';
      const boosterToken = cardsToList[0]?.contract?.tokenAddress || '';
      router.push(`/listing?tokenIds=${tokenIds}&collection=${collection}&boosterToken=${boosterToken}&action=create&price=${inputVal}`);
      if (isBatchListing) setSelectedCards([]);
    }
    setShowConfirmModal(false);
    setCardToList(null);
    setIsBatchListing(false);
    setListingPrice('');
  }, [fixedPriceMode, isBatchListing, cardToList, selectedCards, listingPrice, minPrice, router]);

  const updateCurrentPage = useCallback((cards, page) => {
    const safeCards = Array.isArray(cards) ? cards : [];
    const startIndex = (page - 1) * cardsPerPage;
    const endIndex = startIndex + cardsPerPage;
    setInventory(safeCards.slice(startIndex, endIndex));
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

  const getWearOpacity = (wearCondition) => {
    switch (wearCondition) {
      case 'Pristine': return 'opacity-0';
      case 'Mint': return 'opacity-5';
      case 'Lightly Played': return 'opacity-10';
      case 'Moderately Played': return 'opacity-20';
      case 'Heavily Played': return 'opacity-30';
      default: return 'opacity-0';
    }
  };

  const getRarityName = (rarityNum) => {
    const num = parseInt(rarityNum);
    switch (num) {
      case 1: return 'Common';
      case 2: return 'Rare';
      case 3: return 'Epic';
      case 4: return 'Legendary';
      case 5: return 'Mythic';
      default: return 'Unknown';
    }
  };

  const totalPages = Math.ceil((Array.isArray(allInventory) ? allInventory.length : 0) / cardsPerPage);
  const goToPage = useCallback((page) => {
    if (page > 0 && page <= totalPages) updateCurrentPage(allInventory, page);
  }, [allInventory, totalPages, updateCurrentPage]);

  if (!showUI) {
    return (
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">My Binder</h1>
        <p>Loading wallet...</p>
      </main>
    );
  }

  return (
    <>
      <style jsx>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .foil-shimmer::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
          transform: skewX(-25deg);
          animation: shimmer 2s infinite;
          pointer-events: none;
          z-index: 1;
        }
        .wear-overlay {
          background-image: url('/wear-overlay.png'); /* Assumi PNG in /public; uploadalo se non presente */
          background-size: cover;
          background-repeat: no-repeat;
          background-position: center;
        }
      `}</style>
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">My Binder</h1>
        {!isConnected ? (
          <div>
            <p>Please connect your wallet to view binder.</p>
            <div className="mt-2 space-x-2">
              {connectors.filter(c => c.ready).map((connector) => (
                <button key={connector.id} className="bg-blue-500 text-white px-4 py-2 rounded" onClick={() => connectWallet(connector)} disabled={isConnecting}>
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
              <button onClick={disconnectWallet} className="ml-2 bg-red-500 text-white px-2 py-1 rounded text-sm">Disconnect</button>
            </p>
            <div className="flex space-x-2 mb-4">
              <button
                onClick={toggleMultiMode}
                className={`px-4 py-2 rounded text-sm ${multiMode ? 'bg-yellow-500 text-white' : 'bg-gray-300 text-gray-800'}`}
              >
                {multiMode ? 'Multilisting On' : 'Multilisting Off'}
              </button>
              <button
                onClick={toggleFixedPriceMode}
                className={`px-4 py-2 rounded text-sm ${fixedPriceMode ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-800'}`}
              >
                {fixedPriceMode ? 'Fixed Price On' : 'Fixed Price Off'}
              </button>
            </div>
            {error && <p className="text-red-500">{error}</p>}
            {loading && <p>Loading all pages...</p>}
            {!isEthPriceLoaded && <p className="text-yellow-500 mb-4">Loading ETH/USD price...</p>}
            {multiMode && selectedCards.length > 0 && (
              <button onClick={handleBatchClick} className="bg-green-500 text-white px-4 py-2 rounded mb-4">
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
                    const wearCondition = getWearCondition(card.metadata.wear);
                    const wearOpacity = getWearOpacity(wearCondition);
                    const rarityName = getRarityName(card.rarity);
                    const usdPrice = price !== 'N/A' && ethUsdPrice ? `(${parseFloat(price || 0) * ethUsdPrice.toFixed(2)} USD)` : '';
                    const isFoil = card.metadata.foil !== 'Normal';
                    const dropAddress = card.contractAddress || 'N/A';
                    const tokenAddress = card.contract?.tokenAddress || 'N/A';
                    return (
                      <div
                        key={index}
                        className={`group relative rounded-lg shadow-lg cursor-pointer transition-all duration-300 overflow-hidden flex flex-col w-72 mx-auto border-4 border-transparent group-hover:border-gray-400 ${isSelected ? 'border-green-500 bg-green-50/30' : ''}`} // Case border su hover
                        style={{ height: 'fit-content' }} // Auto height
                        onMouseEnter={() => handleMouseEnter(card)}
                        onMouseLeave={handleMouseLeave}
                        onClick={() => handleCardClick(card)}
                      >
                        {/* Checkbox nascosta */}
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(card)} className="hidden" />
                        {/* Header "tetto" su hover (non taglia immagine) */}
                        <div className="bg-red-500/90 opacity-0 group-hover:opacity-100 transition-opacity duration-300 p-2 z-10 border-b-4 border-red-700 w-full"> {/* Ingrandito p-2 per più spazio */}
                          <div className="text-white text-xs leading-tight">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-bold truncate flex-1 pr-2">{card.metadata.name.split(' #')[0] || 'Unknown'}</span>
                              <span className="text-right min-w-0">Token ID: {card.tokenId}</span>
                            </div>
                            <div className="flex justify-center items-center mb-1">
                              <span className="font-mono text-center w-full">{price} ETH {usdPrice}</span>
                            </div>
                            <div className="flex justify-center items-center mb-1 text-center">
                              <span className="truncate w-full block">Drop: {dropAddress}</span>
                            </div>
                            <div className="flex justify-center items-center mb-1 text-center">
                              <span className="truncate w-full block">Token: {tokenAddress}</span>
                            </div>
                            <div className="flex justify-between items-center text-center min-w-0">
                              <span className="flex-1">Rarity: {rarityName}</span>
                              <span className="flex-1">Wear: {wearCondition}</span>
                              <span className="flex-1">Foil: {card.metadata.foil === 'Normal' ? 'None' : card.metadata.foil || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                        {/* Immagine con effetti (sempre visibile, sotto header, completa, ingrandita, con padding per spazio case) */}
                        <div className={`flex-1 relative overflow-hidden h-96 p-4 ${isFoil ? 'foil-shimmer' : ''}`}> {/* Padding per spazio interno */}
                          {/* Wear overlay */}
                          <div className={`absolute inset-0 wear-overlay ${wearOpacity} z-1 pointer-events-none`}></div>
                          <img
                            src={card.metadata.imageUrl}
                            alt="Card"
                            className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105 relative z-0"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-center items-center space-x-4">
                  <button className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>Previous</button>
                  <span className="text-lg">Page {currentPage} of {totalPages} (Total cards: {allInventory.length})</span>
                  <button className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}>Next</button>
                </div>
              </>
            ) : (
              <p>No opened cards found.</p>
            )}
          </>
        )}
      </main>
      {/* Modal Set Listing Price o Confirm */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">{fixedPriceMode && !isBatchListing ? 'Confirm Listing' : 'Set Listing Price'}</h3>
            {fixedPriceMode && !isBatchListing ? (
              <p className="mb-6">List at estimated price: {listingPrice} ETH?</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-gray-600">{isBatchListing ? `Price for ${selectedCards.length} cards` : 'Price for this card'}</p>
                <label className="block mb-2 text-sm font-medium">Price (ETH, min {minPrice.toFixed(6)}):</label>
                <input
                  type="number"
                  step="0.000001"
                  min={minPrice}
                  value={listingPrice}
                  onChange={(e) => setListingPrice(e.target.value)}
                  placeholder={prices[`${cardToList?.tokenId || selectedCards[0]?.tokenId}-${cardToList?.contractAddress || selectedCards[0]?.contractAddress}`] || '0.001'}
                  className="w-full p-2 border rounded mb-4 text-sm"
                />
              </>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setCardToList(null);
                  setIsBatchListing(false);
                  setListingPrice('');
                }}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400 transition-colors"
              >
                {fixedPriceMode && !isBatchListing ? 'No' : 'Cancel'}
              </button>
              <button
                onClick={confirmListing}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
              >
                {fixedPriceMode && !isBatchListing ? 'Yes' : 'List'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
