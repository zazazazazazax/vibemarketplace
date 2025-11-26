'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount, useSignTypedData, useBalance, useDisconnect, useChainId, useWriteContract, useReadContract, useConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { useWalletSignature } from '../hooks/useWalletSignature';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { ethers } from 'ethers';
import { http } from 'viem';
import { readContract, writeContract, waitForTransaction } from 'wagmi/actions';
import { useQuery } from '@tanstack/react-query';
import { useFarcasterMiniApp } from '../hooks/useFarcasterMiniApp';

export const dynamic = 'force-dynamic';

// ABI minima del contratto (per eventi) – invariato
const CONTRACT_ABI = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "tokenId", "type": "uint256" },
      { "indexed": true, "name": "collection", "type": "address" },
      { "indexed": true, "name": "seller", "type": "address" },
      { "name": "price", "type": "uint256" },
      { "name": "isEth", "type": "bool" }
    ],
    "name": "ListingCreated",
    "type": "event"
  }
];

// ABI estesa per getListingDetails + buyListing + batchBuy
const marketplaceABI = [
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
    "name": "buyListing",
    "outputs": [],
    "stateMutability": "payable",
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
    "name": "batchBuy",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

const CONTRACT_ADDRESS = '0x34682Df3fC35079EFe78fF37008856aB090e03e1';
const zeroAddress = '0x0000000000000000000000000000000000000000';
const erc20ABI = [
  {
    "constant": false,
    "inputs": [
      {"name": "_spender", "type": "address"},
      {"name": "_value", "type": "uint256"}
    ],
    "name": "approve",
    "outputs": [{"name": "", "type": "bool"}],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [
      {"name": "_owner", "type": "address"},
      {"name": "_spender", "type": "address"}
    ],
    "name": "allowance",
    "outputs": [{"name": "", "type": "uint256"}],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "balance", "type": "uint256"}],
    "type": "function"
  }
];

const erc721ABI = [
  {
    "inputs": [{"name": "tokenId", "type": "uint256"}],
    "name": "ownerOf",
    "outputs": [{"name": "owner", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  }
];

//All listings – AGGIORNATO: Verifica owner/seller match on-chain post-fetch
function useAllListings() {
  const [allListings, setAllListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { address: walletAddress } = useAccount();  // Per config, ma non essenziale qui
  const config = useConfig();

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/listings?endpoint=all&limit=1000');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (data.error) {
          setError(data.error);
          return;
        }

        let fetchedListings = data.listings || [];

        // NUOVO: Batch verifica owner/seller match (solo se config disponibile)
        if (config && fetchedListings.length > 0) {
          console.log('Verifying owner/seller for', fetchedListings.length, 'listings...');
          const verifyPromises = fetchedListings.map(async (listing) => {
            try {
              const tokenIdNum = Number(listing.tokenId);
              if (isNaN(tokenIdNum) || tokenIdNum <= 0) return listing;  // Skip invalid

              // Read ownerOf dall'NFT collection
              const owner = await readContract(config, {
                address: listing.collection.toLowerCase(),
                abi: erc721ABI,
                functionName: 'ownerOf',
                args: [BigInt(tokenIdNum)],
                chainId: 8453,  // Forza Base
              });

              // Se seller != owner, segna per remove
              if (owner.toLowerCase() !== listing.seller.toLowerCase()) {
                console.warn(`Mismatch for ${listing.key}: seller ${listing.seller} != owner ${owner}`);
                // Remove dal backend (usa helper, ma qui inline per semplicità)
                await fetch('/api/listings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'remove',
                    items: [{ key: listing.key.toLowerCase() }],
                    walletAddress: listing.seller.toLowerCase()  // Passa seller per completezza
                  }),
                }).catch(removeErr => console.error('Backend remove failed for mismatch:', removeErr));
                return null;  // Filtra out
              }
              return listing;
            } catch (verifyErr) {
              console.error(`Owner verify failed for ${listing.key}:`, verifyErr);
              return listing;  // Keep se errore (non bloccare)
            }
          });

          const verifiedListings = (await Promise.all(verifyPromises)).filter(Boolean);
          console.log(`Verified: ${verifiedListings.length}/${fetchedListings.length} listings valid`);
          fetchedListings = verifiedListings;
        }

        setAllListings(fetchedListings);
      } catch (err) {
        console.error('Fetch all listings error:', err);
        setError('Error fetching listings. Please refresh.');
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, [config]);  // Dipende da config per verifica

  return { allListings, setAllListings, loading, error };
}

export default function Binders() {
  const router = useRouter();
  const { address: walletAddress, isConnected, isConnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const config = useConfig();
  const { data: ethBalance } = useBalance({ address: walletAddress });
  const { hasSigned, isSigning, error: signatureError, handleSignature, resetSignature } = useWalletSignature(walletAddress);
  const { openConnectModal } = useConnectModal();
  const [error, setError] = useState(null);
  const [showHeader, setShowHeader] = useState(false);

  //Hook allListings
  const { allListings, setAllListings, loading: listingsLoading, error: listingsError } = useAllListings();

  // Stati per paginazione
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

// NUOVO: Hook per Mini App (navigate, embedded wallet—non altera connect)
  const { navigateTo } = useFarcasterMiniApp();

  // useQuery per ETH price (copia da InventoryContent)
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
  const [ethUsdPrice, setEthUsdPrice] = useState(0);
  useEffect(() => {
    if (ethPriceData?.price) {
      setEthUsdPrice(ethPriceData.price);
    }
  }, [ethPriceData]);

  // Stati aggiuntivi per multi-carte
  const [zoomedLabels, setZoomedLabels] = useState({});
  const [showCases, setShowCases] = useState({});

  // Nuovi stati per filters e multi
  const [showFilters, setShowFilters] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [selectedCards, setSelectedCards] = useState([]);
  const [dropFilter, setDropFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [pendingDropFilter, setPendingDropFilter] = useState('');
  const [pendingOwnerFilter, setPendingOwnerFilter] = useState('');

  // Ref per old listings (per rollback se necessario)
  const oldListingsRef = useRef(null);
  useEffect(() => {
    if (allListings) oldListingsRef.current = allListings;
  }, [allListings]);

  // Stati per buying multi
  const [isBuyingMap, setIsBuyingMap] = useState({});

  // Funzioni helper (copia/adatta da InventoryContent)
  const getWearCondition = (wear) => {
    const w = parseFloat(wear || 0);
    if (w < 0.04) return 'Pristine';
    if (w < 0.2) return 'Mint';
    if (w < 0.4) return 'Lightly p.';
    if (w < 0.8) return 'Moderately p.';
    return 'Heavily p.';
  };

  const getWearOpacity = (condition) => {
    switch (condition) {
      case 'Pristine': return 'opacity-0';
      case 'Mint': return 'opacity-25';
      case 'Lightly p.': return 'opacity-35';
      case 'Moderately p.': return 'opacity-50';
      case 'Heavily p.': return 'opacity-65';
      default: return 'opacity-0';
    }
  };

  const getRarityName = (rarity) => rarity || 'Unknown'; // Dal backend

  const formatTokenPrice = (value, symbol) => `${value.toFixed(2)} ${symbol || ''}`;

  const abbreviateNumber = (num) => {
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'k';
    return num.toFixed(2);
  };

  const getDisplayPrice = (price, isEth, currency, tokenSymbol, pricePerPackUsd, ethUsdPrice) => {
    if (isEth && ethUsdPrice > 0) {
      const ethVal = Number(price) / 1e18;
      const usdVal = ethVal * ethUsdPrice;
      return `<strong style="color:mediumseagreen; font-weight: 900; opacity: 3.6;">${ethVal.toFixed(6)} ETH (${usdVal.toFixed(2)} USD)</strong>`; // 6 decimals ETH
    } else if (!isEth && tokenSymbol !== 'UNKNOWN' && pricePerPackUsd > 0) {
      const tokenVal = Number(price) / 1e18; // 18 decimals
      const abbrVal = abbreviateNumber(tokenVal);
      const usdPerToken = pricePerPackUsd / 100000; // Pack = 100k tokens
      const usdVal = tokenVal * usdPerToken;
      return `<strong style="color:mediumseagreen; font-weight: 900; opacity: 3.6;">${abbrVal} ${tokenSymbol} (${usdVal.toFixed(2)} USD)</strong>`;
    }
    return '<strong style="color:gray;">Price N/A</strong>';
  };

// Funzione helper per retry read allowance (MODIFICATA: delay più conservativi)
const checkAllowanceWithRetry = useCallback(async (config, currency, walletAddress, CONTRACT_ADDRESS, requiredAmount, maxRetries = 4) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const allowance = await readContract(config, {
        address: currency,
        abi: erc20ABI,
        functionName: 'allowance',
        args: [walletAddress, CONTRACT_ADDRESS],
      });
      if (allowance >= requiredAmount) {
        console.log(`Allowance confirmed after ${attempt + 1} attempt(s)`);
        return true;
      }
      console.warn(`Allowance check failed (attempt ${attempt + 1}): ${allowance.toString()} < ${requiredAmount.toString()}`);
      if (attempt < maxRetries - 1) {
        // Delay esponenziale più conservativo: 1500 * 1.5^attempt (1500ms, ~2250ms, ~3375ms, ~5063ms)
        const delayMs = 1500 * Math.pow(1.5, attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (err) {
      console.error(`Allowance read error (attempt ${attempt + 1}):`, err);
    }
  }
  return false;
}, [readContract]);

  // Funzione helper per remove backend (per match backend POST)
  const removeListingFromBackend = useCallback(async (collection, tokenId, seller) => {
    const key = `${tokenId}-${collection.toLowerCase()}-${seller.toLowerCase()}`;
    const body = {
      action: 'remove',
      items: [{ key }],
      walletAddress: seller.toLowerCase()
    };

    // Retry semplice (1x) per flakiness
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch('/api/listings', {  // No ?endpoint per questo handler
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        console.log('Backend remove successful for key:', key);
        return true;
      } catch (err) {
        console.error(`Backend remove failed (attempt ${attempt + 1}):`, err);
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Delay prima retry
        } else {
          // Dopo retry, non blocca: UI già aggiornata
          return false;
        }
      }
    }
    return false;
  }, []);

  // Handle label click (zoom) per multi
  const handleLabelClick = (cacheKey) => {
    setZoomedLabels(prev => ({ ...prev, [cacheKey]: !prev[cacheKey] }));
  };

  // Funzione per eject/retract case per multi
  const handleEjectClick = (cacheKey, e) => {
    if (e.target.closest('.label-container')) return; // Skip se click su label
    setShowCases(prev => ({ ...prev, [cacheKey]: !prev[cacheKey] }));
  };

  // Auto-return to case on mouse leave
  const handleMouseLeave = useCallback((cacheKey) => {
    setShowCases(prev => {
      const current = prev[cacheKey];
      if (current === false) { // Only if ejected
        return { ...prev, [cacheKey]: true };
      }
      return prev;
    });
  }, []);

  // Toggle select per multi
  const toggleSelect = (listing) => {
    const cacheKey = `${listing.tokenId}-${listing.collection}`;
    setSelectedCards(prev => {
      const isSelected = prev.some(s => s.key === listing.key);
      if (isSelected) {
        return prev.filter(s => s.key !== listing.key);
      } else {
        return [...prev, { ...listing, key: listing.key }];
      }
    });
  };

  // Remove from selected
  const removeFromSelected = (key) => {
    setSelectedCards(prev => prev.filter(s => s.key !== key));
  };

  // Apply drop filter
  const applyDropFilter = () => {
    setDropFilter(pendingDropFilter || '');
    setPendingDropFilter('');
  };

  // Apply owner filter
  const applyOwnerFilter = () => {
    setOwnerFilter(pendingOwnerFilter || '');
    setPendingOwnerFilter('');
  };

  // Filtered listings
  const filteredListings = useMemo(() => {
    let filtered = [...allListings];
    if (dropFilter) {
      filtered = filtered.filter(l => l.collection.toLowerCase() === dropFilter.toLowerCase());
    }
    if (ownerFilter) {
      filtered = filtered.filter(l => l.seller.toLowerCase() === ownerFilter.toLowerCase());
    }
    if (currencyFilter) {
      const isEthFilter = currencyFilter === 'eth';
      filtered = filtered.filter(l => l.isEth === isEthFilter);
    }
    return filtered;
  }, [allListings, dropFilter, ownerFilter, currencyFilter]);

  // Current page listings
  const currentListings = useMemo(() => {
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    return filteredListings.slice(indexOfFirstItem, indexOfLastItem);
  }, [filteredListings, currentPage, itemsPerPage]);

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('Copied to clipboard!'); // Simple confirmation (come in InventoryContent)
      console.log('Copied:', text);
    } catch (err) {
      console.error('Copy failed:', err);
      alert('Copy failed – please try again.'); // Fallback
    }
  };

  const formattedEthBalance = ethBalance ? (parseFloat(ethBalance.formatted)).toFixed(7) : '0';

  // Handler per buy listing specifica (single)
  const handleBuy = useCallback(async (listing) => {
    console.log('handleBuy: chainId =', chainId);

    if (!walletAddress || !listing || !chainId || chainId !== 8453) {
      if (!chainId || chainId !== 8453) setError('Switch to Base chain (ID: 8453)');
      if (!walletAddress) openConnectModal();
      return;
    }

    const cacheKey = `${listing.tokenId}-${listing.collection}`;
    const isBuyingThis = isBuyingMap[cacheKey] || false;
    if (isBuyingThis) return;

    setIsBuyingMap(prev => ({ ...prev, [cacheKey]: true }));

    try {
      // Get details pre-buy
const [price, isEth, currency] = await readContract(config, {
      address: CONTRACT_ADDRESS,
      abi: marketplaceABI,
      functionName: 'getListingDetails',
      args: [listing.collection.toLowerCase(), BigInt(listing.tokenId), listing.seller.toLowerCase()], 
    });

      const priceWei = price;
      console.debug('Buy details:', { price: priceWei.toString(), isEth, currency });

      // Check balance per token (se !isEth)
      if (!isEth && currency !== zeroAddress) {
        const balance = await readContract(config, {
          address: currency,
          abi: erc20ABI,
          functionName: 'balanceOf',
          args: [walletAddress],
        });
        console.debug('Token balance check:', { balance: balance.toString(), required: priceWei.toString() });
        if (balance < priceWei) {
          alert('Insufficient token balance for buy. Check wallet and try again.');
          setIsBuyingMap(prev => ({ ...prev, [cacheKey]: false }));
          return;
        }
        console.log('Token balance sufficient');
      }

      let approveResult = null;
      if (!isEth && currency !== zeroAddress) {
        // Check allowance
        let allowance = await readContract(config, {
          address: currency,
          abi: erc20ABI,
          functionName: 'allowance',
          args: [walletAddress, CONTRACT_ADDRESS],
        });
        if (allowance < priceWei) {
          try {
            approveResult = await writeContract(config, {
              address: currency,
              abi: erc20ABI,
              functionName: 'approve',
              args: [CONTRACT_ADDRESS, priceWei],
            });
            if (approveResult?.hash) {
              await waitForTransaction(config, { hash: approveResult.hash });
            }
            console.log('Approved token for buy');

            // Verifica allowance con retry dopo approve
            const allowanceOk = await checkAllowanceWithRetry(config, currency, walletAddress, CONTRACT_ADDRESS, priceWei);
            if (!allowanceOk) {
              throw new Error('Allowance not updated after approval. Please retry the buy.');
            }

            // Delay aggiuntivo per sync provider (aumentato)
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (approveErr) {
            console.error('Approval error:', approveErr);
            console.warn('Skipped approval – buy may fail');
          }
        } else {
          console.log('Already approved for buy');
        }
      }

      // Buy TX (standalone, matching InventoryContent pattern)
      console.log('Sending buy TX...');
      const buyResult = await writeContract(config, {
        address: CONTRACT_ADDRESS,
        abi: marketplaceABI,
        functionName: 'buyListing',
        args: [listing.collection.toLowerCase(), BigInt(listing.tokenId), listing.seller.toLowerCase()],
        value: isEth ? priceWei : undefined,
      });
      const buyHash = buyResult?.hash || null; // Safe null se undefined
      console.log('Buy tx sent:', buyHash || 'undefined (bug, but proceeding)');

      // Wait for mine (solo se hash, else delay 8s per broadcast/mine)
      if (buyHash) {
        try {
          console.log('TX confirmed, waiting for mine...');
          await waitForTransaction(config, { hash: buyHash });
          console.log('TX mined successfully');

          // Piccolo delay post-mine per sync
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (mineErr) {
          const mineErrorStr = (mineErr.message || mineErr.toString() || '').toLowerCase();
          if (mineErrorStr.includes('bigint') || mineErrorStr.includes('undefined')) {
            console.warn('Ignored wait BigInt error (proceeding to verify)');
          } else {
            console.warn('waitForTransaction error (possible revert):', mineErr.message);
            throw mineErr; // Rilancia per catch
          }
        }
      } else {
        // Fallback delay se no hash
        await new Promise(resolve => setTimeout(resolve, 8000));
      }

      // Verifica post-buy: Rimuovi dalla lista
      console.log('Verifying buy...');
      let listingRemovedOnChain = false;
      try {
        const [postPrice] = await readContract(config, {
          address: CONTRACT_ADDRESS,
          abi: marketplaceABI,
          functionName: 'getListingDetails',
          args: [listing.collection.toLowerCase(), BigInt(listing.tokenId), listing.seller.toLowerCase()],
        });
        if (postPrice === 0n) {
          console.log('Buy verified: Listing removed on-chain');
          listingRemovedOnChain = true;
        } else {
          console.warn('Buy verification failed: Listing still active on-chain');
        }
      } catch {
        console.log('Buy verified: Listing removed (revert)');
        listingRemovedOnChain = true;
      }

      // Se verificato on-chain, rimuovi dal backend
      if (listingRemovedOnChain) {
        await removeListingFromBackend(listing.collection, listing.tokenId, listing.seller);
      }

      // Rimuovi localmente (sempre, per UX immediata)
      setAllListings(prev => prev.filter(l => l.key !== listing.key));

      // Niente alert di successo, solo log
      console.log('Purchase successful! Check your wallet.');
    } catch (err) {
      console.error('Buy error:', err);
      const errorStr = (err.message || err.toString() || '').toLowerCase();
      if (errorStr.includes('user rejected') || errorStr.includes('cancelled')) {
        console.log('User cancelled buy');
      } else if (errorStr.includes('insufficient funds') || errorStr.includes('insufficient balance')) {
        alert('Insufficient funds. Please top up your wallet.');
      } else if (errorStr.includes('not listed') || errorStr.includes('inactive')) {
        console.log('Listing removed during buy – refreshing');
        await removeListingFromBackend(listing.collection, listing.tokenId, listing.seller);
        setAllListings(prev => prev.filter(l => l.key !== listing.key));
      } else if (errorStr.includes('internal json-rpc error') || errorStr.includes('allowance not updated')) {
        // Gestione specifica per questo errore
        alert('Buy timed out (likely sync issue). Please retry – approval is already done!');
      } else {
        alert(`Buy failed: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setIsBuyingMap(prev => ({ ...prev, [cacheKey]: false }));
    }
  }, [walletAddress, chainId, readContract, config, setAllListings, openConnectModal, setError, isBuyingMap, ethUsdPrice, checkAllowanceWithRetry, removeListingFromBackend]);

  // Handler per batch buy
  const handleBatchBuy = useCallback(async () => {
    if (!walletAddress || selectedCards.length === 0 || selectedCards.length > 20 || !chainId || chainId !== 8453) {
      if (selectedCards.length > 20) alert('Max 20 items for batch buy.');
      if (!chainId || chainId !== 8453) setError('Switch to Base chain (ID: 8453)');
      if (!walletAddress) openConnectModal();
      return;
    }

    const isEth = selectedCards[0].isEth; // Assume same for all
    const items = selectedCards.map(({ collection, tokenId, seller }) => ({
      collection: collection.toLowerCase(),
      tokenId: BigInt(tokenId),
      seller: seller.toLowerCase()
    }));
    const totalPrice = selectedCards.reduce((sum, l) => sum + BigInt(l.price), 0n);

    try {
      // Approvals if !isEth
      if (!isEth) {
        const tokenGroups = selectedCards.reduce((groups, l) => {
          const curr = l.currency;
          if (!groups[curr]) groups[curr] = { total: 0n, items: [] };
          groups[curr].total += BigInt(l.price);
          groups[curr].items.push(l);
          return groups;
        }, {});

        for (const [tokenAddr, { total }] of Object.entries(tokenGroups)) {
          const balance = await readContract(config, {
            address: tokenAddr,
            abi: erc20ABI,
            functionName: 'balanceOf',
            args: [walletAddress],
          });
          if (balance < total) {
            alert(`Insufficient ${tokenAddr} balance.`);
            return;
          }

          const allowance = await readContract(config, {
            address: tokenAddr,
            abi: erc20ABI,
            functionName: 'allowance',
            args: [walletAddress, CONTRACT_ADDRESS],
          });
          if (allowance < total) {
            const approveResult = await writeContract(config, {
              address: tokenAddr,
              abi: erc20ABI,
              functionName: 'approve',
              args: [CONTRACT_ADDRESS, total],
            });
            if (approveResult?.hash) await waitForTransaction(config, { hash: approveResult.hash });
            console.log('Approved token for batch buy');

            // Verifica allowance con retry
            const allowanceOk = await checkAllowanceWithRetry(config, tokenAddr, walletAddress, CONTRACT_ADDRESS, total);
            if (!allowanceOk) {
              throw new Error('Allowance not updated after approval. Please retry the batch buy.');
            }

            // Delay aggiuntivo
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      }

      // Batch buy TX
      const buyResult = await writeContract(config, {
        address: CONTRACT_ADDRESS,
        abi: marketplaceABI,
        functionName: 'batchBuy',
        args: [items],
        value: isEth ? totalPrice : undefined,
      });
      const buyHash = buyResult?.hash;
      if (buyHash) {
        await waitForTransaction(config, { hash: buyHash });
        await new Promise(resolve => setTimeout(resolve, 500)); // Delay post-mine
      } else {
        await new Promise(resolve => setTimeout(resolve, 8000));
      }

      // Verify each on-chain
      console.log('Verifying batch buy...');
      const removedKeys = [];
      await new Promise(resolve => setTimeout(resolve, 2000));
      for (const sel of selectedCards) {
        try {
          const [postPrice] = await readContract(config, {
            address: CONTRACT_ADDRESS,
            abi: marketplaceABI,
            functionName: 'getListingDetails',
            args: [sel.collection.toLowerCase(), BigInt(sel.tokenId), sel.seller.toLowerCase()],
          });
          if (postPrice === 0n) {
            removedKeys.push({ collection: sel.collection, tokenId: sel.tokenId, seller: sel.seller, key: sel.key });
          }
        } catch {
          removedKeys.push({ collection: sel.collection, tokenId: sel.tokenId, seller: sel.seller, key: sel.key });
        }
      }

      // Remove dal backend per quelli verificati
      for (const { collection, tokenId, seller } of removedKeys) {
        await removeListingFromBackend(collection, tokenId, seller);
      }

      // Rimuovi localmente
      setAllListings(prev => prev.filter(l => !removedKeys.some(r => r.key === l.key)));
      setSelectedCards([]);

      // Niente alert, solo log
      console.log('Batch purchase successful!');
    } catch (err) {
      console.error('Batch buy error:', err);
      const errorStr = (err.message || err.toString() || '').toLowerCase();
      if (errorStr.includes('internal json-rpc error') || errorStr.includes('allowance not updated')) {
        // Gestione specifica
        alert('Batch buy timed out (likely sync issue). Please retry – approvals are done!');
      } else {
        alert(`Batch buy failed: ${err.message || 'Unknown error'}`);
      }
    }
  }, [walletAddress, chainId, selectedCards, config, readContract, writeContract, setAllListings, openConnectModal, setError, checkAllowanceWithRetry, removeListingFromBackend]);

  const disconnectWallet = () => {
    disconnect();
    localStorage.clear();
    resetSignature();
    setShowHeader(false);
  };

  // Is selected helper
  const isSelected = (listing) => selectedCards.some(s => s.key === listing.key);

  return (
    <>
      <div className="fixed top-0 left-8 w-full h-8 sm:h-16 md:h-16 z-[5] bg-no-repeat bg-center bg-cover" style={{ backgroundImage: 'url(/band.png)' }} />
      <Link href="/" className="fixed top-[-13px] left-[-14px] z-50">
        <img src="/pdb.png" alt="PDB Logo" className="w-40 h-28 sm:w-48 sm:h-32 md:w-60 md:h-40" />
      </Link>
      <div className="fixed top-0 left-0 w-36 sm:w-44 md:w-60 flex flex-col pt-36 sm:pt-40 md:pt-52 pb-4 z-40 h-screen bg-transparent overflow-y-auto">
        <div className="flex flex-col space-y-0 relative">
          <Link href="/binders" className="self-start -ml-2 sm:-ml-3 md:-ml-4">
            <img src="/binders.png" alt="Binders" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 scale-100 brightness-100" />
          </Link>
          <nav className="flex flex-col space-y-0 text-white text-sm mt-0">
            <Link href="/dex" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/dex.png" alt="Dex" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/home.png" alt="Home" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/inventory" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/mybinder.png" alt="My Binder" className="scale-x-110 w-32 h-12 sm:w-40 sm:h-14 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
          </nav>
{/* Multi list section */}
{multiMode && selectedCards.length > 0 && (
  <div className="mt-4 flex flex-col space-y-2">
    <img 
      src="/buy.png" 
      alt="Batch Buy" 
      className="w-24 h-14 sm:w-26 sm:h-18 md:w-32 md:h-20 cursor-pointer self-start -ml-2 hover:scale-105 translate-y-4 ml-6" 
      onClick={handleBatchBuy}
    />
    <div className="relative self-start ml-2">
      <img src="/multilist.png" alt="Multi List" className="w-[170px] h-34 sm:w-80 sm:h-40 md:w-80 md:h-48 lg:w-80 lg:h-56" />
      <div className="absolute top-[20px] sm:top-[22px] bottom-0 left-0 right-0 flex flex-col justify-start items-start pl-2 overflow-y-auto text-[7px] sm:text-[9px] lg:text-xs text-black space-y-2">
        {selectedCards.map((sel, i) => (
          <div key={i} className="flex items-center w-full px-1">
            <span 
              className="text-red-500 cursor-pointer mr-1 flex-shrink-0" 
              onClick={() => removeFromSelected(sel.key)}
            >x</span>
            <span className="truncate flex-1">{sel.name} #{sel.tokenId}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
)}
        </div>
      </div>

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
      {isConnected && showHeader && (
        <div className="fixed top-0 right-2 sm:top-0 sm:right-2 md:top-0 md:right-2 z-10">
          <div className="relative w-40 h-36 sm:w-52 sm:h-52 md:w-56 md:h-108 rounded">
            <div className="absolute inset-0 w-full h-full object-contain bg-no-repeat translate-x-1" style={{ objectPosition: 'center' }}>
              <img 
                src="/addressbg.png" 
                alt="Address BG" 
                className="w-full h-full"
              />
            </div>
            <div className="relative z-10 flex flex-col items-end justify-center h-full pl-8 sm:pl-7.5 md:pl-9 pr-1 sm:pr-2 md:pr-3 py-1 space-y-0.5 text-right max-w-full scale-125 translate-y-[-20px] sm:translate-y-[-25px] md:translate-y-[-25px] translate-x-[-50px]">
              <span className="text-[10px] sm:text-sm md:text-sm font-bold text-black/90 overflow-hidden max-w-[110px] sm:max-w-[120px] leading-tight">
                {window.innerWidth < 640 ? `${walletAddress.slice(0, 3)}...${walletAddress.slice(-3)}` : `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`}
              </span>
              <span className="text-[10px] sm:text-sm md:text-sm text-black/70 overflow-hidden max-w-[110px] sm:max-w-[120px] leading-tight">{formattedEthBalance} ETH</span>
              <button onClick={(e) => { e.stopPropagation(); disconnectWallet(); }} className="p-0 border-none bg-transparent self-end mr-1 pr-0.5 mt-0.5">
                <img src="/disconnect.png" alt="Disconnect" className="w-16 h-10 sm:w-28 sm:h-11 md:w-32 md:h-12 object-contain" />
              </button>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); setShowHeader(false); }} 
              className="absolute opacity-0 w-20 h-8 cursor-pointer z-20 bottom-[+10px] right-8" 
            />
          </div>
        </div>
      )}
      <main suppressHydrationWarning className="flex min-h-screen flex-col items-center p-4 sm:p-6 md:p-8 pt-24 sm:pt-28 md:pt-32 bg-[#00893A] text-white ml-28 sm:ml-36 md:ml-52 relative z-0">
        {!isConnected ? (
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
        ) : listingsLoading ? (
          <div className="flex flex-col items-center space-y-2">
            <img src="/loading.png" alt="Loading" className="w-40 h-30 sm:w-48 sm:h-30 md:w-60 md:h-32" />
            {listingsError && <p className="text-red-500 mt-2">{listingsError}</p>}
          </div>
        ) : (
          <div className="w-full max-w-6xl flex flex-col items-center">
            {/* Filters row */}
            <div className="flex flex-col items-center space-y-6 mb-12 w-full max-w-md">
             {!showFilters && (
              <img 
                src="/filters.png" 
                alt="Filters" 
                className="w-22 h-20 sm:w-26 sm:h-22 md:w-30 md:h-24 transition-all" 
                onClick={() => setShowFilters(!showFilters)}
              />
             )}
{showFilters && (
  <div className="flex flex-col items-center space-y-3 sm:space-y-4 w-full"> 
    {/* Single/Multi + Eth/Token - AUMENTATO: dimensioni sm/md più grandi */}
    <div className="flex space-x-2 sm:space-x-4"> 
      <img 
        src="/single.png" 
        alt="Single" 
        className={`w-16 h-12 sm:w-26 sm:h-16 md:w-30 md:h-12 cursor-pointer hover:scale-105 ${!multiMode ? 'opacity-100' : 'opacity-50'}`} 
        onClick={() => { 
          setMultiMode(false); 
          setSelectedCards([]); 
        }}
      />
      {currencyFilter && (
        <img 
          src="/multi.png" 
          alt="Multi" 
          className={`w-20 h-12 sm:w-26 sm:h-16 md:w-30 md:h-18 cursor-pointer hover:scale-105 ${multiMode ? 'opacity-100' : 'opacity-50'}`} 
          onClick={() => setMultiMode(true)}
        />
      )}
      <img 
        src="/eth.png" 
        alt="ETH" 
        className={`w-16 h-12 sm:w-22 sm:h-14 md:w-26 md:h-16 cursor-pointer hover:scale-105 ${currencyFilter === 'eth' ? 'opacity-100' : 'opacity-50'}`} 
        onClick={() => { 
          setCurrencyFilter(prev => prev === 'eth' ? '' : 'eth'); 
          if (multiMode) { 
            setMultiMode(false); 
            setSelectedCards([]); 
          } 
        }}
      />
      <img 
        src="/token.png" 
        alt="Token" 
        className={`w-16 h-12 sm:w-24 sm:h-14 md:w-24 md:h-12 cursor-pointer hover:scale-105 ${currencyFilter === 'token' ? 'opacity-100' : 'opacity-50'}`} 
        onClick={() => { 
          setCurrencyFilter(prev => prev === 'token' ? '' : 'token'); 
          if (multiMode) { 
            setMultiMode(false); 
            setSelectedCards([]); 
          } 
        }}
      />
    </div>
    {/* Drop Finder - AUMENTATO: h su sm/md; max-w scalato; input più largo */}
    <div className="flex items-center relative w-full max-w-[400px] sm:max-w-[500px] md:max-w-[600px]"> 
      <img src="/dropfinder.png" alt="Drop Finder" className="w-full h-12 sm:h-18 md:h-22 block object-contain" /> 
      <input
        type="text"
        value={pendingDropFilter}
        onChange={(e) => setPendingDropFilter(e.target.value)}
        placeholder="Drop Address"
        className="absolute left-24 top-1.5 sm:left-32 md:left-32 w-[160px] h-8 sm:w-[200px] sm:h-9 md:w-[240px] md:h-10 text-sm text-white pl-2 bg-transparent outline-none border-none" 
      />
      <div 
        className="absolute right-12 sm:right-20 md:right-20 w-8 h-full cursor-pointer" 
        onClick={applyDropFilter}
      />
    </div>
    {/* Binder Finder - AUMENTATO: simile a dropfinder */}
    <div className="flex items-center relative w-full max-w-[400px] sm:max-w-[500px] md:max-w-[600px]"> 
      <img src="/binderfinder.png" alt="Binder Finder" className="w-full h-12 sm:h-18 md:h-22 block object-contain" /> 
      <input
        type="text"
        value={pendingOwnerFilter}
        onChange={(e) => setPendingOwnerFilter(e.target.value)}
        placeholder="Owner Address"
        className="absolute left-24 top-1.5 sm:left-32 md:left-32 w-[160px] h-8 sm:w-[200px] sm:h-9 md:w-[240px] md:h-10 text-sm text-white pl-2 bg-transparent outline-none border-none" 
      />
      <div 
        className="absolute right-12 sm:right-20 md:right-20 w-8 h-full cursor-pointer" 
        onClick={applyOwnerFilter}
      />
    </div>
    {/* Bottone close con previous.png - AUMENTATO: dimensioni su sm/md */}
    <button
      onClick={() => setShowFilters(false)}
      className="p-2 rounded self-end opacity-70 hover:opacity-100"
    >
      <img 
        src="/previous.png" 
        alt="Close Filters" 
        className="w-14 h-10 sm:w-20 sm:h-12 md:w-24 md:h-14" 
      />
    </button>
  </div>
)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
              {currentListings.length > 0 ? (
                currentListings.map((listing) => {
                  const cacheKey = `${listing.tokenId}-${listing.collection}`;
                  const isZoomed = zoomedLabels[cacheKey] || false;
                  const showThisCase = showCases[cacheKey] !== undefined ? showCases[cacheKey] : true;
                  const isBuyingThis = isBuyingMap[cacheKey] || false;
                  const isSel = isSelected(listing);
                  const wearCondition = getWearCondition(listing.wear);
                  const wearOpacity = getWearOpacity(wearCondition);
                  const isStandardFoil = listing.foil === 'Standard';
                  const isPrizeFoil = listing.foil === 'Prize';
                  const foilClass = isStandardFoil ? 'foil-standard' : isPrizeFoil ? 'foil-prize' : '';
                  const containerWidth = 220;
                  const containerHeight = 320;

                  return (
                    <div 
                      key={cacheKey} 
                      className={`group relative rounded-lg shadow-lg cursor-pointer transition-all duration-300 overflow-hidden w-80 mx-0 -ml-6 sm:mx-auto h-[30.375rem] ${multiMode && isSel ? 'scale-105' : ''}`} 
                      onClick={(e) => {
                        if (multiMode) {
                          toggleSelect(listing);
                        } else {
                          if (e.target.closest('.label-container')) return;
                          setShowCases(prev => ({ ...prev, [cacheKey]: !showThisCase }));
                        }
                      }}
                      onMouseLeave={() => handleMouseLeave(cacheKey)}
                    >
                      {/* Immagine NFT + Wear + Foil: z-10, posizionata nel case */}
                      <div 
                        className={`absolute top-[139px] left-1/2 transform -translate-x-1/2 overflow-hidden z-10 transition-transform duration-300 group-hover:scale-95 relative rounded-lg ${foilClass}`}
                        style={{ width: `${containerWidth}px`, height: `${containerHeight}px` }}
                      >
                        <img 
                          src={listing.imageUrl} 
                          alt={listing.name} 
                          className="w-full h-full object-cover" 
                        />

                        {/* Overlay wear */}
<div 
  className={`absolute inset-0 z-20 pointer-events-none ${wearOpacity} mix-blend-multiply grayscale brightness-75 sepia contrast-110`}
  style={{ backgroundImage: 'url(/wear-overlay.png)', backgroundSize: 'cover' }} 
/>

                    {/* Foil effect: z-25 - CSS esatto da InventoryContent.js per rainbow/honeycomb shimmer */}
                    {(isStandardFoil || isPrizeFoil) && (
                      <>
                        <style jsx global>{`
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
                          @keyframes rainbowShimmer {
                            0% {
                              background-position: 0% 50%;
                            }
                            100% {
                              background-position: 400% 50%;
                            }
                          }
                        `}</style>
                        <div className="foil-effect absolute inset-0 z-30 pointer-events-none overflow-hidden" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                          <div className={`shimmer ${foilClass}`} />
                        </div>
                      </>
                    )}
                      </div>

                      {/* Case PNG: z-30, conditional, semi-transparent if selected in multi */}
                      <div className={`absolute inset-0 z-30 ${showThisCase ? (multiMode && isSel ? 'opacity-40 scale-100' : 'opacity-100 scale-100') : 'opacity-0 scale-95'} transform translate-y-[24px] translate-x-[5px]`} 
                           style={{ backgroundImage: 'url(/casetemp.png)', backgroundSize: '96% 96%', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', transition: 'opacity 0.3s ease, transform 0.3s ease' }} />

                      {/* Tasto Buy sovrapposto (bottom-right, z-50, solo PNG grande, trasparente senza alone) - solo single mode */}
                      {!multiMode && isConnected && showThisCase && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); // Stop label/eject click
                            handleBuy(listing);
                          }}
                          className="absolute bottom-2 right-2 z-50 p-0 bg-transparent border-none transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={listingsLoading || isConnecting || isBuyingThis}
                          title="Buy this card"
                        >
                          <img src="/buy.png" alt="Buy" className="w-22 h-20 transition-all duration-200" />
                        </button>
                      )}

                      {/* Etichetta: z-40 con zoom - Usa wearCondition locale */}
                      <div 
                        className={`absolute top-[81px] left-1/2 transform -translate-x-1/2 translate-x-[-96px] w-[192px] h-[52px] z-40 ${showThisCase ? 'opacity-100' : 'opacity-0'} transition-all duration-200 cursor-pointer label-container`}
                        style={{ transition: 'transform 0.2s ease, opacity 0.3s ease' }}
                        onClick={(e) => { e.stopPropagation(); handleLabelClick(cacheKey); }}
                      >
                        <div 
                          className={`w-full h-full bg-white p-0.5 text-[7px] leading-tight flex flex-col justify-center text-black overflow-hidden pt-[3px] relative z-10 ${isZoomed ? 'scale-150 origin-center shadow-lg' : ''}`}
                        >
                          <div className="flex justify-center items-center mb-0.5 text-left">
                            <span className="font-bold truncate w-full">{listing.name} #{listing.tokenId}</span>
                          </div>
                          <div className="flex justify-start items-center text-[7px] min-w-0 pl-[4px] mb-0.5">
                            <span className="font-mono" dangerouslySetInnerHTML={{ __html: getDisplayPrice(listing.price, listing.isEth, listing.currency || listing.tokenAddress, listing.tokenSymbol, listing.pricePerPackUsd, ethUsdPrice) }} />
                          </div>
                          <div className="flex justify-center items-center space-x-1 text-[7px] min-w-0 pl-[4px] mb-0.5">
                            <span className="flex-1"><span className="font-bold">R:</span> {getRarityName(listing.rarity)}</span>
                            <span className="flex-1"><span className="font-bold">W:</span> {wearCondition}</span>
                            <span className="flex-1"><span className="font-bold">F:</span> {listing.foil === 'Normal' ? 'None' : listing.foil || 'N/A'}</span>
                          </div>
                          <div className="flex justify-center items-center mb-0.5 text-left">
                            <span 
                              className="w-full block cursor-pointer hover:underline text-[7px] break-all" 
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(listing.collection); }}
                            ><span className="font-bold">D:</span> {listing.collection}</span>
                          </div>
                          <div className="flex justify-center items-center text-left">
                            <span 
                              className="w-full block cursor-pointer hover:underline text-[7px] break-all" 
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(listing.tokenAddress); }}
                            ><span className="font-bold">T:</span> {listing.tokenAddress}</span>
                          </div>
                        </div>
                        {/* Cornice label su zoom */}
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
                })
              ) : (
                <p className="text-white text-center col-span-full">No cards listed atm.</p>
              )}
            </div>
            {/* Pulsanti paginazione */}
      {filteredListings.length > itemsPerPage && (
        <div className="flex justify-center items-center space-x-4 mt-8 w-full">
          <button
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="bg-transparent border-none p-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-110 transition-transform"
          >
            <img src="/previous.png" alt="Previous" className="w-30 h-20" />
          </button>
          <button
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredListings.length / itemsPerPage)))}
            disabled={currentPage === Math.ceil(filteredListings.length / itemsPerPage)}
            className="bg-transparent border-none p-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-110 transition-transform"
          >
            <img src="/next.png" alt="Next" className="w-30 h-20" />
          </button>
        </div>
      )}
          </div>
        )}
      </main>
    </>
  );
}
