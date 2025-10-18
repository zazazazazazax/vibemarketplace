'use client';

import { useState } from 'react';
import { ethers } from 'ethers';

export default function Home() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
        fetchInventory(address);
      } catch (err) {
        setError('Errore nella connessione: ' + err.message);
      }
    } else {
      setError('Installa MetaMask!');
    }
  };

  const fetchInventory = async (address) => {
    setLoading(true);
    setError(null);
    try {
      const apiKey = process.env.NEXT_PUBLIC_API_KEY || '5A8RM-7NVT3-Y4CL4-DOMFU-YAYO2';
      const baseUrl = 'https://build.wield.xyz/vibe/boosterbox';
      const response = await fetch(
        `${baseUrl}/owner/${address}?status=rarity_assigned&includeMetadata=true&chainId=8453`,
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

      const filteredCards = data.data.filter((card) => card.rarity > 0);

      const cardsWithMetadata = await Promise.all(
        filteredCards.map(async (card) => {
          const metadataResponse = await fetch(
            `${baseUrl}/metadata/${card.contractAddress}/${card.tokenId}`,
            {
              headers: { 'API-KEY': apiKey },
            }
          );
          const metadata = await metadataResponse.json();
          return { ...card, metadata: metadata.data };
        })
      );

      setInventory(cardsWithMetadata);
    } catch (err) {
      setError('Errore nel caricamento: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Il Mio Inventario su Vibe.Market</h1>
      {!walletAddress ? (
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded"
          onClick={connectWallet}
        >
          Connetti Wallet
        </button>
      ) : (
        <p className="mb-4">Connesso: {walletAddress}</p>
      )}
      {error && <p className="text-red-500">{error}</p>}
      {loading && <p>Caricamento...</p>}
      {inventory.length > 0 ? (
        <ul className="space-y-4">
          {inventory.map((card, index) => (
            <li key={index} className="border p-4 rounded">
              <strong>Token ID:</strong> {card.tokenId} | <strong>Contract:</strong>{' '}
              {card.contractAddress} | <strong>Rarity:</strong> {card.rarity}
              <br />
              {card.metadata && (
                <>
                  <img
                    src={card.metadata.image}
                    alt="Card"
                    className="w-24 mt-2"
                  />
                  <p>
                    <strong>Foil:</strong> {card.metadata.foil || 'N/A'} |{' '}
                    <strong>Wear:</strong> {card.metadata.wear || 'N/A'}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nessuna carta aperta trovata.</p>
      )}
    </main>
  );
}