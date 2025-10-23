'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const cardsPerPage = 50;

  console.log('Inventory component mounted');

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

  const fetchEthUsdPrice = useCallback(async () => {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      setEthUsdPrice(data.ethereum.usd || 0);
    } catch (err) {
      console.error('Error fetching ETH price:', err);
    }
  }, []);

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
    } catch (err) {
      console.error('Fetch inventory error:', err);
      setError('Error loading: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []); // No deps, stable

  const connectWallet = async () => {
    console.log('Connect wallet clicked');
    setIsConnecting(true);
    setError(null);
    if (window.ethereum && window.ethereum.isMetaMask) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send('eth_accounts', []); // Silent
        if (accounts.length === 0) {
          await provider.send('eth_requestAccounts', []); // Only if empty
        }

        // Switch to Base chain if not already (solo nel connect manual)
        try {
          console.log('Attempting chain switch in manual connect...');
          await provider.send('wallet_switchEthereumChain', [{ chainId: '0x2105' }]); // 8453 in hex
          console.log('Chain switch successful in manual connect');
        } catch (switchError) {
          console.log('Chain switch error in manual connect:', switchError.code, switchError.message);
          if (switchError.code === 4902) {
            // Chain not added: add it
            await provider.send('wallet_addEthereumChain', [{
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

        const signer = await provider.getSigner();
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
        fetchEthUsdPrice();
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
        fetchEthUsdPrice();
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

      // Delay per load
      console.log('Waiting delay before checks...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log('Delay completed, proceeding with checks');

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
                fetchEthUsdPrice();
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
          fetchEthUsdPrice();
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

    // Esegui con delay
    const delayedCheck = async () => {
      await checkAutoConnect();
    };
    delayedCheck();

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
  }, [router, isConnecting]); // Removed fetch deps, now stable with useCallback

  const disconnectWallet = () => {
    console.log('Disconnect clicked');
    if (window.ethereum) {
      window.ethereum.removeListener('accountsChanged', () => {}); // Cleanup if needed
    }
    if (window.solana) {
      window.solana.disconnect();
    }
    setWalletAddress(null);
    localStorage.clear();
    setAllInventory([]);
    setInventory([]);
    router.push('/'); // Redirect to home on disconnect
  };

  const calculateCardPrice = async (card) => {
    const cacheKey = `${card.tokenId}-${card.contractAddress}`;
    if (prices[cacheKey]) return prices[cacheKey];

    if (!card.contract?.tokenAddress) return 'N/A';

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const collectionDrop = new ethers.Contract(
        card.contractAddress,
        [
          'function COMMON_OFFER() external view returns (uint256)',
          'function RARE_OFFER() external view returns (uint256)',
          'function EPIC_OFFER() external view returns (uint256)',
          'function LEGENDARY_OFFER() external view returns (uint256)',
          'function MYTHIC_OFFER() external view returns (uint256)'
        ],
        provider
      );

      const boosterToken = new ethers.Contract(
        card.contract.tokenAddress,
        [
          'function getTokenSellQuote(uint256 tokenAmount) external view returns (uint256)'
        ],
        provider
      );

      let baseTokens;
      if (card.rarity === 1) baseTokens = await collectionDrop.COMMON_OFFER();
      else if (card.rarity === 2) baseTokens = await collectionDrop.RARE_OFFER();
      else if (card.rarity === 3) baseTokens = await collectionDrop.EPIC_OFFER();
      else if (card.rarity === 4) baseTokens = await collectionDrop.LEGENDARY_OFFER();
      else if (card.rarity === 5) baseTokens = await collectionDrop.MYTHIC_OFFER();
      else return 'Invalid rarity';

      const ethBase = await boosterToken.getTokenSellQuote(baseTokens);

      console.log(`Card ${card.tokenId}: ethBase = ${ethers.formatEther(ethBase)}`);

      const foilType = card.metadata.foil;
      let foilMult = 100n;
      if (foilType === 'Standard') foilMult = 200n;
      else if (foilType === 'Prize') foilMult = 400n;

      const wearStr = card.metadata.wear;
      const wear = parseFloat(wearStr);
      let wearMult = 100n;
      if (wear < 0.05) wearMult = 180n;
      else if (wear < 0.2) wearMult = 160n;
      else if (wear < 0.45) wearMult = 140n;
      else if (wear < 0.75) wearMult = 120n;

      const listingPrice = ((ethBase * foilMult * wearMult * 142n) / 1000000n);

      const priceInEth = ethers.formatEther(listingPrice).toFixed(6);
      const priceInUsd = (parseFloat(priceInEth) * ethUsdPrice).toFixed(2);
      const price = `${priceInEth} ETH (${priceInUsd} USD)`;

      setPrices(prev => ({ ...prev, [cacheKey]: price }));
      return price;
    } catch (err) {
      console.error('Error calculating price for card', card.tokenId, err);
      return 'N/A';
    }
  };

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
