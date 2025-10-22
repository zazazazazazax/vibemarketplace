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

  const cardsPerPage = 50;

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
        fetchAllInventory(address);
      } catch (err) {
        setError('Error connecting: ' + err.message);
      }
    } else {
      setError('Install MetaMask!');
    }
  };

  const fetchAllInventory = async (address) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/inventory?address=${address}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      const cardsWithPrices = await Promise.all(data.cards.map(async (card) => {
        const price = await calculateCardPrice(card);
        return { ...card, estimatedPrice: price };
      }));

      setAllInventory(cardsWithPrices);
      updateCurrentPage(cardsWithPrices, 1);
    } catch (err) {
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateCardPrice = async (card) => {
    if (prices[card.tokenId]) return prices[card.tokenId]; // Cache

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const seedUtils = new ethers.Contract(
        '0x002aaaa42354bf8f09f9924977bf0c531933f999', // Fixed Seed Utils address
        [
          'function wearFromSeed(bytes32 seed) external pure returns (string memory wear)',
          'function getFoilMappingFromSeed(bytes32 seed) external pure returns (string memory foilType)'
        ],
        provider
      );

      const boosterToken = new ethers.Contract(
        card.tokenAddress, // From API
        [
          'function getTokenSellQuote(uint256 tokenAmount) external view returns (uint256 ethReceived)'
        ],
        provider
      );

      // Get rarity and baseTokens from API (already in card)
      const rarity = card.rarity;
      // Assume baseTokens from rarity (from contract logic)
      let baseTokens;
      if (rarity == 1) baseTokens = 1000; // COMMON
      else if (rarity == 2) baseTokens = 5000; // RARE
      else if (rarity == 3) baseTokens = 10000; // EPIC
      else if (rarity == 4) baseTokens = 25000; // LEGENDARY
      else if (rarity == 5) baseTokens = 50000; // MYTHIC
      else baseTokens = 0;

      const ethBase = await boosterToken.getTokenSellQuote(baseTokens);

      // Foil multiplier
      const foilType = card.metadata.foil; // From API
      let foilMult = 100;
      if (foilType === 'Standard') foilMult = 200;
      else if (foilType === 'Prize') foilMult = 400;

      // Wear multiplier
      const wearStr = card.metadata.wear; // From API (string like "0.9409816264")
      const wearValue = parseFloat(wearStr) * 100000000; // To uint
      let wearMult = 100;
      const wear = parseInt(wearValue.toString());
      if (wear < 5) wearMult = 180;
      else if (wear < 20) wearMult = 160;
      else if (wear < 45) wearMult = 140;
      else if (wear < 75) wearMult = 120;

      const listingPrice = ((ethBase * foilMult * wearMult * 142) / 1000000); // +42%

      const priceInEth = ethers.formatEther(listingPrice);
      setPrices(prev => ({ ...prev, [card.tokenId]: priceInEth }));
      return priceInEth;
    } catch (err) {
      console.error('Error calculating price:', err);
      return 'Error';
    }
  };

  const updateCurrentPage = (cards, page) => {
    const startIndex = (page - 1) * cardsPerPage;
    const endIndex = startIndex + cardsPerPage;
    const currentCards = cards.slice(startIndex, endIndex);
    setInventory(currentCards);
    setCurrentPage(page);
  };

  // Function to convert wear value to condition (lower is better, adjusted thresholds)
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
            {inventory.map((card, index) => (
              <li key={index} className="border p-4 rounded flex">
                <img
                  src={card.metadata.imageUrl}
                  alt="Card"
                  className="w-32 h-48 object-cover mr-4"
                />
                <div>
                  <p><strong>Collection Name:</strong> {card.metadata.name.split(' #')[0] || 'Unknown Collection'}</p>
                  <p><strong>Contract Address:</strong> {card.contractAddress}</p>
                  <p><strong>Token Address:</strong> {card.tokenAddress || 'N/A'}</p>
                  <p><strong>Token ID:</strong> {card.tokenId}</p>
                  <p><strong>Wear:</strong> {getWearCondition(card.metadata.wear) || 'N/A'}</p>
                  <p><strong>Foil:</strong> {card.metadata.foil === 'Normal' ? 'None' : card.metadata.foil || 'N/A'}</p>
                  <p><strong>Estimated Price:</strong> {card.estimatedPrice || 'Loading...'}</p>
                </div>
              </li>
            ))}
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
