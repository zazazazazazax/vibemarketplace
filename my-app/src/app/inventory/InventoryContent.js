'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAccount, useDisconnect, useChainId, useBalance, useConfig, useSignTypedData } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useQuery } from '@tanstack/react-query';
import { readContract, writeContract, waitForTransaction } from 'wagmi/actions';
import { useWalletSignature } from '../hooks/useWalletSignature';  // Adatta il path se necessario
import { useFarcasterMiniApp } from '../hooks/useFarcasterMiniApp';

const MARKETPLACE_ADDRESS = '0x34682Df3fC35079EFe78fF37008856aB090e03e1' ;

const erc721ABI = [
  {
    "inputs": [
      {"name": "operator", "type": "address"},
      {"name": "approved", "type": "bool"}
    ],
    "name": "setApprovalForAll",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "owner", "type": "address"},
      {"name": "operator", "type": "address"}
    ],
    "name": "isApprovedForAll",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  }
] ;

const marketplaceABI = [
  {
    "inputs": [
      {"name": "_collection", "type": "address"},
      {"name": "_boosterToken", "type": "address"},
      {"name": "tokenId", "type": "uint256"},
      {"name": "_price", "type": "uint256"},
      {"name": "_isEth", "type": "bool"}
    ],
    "name": "createListing",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "_collection", "type": "address"},
      {"name": "tokenId", "type": "uint256"},
      {"name": "seller", "type": "address"}  // NUOVO: Aggiunto seller
    ],
    "name": "getListingDetails",
    "outputs": [
      {"name": "listingPrice", "type": "uint256"},
      {"name": "isEth", "type": "bool"},
      {"name": "currency", "type": "address"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "_collection", "type": "address"},
      {"name": "tokenId", "type": "uint256"},
      {"name": "seller", "type": "address"}  // NUOVO: Aggiunto seller
    ],
    "name": "delist",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "items",
        "type": "tuple[]",
        "components": [  // AGGIORNATO: Aggiunto seller in BatchItem
          {"name": "collection", "type": "address"},
          {"name": "tokenId", "type": "uint256"},
          {"name": "seller", "type": "address"}  // NUOVO
        ]
      }
    ],
    "name": "delistBatch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "_isEth", "type": "bool"},
      {
        "name": "items",
        "type": "tuple[]",
        "components": [  // Invariato: seller è msg.sender
          {"name": "collection", "type": "address"},
          {"name": "tokenId", "type": "uint256"},
          {"name": "price", "type": "uint256"},
          {"name": "boosterToken", "type": "address"}
        ]
      }
    ],
    "name": "createListingBatch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];
// Rimossa boosterTokenABI - non più necessaria

export default function InventoryContent() {
  const router = useRouter();

  // Hooks Wagmi (sempre al top)
  const { address: walletAddress, isConnected, isConnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { data: ethBalance } = useBalance({ address: walletAddress });
const config = useConfig();
const { hasSigned, isSigning, error: signatureError, handleSignature, resetSignature } = useWalletSignature(walletAddress);
const { openConnectModal } = useConnectModal();

// NUOVO: Hook per Mini App (navigate, embedded wallet—non altera connect)
  const { navigateTo } = useFarcasterMiniApp();

  // Stati (sempre al top)
  const [showUI, setShowUI] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
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
  const [zoomedLabels, setZoomedLabels] = useState({});
const [multiMode, setMultiMode] = useState(false);
const [isListedFilter, setIsListedFilter] = useState(false);
const [showListingOptions, setShowListingOptions] = useState(null); // null o cacheKey della card in listing mode
const [listings, setListings] = useState({}); // { [cacheKey]: { price: BigInt, isEth: bool, currency: address } }
const [imageSizes, setImageSizes] = useState({ fallback: 320 });

// Nuovi stati per i filtri
const [showFilters, setShowFilters] = useState(false);
const [dropFilter, setDropFilter] = useState('');
const [pendingDropFilter, setPendingDropFilter] = useState('');
const [showBatchListingOptions, setShowBatchListingOptions] = useState(false);
const zeroAddress = '0x0000000000000000000000000000000000000000';
const hasListedSelected = useMemo(() => 
  selectedCards.length > 0 && selectedCards.every(card => {
    const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
    return listings[cacheKey];
  }), [selectedCards, listings]);
const debounceRef = useRef(null);

  const cardsPerPage = 20;
  const containerWidth = 220;
  const containerHeight = 320;

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
      setImageSizes({ fallback: containerHeight });
      setZoomedLabels({});
    }
  }, [walletAddress, chainId, isConnected]);

  // useEffect per cleanup debounce
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // useEffect per reset batch options su change selectedCards
  useEffect(() => {
    if (multiMode && !isListedFilter && selectedCards.length > 0) {
      setShowBatchListingOptions(false);
    }
  }, [selectedCards, multiMode, isListedFilter]);

// useEffect per paginazione
useEffect(() => {
  if (Array.isArray(allInventory) && allInventory.length > 0) {
    let filteredInventory = allInventory;
    // Applica prima il filtro drop (se attivo)
    if (dropFilter) {
      filteredInventory = filteredInventory.filter(card => 
        card.contractAddress.toLowerCase() === dropFilter.toLowerCase()
      );
    }
    // Applica poi i filtri listed/multi (listed ha priorità su multi)
    if (isListedFilter) {
      filteredInventory = filteredInventory.filter(card => {
        const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
        return !!listings[cacheKey];
      });
    } else if (multiMode) {
      // Se multi attivo e non listedFilter, mostra solo non-listate
      filteredInventory = filteredInventory.filter(card => {
        const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
        return !listings[cacheKey];
      });
    }
    // Calcola pagine sul filtered
    const filteredTotalPages = Math.ceil(filteredInventory.length / cardsPerPage) || 1;
    // Clamp currentPage se > filteredTotalPages (es. dopo filtro)
    setCurrentPage(prev => Math.min(prev, filteredTotalPages));
    updateCurrentPage(filteredInventory, currentPage);
  }
}, [currentPage, allInventory, isListedFilter, listings, multiMode, dropFilter]);

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
    if ((data.cards?.length || 0) > 0 && isEthPriceLoaded) {
      data.cards.forEach((card, i) => {
        if (i < 10) {
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
}, [isEthPriceLoaded]); // Nota: qui fetchAllInventory usa già calculateCardPrice nel setTimeout, ma poiché è dopo nel codice originale, funzionava (eseguito post-render). Ora con riordino è ok.

// [FIX: calculateCardPrice spostato QUI, PRIMA di fetchListings]
const calculateCardPrice = useCallback(async (card) => {
  const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
  if (prices[cacheKey]) return prices[cacheKey];
  if (!card.contract?.tokenAddress) return null;
  try {
    const cardData = JSON.stringify({ metadata: card.metadata, rarity: card.rarity, contract: card.contract });
    const params = new URLSearchParams({ endpoint: 'card-price', tokenId: card.tokenId, contractAddress: card.contractAddress, cardData });
    const response = await fetch(`/api/inventory?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    setPrices(prev => ({ ...prev, [cacheKey]: data }));
    return data;
  } catch (err) {
    console.error('Error calculating price for card', card.tokenId, err);
    return null;
  }
}, [prices]);

const fetchListings = useCallback(async (cards) => {
  if (!cards || cards.length === 0 || !walletAddress || !config) return;
  const listingPromises = cards.map(async (card) => {
    const cacheKey = `${card.tokenId || 'invalid'}-${card.contractAddress || 'invalid'}-${walletAddress || 'invalid'}`;
    const tokenIdNum = Number(card.tokenId);
    if (!card.tokenId || isNaN(tokenIdNum) || tokenIdNum <= 0) {
      console.debug('Skipping invalid tokenId for', cacheKey, ':', card.tokenId);
      return { cacheKey, data: null };
    }
    try {
      console.debug('Fetching listing for', cacheKey, 'tokenId:', tokenIdNum);
      const [listingPrice, isEth, currency] = await readContract(config, {
        address: MARKETPLACE_ADDRESS,
        abi: marketplaceABI,
        functionName: 'getListingDetails',
args: [card.contractAddress, BigInt(tokenIdNum), walletAddress], 
chainId,
      });
      console.debug('Listing fetched for', cacheKey, ':', { listingPrice: listingPrice?.toString(), isEth, currency });
      let usdValue = 0;
      if (isEth && ethUsdPrice > 0) {
        // Per ETH listing: calcola USD diretto (invariato)
        const listedVal = Number(listingPrice) / 1e18;
        usdValue = listedVal * ethUsdPrice;
        console.debug('ETH USD calculated for', cacheKey, ':', usdValue);
      } else if (!isEth && currency !== '0x0000000000000000000000000000000000000000') {
        // Per token listing: calcola USD usando pricePerPackUsd PRIORITÀ: da card.contract (fetch iniziale), poi da priceData
        let packUsdStr = card.contract?.pricePerPackUsd; // <-- OTTIMIZZAZIONE: Usa direttamente da card.contract (disponibile da fetchAllInventory)
        if (!packUsdStr) {
          // Fallback: Prova da prices[cacheKey] (già calcolato)
          let priceData = prices[cacheKey];
          if (!priceData) {
            // Fetch priceData se non presente
            try {
              priceData = await calculateCardPrice(card);
              console.debug('Fetched priceData for token USD calc:', cacheKey);
            } catch (fetchErr) {
              console.debug('Failed to fetch priceData for', cacheKey, ':', fetchErr.message || fetchErr);
              priceData = null;
            }
          }
          packUsdStr = priceData?.contract?.pricePerPackUsd; // <-- FIX: Nested in contract
        }
        if (packUsdStr) {
          try {
            // Parse pricePerPackUsd (es. "$0.07" -> 0.07)
            const cleanStr = packUsdStr.replace('$', '').replace(/,/g, ''); // Migliorato: /,/g per multiple virgole
            const packUsd = parseFloat(cleanStr) || 0;
            const tokenPerPack = 100000; // 100k token per pack
            const listedTokens = Number(listingPrice) / 1e18; // Token nel listing
            if (listedTokens > 0 && packUsd > 0) {
              usdValue = (listedTokens / tokenPerPack) * packUsd;
              console.debug('Token USD calculated for', cacheKey, 'via pricePerPackUsd:', usdValue, '(listedTokens:', listedTokens, ', packUsd:', packUsd, ')');
            } else {
              console.debug('Invalid listedTokens or packUsd for', cacheKey, ':', { listedTokens, packUsd });
            }
          } catch (calcErr) {
            console.debug('Failed to calculate USD via pricePerPackUsd for', cacheKey, ':', calcErr.message || calcErr);
            usdValue = 0; // Fallback sicuro a 0
          }
        } else {
          console.debug('No pricePerPackUsd available for', cacheKey, ': from card.contract or priceData');
          usdValue = 0; // Fallback sicuro a 0
        }
      }
      // Sempre salva listing base + usdValue (anche se 0)
      return { cacheKey, data: { price: listingPrice, isEth, currency, usdValue } };
    } catch (err) {
      console.debug('Error fetching listing for', cacheKey, ':', err.message || err);
      return { cacheKey, data: null };
    }
  });
  try {
    const results = await Promise.all(listingPromises);
    const newListings = {};
    results.forEach(({ cacheKey, data }) => {
      if (data) newListings[cacheKey] = data;
    });
    setListings(prev => ({ ...prev, ...newListings }));
    console.debug('Listings updated:', Object.keys(newListings).length, 'new entries');
  } catch (err) {
    console.error('Error in fetchListings batch:', err);
  }
}, [walletAddress, config, chainId, ethUsdPrice, prices, calculateCardPrice]);

// Nuovo useEffect per fetch listings (ora dopo la definizione di fetchListings)
useEffect(() => {
  if (allInventory.length > 0) {
    fetchListings(allInventory);
  }
}, [allInventory, fetchListings]);


const disconnectWallet = useCallback(() => {
  disconnect();
  localStorage.clear();
  resetSignature();  // Usa il reset dal hook
  setAllInventory([]);
  setPrices({});
  setSelectedCards([]);
  setZoomedLabels({});
  setShowHeader(false);
  router.push('/');
}, [disconnect, router, resetSignature]);

const handleBatchEthListing = useCallback(async () => {
  if (selectedCards.length === 0 || !multiMode || !walletAddress) {
    alert('No cards selected or invalid mode/wallet');
    return;
  }
  // Calcola prezzi se non caricati (parallelo)
  await Promise.all(selectedCards.map(async (card) => {
    const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
    if (!prices[cacheKey]) await calculateCardPrice(card);
  }));
  // Collezioni uniche per approvazioni (invariato – tutto il block approvals)
  const uniqueCollections = [...new Set(selectedCards.map(c => c.contractAddress))];
  console.log('Unique collections for approval:', uniqueCollections);
  console.log('Wagmi config before approvals:', config);
  let skippedCount = 0;
  try {
    for (const collection of uniqueCollections) {
      let approvalSkipped = false;
      try {
        console.log(`Checking approval for collection: ${collection}, args: [${walletAddress.toLowerCase()}, ${MARKETPLACE_ADDRESS.toLowerCase()}]`);
        const isApproved = await readContract(config, {
          address: collection.toLowerCase(),
          abi: erc721ABI,
          functionName: 'isApprovedForAll',
          args: [walletAddress.toLowerCase(), MARKETPLACE_ADDRESS.toLowerCase()],
          chainId,
          blockTag: 'latest',
        });
        console.log(`isApproved for ${collection}:`, isApproved);
        if (!isApproved) {
          console.log(`Approving collection: ${collection}, args: [${MARKETPLACE_ADDRESS.toLowerCase()}, true]`);
          const approveResult = await writeContract(config, {
            address: collection.toLowerCase(),
            abi: erc721ABI,
            functionName: 'setApprovalForAll',
            args: [MARKETPLACE_ADDRESS.toLowerCase(), true],
            chainId,
          });
          console.log(`Approve tx sent for ${collection}:`, approveResult.hash);
          await waitForTransaction(config, { hash: approveResult.hash, chainId });
          console.log(`Approved and confirmed for ${collection}`);
          await new Promise(resolve => setTimeout(resolve, 400));
        } else {
          console.log(`Already approved: ${collection}`);
        }
      } catch (approveErr) {
        console.error(`Error on collection ${collection}:`, approveErr);
        console.error('Full error stack:', approveErr.stack);
        approvalSkipped = true;
        skippedCount++;
        console.warn(`Skipped approval for ${collection} (continuing silently): ${approveErr.message}`);
      }
      if (approvalSkipped) {
        console.warn(`Skipped ${collection} – batch may fail if not approved`);
      }
    }
    if (skippedCount > 0) {
      console.warn(`Completed approvals: ${uniqueCollections.length - skippedCount} successful, ${skippedCount} skipped`);
    }
    // Prepara items (invariato)
    const items = selectedCards.map(card => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
      const priceData = prices[cacheKey];
      const tokenIdStr = Number(card.tokenId).toString();
      const tokenId = BigInt(tokenIdStr);
      const ethValue = priceData?.ethValue || 0;
      const ethStr = Math.floor(ethValue * 1e18).toString();
      const price = BigInt(ethStr);
      if (price <= 0n) throw new Error(`Invalid price for ${cacheKey}`);
      console.log(`Item for ${cacheKey}: [${card.contractAddress.toLowerCase()}, ${tokenId}, ${price}, ${zeroAddress.toLowerCase()}]`);
      return [card.contractAddress.toLowerCase(), tokenId, price, zeroAddress.toLowerCase()];
    });
    // Tx batch
    console.log('Starting batch listing tx...');
    const result = await writeContract(config, {
      address: MARKETPLACE_ADDRESS.toLowerCase(),
      abi: marketplaceABI,
      functionName: 'createListingBatch',
      args: [true, items],
      chainId,
    });
    console.debug('Batch ETH tx sent:', result.hash);

    // Update UI ottimistico IMMEDIATO per tutti
    const optimisticListings = {};
    selectedCards.forEach(card => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
      const priceData = prices[cacheKey];
      const listedVal = (priceData?.ethValue || 0);
      const usdValue = listedVal * ethUsdPrice;
      const ethStr = Math.floor(listedVal * 1e18).toString();
      const price = BigInt(ethStr);
      optimisticListings[cacheKey] = { price, isEth: true, currency: zeroAddress, usdValue };
    });
    setListings(prev => ({ ...prev, ...optimisticListings }));
    setCurrentPage(1);
    setSelectedCards([]);
    setShowBatchListingOptions(false);
    console.debug('Optimistic UI update for batch ETH:', selectedCards.length);

    // Verifica on-chain dopo 8s (parallela per batch)
    setTimeout(async () => {
      const verifyPromises = selectedCards.map(async (card) => {
        const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
        try {
          const collection = card.contractAddress.toLowerCase();
          const [verifiedPrice, verifiedIsEth, verifiedCurrency] = await readContract(config, {
            address: MARKETPLACE_ADDRESS,
            abi: marketplaceABI,
            functionName: 'getListingDetails',
            args: [collection, BigInt(Number(card.tokenId)), walletAddress],
            chainId,
          });
          return { cacheKey, success: true, verified: { price: verifiedPrice, isEth: verifiedIsEth, currency: verifiedCurrency } };
        } catch (verifyErr) {
          console.warn(`Batch verify failed for ${cacheKey}:`, verifyErr.message);
          return { cacheKey, success: false };
        }
      });
      const verifyResults = await Promise.all(verifyPromises);
      const verifiedKeys = verifyResults.filter(r => r.success).map(r => r.cacheKey);
      const failedKeys = verifyResults.filter(r => !r.success).map(r => r.cacheKey);
      console.debug(`Batch verify: ${verifiedKeys.length} success, ${failedKeys.length} failed`);

      // Rollback failed in UI
      if (failedKeys.length > 0) {
        setListings(prev => {
          const newListings = { ...prev };
          failedKeys.forEach(key => delete newListings[key]);
          return newListings;
        });
        alert(`${failedKeys.length} listings failed: TX reverted. retry.`);
      }

      // Salva solo verified in JSON
      if (verifiedKeys.length > 0) {
        const addItems = verifyResults.filter(r => r.success).map(r => {
          const card = selectedCards.find(c => `${c.tokenId}-${c.contractAddress}-${walletAddress}` === r.cacheKey);
          const verified = r.verified;
          const listedVal = Number(verified.price) / 1e18;
          const verifiedUsdValue = listedVal * ethUsdPrice;
          return {
            key: r.cacheKey.toLowerCase(),
            listing: {
              tokenId: card.tokenId.toString(),
              collection: card.contractAddress.toLowerCase(),
              seller: walletAddress.toLowerCase(),
              price: verified.price.toString(),
              isEth: verified.isEth,
              currency: verified.currency.toLowerCase()
            }
          };
        });
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', items: addItems, walletAddress: walletAddress.toLowerCase() })
        }).then(() => console.debug('JSON saved for verified batch'));
      }

      // Remove failed from JSON (se ottimistici)
      if (failedKeys.length > 0) {
        const removeItems = failedKeys.map(key => ({ key: key.toLowerCase() }));
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove', items: removeItems, walletAddress: walletAddress.toLowerCase() })
        }).catch(() => {});
      }
    }, 8000);

    // Refresh async generale
    setTimeout(async () => {
      try {
        await fetchListings(allInventory);
        await fetchAllInventory(walletAddress);
      } catch (refreshErr) {
        console.error('Refresh error:', refreshErr);
      }
    }, 10000);

  } catch (err) {
    console.error('Batch ETH listing error:', err);
    console.error('Full error stack:', err.stack);
    const errorStr = (err.message || err.toString() || '').toLowerCase();
    if (errorStr.includes('user rejected') || errorStr.includes('cancelled')) {
      return;
    }
    alert('Batch ETH listing failed: ' + (err.message || 'Unknown error'));
  }
}, [selectedCards, multiMode, walletAddress, prices, calculateCardPrice, config, chainId, ethUsdPrice, zeroAddress, fetchListings, allInventory, fetchAllInventory]);

const handleBatchTokenListing = useCallback(async () => {
  if (selectedCards.length === 0 || !multiMode || !walletAddress) {
    alert('No cards selected or invalid mode/wallet');
    return;
  }
  // Calcola prezzi se non caricati
  await Promise.all(selectedCards.map(async (card) => {
    const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
    if (!prices[cacheKey]) await calculateCardPrice(card);
  }));
  // Collezioni uniche per approvazioni (invariato – tutto il block approvals)
  const uniqueCollections = [...new Set(selectedCards.map(c => c.contractAddress))];
  console.log('Unique collections for approval:', uniqueCollections);
  console.log('Wagmi config before approvals:', config);
  let skippedCount = 0;
  try {
    for (const collection of uniqueCollections) {
      let approvalSkipped = false;
      try {
        console.log(`Checking approval for collection: ${collection}, args: [${walletAddress.toLowerCase()}, ${MARKETPLACE_ADDRESS.toLowerCase()}]`);
        const isApproved = await readContract(config, {
          address: collection.toLowerCase(),
          abi: erc721ABI,
          functionName: 'isApprovedForAll',
          args: [walletAddress.toLowerCase(), MARKETPLACE_ADDRESS.toLowerCase()],
          chainId,
          blockTag: 'latest',
        });
        console.log(`isApproved for ${collection}:`, isApproved);
        if (!isApproved) {
          console.log(`Approving collection: ${collection}, args: [${MARKETPLACE_ADDRESS.toLowerCase()}, true]`);
          const approveResult = await writeContract(config, {
            address: collection.toLowerCase(),
            abi: erc721ABI,
            functionName: 'setApprovalForAll',
            args: [MARKETPLACE_ADDRESS.toLowerCase(), true],
            chainId,
          });
          console.log(`Approve tx sent for ${collection}:`, approveResult.hash);
          await waitForTransaction(config, { hash: approveResult.hash, chainId });
          console.log(`Approved and confirmed for ${collection}`);
          await new Promise(resolve => setTimeout(resolve, 400));
        } else {
          console.log(`Already approved: ${collection}`);
        }
      } catch (approveErr) {
        console.error(`Error on collection ${collection}:`, approveErr);
        console.error('Full error stack:', approveErr.stack);
        approvalSkipped = true;
        skippedCount++;
        console.warn(`Skipped approval for ${collection} (continuing silently): ${approveErr.message}`);
      }
      if (approvalSkipped) {
        console.warn(`Skipped ${collection} – batch may fail if not approved`);
      }
    }
    if (skippedCount > 0) {
      console.warn(`Completed approvals: ${uniqueCollections.length - skippedCount} successful, ${skippedCount} skipped`);
    }
    // Prepara items with usd (invariato)
    const itemsWithUsd = selectedCards.map(card => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
      const priceData = prices[cacheKey];
      const tokenIdStr = Number(card.tokenId).toString();
      const tokenId = BigInt(tokenIdStr);
      const tokenValue = priceData?.tokenValue || 0;
      const tokenStr = Math.round(tokenValue).toString();
      const price = BigInt(tokenStr) * 1000000000000000000n;
      const boosterToken = card.contract?.tokenAddress?.toLowerCase() || zeroAddress.toLowerCase();
      if (!boosterToken || boosterToken === zeroAddress.toLowerCase() || price <= 0n) throw new Error(`Invalid price/token for ${cacheKey}`);
      let usdValue = 0;
      const packUsdStr = card.contract?.pricePerPackUsd || priceData?.contract?.pricePerPackUsd;
      if (packUsdStr) {
        const cleanStr = packUsdStr.replace('$', '').replace(/,/g, '');
        const packUsd = parseFloat(cleanStr) || 0;
        const tokenPerPack = 100000;
        const listedTokens = Number(price) / 1e18;
        usdValue = (listedTokens / tokenPerPack) * packUsd;
      }
      console.log(`Item for ${cacheKey}: [${card.contractAddress.toLowerCase()}, ${tokenId}, ${price}, ${boosterToken}]`);
      return { tuple: [card.contractAddress.toLowerCase(), tokenId, price, boosterToken], usdValue };
    });
    // Tx batch
    console.log('Starting batch listing tx...');
    const txItems = itemsWithUsd.map(i => i.tuple);
    const result = await writeContract(config, {
      address: MARKETPLACE_ADDRESS.toLowerCase(),
      abi: marketplaceABI,
      functionName: 'createListingBatch',
      args: [false, txItems],
      chainId,
    });
    console.debug('Batch Token tx sent:', result.hash);

    // Update UI ottimistico IMMEDIATO per tutti
    const optimisticListings = {};
    selectedCards.forEach((card, idx) => {
      const { tuple: [_, __, price], usdValue } = itemsWithUsd[idx];
      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
      const boosterToken = card.contract?.tokenAddress || zeroAddress;
      optimisticListings[cacheKey] = { price, isEth: false, currency: boosterToken, usdValue };
    });
    setListings(prev => ({ ...prev, ...optimisticListings }));
    setCurrentPage(1);
    setSelectedCards([]);
    setShowBatchListingOptions(false);
    console.debug('Optimistic UI update for batch Token:', selectedCards.length);

    // Verifica on-chain dopo 8s (parallela)
    setTimeout(async () => {
      const verifyPromises = selectedCards.map(async (card, idx) => {
        const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
        try {
          const collection = card.contractAddress.toLowerCase();
          const [verifiedPrice, verifiedIsEth, verifiedCurrency] = await readContract(config, {
            address: MARKETPLACE_ADDRESS,
            abi: marketplaceABI,
            functionName: 'getListingDetails',
            args: [collection, BigInt(Number(card.tokenId)), walletAddress],
            chainId,
          });
          // Ricalcola USD verified
          let verifiedUsdValue = itemsWithUsd[idx].usdValue;
          if (!verifiedIsEth && verifiedCurrency !== zeroAddress) {
            const packUsdStr = card.contract?.pricePerPackUsd || prices[cacheKey]?.contract?.pricePerPackUsd;
            if (packUsdStr) {
              const cleanStr = packUsdStr.replace('$', '').replace(/,/g, '');
              const packUsd = parseFloat(cleanStr) || 0;
              const tokenPerPack = 100000;
              const listedTokens = Number(verifiedPrice) / 1e18;
              verifiedUsdValue = (listedTokens / tokenPerPack) * packUsd;
            }
          }
          return { cacheKey, success: true, verified: { price: verifiedPrice, isEth: verifiedIsEth, currency: verifiedCurrency, usdValue: verifiedUsdValue } };
        } catch (verifyErr) {
          console.warn(`Batch verify failed for ${cacheKey}:`, verifyErr.message);
          return { cacheKey, success: false };
        }
      });
      const verifyResults = await Promise.all(verifyPromises);
      const verifiedKeys = verifyResults.filter(r => r.success).map(r => r.cacheKey);
      const failedKeys = verifyResults.filter(r => !r.success).map(r => r.cacheKey);
      console.debug(`Batch verify: ${verifiedKeys.length} success, ${failedKeys.length} failed`);

      // Rollback failed in UI
      if (failedKeys.length > 0) {
        setListings(prev => {
          const newListings = { ...prev };
          failedKeys.forEach(key => delete newListings[key]);
          return newListings;
        });
        alert(`${failedKeys.length} listings failed: TX reverted. retry.`);
      }

      // Update verified USD in UI
      verifyResults.filter(r => r.success).forEach(r => {
        setListings(prev => ({ ...prev, [r.cacheKey]: { ...prev[r.cacheKey], usdValue: r.verified.usdValue } }));
      });

      // Salva solo verified in JSON
      if (verifiedKeys.length > 0) {
        const addItems = verifyResults.filter(r => r.success).map(r => {
          const card = selectedCards.find(c => `${c.tokenId}-${c.contractAddress}-${walletAddress}` === r.cacheKey);
          const verified = r.verified;
          return {
            key: r.cacheKey.toLowerCase(),
            listing: {
              tokenId: card.tokenId.toString(),
              collection: card.contractAddress.toLowerCase(),
              seller: walletAddress.toLowerCase(),
              price: verified.price.toString(),
              isEth: verified.isEth,
              currency: verified.currency.toLowerCase()
            }
          };
        });
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', items: addItems, walletAddress: walletAddress.toLowerCase() })
        }).then(() => console.debug('JSON saved for verified batch'));
      }

      // Remove failed from JSON
      if (failedKeys.length > 0) {
        const removeItems = failedKeys.map(key => ({ key: key.toLowerCase() }));
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove', items: removeItems, walletAddress: walletAddress.toLowerCase() })
        }).catch(() => {});
      }
    }, 8000);

    // Refresh async generale
    setTimeout(async () => {
      try {
        await fetchListings(allInventory);
        await fetchAllInventory(walletAddress);
      } catch (refreshErr) {
        console.error('Refresh error:', refreshErr);
      }
    }, 10000);

  } catch (err) {
    console.error('Batch Token listing error:', err);
    console.error('Full error stack:', err.stack);
    const errorStr = (err.message || err.toString() || '').toLowerCase();
    if (errorStr.includes('user rejected') || errorStr.includes('cancelled')) {
      return;
    }
    alert('Batch Token listing failed: ' + (err.message || 'Unknown error'));
  }
}, [selectedCards, multiMode, walletAddress, prices, calculateCardPrice, config, chainId, zeroAddress, fetchListings, allInventory, fetchAllInventory]);

const handleBatchDelist = useCallback(async () => {
  if (selectedCards.length === 0 || !multiMode || !walletAddress || !hasListedSelected) {
    alert('No listed cards selected or invalid mode');
    return;
  }
  try {
    const items = selectedCards.map(card => {
      const tokenId = BigInt(Number(card.tokenId));
      return [card.contractAddress.toLowerCase(), tokenId, walletAddress];
    });
    console.log('Batch delist items:', items);
    const result = await writeContract(config, {
      address: MARKETPLACE_ADDRESS.toLowerCase(),
      abi: marketplaceABI,
      functionName: 'delistBatch',
      args: [items],
      chainId,
    });
    console.debug('Batch delist tx sent:', result.hash);

    // Update UI ottimistico IMMEDIATO (rimuovi tutti)
    const updatedListings = { ...listings };
    selectedCards.forEach(card => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
      delete updatedListings[cacheKey];
    });
    setListings(updatedListings);
    setCurrentPage(1);
    setSelectedCards([]);
    console.log('Optimistic UI remove for batch delist:', selectedCards.length);

    // Verifica on-chain dopo 8s (parallela)
    setTimeout(async () => {
      const verifyPromises = selectedCards.map(async (card) => {
        const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
        try {
          const collection = card.contractAddress.toLowerCase();
          await readContract(config, {
            address: MARKETPLACE_ADDRESS,
            abi: marketplaceABI,
            functionName: 'getListingDetails',
            args: [collection, BigInt(Number(card.tokenId)), walletAddress],
            chainId,
          });
          // Success qui = ANCORA LISTED (TX fallita per questo item)
          return { cacheKey, success: false }; // "success" = still listed = delist failed
        } catch (verifyErr) {
          console.debug(`Delist verify reverted for ${cacheKey} (success)`);
          return { cacheKey, success: true }; // Revert = delisted = good
        }
      });
      const verifyResults = await Promise.all(verifyPromises);
      const delistedKeys = verifyResults.filter(r => r.success).map(r => r.cacheKey); // Good: delisted
      const failedKeys = verifyResults.filter(r => !r.success).map(r => r.cacheKey); // Bad: still listed
      console.debug(`Batch delist verify: ${delistedKeys.length} success, ${failedKeys.length} failed`);

      // Rollback failed in UI (riaggiungi)
      if (failedKeys.length > 0) {
        const originalListings = {}; // Assumi hai salvato pre-TX, o usa listings snapshot
        failedKeys.forEach(key => {
          // Ripristina da original listings (usa listings pre-update se hai snapshot, o query)
          const parts = key.split('-');
          const origCard = selectedCards.find(c => `${c.tokenId}-${c.contractAddress}` === key);
          if (origCard && listings[key]) originalListings[key] = listings[key]; // Fallback
        });
        setListings(prev => ({ ...prev, ...originalListings }));
        alert(`${failedKeys.length} delist failed: TX reverted. refreshed.`);
      }

      // Salva remove solo per delisted in JSON
      if (delistedKeys.length > 0) {
        const removeItems = delistedKeys.map(key => ({ key: key.toLowerCase() }));
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove', items: removeItems, walletAddress: walletAddress.toLowerCase() })
        }).then(() => console.debug('JSON removed for verified delisted'));
      }

      // Ri-aggiungi failed in JSON
      if (failedKeys.length > 0) {
        const addItems = failedKeys.map(key => {
          const card = selectedCards.find(c => `${c.tokenId}-${c.contractAddress}` === key);
          const origListing = listings[key]; // Fallback
          if (card && origListing) {
            return {
              key: key.toLowerCase(),
              listing: {
                tokenId: card.tokenId.toString(),
                collection: card.contractAddress.toLowerCase(),
                seller: walletAddress.toLowerCase(),
                price: origListing.price.toString(),
                isEth: origListing.isEth,
                currency: origListing.currency.toLowerCase()
              }
            };
          }
          return null;
        }).filter(Boolean);
        if (addItems.length > 0) {
          await fetch('/api/listings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', items: addItems, walletAddress: walletAddress.toLowerCase() })
          }).catch(() => {});
        }
      }
    }, 8000);

    // Refresh async generale
    setTimeout(async () => {
      try {
        await fetchListings(allInventory);
        await fetchAllInventory(walletAddress);
      } catch (refreshErr) {
        console.error('Refresh error:', refreshErr);
      }
    }, 10000);

  } catch (err) {
    console.error('Batch delist error:', err);
    console.error('Full error stack:', err.stack);
    const errorStr = (err.message || err.toString() || '').toLowerCase();
    if (errorStr.includes('user rejected') || errorStr.includes('cancelled')) {
      return;
    }
    alert('Batch delist failed: ' + (err.message || 'Unknown error'));
  }
}, [selectedCards, multiMode, walletAddress, hasListedSelected, config, chainId, listings, fetchListings, allInventory, fetchAllInventory, zeroAddress]);

  const formatTokenPrice = useCallback((tokenValue, tokenSymbol) => {
    const value = Math.round(tokenValue);
    if (value >= 1e6) {
      return `${(value / 1e6).toFixed(0)}M ${tokenSymbol}`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}k ${tokenSymbol}`;
    } else {
      return `${value} ${tokenSymbol}`;
    }
  }, []);

  const handleMouseEnter = useCallback((card) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
      if (!prices[cacheKey] && card.contract?.tokenAddress && isEthPriceLoaded) {
        await calculateCardPrice(card);
      }
      setHoveredCardId(cacheKey);
    }, 0);
  }, [prices, isEthPriceLoaded, calculateCardPrice]);

const handleMouseLeave = useCallback(() => {
  if (debounceRef.current) clearTimeout(debounceRef.current);
  setHoveredCardId(null);
  setShowListingOptions(null);
}, []);

const toggleSelect = useCallback((card) => {
  setSelectedCards(prev => {
    const safePrev = Array.isArray(prev) ? prev : [];
    const isSelected = safePrev.some(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress);
    if (!isSelected) {
      if (safePrev.length >= 20) {
        alert('Maximum 20 cards allowed for batch operations.');
        return safePrev; // Non aggiunge
      }
    }
    return isSelected 
      ? safePrev.filter(c => !(c.tokenId === card.tokenId && c.contractAddress === card.contractAddress))
      : [...safePrev, card];
  });
}, []);

  const removeFromSelected = useCallback((cardToRemove) => {
    setSelectedCards(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.filter(c => !(c.tokenId === cardToRemove.tokenId && c.contractAddress === cardToRemove.contractAddress));
    });
  }, []);

  const handleCardClick = useCallback((card) => {
    if (multiMode) {
      toggleSelect(card);
    }
  }, [multiMode, toggleSelect]);

// Obsoleta: sostituita da handleEthListing e handleTokenListing per tx diretta
// const handleSingleList = ... (rimuovere)

const handleDelist = useCallback(async (card) => {
  if (!walletAddress) {
    alert('Wallet not connected');
    return;
  }
  const collection = card.contractAddress;
  const tokenIdNum = Number(card.tokenId);
  if (!card.tokenId || isNaN(tokenIdNum) || tokenIdNum <= 0) {
    alert('Invalid token ID');
    return;
  }
  const tokenId = BigInt(tokenIdNum);
  const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
  const listing = listings[cacheKey];
  if (!listing) {
    alert('Not listed');
    return;
  }
  console.debug('Starting delist for', cacheKey, 'tokenId:', tokenIdNum);
  try {
    const delistResult = await writeContract(config, {
      address: MARKETPLACE_ADDRESS,
      abi: marketplaceABI,
      functionName: 'delist',
      args: [collection, tokenId, walletAddress],
      chainId,
    });
    console.debug('Delist tx sent:', delistResult.hash);

    // Update UI ottimistico IMMEDIATO (rimuovi)
    setListings(prev => {
      const newListings = { ...prev };
      delete newListings[cacheKey];
      console.debug('Optimistic UI remove for', cacheKey);
      return newListings;
    });
    setCurrentPage(1);
    setShowListingOptions(null);

    // Verifica on-chain dopo 8s
    setTimeout(async () => {
      try {
        console.debug('Verifying delist on-chain...');
        await readContract(config, {
          address: MARKETPLACE_ADDRESS,
          abi: marketplaceABI,
          functionName: 'getListingDetails',
          args: [collection, BigInt(tokenIdNum), walletAddress],
          chainId,
        });
        // Success qui = ANCORA LISTED (TX fallita): Rollback UI e JSON
        console.warn('Delist verify success (still listed – TX reverted)');
        setListings(prev => ({ ...prev, [cacheKey]: listing })); // Riaggiungi
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add', // Ri-aggiungi
            items: [{
              key: cacheKey.toLowerCase(),
              listing: {
                tokenId: card.tokenId.toString(),
                collection: collection.toLowerCase(),
                seller: walletAddress.toLowerCase(),
                price: listing.price.toString(),
                isEth: listing.isEth,
                currency: listing.currency.toLowerCase()
              }
            }],
            walletAddress: walletAddress.toLowerCase()
          })
        }).catch(() => {});
        alert('Delist failed: TX reverted on-chain. Listing refreshed.');
      } catch (verifyErr) {
        // Revert qui = NON PIÙ LISTED (success): Conferma remove JSON
        console.debug('Delist verified on-chain (reverted = success)');
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'remove',
            items: [{ key: cacheKey.toLowerCase() }],
            walletAddress: walletAddress.toLowerCase()
          })
        }).then(() => console.debug('JSON removed after verify'));
      }
    }, 8000);

    // Refresh async generale
    setTimeout(async () => {
      try {
        await fetchListings(allInventory);
        await fetchAllInventory(walletAddress);
      } catch (refreshErr) {
        console.error('Refresh error:', refreshErr);
      }
    }, 10000);

  } catch (err) {
    console.error('Delist error:', err);
    console.error('Full error stack:', err.stack);
    const errorStr = (err.message || err.toString() || '').toLowerCase();
    if (errorStr.includes('user rejected') || errorStr.includes('cancelled')) {
      return;
    }
    alert('Delist failed: ' + (err.message || 'Unknown error'));
  }
}, [walletAddress, config, chainId, listings, fetchListings, allInventory, fetchAllInventory, zeroAddress]);

const handleEthListing = useCallback(async (card) => {
  const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
  const tokenIdNum = Number(card.tokenId);
  if (!card.tokenId || isNaN(tokenIdNum) || tokenIdNum <= 0 || !walletAddress) {
    alert('Invalid token or wallet');
    return;
  }
  // Ensure price is calculated
  let priceData = prices[cacheKey];
  if (!priceData) {
    try {
      priceData = await calculateCardPrice(card);
    } catch (err) {
      console.error('Price calculation error:', err);
      alert('Failed to calculate price');
      return;
    }
  }
  if (!priceData || typeof priceData.ethValue !== 'number' || priceData.ethValue <= 0) {
    alert('Invalid ETH price');
    return;
  }
  const collection = card.contractAddress.toLowerCase();
  const boosterToken = (card.contract?.tokenAddress || zeroAddress).toLowerCase();
  const tokenIdStr = tokenIdNum.toString();
  const tokenId = BigInt(tokenIdStr);
  const ethValue = priceData.ethValue;
  const ethStr = Math.floor(ethValue * 1e18).toString();
  const price = BigInt(ethStr);
  if (price <= 0n) {
    alert('Price must be greater than 0');
    return;
  }
  console.debug('Starting ETH listing for', cacheKey, 'tokenId:', tokenIdNum);
  try {
    let approvalSkipped = false;
    // Check approval with blockTag
    console.log(`Checking approval for collection: ${collection}, args: [${walletAddress.toLowerCase()}, ${MARKETPLACE_ADDRESS.toLowerCase()}]`);
    const isApproved = await readContract(config, {
      address: collection,
      abi: erc721ABI,
      functionName: 'isApprovedForAll',
      args: [walletAddress.toLowerCase(), MARKETPLACE_ADDRESS.toLowerCase()],
      chainId,
      blockTag: 'latest',
    });
    console.log(`isApproved for ${collection}:`, isApproved);
    if (!isApproved) {
      try {
        console.log(`Approving collection: ${collection}, args: [${MARKETPLACE_ADDRESS.toLowerCase()}, true]`);
        const approveResult = await writeContract(config, {
          address: collection,
          abi: erc721ABI,
          functionName: 'setApprovalForAll',
          args: [MARKETPLACE_ADDRESS.toLowerCase(), true],
          chainId,
        });
        console.log(`Approve tx sent for ${collection}:`, approveResult.hash);
        await waitForTransaction(config, { hash: approveResult.hash, chainId });
        console.log(`Approved and confirmed for ${collection}`);
        await new Promise(resolve => setTimeout(resolve, 400));
      } catch (approveErr) {
        console.error(`Error on approve for ${collection}:`, approveErr);
        console.error('Full error stack:', approveErr.stack);
        approvalSkipped = true;
        console.warn(`Skipped approval for ${collection} (continuing silently): ${approveErr.message}`);
      }
    } else {
      console.log(`Already approved: ${collection}`);
    }
    if (approvalSkipped) {
      console.warn(`Skipped ${collection} – listing may fail if not approved`);
    }
    // Create listing TX
    console.log(`Creating ETH listing, args: [${collection}, ${boosterToken}, ${tokenId}, ${price}, true]`);
    const listingResult = await writeContract(config, {
      address: MARKETPLACE_ADDRESS.toLowerCase(),
      abi: marketplaceABI,
      functionName: 'createListing',
      args: [collection, boosterToken, tokenId, price, true],
      chainId,
    });
    console.debug('ETH listing tx sent:', listingResult.hash);

    // Update UI ottimistico IMMEDIATO
    const usdValue = ethValue * ethUsdPrice;
    const optimisticListing = { price, isEth: true, currency: zeroAddress, usdValue };
    setListings(prev => ({ ...prev, [cacheKey]: optimisticListing }));
    setCurrentPage(1);
    setShowListingOptions(null);
    console.debug('Optimistic UI update for', cacheKey);

    // Verifica on-chain dopo 8s (con debug extra)
    console.debug('Scheduling verify timeout for', cacheKey); // DEBUG: Conferma scheduling
    setTimeout(async () => {
      console.debug('Timeout fired – starting verify for', cacheKey); // DEBUG: Conferma esecuzione
      try {
        console.debug('Verifying ETH listing on-chain...');
        const [verifiedPrice, verifiedIsEth, verifiedCurrency] = await readContract(config, {
          address: MARKETPLACE_ADDRESS,
          abi: marketplaceABI,
          functionName: 'getListingDetails',
          args: [collection, BigInt(tokenIdNum), walletAddress],
          chainId,
        });
        // Success: Conferma e salva JSON
        const verifiedUsdValue = verifiedIsEth ? (Number(verifiedPrice) / 1e18) * ethUsdPrice : usdValue;
        setListings(prev => ({ ...prev, [cacheKey]: { ...optimisticListing, usdValue: verifiedUsdValue } }));
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add',
            items: [{
              key: cacheKey.toLowerCase(),
              listing: {
                tokenId: card.tokenId.toString(),
                collection: collection,
                seller: walletAddress.toLowerCase(),
                price: verifiedPrice.toString(),
                isEth: verifiedIsEth,
                currency: verifiedCurrency.toLowerCase()
              }
            }],
            walletAddress: walletAddress.toLowerCase()
          })
        }).then(() => console.debug('JSON saved after verify'));
        console.debug('ETH listing verified on-chain'); // DEBUG: Fine verifica
      } catch (verifyErr) {
        // Revert: TX fallita, rollback UI e JSON
        console.warn('ETH verify failed (TX reverted):', verifyErr.message);
        setListings(prev => {
          const newListings = { ...prev };
          delete newListings[cacheKey];
          return newListings;
        });
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'remove',
            items: [{ key: cacheKey.toLowerCase() }],
            walletAddress: walletAddress.toLowerCase()
          })
        }).catch(() => {}); // Ignora se non presente
        alert('Listing failed: TX reverted on-chain. retry.');
        console.debug('Verify failed complete for', cacheKey); // DEBUG
      }
    }, 8000);

    // Refresh async generale
    setTimeout(async () => {
      try {
        await fetchListings(allInventory);
        await fetchAllInventory(walletAddress);
      } catch (refreshErr) {
        console.error('Refresh error:', refreshErr);
      }
    }, 10000);

  } catch (err) {
    console.error('ETH listing error:', err);
    console.error('Full error stack:', err.stack);
    const errorStr = (err.message || err.toString() || '').toLowerCase();
    if (errorStr.includes('user rejected') || errorStr.includes('cancelled')) {
      return;
    }
    alert('ETH listing failed: ' + (err.message || 'Unknown error'));
  }
}, [walletAddress, prices, fetchAllInventory, chainId, calculateCardPrice, config, fetchListings, allInventory, ethUsdPrice, zeroAddress]);

const handleTokenListing = useCallback(async (card) => {
  const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
  const tokenIdNum = Number(card.tokenId);
  if (!card.tokenId || isNaN(tokenIdNum) || tokenIdNum <= 0 || !walletAddress) {
    alert('Invalid token or wallet');
    return;
  }
  // Ensure price is calculated
  let priceData = prices[cacheKey];
  if (!priceData) {
    try {
      priceData = await calculateCardPrice(card);
    } catch (err) {
      console.error('Price calculation error:', err);
      alert('Failed to calculate price');
      return;
    }
  }
  if (!priceData || typeof priceData.tokenValue !== 'number' || priceData.tokenValue <= 0) {
    alert('Invalid Token price');
    return;
  }
  const collection = card.contractAddress.toLowerCase();
  const boosterToken = card.contract?.tokenAddress?.toLowerCase();
  if (!boosterToken) {
    alert('No booster token available');
    return;
  }
  const tokenIdStr = tokenIdNum.toString();
  const tokenId = BigInt(tokenIdStr);
  const tokenValue = priceData.tokenValue;
  const tokenStr = Math.round(tokenValue).toString();
  const price = BigInt(tokenStr) * 1000000000000000000n;
  if (price <= 0n) {
    alert('Price must be greater than 0');
    return;
  }
  // Calcola usdValue ottimistico
  let usdValue = 0;
  const packUsdStr = card.contract?.pricePerPackUsd || priceData?.contract?.pricePerPackUsd;
  if (packUsdStr) {
    const cleanStr = packUsdStr.replace('$', '').replace(/,/g, '');
    const packUsd = parseFloat(cleanStr) || 0;
    const tokenPerPack = 100000;
    const listedTokens = Number(price) / 1e18;
    if (listedTokens > 0 && packUsd > 0) {
      usdValue = (listedTokens / tokenPerPack) * packUsd;
    }
  }
  console.debug('Starting Token listing for', cacheKey, 'tokenId:', tokenIdNum);
  try {
    let approvalSkipped = false;
    // Check approval with blockTag (invariato)
    console.log(`Checking approval for collection: ${collection}, args: [${walletAddress.toLowerCase()}, ${MARKETPLACE_ADDRESS.toLowerCase()}]`);
    const isApproved = await readContract(config, {
      address: collection,
      abi: erc721ABI,
      functionName: 'isApprovedForAll',
      args: [walletAddress.toLowerCase(), MARKETPLACE_ADDRESS.toLowerCase()],
      chainId,
      blockTag: 'latest',
    });
    console.log(`isApproved for ${collection}:`, isApproved);
    if (!isApproved) {
      try {
        console.log(`Approving collection: ${collection}, args: [${MARKETPLACE_ADDRESS.toLowerCase()}, true]`);
        const approveResult = await writeContract(config, {
          address: collection,
          abi: erc721ABI,
          functionName: 'setApprovalForAll',
          args: [MARKETPLACE_ADDRESS.toLowerCase(), true],
          chainId,
        });
        console.log(`Approve tx sent for ${collection}:`, approveResult.hash);
        await waitForTransaction(config, { hash: approveResult.hash, chainId });
        console.log(`Approved and confirmed for ${collection}`);
        await new Promise(resolve => setTimeout(resolve, 400));
      } catch (approveErr) {
        console.error(`Error on approve for ${collection}:`, approveErr);
        console.error('Full error stack:', approveErr.stack);
        approvalSkipped = true;
        console.warn(`Skipped approval for ${collection} (continuing silently): ${approveErr.message}`);
      }
    } else {
      console.log(`Already approved: ${collection}`);
    }
    if (approvalSkipped) {
      console.warn(`Skipped ${collection} – listing may fail if not approved`);
    }
    // Create listing TX
    console.log(`Creating token listing, args: [${collection}, ${boosterToken}, ${tokenId}, ${price}, false]`);
    const listingResult = await writeContract(config, {
      address: MARKETPLACE_ADDRESS.toLowerCase(),
      abi: marketplaceABI,
      functionName: 'createListing',
      args: [collection, boosterToken, tokenId, price, false],
      chainId,
    });
    console.debug('Token listing tx sent:', listingResult.hash);

    // Update UI ottimistico IMMEDIATO
    const optimisticListing = { price, isEth: false, currency: boosterToken, usdValue };
    setListings(prev => ({ ...prev, [cacheKey]: optimisticListing }));
    setCurrentPage(1);
    setShowListingOptions(null);
    console.debug('Optimistic UI update for', cacheKey);

    // Verifica on-chain dopo 8s
    setTimeout(async () => {
      try {
        console.debug('Verifying Token listing on-chain...');
        const [verifiedPrice, verifiedIsEth, verifiedCurrency] = await readContract(config, {
          address: MARKETPLACE_ADDRESS,
          abi: marketplaceABI,
          functionName: 'getListingDetails',
          args: [collection, BigInt(tokenIdNum), walletAddress],
          chainId,
        });
        // Success: Ricalcola usdValue verified e salva JSON
        let verifiedUsdValue = usdValue;
        if (!verifiedIsEth && verifiedCurrency !== zeroAddress) {
          // Ricalcola USD per token
          const packUsdStr = card.contract?.pricePerPackUsd || priceData?.contract?.pricePerPackUsd;
          if (packUsdStr) {
            const cleanStr = packUsdStr.replace('$', '').replace(/,/g, '');
            const packUsd = parseFloat(cleanStr) || 0;
            const tokenPerPack = 100000;
            const listedTokens = Number(verifiedPrice) / 1e18;
            verifiedUsdValue = (listedTokens / tokenPerPack) * packUsd;
          }
        }
        setListings(prev => ({ ...prev, [cacheKey]: { ...optimisticListing, usdValue: verifiedUsdValue } }));
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add',
            items: [{
              key: cacheKey.toLowerCase(),
              listing: {
                tokenId: card.tokenId.toString(),
                collection: collection,
                seller: walletAddress.toLowerCase(),
                price: verifiedPrice.toString(),
                isEth: verifiedIsEth,
                currency: verifiedCurrency.toLowerCase()
              }
            }],
            walletAddress: walletAddress.toLowerCase()
          })
        }).then(() => console.debug('JSON saved after verify'));
        console.debug('Token listing verified on-chain');
      } catch (verifyErr) {
        // Revert: TX fallita, rollback UI e JSON
        console.warn('Token verify failed (TX reverted):', verifyErr.message);
        setListings(prev => {
          const newListings = { ...prev };
          delete newListings[cacheKey];
          return newListings;
        });
        await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'remove',
            items: [{ key: cacheKey.toLowerCase() }],
            walletAddress: walletAddress.toLowerCase()
          })
        }).catch(() => {});
        alert('Listing failed: TX reverted on-chain. retry.');
      }
    }, 8000);

    // Refresh async generale
    setTimeout(async () => {
      try {
        await fetchListings(allInventory);
        await fetchAllInventory(walletAddress);
      } catch (refreshErr) {
        console.error('Refresh error:', refreshErr);
      }
    }, 10000);

  } catch (err) {
    console.error('Token listing error:', err);
    console.error('Full error stack:', err.stack);
    const errorStr = (err.message || err.toString() || '').toLowerCase();
    if (errorStr.includes('user rejected') || errorStr.includes('cancelled')) {
      return;
    }
    alert('Token listing failed: ' + (err.message || 'Unknown error'));
  }
}, [walletAddress, prices, fetchAllInventory, chainId, calculateCardPrice, config, fetchListings, allInventory, zeroAddress]);

  const toggleMultiMode = useCallback(() => {
    setMultiMode(prev => !prev);
    if (selectedCards.length > 0) setSelectedCards([]);
  }, [selectedCards.length]);

  const toggleListedFilter = useCallback(() => {
    setIsListedFilter(prev => !prev);
    setCurrentPage(1);
  }, []);

  const copyToClipboard = useCallback((text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  }, []);

  const handleLabelClick = useCallback((cacheKey) => {
    setZoomedLabels(prev => ({ ...prev, [cacheKey]: !prev[cacheKey] }));
  }, []);

const updateCurrentPage = useCallback((cards, page) => {
  const safeCards = Array.isArray(cards) ? cards : [];
  const startIndex = (page - 1) * cardsPerPage;
  const endIndex = startIndex + cardsPerPage;
  setInventory(safeCards.slice(startIndex, endIndex));
  setCurrentPage(page);
}, []);

const totalPages = useMemo(() => {
  if (!Array.isArray(allInventory) || allInventory.length === 0) return 1;
  let filteredInventory = allInventory;
  // Applica prima il filtro drop (se attivo)
  if (dropFilter) {
    filteredInventory = filteredInventory.filter(card => 
      card.contractAddress.toLowerCase() === dropFilter.toLowerCase()
    );
  }
  // Applica poi i filtri listed/multi (listed ha priorità su multi)
  if (isListedFilter) {
    filteredInventory = filteredInventory.filter(card => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
      return !!listings[cacheKey];
    });
  } else if (multiMode) {
    // Se multi attivo e non listedFilter, mostra solo non-listate
    filteredInventory = filteredInventory.filter(card => {
      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
      return !listings[cacheKey];
    });
  }
  return Math.ceil(filteredInventory.length / cardsPerPage);
}, [allInventory, isListedFilter, listings, multiMode, dropFilter]);

const goToPage = useCallback((page) => {
  if (page >= 1 && page <= totalPages) {
    setCurrentPage(page);
  }
}, [totalPages]);

const getWearCondition = (wearValue) => {
  const wear = parseFloat(wearValue);
  if (wear <= 0.04) return 'Pristine';
  if (wear <= 0.2) return 'Mint';
  if (wear <= 0.4) return 'Lightly p.';
  if (wear <= 0.8) return 'Moderately p.';
  return 'Heavily p.';
};

  const getWearOpacity = (wearCondition) => {
    switch (wearCondition) {
      case 'Pristine': return 'opacity-0';
      case 'Mint': return 'opacity-25';
      case 'Lightly p.': return 'opacity-35';
      case 'Moderately p.': return 'opacity-50';
      case 'Heavily p.': return 'opacity-65';
      default: return 'opacity-0';
    }
  };

  const getRarityName = (rarityName) => {
    const num = parseInt(rarityName);
    switch (num) {
      case 1: return 'Common';
      case 2: return 'Rare';
      case 3: return 'Epic';
      case 4: return 'Legendary';
      case 5: return 'Mythic';
      default: return 'Unknown';
    }
  };

  const handleImageLoad = useCallback((cacheKey, e) => {
    const renderedHeight = e.target.offsetHeight;
    setImageSizes(prev => ({ ...prev, [cacheKey]: renderedHeight }));
  }, []);

  const formattedEthBalance = ethBalance ? (parseFloat(ethBalance.formatted)).toFixed(7) : '0';

  // Calcola altezza dinamica per max 4 cards visibili, poi scroll
  const maxVisibleCards = 4;
  const cardItemHeight = 16;
  const baseHeight = 70; // Altezza per list button + header
  const maxScrollHeight = baseHeight + (maxVisibleCards * cardItemHeight);
  const dynamicHeight = Math.min(maxScrollHeight, baseHeight + (selectedCards.length * cardItemHeight));

  return (
    <>
      <style jsx global>{`
        .foil-effect {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 25;
          overflow: hidden;
          border-radius: 0.5rem;
        }
        .shimmer {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 98%;
          background: linear-gradient(90deg,
            transparent 0%,
            rgba(255, 0, 0, 0.2) 8%,
            rgba(255, 127, 0, 0.25) 16%,
            rgba(255, 255, 0, 0.2) 24%,
            rgba(0, 255, 0, 0.25) 32%,
            rgba(0, 255, 255, 0.2) 40%,
            rgba(0, 0, 255, 0.25) 48%,
            rgba(75, 0, 130, 0.2) 56%,
            rgba(148, 0, 211, 0.25) 64%,
            rgba(255, 0, 255, 0.2) 72%,
            transparent 80%,
            transparent 100%
          );
          background-size: 400% 100%;
          mix-blend-mode: screen;
          animation: rainbowShimmer 6s linear infinite;
          opacity: 0.8;
          border-radius: 0.5rem;
        }
        .foil-prize .shimmer {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 2px;
          border-radius: inherit;
          opacity: 0.8;
          filter: brightness(2.2) saturate(3.2) contrast(1.5) blur(5px);
          background:
            conic-gradient(from 45deg at 50% 50%,
              hsla(300, 100%, 50%, 0.4) 0deg,
              hsla(330, 100%, 55%, 0.45) 30deg,
              hsla(0, 100%, 50%, 0.5) 60deg,
              hsla(30, 100%, 55%, 0.45) 90deg,
              hsla(60, 70%, 40%, 0.4) 105deg,
              hsla(75, 90%, 45%, 0.42) 120deg,
              hsla(90, 100%, 50%, 0.45) 135deg,
              hsla(105, 100%, 48%, 0.45) 150deg,
              hsla(120, 100%, 50%, 0.5) 165deg,
              hsla(135, 100%, 52%, 0.48) 180deg,
              hsla(150, 100%, 50%, 0.45) 195deg,
              hsla(165, 100%, 50%, 0.45) 210deg,
              hsla(180, 100%, 50%, 0.45) 225deg,
              hsla(195, 100%, 52%, 0.42) 240deg,
              hsla(210, 100%, 55%, 0.45) 255deg,
              hsla(240, 100%, 50%, 0.4) 270deg,
              hsla(270, 100%, 55%, 0.45) 285deg,
              hsla(285, 100%, 52%, 0.42) 300deg,
              hsla(300, 100%, 50%, 0.45) 315deg,
              hsla(330, 100%, 55%, 0.45) 330deg,
              hsla(180, 100%, 50%, 0.45) 360deg
            ),
            repeating-radial-gradient(circle at 25% 25%,
              hsla(300, 100%, 40%, 0.3) 0%,
              hsla(180, 100%, 45%, 0.35) 20%,
              hsla(120, 100%, 50%, 0.4) 40%,
              hsla(60, 70%, 40%, 0.25) 60%,
              hsla(30, 100%, 50%, 0.3) 80%,
              hsla(0, 100%, 40%, 0.3) 100%,
              transparent 100%
            ),
            repeating-radial-gradient(circle at 75% 75%,
              hsla(0, 100%, 40%, 0.3) 0%,
              hsla(60, 70%, 40%, 0.25) 20%,
              hsla(120, 100%, 50%, 0.4) 40%,
              hsla(180, 100%, 45%, 0.35) 60%,
              hsla(300, 100%, 50%, 0.4) 80%,
              hsla(30, 100%, 40%, 0.3) 100%,
              transparent 100%
            );
          background-size: 200% 200%, 50% 50%, 50% 50%;
          background-blend-mode: color-burn;
          mix-blend-mode: overlay;
          transform: none;
          pointer-events: none;
          position: absolute;
          inset: 0;
          border-radius: inherit;
          animation: honeycombShimmer 4s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
        }

        @keyframes honeycombShimmer {
          0% {
            background-position: 0% 0%, 0% 0%, 0% 0%;
            transform: rotate(0deg);
            filter: brightness(2.2) saturate(3.2) contrast(1.5) blur(5px);
          }
          16.67% {
            background-position: 16.67% 16.67%, 33% 33%, 66% 66%;
            transform: rotate(2deg);
          }
          33.33% {
            background-position: 33.33% 33.33%, 66% 66%, 33% 33%;
            transform: rotate(4deg);
          }
          50% {
            background-position: 50% 50%, 100% 75%, 75% 100%;
            transform: rotate(2deg);
          }
          54.17% {
            background-position: 54.17% 54.17%, 75% 60%, 60% 75%;
            transform: rotate(1.5deg);
          }
          58.33% {
            background-position: 58.33% 58.33%, 60% 50%, 50% 60%;
            transform: rotate(1deg);
          }
          62.5% {
            background-position: 62.5% 62.5%, 50% 40%, 40% 50%;
            transform: rotate(0.5deg);
          }
          66.67% {
            background-position: 66.67% 66.67%, 40% 100%, 100% 40%;
            transform: rotate(0deg);
          }
          83.33% {
            background-position: 75% 75%, 66% 66%, 33% 33%;
            transform: rotate(-2deg);
          }
          95% {
            background-position: 80% 80%, 80% 80%, 20% 20%;
            transform: rotate(-1deg);
            filter: brightness(2.2) saturate(3.2) contrast(1.5) blur(5.5px);
          }
          100% {
            background-position: 80% 80%, -20% -20%, -20% -20%;
            transform: rotate(0deg);
            filter: brightness(2.2) saturate(3.2) contrast(1.5) blur(5px);
          }
        }

        .foil-prize .shimmer::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            repeating-radial-gradient(ellipse at 50% 50%,
              hsla(0, 100%, 30%, 0.25) 0%,
              hsla(60, 70%, 35%, 0.25) 15%,
              hsla(75, 90%, 40%, 0.28) 25%,
              hsla(120, 100%, 40%, 0.35) 40%,
              hsla(150, 100%, 45%, 0.3) 55%,
              hsla(180, 100%, 35%, 0.3) 70%,
              hsla(300, 100%, 40%, 0.35) 85%,
              hsla(30, 100%, 30%, 0.25) 100%,
              hsla(180, 100%, 35%, 0.3) 115%,
              transparent 120%,
              transparent 360deg
            );
          background-size: 80% 80%;
          filter: brightness(1.8) saturate(2.8) blur(6px);
          mix-blend-mode: screen;
          background-blend-mode: lighten;
          opacity: 0.65;
          z-index: -1;
          animation: honeycombShimmer 4s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite reverse;
        }

        .foil-prize .shimmer::after {
          display: none;
        }
        @keyframes rainbowShimmer {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 400% 50%;
          }
        }
      `}</style>
      {/* Band PNG in alto, dietro logo e header */}
      <div className="fixed top-0 left-10 w-full h-8 sm:h-16 md:h-16 z-[5] bg-no-repeat bg-center bg-cover" style={{ backgroundImage: 'url(/band.png)' }} />
      {/* Logo PDB fisso in alto a sinistra */}
      <Link href="/" className="fixed top-[-13px] left-[-14px] z-50">
        <img src="/pdb.png" alt="PDB Logo" className="w-40 h-28 sm:w-48 sm:h-32 md:w-60 md:h-40" />
      </Link>
      {/* Menu laterale sinistro fisso - CON SCROLL E SPAZIATURA RIDOTTA */}
      <div className="fixed top-0 left-0 w-36 sm:w-44 md:w-60 flex flex-col pt-36 sm:pt-40 md:pt-52 pb-4 z-40 h-screen bg-transparent overflow-y-auto">
        <div className="flex flex-col space-y-0">
          {/* My Binder */}
          <Link href="/inventory" className="self-start -ml-2 sm:-ml-3 md:-ml-4">
            <img src="/mybinder.png" alt="My Binder" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 scale-110 brightness-100" />
          </Link>
          <nav className="flex flex-col space-y-0 text-white text-sm mt-0">
            <Link href="/binders" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/binders.png" alt="Binders" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/dex" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/dex.png" alt="Dex" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/home.png" alt="Home" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
          </nav>
        </div>
        
        {/* Lista selected cards - RIDISEGNATA CON BG E SCROLL */}
{multiMode && selectedCards.length > 0 && (
  <div className="bg-[url(/multilist.png)] bg-contain bg-no-repeat bg-center pt-0 pb-2 pr-2 pl-2 rounded-none w-full h-52 sm:h-60 md:h-72 translate-x-[-4px] sm:translate-x-0 md:translate-x-[6px] flex flex-col" style={{ objectPosition: 'center' }}> {/* Aggiunto flex flex-col per layout verticale rigido */}
    <div className="flex flex-col items-center space-y-1 mb-2"> {/* Ridotto space-y a 1, aumentato mb-6 per separazione maggiore sopra lista */}
      {isListedFilter ? (
        hasListedSelected && (
          <img
            src="/delist.png"
            alt="Batch Delist"
            className="w-20 h-12 sm:w-24 sm:h-14 md:w-28 md:h-16 object-contain cursor-pointer hover:opacity-80 transition-opacity" // Fissa
            onClick={handleBatchDelist}
          />
        )
      ) : (
        <>
          {!showBatchListingOptions ? (
            <img
              src="/list.png"
              alt="Prepare Batch List"
              className="-translate-x-10 -translate-y-0 w-20 h-12 sm:w-24 sm:h-14 md:w-28 md:h-16 object-contain cursor-pointer hover:opacity-80 transition-opacity" // Fissa: -translate-x-6 per ~24px sinistra, -translate-y-1 per ~4px giù (più vicino al bg)
              onClick={() => setShowBatchListingOptions(true)}
            />
          ) : (
            <div className="flex space-x-[-12px]"> {/* Overlap orizzontale per eth/token */}
              <img
                src="/eth.png"
                alt="Batch ETH List"
                className="w-20 h-12 sm:w-24 sm:h-14 md:w-28 md:h-16 object-contain cursor-pointer hover:opacity-80 transition-opacity" // Fissa
                onClick={handleBatchEthListing}
              />
              <img
                src="/token.png"
                alt="Batch Token List"
                className="w-20 h-12 sm:w-24 sm:h-14 md:w-28 md:h-16 object-contain cursor-pointer hover:opacity-80 transition-opacity" // Fissa
                onClick={handleBatchTokenListing}
              />
            </div>
          )}
        </>
      )}
      {hasListedSelected && !isListedFilter && (
        <img
          src="/delist.png"
          alt="Batch Delist"
          className="w-20 h-12 sm:w-24 sm:h-14 md:w-28 md:h-16 object-contain cursor-pointer hover:opacity-80 transition-opacity" // Fissa
          onClick={handleBatchDelist}
        />
      )}
    </div>
    <div className="flex-1 overflow-hidden"> {/* flex-1 per occupare spazio residuo, overflow-hidden per contenere */}
      <div className="h-full max-h-[110px] sm:max-h-38 md:max-h-40 overflow-y-auto -ml-1 pr-1"> {/* Aumentato max-h per lista più grande (32/36/40), h-full per fissare altezza, pr-1 per padding destro */}
        <ul className="space-y-0.5">
          {selectedCards.slice(0, 20).map((card, idx) => (
            <li key={idx} className="text-black/90 flex justify-start items-center text-[7px] sm:text-[9px] md:text-xs break-words px-1 py-0.5 rounded">
              <button onClick={() => removeFromSelected(card)} className="order-first mr-1 text-[8px] sm:text-xs md:text-xs font-bold px-0.5 w-3 flex-shrink-0 text-red-600 hover:text-red-800">
                ×
              </button>
              <span className="max-w-[80px] sm:max-w-[100px] md:max-w-[120px] font-medium flex-1 flex-shrink-0 whitespace-nowrap overflow-hidden">
                {card.metadata.name.split(' #')[0] || 'Unknown'} #{card.tokenId}
              </span>
            </li>
          ))}
          {selectedCards.length > 20 && (
            <li className="text-red-600 text-[7px] sm:text-[9px] md:text-xs text-center py-1">
              Max 20 cards allowed. Remove some to add more.
            </li>
          )}
        </ul>
      </div>
    </div>
  </div>
)}
      </div>
      {/* Pepe.png button fisso in alto a destra (sovrapposto a band.png), visibile solo se connesso e header non mostrato */}
      {isConnected && !showHeader && (
        <button
          onClick={() => setShowHeader(true)}
          className="fixed top-0 right-2 sm:top-0 sm:right-2 md:top-0 md:right-2 z-10 p-0 border-none bg-transparent cursor-pointer"
        >
          <img
            src="/pepe.png"
            alt="Show Wallet Header"
            className="w-20 h-18 sm:w-32 sm:h-28 md:w-40 md:h-36 object-contain transition-opacity hover:opacity-100"
          />
        </button>
      )}
      {/* Header wallet in alto a destra - visibile solo dopo click su pepe.png */}
      {isConnected && showHeader && (
        <div className="fixed top-0 right-2 sm:top-0 sm:right-2 md:top-0 md:right-2 z-10">
          <div className="relative w-40 h-36 sm:w-52 sm:h-52 md:w-56 md:h-108 rounded"> {/* sm:h-52 (+8px stretch verticale su medio); md:h-108 (+10px su grande) - Rimosso overflow-hidden per permettere al bottone di protrudere */}
            <div className="absolute inset-0 w-full h-full object-contain bg-no-repeat translate-x-1" style={{ objectPosition: 'center' }}>
              <img 
                src="/addressbg.png" 
                alt="Address BG" 
                className="w-full h-full"
              />
            </div>
            <div className="relative z-10 flex flex-col items-end justify-center h-full pl-8 sm:pl-7.5 md:pl-9 pr-1 sm:pr-2 md:pr-3 py-1 space-y-0.5 text-right max-w-full scale-125 translate-y-[-20px] sm:translate-y-[-25px] md:translate-y-[-25px] translate-x-[-50px]"> {/* pr-1 sm:pr-2 md:pr-3 (-2px su medio/grande per spostare disconnect più a destra) */}
              <span className="text-[10px] sm:text-sm md:text-sm font-bold text-black/90 overflow-hidden max-w-[110px] sm:max-w-[120px] leading-tight">
                {window.innerWidth < 640 ? `${walletAddress.slice(0, 3)}...${walletAddress.slice(-3)}` : `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`}
              </span>
              <span className="text-[10px] sm:text-sm md:text-sm text-black/70 overflow-hidden max-w-[110px] sm:max-w-[120px] leading-tight">{formattedEthBalance} ETH</span>
              <button onClick={(e) => { e.stopPropagation(); disconnectWallet(); }} className="p-0 border-none bg-transparent self-end mr-1 pr-0.5 mt-0.5">
                <img src="/disconnect.png" alt="Disconnect" className="w-16 h-8 sm:w-28 sm:h-11 md:w-32 md:h-12 object-contain" />
              </button>
            </div>
            {/* Bottone invisibile sotto disconnect per tornare a pepe.png - posizionato assolutamente per non influenzare il layout */}
            <button 
              onClick={(e) => { e.stopPropagation(); setShowHeader(false); }} 
              className="absolute opacity-0 w-20 h-8 cursor-pointer z-20 bottom-[+10px] right-8" 
            />
          </div>
        </div>
      )}
      <main className="flex min-h-screen flex-col items-center p-4 sm:p-6 md:p-8 pt-24 sm:pt-28 md:pt-32 bg-[#00893A] text-white ml-28 sm:ml-36 md:ml-52 relative z-0">
        {showUI ? (
!isConnected ? (
<div className="flex flex-col items-center space-y-2">
  <button
    onClick={openConnectModal}
    type="button"
    aria-label="Connect your wallet"
    className="bg-transparent border-none p-0 cursor-pointer disabled:opacity-50"
    disabled={isConnecting}
  >
    <img 
      src="/connect.png" 
      alt="Connect Wallet" 
      className={`w-40 h-20 sm:w-48 sm:h-24 md:w-56 md:h-28 transition-opacity ${isConnecting ? 'opacity-50' : ''}`} 
    />
  </button>
</div>
) : (
            <div className="w-full flex flex-col items-center">
<div className="flex flex-col space-y-2 mb-4 -ml-12 sm:-ml-14 md:-ml-16 mt-28">
  {!showFilters ? (
    <button
      onClick={() => setShowFilters(true)}
      className="p-2 rounded self-start"
    >
      <img 
        src="/filters.png" 
        alt="Filters" 
        className="w-17 h-16 sm:w-22 sm:h-18 md:w-26 md:h-20 transition-all"
      />
    </button>
  ) : (
    <>
      {/* Riga bottoni: single + multi + listed (a fianco) */}
      <div className="flex space-x-1 self-start">
        {/* Single: attiva se !multiMode, clicca per disattivare multi (modalità normale default) */}
        <button
          onClick={() => setMultiMode(false)}
          className="p-2 rounded"
        >
          <img 
            src="/single.png" 
            alt="Single Mode" 
            className={`w-20 h-14 sm:w-20 sm:h-18 md:w-24 md:h-19 transition-all ${!multiMode ? 'brightness-100 saturate-100' : 'brightness-50 grayscale'}`}
          />
        </button>
        {/* Multi: toggle come prima */}
        <button
          onClick={toggleMultiMode}
          className="p-2 rounded"
        >
          <img 
            src="/multi.png" 
            alt="Multilisting" 
            className={`w-24 h-21 sm:w-30 sm:h-22 md:w-30 md:h-16 transition-all ${multiMode ? 'brightness-100 saturate-100' : 'brightness-50 grayscale'}`} 
          />
        </button>
{/* Listed: come prima, a fianco */}
<button
  onClick={toggleListedFilter}
  className="p-2 rounded"
>
  <img 
    src="/listed.png" 
    alt="Listed Filter" 
    className={`w-18 h-14 sm:w-22 sm:h-14 md:w-30 md:h-16 transition-all ${isListedFilter ? 'brightness-100 saturate-100' : 'brightness-50 grayscale'}`}
  />
</button>
      </div>
      {/* Dropfinder sotto: immagine + input sovrapposto (testo bianco) + bottoni invisibili */}
<div className="relative self-start w-full max-w-lg"> {/* Aumentato max-w-lg per più stretch orizzontale se necessario */}
  {/* object-fill: stretch esatto senza taglio, deforma se aspect non matcha */}
  <img 
    src="/dropfinder.png" 
    alt="Drop Finder" 
    className="w-66 h-12 sm:h-14 md:h-16 block object-fill"
  />
  <input 
    type="text"
    value={pendingDropFilter}
    onChange={(e) => setPendingDropFilter(e.target.value)}
    placeholder="Drop contract address"
    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-transparent text-white border-0 outline-none text-sm w-1/2 px-2 py-1 z-10"
  />
  {/* Centrato: left-1/2 -translate-x-1/2; w-1/2 per spazio al go */}
<button 
  onClick={() => {
    const trimmedValue = pendingDropFilter.toLowerCase().trim();
    if (trimmedValue) {
      setDropFilter(trimmedValue);
    } else {
      setDropFilter('');
    }
  }}
  className="absolute right-14 top-1/2 -translate-y-1/2 w-16 h-full opacity-0 cursor-pointer z-20"
  title="Apply Drop Filter (Go)"
/>
</div>
      {/* Bottone per chiudere il pannello (riporta a filters.png) - posizionato a destra */}
      <button
        onClick={() => setShowFilters(false)}
        className="p-2 rounded self-end opacity-70 hover:opacity-100"
      >
        <img 
          src="/previous.png" 
          alt="Close Filters" 
          className="w-18 h-12 sm:w-18 sm:h-14 md:w-25 md:h-15"
        />
      </button>
    </>
  )}
</div>
              {error && <p className="text-red-500">{error}</p>}
{loading && (
<div className="flex justify-center mt-32">
    <img src="/loading.png" alt="Loading" className="w-40 h-32 sm:w-48 sm:h-36 md:w-56 md:h-40 scale-x-150" />
  </div>
)}
              {!isEthPriceLoaded && (
                <div className="flex justify-center mb-4">
                  <img src="/loading.png" alt="Loading ETH/USD Price" className="w-40 h-32 sm:w-48 sm:h-36 md:w-56 md:h-40 opacity-75" />
                </div>
              )}
              {inventory.length > 0 ? (
                <div className="w-full flex flex-col items-center">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 w-full max-w-7xl mx-auto">
                    {inventory.map((card, index) => {
                      const cacheKey = `${card.tokenId}-${card.contractAddress}-${walletAddress}`;
                      const priceData = prices[cacheKey];
                      const isSelected = selectedCards.some(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress);
const listing = listings[cacheKey];
const isListed = !!listing;
let displayPrice = 'N/A';
const tokenSymbol = card.contract?.tokenSymbol || 'TOKEN';
if (isListed) {
  const listedVal = Number(listing.price) / 1e18;
  let usdValue = 0;
  if (listing.isEth) {
    // Calcola USD effettivo dal prezzo ETH del listing
    usdValue = listedVal * ethUsdPrice;
  } else {
    // Per Token, usa listing.usdValue (calcolato in fetchListings), fallback sicuro a 0 (no pre-listing)
    usdValue = listing.usdValue || 0;
  }
  if (listing.isEth) {
    // ETH + USD (tutto bold + verde)
    displayPrice = `<strong style="color: mediumseagreen; font-weight: 900; opacity: 3.6;">${listedVal.toFixed(6)} ETH (${usdValue.toFixed(2)} USD)</strong>`;  
  } else {
    // Solo Token (bold) + USD (tutto bold) + verde o N/A se USD=0
    const listedTokenDisplay = formatTokenPrice(listedVal, tokenSymbol);
    const usdPart = usdValue > 0 ? ` (${usdValue.toFixed(2)} USD)` : ' (N/A)';
    displayPrice = `<strong style="color:mediumseagreen; font-weight: 900; opacity: 3.6;">${listedTokenDisplay}${usdPart}</strong>`; 
  }
} else if (priceData && priceData.ethValue > 0) {
  const ethValue = priceData.ethValue;
  const usdValue = priceData.usdValue;
  const tokenValue = priceData.tokenValue;
  const tokenPriceDisplay = formatTokenPrice(tokenValue, tokenSymbol);
  displayPrice = `${ethValue.toFixed(6)} ETH (${usdValue.toFixed(2)} USD) ${tokenPriceDisplay}`;
} else if (hoveredCardId === cacheKey) {
  displayPrice = 'Calculating...';
}
                      const wearCondition = getWearCondition(card.metadata.wear);
                      const wearOpacity = getWearOpacity(wearCondition);
                      const rarityName = getRarityName(card.rarity);
                      const foilType = card.metadata.foil || 'Normal';
                      const isStandardFoil = foilType === 'Standard';
                      const isPrizeFoil = foilType === 'Prize';
                      const dropAddress = card.contractAddress || 'N/A';
                      const tokenAddress = card.contract?.tokenAddress || 'N/A';
const isHovered = hoveredCardId === cacheKey;
const renderedHeight = imageSizes[cacheKey] || containerHeight;
const topOffset = (containerHeight - renderedHeight) / 2;
const nameWithId = `${card.metadata.name.split(' #')[0] || 'Unknown'} #${card.tokenId}`;
const foilClass = isStandardFoil ? 'foil-standard' : isPrizeFoil ? 'foil-prize' : '';
const showCase = multiMode && isSelected || isHovered || isListed; // Aggiungi isListed per show fisso
const isZoomed = zoomedLabels[cacheKey];
                      return (
                        <div
                          key={index}
                          className={`group relative rounded-lg shadow-lg cursor-pointer transition-all duration-300 overflow-hidden w-80 mx-0 ml-2 sm:mx-auto h-[30.375rem] ${multiMode && isSelected ? 'scale-105' : ''}`}
                          onMouseEnter={() => handleMouseEnter(card)}
                          onMouseLeave={handleMouseLeave}
                          onClick={() => handleCardClick(card)}
                        >
                          {/* Checkbox nascosta */}
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(card)} className="hidden" />

{/* Delist o List button (solo in non-multi mode, su showCase) */}
{!multiMode && showCase && (
  <>
    {isListed ? (
      <img
        src="/delist.png"
        alt="Delist"
        className="absolute z-50 w-24 h-20 cursor-pointer opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          handleDelist(card);
        }}
        style={{ bottom: '-4px', right: '-4px' }}
      />
    ) : showListingOptions === cacheKey ? (
      <div className="absolute z-50 bottom-[-4px] right-[-4px] flex space-x-[-10px]">
        <img
          src="/eth.png"
          alt="List in ETH"
          className="w-24 h-22 cursor-pointer opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            handleEthListing(card);
          }}
        />
        <img
          src="/token.png"
          alt="List in Token"
          className="w-24 h-16 cursor-pointer opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            handleTokenListing(card);
          }}
        />
      </div>
    ) : (
      <img
        src="/list.png"
        alt="List"
        className="absolute z-50 w-24 h-24 cursor-pointer opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          setShowListingOptions(cacheKey);
        }}
        style={{ bottom: '-4px', right: '-4px' }}
      />
    )}
  </>
)}

                          {/* Immagine card + Wear + Foil: z-10 - Parent con inline style per dimensioni fisse */}
                          <div 
                            className={`absolute top-[139px] left-1/2 transform -translate-x-1/2 overflow-hidden z-10 transition-transform duration-300 group-hover:scale-95 relative rounded-lg ${foilClass || ''}`}
                            style={{ width: `${containerWidth}px`, height: `${containerHeight}px` }}
                          >
                            <img
                              src={card.metadata.imageUrl}
                              alt="Card"
                              className="relative z-10 image-rendering-pixelated block"
                              style={{
                                width: '100% !important',
                                height: '100% !important',
                                objectFit: 'fill',
                                objectPosition: 'center center'
                              }}
                              onLoad={(e) => handleImageLoad(cacheKey, e)}
                            />
                            {/* Wear overlay: z-20, 100% per match, spostato su di 4px */}
                            <div 
                              className={`absolute inset-0 z-20 pointer-events-none ${wearOpacity} image-rendering-pixelated mix-blend-multiply grayscale brightness-75 sepia contrast-110`}
                              style={{
                                top: '-1px',
                                width: '100%',
                                height: '98%',
                                backgroundImage: `url('/wear-overlay.png')`,
                                backgroundSize: '100% 100%',
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'center center'
                              }}
                            />
                            {/* Foil effect: z-25 */}
                            {(isStandardFoil || isPrizeFoil) && (
                              <div className="foil-effect">
                                <div className="shimmer"></div>
                              </div>
                            )}
                          </div>

{/* Case PNG: z-30 */}
<div className={`absolute inset-0 z-30 ${showCase ? (isSelected && multiMode && isListedFilter ? 'opacity-40 scale-100' : isHovered && !isSelected && !isListed ? 'opacity-40 scale-100' : 'opacity-100 scale-100') : 'opacity-0 scale-95'} transform translate-y-[24px] translate-x-[5px]`} 
     style={{ backgroundImage: 'url(/casetemp.png)', backgroundSize: '96% 96%', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', transition: 'none' }} />

                          {/* Etichetta: z-40 con zoom e frame */}
                          <div 
                            className={`absolute top-[81px] left-1/2 transform -translate-x-1/2 translate-x-[-96px] w-[192px] h-[52px] z-40 ${showCase ? 'opacity-100' : 'opacity-0'} transition-all duration-200 cursor-pointer`}
                            style={{ transition: 'transform 0.2s ease' }}
                            onClick={() => handleLabelClick(cacheKey)}
                          >
                            {/* Contenuto etichetta con sfondo bianco sempre */}
                            <div 
                              className={`w-full h-full bg-white p-0.5 text-[7px] leading-tight flex flex-col justify-center text-black overflow-hidden pt-[3px] relative z-10 ${isZoomed ? 'scale-150 origin-center shadow-lg' : ''}`}
                            >
                              <div className="flex justify-center items-center mb-0.5 text-left">
                                <span className="font-bold truncate w-full">{nameWithId}</span>
                              </div>
<div className="flex justify-start items-center text-[7px] min-w-0 pl-[4px] mb-0.5">
  <span className="font-mono" dangerouslySetInnerHTML={{ __html: displayPrice }} />
</div>
                              <div className="flex justify-center items-center space-x-1 text-[7px] min-w-0 pl-[4px] mb-0.5">
                                <span className="flex-1"><span className="font-bold">R:</span> {rarityName}</span>
                                <span className="flex-1"><span className="font-bold">W:</span> {wearCondition}</span>
                                <span className="flex-1"><span className="font-bold">F:</span> {foilType === 'Normal' ? 'None' : foilType || 'N/A'}</span>
                              </div>
                              <div className="flex justify-center items-center mb-0.5 text-left">
                                <span className="w-full block cursor-pointer hover:underline text-[7px] break-all" onClick={(e) => { e.stopPropagation(); copyToClipboard(dropAddress); }}><span className="font-bold">D:</span> {dropAddress}</span>
                              </div>
                              <div className="flex justify-center items-center text-left">
                                <span className="w-full block cursor-pointer hover:underline text-[7px] break-all" onClick={(e) => { e.stopPropagation(); copyToClipboard(tokenAddress); }}><span className="font-bold">T:</span> {tokenAddress}</span>
                              </div>
                            </div>
                            {/* Cornice label.png solo su zoom, z-index più alto, rimpicciolita */}
                            {isZoomed && (
                              <div 
                                className="absolute z-20 scale-125 origin-center"
                                style={{
                                  top: '-12.5%',
                                  left: '-18.5%',
                                  width: '140%',
                                  height: '125%',
                                  backgroundImage: `url('/label.png')`,
                                  backgroundSize: 'cover',
                                  backgroundRepeat: 'no-repeat',
                                  backgroundPosition: 'center'
                                }}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex justify-center items-center space-x-4">
<button 
  className="p-0 border-none bg-transparent cursor-pointer disabled:cursor-not-allowed" 
  onClick={() => goToPage(currentPage - 1)} 
  disabled={currentPage === 1}
>
  <img 
    src="/previous.png" 
    alt="Previous Page" 
    className={`w-20 h-16 sm:w-24 sm:h-18 md:w-28 md:h-20 transition-opacity scale-x-110 ${currentPage === 1 ? 'brightness-50 grayscale opacity-50' : ''}`} 
  />
</button>
                    <button 
                      className="p-0 border-none bg-transparent cursor-pointer disabled:cursor-not-allowed" 
                      onClick={() => goToPage(currentPage + 1)} 
                      disabled={currentPage === totalPages}
                    >
<img 
  src="/next.png" 
  alt="Next Page" 
  className={`w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20 transition-opacity ${currentPage === totalPages ? 'brightness-50 grayscale opacity-50' : ''}`} 
/>
                    </button>
                  </div>
                </div>
              ) : (
<div className="flex justify-center">
    <img 
      src="/nocardsfound.png" 
      alt="No opened cards found" 
      className="w-40 h-38 sm:w-52 sm:h-42 md:w-62 md:h-44 opacity-75 transition-opacity" 
    />
  </div>
)}
            </div>
          )
) : (
  <div className="flex justify-center">
    <img src="/loading.png" alt="Loading" className="w-40 h-32 sm:w-48 sm:h-36 md:w-56 sm:h-40" />
  </div>
)}
      </main>
    </>
  );
}
