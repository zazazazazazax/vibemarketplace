'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

export default function Home() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [allInventory, setAllInventory] = useState([]); // All cards
  const [inventory, setInventory] = useState([]); // Current page
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [prices, setPrices] = useState({}); // Cache per prezzi
  const [ethUsdPrice, setEthUsdPrice] = useState(0); // ETH/USD rate
  const [hoveredCardId, setHoveredCardId] = useState(null); // ID carta hover (per display)

  const cardsPerPage = 50;

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
        fetchEthUsdPrice();
        fetchAllInventory(address);
      } catch (err) {
        setError('Error connecting: ' + err.message);
      }
    } else {
      setError('Install MetaMask!');
    }
  };

  const fetchEthUsdPrice = async () => {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      setEthUsdPrice(data.ethereum.usd || 0);
    } catch (err) {
      console.error('Error fetching ETH price:', err);
      setEthUsdPrice(0);
    }
  };

  const fetchAllInventory = async (address) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/inventory?address=${address}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setAllInventory(data.cards);
      updateCurrentPage(data.cards, 1);
    } catch (err) {
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateCardPrice = async (card) => {
    const cacheKey = `${card.tokenId}-${card.contractAddress}`;
    if (prices[cacheKey]) return prices[cacheKey];

    if (!card.contract?.tokenAddress) return 'N/A';

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const boosterToken = new ethers.Contract(
        card.contract.tokenAddress,
        [
          'function getTokenSellQuote(uint256 tokenAmount) external view returns (uint256)'
        ],
        provider
      );

      // BaseTokens from rarity
      let baseTokens;
      if (card.rarity === 1) baseTokens = 10000n; // Common
      else if (card.rarity === 2) baseTokens = 110000n; // Rare
      else if (card.rarity === 3) baseTokens = 400000n; // Epic
      else if (card.rarity === 4) baseTokens = 4000000n; // Legendary
      else if (card.rarity === 5) baseTokens = 20000000n; // Mythic
      else return 'Invalid rarity';

      const ethBase = await boosterToken.getTokenSellQuote(baseTokens);

      // Foil multiplier
      const foilType = card.metadata.foil;
      let foilMult = 100n;
      if (foilType === 'Standard') foilMult = 200n;
      else if (foilType === 'Prize') foilMult = 400n;

      // Wear multiplier
      const wearStr = card.metadata.wear;
      const wearValue = BigInt(Math.floor(parseFloat(wearStr) * 100000000));
      let wearMult = 100n;
      if (wearValue < 5n) wearMult = 180n;
      else if (wearValue < 20n) wearMult = 160n;
      else if (wearValue < 45n) wearMult = 140n;
      else if (wearValue < 75n) wearMult = 120n;

      const listingPrice = ((ethBase * foilMult * wearMult * 142n) / 1000000n); // +42%

      const priceInEth = ethers.formatEther(listingPrice, { decimals: 6 }); // 6 decimali
      const priceInUsd = (parseFloat(priceInEth) * ethUsdPrice).toFixed(2);
      const price = `${priceInEth} ETH (${priceInUsd} USD)`;

      setPrices(prev => ({ ...prev, [cacheKey]: price }));
      return price;
    } catch (err) {
      console.error('Error calculating price for card', card.tokenId, err);
      return 'N/A';
    }
  };

  // Hover handler for lazy-load price
  const handleMouseEnter = async (card) => {
    const cacheKey = `${card.tokenId}-${card.contractAddress}`;
    if (!prices[cacheKey] && card.contract?.tokenAddress) {
      const price = await calculateCardPrice(card);
      setPrices(prev => ({ ...prev, [cacheKey]: price }));
    }
    setHoveredCardId(cacheKey);
  };

  const handleMouseLeave = () => {
    setHoveredCardId(null);
  };

  const updateCurrentPage = (cards, page) => {
    const startIndex = (page - 1) * cardsPerPage;
    const endIndex = startIndex + cardsPerPage;
    const currentCards = cards.slice(startIndex, endIndex);
    setInventory(currentCards);
    setCurrentPage(page);
  };

  // Function to convert wear value to condition (lower is better)
  const getWearCondition = (wearValue) => {
    const wear = parseFloat(wearValue);
    if (wear <= 0.1) return 'Pristine';
    if (wear <= 0.3) return 'Mint';
    if (wear <= 0.5) return 'Lightly Played';
    if (wear <= 0.8) return 'Moderately Played';
    return 'Heavily Played';
  };

  const totalPages = Math.ceil(allInventory.length / cardsPerPage);

  const goToPage = (page) => {
    if (page > 0 && page <= totalPages) {
      updateCurrentPage(allInventory, page);
    }
  };

  useEffect(() => {
    if (allInventory.length > 0) {
      updateCurrentPage(allInventory, currentPage);
    }
  }, [currentPage]);

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
        <p className="mb-4">Connected: {walletAddress}</p>
      )}
      {error && <p className="text-red-500">{error}</p>}
      {loading && <p>Loading all pages...</p>}
      {inventory.length > 0 ? (
        <>
          <ul className="space-y-4">
            {inventory.map((card, index) => {
              const cacheKey = `${card.tokenId}-${card.contractAddress}`;
              return (
                <li key={index} className="border p-4 rounded flex" onMouseEnter={() => handleMouseEnter(card)} onMouseLeave={handleMouseLeave}>
                  <img
                    src={card.metadata.imageUrl}
                    alt="Card"
                    className="w-32 h-48 object-cover mr-4"
                  />
                  <div>
                    <p><strong>Collection Name:</strong> {card.metadata.name.split(' #')[0] || 'Unknown Collection'}</p>
                    <p><strong>Contract Address:</strong> {card.contractAddress}</p>
                    <p><strong>Token Address:</strong> {card.contract?.tokenAddress || 'N/A'}</p>
                    <p><strong>Token ID:</strong> {card.tokenId}</p>
                    <p><strong>Wear:</strong> {getWearCondition(card.metadata.wear) || 'N/A'}</p>
                    <p><strong>Foil:</strong> {card.metadata.foil === 'Normal' ? 'None' : card.metadata.foil || 'N/A'}</p>
                    <p><strong>Estimated Price:</strong> {hoveredCardId === cacheKey ? prices[cacheKey] || 'Calculating...' : 'Hover to calculate'}</p>
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
            <span>Page {currentPage} of {totalPages} (Total cards: {allInventory.length})</span>
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
    </main>
  );
}
