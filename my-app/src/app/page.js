'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

export default function Home() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const cardsPerPage = 50; // Match with API limit

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
        fetchInventory(address, 1); // Start with page 1
      } catch (err) {
        setError('Error connecting: ' + err.message);
      }
    } else {
      setError('Install MetaMask!');
    }
  };

  const fetchInventory = async (address, page) => {
    setLoading(true);
    setError(null);
    try {
      const apiKey = process.env.NEXT_PUBLIC_API_KEY || '5A8RM-7NVT3-Y4CL4-DOMFU-YAYO2';
      const baseUrl = 'https://build.wield.xyz/vibe/boosterbox';
      const response = await fetch(
        `${baseUrl}/owner/${address}?status=rarity_assigned&includeMetadata=true&chainId=8453&page=${page}&limit=${cardsPerPage}`,
        {
          headers: {
            'API-KEY': apiKey,
          },
        }
      );
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message);
      }

      // Use data.boxes and filter rarity > 0
      const filteredCards = data.boxes.filter((card) => card.rarity > 0);

      // Assume API returns total count or calculate from response if available
      const totalCards = data.total || data.boxes.length; // Adjust if API provides 'total'
      setTotalPages(Math.ceil(totalCards / cardsPerPage));
      setInventory(filteredCards);
    } catch (err) {
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Function to convert wear value to condition (lower is better)
  const getWearCondition = (wearValue) => {
    const wear = parseFloat(wearValue);
    if (wear <= 0.1) return 'Pristine';
    if (wear <= 0.3) return 'Mint';
    if (wear <= 0.6) return 'Lightly Played';
    if (wear <= 0.9) return 'Moderately Played';
    return 'Heavily Played';
  };

  useEffect(() => {
    if (walletAddress) {
      fetchInventory(walletAddress, currentPage);
    }
  }, [walletAddress, currentPage]);

  const goToPage = (page) => {
    if (page > 0 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

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
      {loading && <p>Loading...</p>}
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
                  <p><strong>Collection Address:</strong> {card.contractAddress}</p>
                  <p><strong>Token ID:</strong> {card.tokenId}</p>
                  <p><strong>Wear:</strong> {getWearCondition(card.metadata.wear) || 'N/A'}</p>
                  <p><strong>Foil:</strong> {card.metadata.foil === 'Normal' ? 'None' : card.metadata.foil || 'N/A'}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <button
              className="bg-blue-500 text-white px-2 py-1 rounded mr-2"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button
              className="bg-blue-500 text-white px-2 py-1 rounded ml-2"
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
