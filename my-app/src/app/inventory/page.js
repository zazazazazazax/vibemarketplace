'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';

export default function Inventory() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState(null);
  const [allInventory, setAllInventory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [prices, setPrices] = useState({});
  const [ethUsdPrice, setEthUsdPrice] = useState(0);
  const [isEthPriceLoaded, setIsEthPriceLoaded] = useState(false); // Flag per ETH/USD readiness (backend)
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [provider, setProvider] = useState(null); // Provider MetaMask per signer
  const [offerCache, setOfferCache] = useState({}); // Non più usato, ma tenuto per compatibilità (rimuovi se vuoi)
  const debounceRef = useRef(null); // Per debounce su hover

  const cardsPerPage = 50;

  // EIP-712 typed data for signature
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

  // Fetch ETH/USD dal backend con retry manuale (no loop infinito)
  const fetchEthUsdPrice = useCallback(async (retries = 3) => {
    if (isEthPriceLoaded) return;
    console.log('Fetching ETH/USD price from backend...');
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch('/api/inventory?endpoint=eth-price');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        setEthUsdPrice(data.price || 0);
        setIsEthPriceLoaded(true);
        console.log('ETH/USD price loaded from backend:', data.price);
        return;
      } catch (err) {
        console.error(`ETH price fetch attempt ${i + 1} failed:`, err.message);
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1))); // Backoff: 2s, 4s
        }
      }
    }
    setError('Failed to load ETH price. Retrying later...'); // UX fallback
  }, [isEthPriceLoaded]);

  // Fetch iniziale ETH price all'avvio (no interval, solo retry manuale)
  useEffect(() => {
    fetchEthUsdPrice();
  }, []); // Dependency vuota: solo al mount

  const fetchAllInventory = useCallback(async (address) => {
    console.log('Fetching inventory for', address);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/inventory?address=${address}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      console.log('Inventory loaded, cards length:', data.cards.length);
      setAllInventory(data.cards);
      updateCurrentPage(data.cards, 1);

      // Pre-calcola prezzi solo dopo 3s per warm-up (ora backend, con check ETH loaded)
      if (data.cards.length > 0 && isEthPriceLoaded) {
        setTimeout(() => preCalculatePrices(data.cards), 3000);
      }
    } catch (err) {
      console.error('Fetch inventory error:', err);
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [isEthPriceLoaded]);

  // Pre-calcola prezzi con fetch backend sequenziale (delay per evitare overload)
  const preCalculatePrices = useCallback(async (cards) => {
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cacheKey = `${card.tokenId}-${card.contractAddress}`;
      if (!prices[cacheKey] && card.contract?.tokenAddress) {
        try {
          const price = await calculateCardPrice(card);
          setPrices(prev => ({ ...prev, [cacheKey]: price }));
        } catch (err) {
          console.error('Pre-calc error for card', card.tokenId, err);
        }
        // Delay 500ms tra calls per evitare rate limit backend
        if (i < cards.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }, [prices]);

  const connectWallet = async () => {
    console.log('Connect wallet clicked');
    setIsConnecting(true);
    setError(null);
    if (window.ethereum && window.ethereum.isMetaMask) {
      try {
        const prov = new ethers.BrowserProvider(window.ethereum);
        const accounts = await prov.send('eth_accounts', []); // Silent
        if (accounts.length === 0) {
          await prov.send('eth_requestAccounts', []); // Only if empty
        }

        // Switch to Base chain if not already (solo nel connect manual)
        try {
          console.log('Attempting chain switch in manual connect...');
          await prov.send('wallet_switchEthereumChain', [{ chainId: '0x2105' }]); // 8453 in hex
          console.log('Chain switch successful in manual connect');
        } catch (switchError) {
          console.log('Chain switch error in manual connect:', switchError.code, switchError.message);
          if (switchError.code === 4902) {
            // Chain not added: add it
            await prov.send('wallet_addEthereumChain', [{
              chainId: '0x2105',
              chainName: 'Base',
              rpcUrls: ['https://mainnet.base.org'],
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              blockExplorerUrls: ['https://basescan.org']
            }]);
            console.log('Chain added successfully');
          } else if (switchError.code !== 4001) {
            throw switchError;
          }
        }

        // Salva provider persistente (MetaMask per signer)
        setProvider(prov);

        const signer = await prov.getSigner();
        const address = await signer.getAddress();
        console.log('Connected address:', address);

        localStorage.setItem('preferredWallet', 'metamask');
        console.log('Saved preferredWallet: metamask');

        const message = {
          content: 'Sign to persist your Vibe.Marketplace session for 24 hours.',
          nonce: nonce
        };
        const signature = await signer.signTypedData(domain, types, message);
        console.log('Signature generated:', signature);

        localStorage.setItem('walletAddress', address);
        localStorage.setItem('walletSignature', signature);
        localStorage.setItem('walletNonce', nonce.toString());
        localStorage.setItem('walletTimestamp', Date.now().toString());

        console.log('All localStorage saved');

        setWalletAddress(address);
        fetchAllInventory(address);
      } catch (err) {
        console.error('Connect error:', err);
        setError('Error connecting: ' + err.message);
        if (err.code === 4001) {
          localStorage.clear();
        }
      }
    } else if (window.solana) {
      try {
        const solana = window.solana;
        // Per manual connect, usa default (prompt if needed)
        await solana.connect();
        const address = solana.publicKey.toString();
        localStorage.setItem('preferredWallet', 'phantom');
        localStorage.setItem('walletAddress', address);
        setWalletAddress(address);
        fetchAllInventory(address);
      } catch (err) {
        console.error('Phantom connect error:', err);
        setError('Error connecting Phantom: ' + err.message);
      }
    } else {
      setError('Install MetaMask or Phantom!');
    }
    setIsConnecting(false);
  };

  // Auto-reconnect: usa solo verifica signature (senza provider o eth_accounts) per evitare popup multi-wallet
  useEffect(() => {
    let accountsChangedHandler;

    const checkAutoConnect = async () => {
      if (isConnecting) return; // Skip if manual connect in progress

      console.log('Starting auto-reconnect check...');

      let preferredWallet = localStorage.getItem('preferredWallet');
      console.log('Preferred wallet:', preferredWallet);

      if (!preferredWallet) {
        if (window.ethereum && window.ethereum.isMetaMask) {
          preferredWallet = 'metamask';
          localStorage.setItem('preferredWallet', 'metamask');
        } else {
          console.log('No preferred wallet or MetaMask, showing connect button');
          return;
        }
      }

      let success = false;

      if (preferredWallet === 'metamask' && window.ethereum && window.ethereum.isMetaMask) {
        const storedAddress = localStorage.getItem('walletAddress');
        const storedSignature = localStorage.getItem('walletSignature');
        const storedNonce = localStorage.getItem('walletNonce');
        const storedTimestamp = localStorage.getItem('walletTimestamp');

        console.log('Stored data check:', { storedAddress: !!storedAddress, storedNonce: !!storedNonce, storedTimestamp: !!storedTimestamp });

        if (storedAddress && storedSignature && storedNonce && storedTimestamp) {
          const now = Date.now();
          const expiry = 24 * 60 * 60 * 1000;
          if (now - parseInt(storedTimestamp) < expiry) {
            try {
              console.log('Auto-reconnect attempt via signature only...');
              // Verifica signature per recuperare address senza provider
              console.log('Verifying signature...');
              const message = {
                content: 'Sign to persist your Vibe.Marketplace session for 24 hours.',
                nonce: parseInt(storedNonce)
              };
              const recoveredAddress = ethers.verifyTypedData(domain, types, message, storedSignature);
              console.log('Recovered address from signature:', recoveredAddress);

              if (recoveredAddress.toLowerCase() === storedAddress.toLowerCase()) {
                console.log('Signature valid, using recovered address for session');
                setWalletAddress(recoveredAddress);
                fetchAllInventory(recoveredAddress);
                success = true;
                return;
              } else {
                console.log('Signature mismatch');
                localStorage.clear();
                return;
              }
            } catch (err) {
              console.error('Signature verification failed:', err.message || err);
              localStorage.clear();
              return;
            }
          } else {
            console.log('Signature expired, clearing storage');
            localStorage.clear();
            return;
          }
        }
      } else if (preferredWallet === 'phantom' && window.solana) {
        const solana = window.solana;
        try {
          console.log('Attempting silent Phantom connect...');
          await solana.connect({ onlyIfTrusted: true });
          const address = solana.publicKey.toString();
          console.log('Phantom silent connect success, address:', address);
          setWalletAddress(address);
          fetchAllInventory(address);
          success = true;
          return;
        } catch (err) {
          console.log('Phantom not connected silently:', err.message);
        }
      }

      // If no success and no preferred, redirect to home
      if (!preferredWallet) {
        router.push('/');
      }
      // Otherwise, stay on page and show connect button
    };

    // Esegui senza delay
    checkAutoConnect();

    // Listener for accountsChanged (aggiungi solo dopo connect, ma per semplicità qui)
    if (window.ethereum) {
      accountsChangedHandler = (accounts) => {
        console.log('Accounts changed:', accounts);
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          fetchAllInventory(accounts[0]);
        } else {
          setWalletAddress(null);
          localStorage.clear();
          // Optionally redirect, but stay for now
          // router.push('/');
        }
      };
      window.ethereum.on('accountsChanged', accountsChangedHandler);
    }

    // Cleanup
    return () => {
      if (window.ethereum && accountsChangedHandler) {
        window.ethereum.removeListener('accountsChanged', accountsChangedHandler);
      }
    };
  }, [router, isConnecting, fetchAllInventory]);

  const disconnectWallet = () => {
    console.log('Disconnect clicked');
    if (window.ethereum) {
      window.ethereum.removeListener('accountsChanged', () => {}); // Cleanup if needed
    }
    if (window.solana) {
      window.solana.disconnect();
    }
    setProvider(null); // Clear provider su disconnect
    setWalletAddress(null);
    setIsEthPriceLoaded(false); // Reset per retry futuri
    localStorage.clear();
    setAllInventory([]);
    setInventory([]);
    setPrices({}); // Clear prices cache
    router.push('/'); // Redirect to home on disconnect
  };

  // Calcola prezzo card via backend fetch
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

  // Debounce per handleMouseEnter (0ms per istantaneo)
  const handleMouseEnter = useCallback(async (card) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(async () => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}`;
      if (!prices[cacheKey] && card.contract?.tokenAddress) {
        if (isEthPriceLoaded) {
          const price = await calculateCardPrice(card);
          setPrices(prev => ({ ...prev, [cacheKey]: price }));
        } else {
          setPrices(prev => ({ ...prev, [cacheKey]: 'Loading USD price...' })); // Temp
        }
      }
      setHoveredCardId(cacheKey);
    }, 0);
  }, [prices, isEthPriceLoaded, calculateCardPrice]);

  const handleMouseLeave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    setHoveredCardId(null);
  }, []);

  const updateCurrentPage = useCallback((cards, page) => {
    const startIndex = (page - 1) * cardsPerPage;
    const endIndex = startIndex + cardsPerPage;
    const currentCards = cards.slice(startIndex, endIndex);
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

  const totalPages = Math.ceil(allInventory.length / cardsPerPage);

  const goToPage = useCallback((page) => {
    if (page > 0 && page <= totalPages) {
      updateCurrentPage(allInventory, page);
    }
  }, [allInventory, totalPages, updateCurrentPage]);

  useEffect(() => {
    if (allInventory.length > 0) {
      updateCurrentPage(allInventory, currentPage);
    }
  }, [currentPage, allInventory.length, updateCurrentPage]);

  // Cleanup debounce su unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
      {!walletAddress ? (
        <div>
          <p>Please connect your wallet to view inventory.</p>
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded mt-2"
            onClick={connectWallet}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
          {error && <p className="text-red-500 mt-2">{error}</p>}
        </div>
      ) : (
        <>
          <p className="mb-4">Connected: {walletAddress} <button onClick={disconnectWallet} className="ml-2 bg-red-500 text-white px-2 py-1 rounded text-sm">Disconnect</button></p>
          {error && <p className="text-red-500">{error}</p>}
          {loading && <p>Loading all pages...</p>}
          {!isEthPriceLoaded && <p className="text-yellow-500 mb-4">Loading ETH/USD price... (quick fetch)</p>}
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
        </>
      )}
    </main>
  );
}
