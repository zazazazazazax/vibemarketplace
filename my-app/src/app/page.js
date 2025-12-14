'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useSignTypedData, useBalance, useDisconnect, useChainId, useWriteContract, useReadContract, useConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { http } from 'viem';
import { useWalletSignature } from './hooks/useWalletSignature';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { ethers } from 'ethers';
import { readContract, writeContract, waitForTransaction } from 'wagmi/actions';
import { useQuery } from '@tanstack/react-query';
import { useFarcasterMiniApp } from './hooks/useFarcasterMiniApp';

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

// ABI estesa per getListingDetails + buyListing
const marketplaceABI = [
  {
    "inputs": [
      {"name": "_collection", "type": "address"},
      {"name": "tokenId", "type": "uint256"},
      {"name": "seller", "type": "address"}
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
      {"name": "seller", "type": "address"}
    ],
    "name": "buyListing",
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
    "outputs": [{"name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// Hook custom per latest listing – esposto setter per update manuali
function useLatestListing() {
  const [latestListing, setLatestListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchLatest() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/listings?endpoint=latest');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (data.error) {
          setError(data.error);
          return;
        }

        setLatestListing(data);
      } catch (err) {
        console.error('Fetch latest listing error:', err);
        setError('Error fetching data. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    }

    fetchLatest();
  }, []);

  return { latestListing, setLatestListing, loading, error };
}

export default function Home() {
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
  const { authenticated, connectWallet, navigateTo } = useFarcasterMiniApp();

  const { latestListing, setLatestListing, loading: listingLoading, error: listingError } = useLatestListing(); 

// NUOVO: Controllo owner vs seller per stale listings
useEffect(() => {
  async function checkOwnerValidity() {
    if (!isConnected || !latestListing || listingLoading || !config) return;

    try {
      const collection = latestListing.collection.toLowerCase();
      const tokenId = BigInt(latestListing.tokenId);
      const currentOwner = await readContract(config, {
        address: collection,
        abi: erc721ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      });

      if (currentOwner.toLowerCase() !== latestListing.seller.toLowerCase()) {
        console.log('Stale listing detected: owner changed, removing...');
        
        // Rimuovi dal backend
        const cacheKey = `${latestListing.tokenId}-${collection}-${latestListing.seller.toLowerCase()}`;
        const removeRes = await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'remove',
            items: [{ key: cacheKey }],
            walletAddress: walletAddress.toLowerCase()
          })
        });
        if (!removeRes.ok) {
          const removeErr = await removeRes.json();
          console.error('Remove stale API failed:', removeErr);
        } else {
          console.log('Stale listing removed from backend');
        }

        // Aggiorna UI: resetta latest e fetcha next
        setLatestListing(null);
        const nextResponse = await fetch('/api/listings?endpoint=latest');
        const nextData = await nextResponse.json();
        if (!nextData.error) {
          setLatestListing(nextData);
        }
      }
    } catch (err) {
      console.error('Owner check error:', err);
      // Non fallire: ignora se errore (es. NFT non esistente)
    }
  }

  checkOwnerValidity();
}, [latestListing, isConnected, listingLoading, config, walletAddress]);  // Dipendenze: trigger su latestListing change

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

  // Stati aggiuntivi
  const [zoomedLabel, setZoomedLabel] = useState(false);
  const [showCase, setShowCase] = useState(true); // Default: in case
  const [viewMode, setViewMode] = useState('connect'); // 'connect', 'latest', 'faq', 'dev'

// NUOVO: useEffect per auto-signature post-connect in Mini App (opzionale, integra con tuo hook)
  useEffect(() => {
    if (authenticated && isConnected && !hasSigned && !isSigning) {
      handleSignature();  // Triggera signature solo se in Mini App e connesso
    }
  }, [authenticated, isConnected, hasSigned, isSigning, handleSignature]);

  // useEffect per default latest post-connect
  useEffect(() => {
    if (isConnected && viewMode === 'connect') {
      setViewMode('latest');
    }
  }, [isConnected]);

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
      case 'Mint': return 'opacity-5';
      case 'Lightly p.': return 'opacity-15';
      case 'Moderately p.': return 'opacity-30';
      case 'Heavily p.': return 'opacity-50';
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

  // Handle label click (zoom)
  const handleLabelClick = (cacheKey) => {
    setZoomedLabel(prev => !prev); // Toggle zoom (single card, cacheKey=latest.collection + tokenId)
  };

  // Nuova funzione per eject/retract case
  const handleEjectClick = (e) => {
    if (e.target.closest('.label-container')) return; // Skip se click su label
    setShowCase(prev => !prev);
  };

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

  // NUOVO: Handler per buy latest listing (standalone writeContract + waitForTransaction, matching InventoryContent)
  const [isBuying, setIsBuying] = useState(false); // Per disable button
  const oldListingRef = useRef(null); // Per rollback non-stale
  useEffect(() => { if (latestListing) oldListingRef.current = latestListing; }, [latestListing]);

  const handleBuyLatest = useCallback(async () => {
    console.log('handleBuyLatest: chainId =', chainId);

    if (!walletAddress || !latestListing || !chainId || chainId !== 8453 || isBuying) {
      if (!chainId || chainId !== 8453) setError('Switch to Base chain (ID: 8453)');
      if (!walletAddress) openConnectModal();
      return;
    }

    setIsBuying(true); // Disable button
    const collection = latestListing.collection.toLowerCase();
    const tokenId = BigInt(latestListing.tokenId);
    const cacheKey = `${latestListing.tokenId}-${collection.toLowerCase()}-${latestListing.seller.toLowerCase()}`;

    try {
      // Get details pre-buy
      const [price, isEth, currency] = await readContract(config, {
        address: CONTRACT_ADDRESS,
        abi: marketplaceABI,
        functionName: 'getListingDetails',
        args: [collection, tokenId, latestListing.seller],
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
          setIsBuying(false);
          return;
        }
        console.log('Token balance sufficient');
      }

      let approveResult = null;
      if (!isEth && currency !== zeroAddress) {
        // Check allowance
        const allowance = await readContract(config, {
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
            await new Promise(resolve => setTimeout(resolve, 400));
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
        args: [collection, tokenId, latestListing.seller],
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
        } catch (mineErr) {
          const mineErrorStr = (mineErr.message || mineErr.toString() || '').toLowerCase();
          if (mineErrorStr.includes('bigint') || mineErrorStr.includes('undefined')) {
            console.warn('Ignored wait BigInt error (proceeding to verify)');
          } else {
            console.warn('waitForTransaction error (possible revert):', mineErr.message);
            // Proceed to verify anyway
          }
        }
      } else {
        console.log('No hash (bug), delaying 8s for broadcast/mine...');
        await new Promise(resolve => setTimeout(resolve, 8000)); // Delay per coprire conferma + mine
      }

      // Optimistic remove post-mine/delay
      setLatestListing(null);
      console.debug('Optimistic remove latest for buy (post-mine/delay)');

      // Verify post-mine/delay (no retry, catch = success)
      try {
        console.log('Verifying on-chain post-delay/mine...');
        await readContract(config, {
          address: CONTRACT_ADDRESS,
          abi: marketplaceABI,
          functionName: 'getListingDetails',
          args: [collection, tokenId, latestListing.seller],
        });
        // Non revert = still listed (fail)
        console.warn('Verify failed post-delay – listing still active (TX reverted)');
        setLatestListing(oldListingRef.current);
        alert('Buy fallito: TX reverted on-chain. Riprova.');
      } catch (verifyErr) {
        // Revert = success (delist happened)
        console.log('Verify success post-delay – listing removed! Error:', verifyErr.message);
        // API remove per sync (matching InventoryContent post-delist)
        try {
          const removeRes = await fetch('/api/listings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'remove',
              items: [{ key: cacheKey.toLowerCase() }],
              walletAddress: walletAddress.toLowerCase()
            })
          });
          if (!removeRes.ok) {
            const removeErr = await removeRes.json();
            console.error('Remove API failed:', removeErr);
          } else {
            console.log('Remove API success');
          }
        } catch (removeErr) {
          console.error('Remove fetch error:', removeErr);
        }
        // Fetch next latest (refresh matching post-listing in InventoryContent)
        try {
          const response = await fetch('/api/listings?endpoint=latest');
          const newData = await response.json();
          console.log('Next latest fetch:', newData);
          if (!newData.error) {
            setLatestListing(newData);
          } else {
            console.warn('Next latest error:', newData.error);
          }
        } catch (fetchErr) {
          console.error('Next latest fetch error:', fetchErr);
        }
      }

    } catch (err) {
      console.error('Buy error:', err);
      const errorStr = (err.message || err.toString() || '').toLowerCase();
      if (errorStr.includes('user rejected') || errorStr.includes('cancelled')) {
        setIsBuying(false);
        return;
      }
      let userMessage = 'Buy fallito: ';
      if (errorStr.includes('32603') || errorStr.includes('internal json-rpc')) {
        userMessage += 'Wallet/RPC error (e.g., gas too low). Try increasing gas in MetaMask.';
      } else if (errorStr.includes('insufficient funds') || errorStr.includes('balance')) {
        userMessage += 'Insufficient balance (ETH for gas or tokens).';
      } else if (errorStr.includes('execution reverted') || errorStr.includes('revert')) {
        userMessage += 'Transaction reverted by contract (e.g., invalid listing).';
      } else if (errorStr.includes('bigint') || errorStr.includes('undefined')) {
        console.warn('Ignored BigInt error in buy (proceeding to delay/verify)');
      } else {
        userMessage += err.message || 'Unknown error – check console.';
        alert(userMessage);
      }
      setIsBuying(false);
    }
  }, [walletAddress, latestListing, chainId, readContract, config, isBuying, setLatestListing]);

  const disconnectWallet = () => {
    disconnect();
    localStorage.clear();
    resetSignature();
    setShowHeader(false);
  };

  return (
    <>
      <div className="fixed top-0 left-8 w-full h-8 sm:h-16 md:h-16 z-[5] bg-no-repeat bg-center bg-cover" style={{ backgroundImage: 'url(/band.png)' }} />
      <Link href="/" className="fixed top-[-13px] left-[-14px] z-50">
        <img src="/pdb.png" alt="PDB Logo" className="w-40 h-28 sm:w-48 sm:h-32 md:w-60 md:h-40" />
      </Link>
      <div className="fixed top-0 left-0 w-36 sm:w-44 md:w-60 flex flex-col pt-36 sm:pt-40 md:pt-52 pb-4 z-40 h-screen bg-transparent overflow-y-auto">
        <div className="flex flex-col space-y-0">
          <Link href="/" className="self-start -ml-2 sm:-ml-3 md:-ml-4">
            <img src="/home.png" alt="Home" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 scale-100 brightness-100" />
          </Link>
          <nav className="flex flex-col space-y-0 text-white text-sm mt-0">
            <Link href="/inventory" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/mybinder.png" alt="My Binder" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/binders" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/binders.png" alt="Binders" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/dex" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/dex.png" alt="Dex" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
          </nav>
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
<main 
  suppressHydrationWarning 
  className="flex min-h-screen flex-col items-center p-4 sm:p-6 md:p-8 pt-24 sm:pt-28 md:pt-28 bg-[#00893A] text-white ml-28 sm:ml-36 md:ml-52 relative z-0 justify-start pb-40" 
>
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
  ) : (
    <div key={isSigning ? 'signing' : 'connected'} className="flex flex-col items-center justify-center w-full max-w-md">
      {isSigning ? (
        <div className="flex flex-col items-center space-y-2">
          <img src="/loading.png" alt="Loading" className="w-40 h-30 sm:w-48 sm:h-36 md:w-56 md:h-40" />
          {signatureError && <p className="text-red-500 mt-2">{error}</p>}
        </div>
      ) : null}
      {/* 3 Tasti row (sempre visibili post-connect) */}
      <div className="flex space-x-4 mb-8 z-10">
        <button 
          onClick={() => setViewMode('latest')} 
          className="p-0 bg-transparent border-none transition-all duration-200 hover:scale-110"
        >
          <img 
            src="/latest.png" 
            alt="Latest" 
            className={`w-20 h-16 transition-all duration-200 ${viewMode === 'latest' ? 'brightness-125 scale-105' : 'brightness-75'}`} 
          />
        </button>
        <button 
          onClick={() => setViewMode('faq')} 
          className="p-0 bg-transparent border-none transition-all duration-200 hover:scale-110"
        >
          <img 
            src="/faq.png" 
            alt="FAQ" 
            className={`w-16 h-16 transition-all duration-200 ${viewMode === 'faq' ? 'brightness-125 scale-105' : 'brightness-75'}`} 
          />
        </button>
        <button 
          onClick={() => setViewMode('dev')} 
          className="p-0 bg-transparent border-none transition-all duration-200 hover:scale-110"
        >
          <img 
            src="/dev.png" 
            alt="Dev" 
            className={`w-16 h-16 transition-all duration-200 ${viewMode === 'dev' ? 'brightness-125 scale-105' : 'brightness-75'}`} 
          />
        </button>
      </div>

      {/* Conditional content based on viewMode */}
      {viewMode === 'latest' ? (
        <>
          {listingLoading ? (
            <div className="flex flex-col items-center space-y-2">
              <img src="/loading.png" alt="Loading Latest Card" className="w-40 h-30 sm:w-48 sm:h-36 md:w-56 md:h-40 animate-spin" />
            </div>
          ) : listingError ? (
            <p className="text-red-500 text-center">Error: {listingError}</p>
          ) : latestListing ? (
            (() => {
              // Calcoli locali: solo qui, dopo tutte le funzioni, e solo se latestListing esiste
              const wearCondition = getWearCondition(latestListing.wear);
              const wearOpacity = getWearOpacity(wearCondition);
              const isStandardFoil = latestListing.foil === 'Standard';
              const isPrizeFoil = latestListing.foil === 'Prize';
              const foilClass = isStandardFoil ? 'foil-standard' : isPrizeFoil ? 'foil-prize' : '';
              const containerWidth = 220;
              const containerHeight = 320;

              // Debug log: ora corretto, solo dopo dati reali
              console.log('Latest Listing Debug (inline):', {
                foil: latestListing.foil,
                isStandardFoil,
                isPrizeFoil,
                foilClass,
                wear: latestListing.wear,
                wearCondition,
                wearOpacity
              });

              return (
                <div className="group relative rounded-lg shadow-lg cursor-pointer transition-all duration-300 overflow-hidden w-80 mx-0 -ml-2 sm:mx-auto h-[30.375rem]" onClick={handleEjectClick}>
                  {/* Immagine card + Wear + Foil: z-10 - Copia esatta da InventoryContent */}
                  <div 
                    className={`absolute top-[139px] left-1/2 transform -translate-x-1/2 overflow-hidden z-10 transition-transform duration-300 group-hover:scale-95 relative rounded-lg ${foilClass}`}
                    style={{ width: `${containerWidth}px`, height: `${containerHeight}px` }}
                  >
                    <img
                      src={latestListing.imageUrl}
                      alt={`Ultima carta: #${latestListing.tokenId}`}
                      className="relative z-10 image-rendering-pixelated block"
                      style={{
                        width: '100% !important',
                        height: '100% !important',
                        objectFit: 'fill',
                        objectPosition: 'center center'
                      }}
                      onError={(e) => { e.target.src = 'https://via.placeholder.com/300x400?text=NFT+Card'; }}
                      onLoad={() => console.log('Image loaded for latest card')}
                    />
                    {/* Wear overlay: z-20, copia esatta da InventoryContent */}
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

                  {/* Case PNG: z-30, conditional */}
                  <div className={`absolute inset-0 z-30 ${showCase ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} transform translate-y-[24px] translate-x-[5px]`} 
                       style={{ backgroundImage: 'url(/casetemp.png)', backgroundSize: '96% 96%', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', transition: 'opacity 0.3s ease, transform 0.3s ease' }} />

                  {/* Tasto Buy sovrapposto (bottom-right, z-50, solo PNG grande, trasparente senza alone) */}
                  {isConnected && showCase && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // Stop label/eject click
                        handleBuyLatest();
                      }}
                      className="absolute bottom-2 right-2 z-50 p-0 bg-transparent border-none transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={listingLoading || isConnecting || isBuying}
                      title="Buy this card"
                    >
                      <img src="/buy.png" alt="Buy" className="w-22 h-20 transition-all duration-200" />
                    </button>
                  )}

                  {/* Etichetta: z-40 con zoom - Usa wearCondition locale */}
                  <div 
                    className={`absolute top-[81px] left-1/2 transform -translate-x-1/2 translate-x-[-96px] w-[192px] h-[52px] z-40 ${showCase ? 'opacity-100' : 'opacity-0'} transition-all duration-200 cursor-pointer label-container`}
                    style={{ transition: 'transform 0.2s ease, opacity 0.3s ease' }}
                    onClick={handleLabelClick}
                  >
                    <div 
                      className={`w-full h-full bg-white p-0.5 text-[7px] leading-tight flex flex-col justify-center text-black overflow-hidden pt-[3px] relative z-10 ${zoomedLabel ? 'scale-150 origin-center shadow-lg' : ''}`}
                    >
                      <div className="flex justify-center items-center mb-0.5 text-left">
                        <span className="font-bold truncate w-full">{latestListing.name} #{latestListing.tokenId}</span>
                      </div>
                      <div className="flex justify-start items-center text-[7px] min-w-0 pl-[4px] mb-0.5">
                        <span className="font-mono" dangerouslySetInnerHTML={{ __html: getDisplayPrice(latestListing.price, latestListing.isEth, latestListing.currency || latestListing.tokenAddress, latestListing.tokenSymbol, latestListing.pricePerPackUsd, ethUsdPrice) }} />
                      </div>
                      <div className="flex justify-center items-center space-x-1 text-[7px] min-w-0 pl-[4px] mb-0.5">
                        <span className="flex-1"><span className="font-bold">R:</span> {getRarityName(latestListing.rarity)}</span>
                        <span className="flex-1"><span className="font-bold">W:</span> {wearCondition}</span>
                        <span className="flex-1"><span className="font-bold">F:</span> {latestListing.foil === 'Normal' ? 'None' : latestListing.foil || 'N/A'}</span>
                      </div>
                      <div className="flex justify-center items-center mb-0.5 text-left">
                        <span 
                          className="w-full block cursor-pointer hover:underline text-[7px] break-all" 
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(latestListing.collection); }}
                        ><span className="font-bold">D:</span> {latestListing.collection}</span>
                      </div>
                      <div className="flex justify-center items-center text-left">
                        <span 
                          className="w-full block cursor-pointer hover:underline text-[7px] break-all" 
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(latestListing.tokenAddress); }}
                        ><span className="font-bold">T:</span> {latestListing.tokenAddress}</span>
                      </div>
                    </div>
                    {/* Cornice label su zoom */}
                    {zoomedLabel && (
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
            })()
          ) : (
            <p className="text-white text-center">No cards listed atm.</p>
          )}
        </>
) : viewMode === 'faq' ? (
  <div className="flex flex-col items-center space-y-4">
    <img src="/welcome.png" alt="Welcome" className="w-80 h-auto rounded-lg" />
    <div className="max-w-2xl text-white text-base leading-relaxed text-center px-4">
      <h2 className="text-xl font-bold mb-2">What's pdb?</h2>
      <p className="mb-4">
        Pdb (poorly drawn binders) is a marketplace** for ltcs (liquid trading cards) launched on vibe.market (on base network). Find and buy your favourite/missing cards from any collection or list and sell duples from your own!
      </p>
      
      <h2 className="text-xl font-bold mb-2">How does it work?</h2>
      <ul className="text-left mb-4 space-y-1 list-disc list-inside">
        <li>Visit 'My binder' to access your inventory!</li>
        <li>List* your cards for eth or tokens with a fixed price based on (rarity x wear x foil)+42% (wear goes from x1 to x1.8 , standard foil x2 , prize foil x4)</li>
        <li>Delist your cards anytime you want (keep in mind: if you list in eth, collection price might surge leaving your cards listed for cheap!)</li>
        <li>Visit 'Binders' to explore listed cards (you can filter by collection and owner)</li>
        <li>Buy* cards with eth or related collection token!</li>
        <li>Visit 'Dex' to trade tokens from any collection against eth!</li>
      </ul>
      
      <h2 className="text-xl font-bold mb-2">Is it safe?</h2>
      <p className="mb-4">
        The contract managing the marketplace is AI generated w/o audits. Because of this, the minimum i can do is making it open source (you can find it in the 'dev' section), feel free to query any AI and use it to create your own vibemarketplace!
        This is my first dapp created so be kind, for any other question or help you can find me on farcaster (@zazza) / X (@zazzazzaza)
      </p>
      
      <p className="font-bold text-base">
        **Disclaimer:
      </p>
      <p className="text-sm mb-2">
        This platform enables the trading of NFTs. All transactions are final and at your own risk. We do not guarantee the authenticity, value, or legality of any NFTs. Conduct your own due diligence before participating.
      </p>
      <p className="text-sm italic">
        * 1,4% fee will be included within the listing price for any successful purchase
      </p>
    </div>
  </div>
) : viewMode === 'dev' ? (
  <div className="w-full flex items-center justify-center px-4">
    <div className="relative w-full max-w-none bg-center bg-no-repeat" 
         style={{ 
           width: '95vw', 
           height: '80vh', 
           backgroundImage: 'url(/textbg2.png)' 
         }}>
      <div className="absolute inset-0 z-10 p-4 overflow-y-auto">
        <div className="text-black text-sm leading-relaxed">
          <h2 className="text-lg font-bold mb-2">VibemarketplaceV4_1 (0x34682Df3fC35079EFe78fF37008856aB090e03e1)</h2>
          <pre className="text-black font-mono text-xs leading-relaxed">
          {`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IBoosterDrop {
    struct Rarity {
        uint8 rarity;
        uint256 randomValue;
        bytes32 tokenSpecificRandomness;
    }
    function getTokenRarity(uint256 tokenId) external view returns (Rarity memory rarityInfo);
}

interface IBoosterTokenV2 {
    function getTokenSellQuote(uint256 tokenAmount) external view returns (uint256 ethReceived);
}

contract VibeMarketplaceV4_1 is ReentrancyGuard, Ownable {
    address public feeWallet;

    struct Listing {
        uint256 tokenId;
        address collection;
        address boosterToken;
        address seller;
        uint256 price;
        bool isEth;
        bool active;
    }

    struct BatchListingItem {
        address collection;
        uint256 tokenId;
        uint256 price;
        address boosterToken; // Per-item, obbligatorio se isEth=false
    }

    struct BatchItem {
        address collection;
        uint256 tokenId;
        address seller; // NUOVO: Per supportare multi-seller in batch
    }

    mapping(bytes32 => Listing) public listings;
    mapping(bytes32 => address[]) private _activeSellersForToken;  // Key: keccak256(collection + tokenId)

    uint256 public constant FEE_BPS = 140; // 1.4%
    uint256 public constant MAX_BATCH_SIZE = 20; // Gas safety

    event ListingCreated(uint256 indexed tokenId, address indexed collection, address indexed seller, uint256 price, bool isEth);
    event ListingBought(uint256 indexed tokenId, address indexed collection, address indexed buyer, address seller, uint256 price, bool isEth);
    event ListingDelisted(uint256 indexed tokenId, address indexed collection, address indexed seller);

    constructor(address _feeWallet) Ownable(msg.sender) {
        feeWallet = _feeWallet;
    }

    function _getListingKey(address _collection, uint256 tokenId, address seller) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_collection, tokenId, seller));
    }

    function _getTokenKey(address _collection, uint256 tokenId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_collection, tokenId));
    }

    function createListing(
        address _collection, 
        address _boosterToken, 
        uint256 tokenId, 
        uint256 _price, 
        bool _isEth
    ) public {
        require(_price > 0, "Price must be greater than 0");

        IBoosterDrop collectionDrop = IBoosterDrop(_collection);
        IBoosterDrop.Rarity memory r = collectionDrop.getTokenRarity(tokenId);
        require(r.rarity > 0, "Only opened cards");

        IERC721 collectionNFT = IERC721(_collection);
        require(collectionNFT.ownerOf(tokenId) == msg.sender, "Not owner");
        require(collectionNFT.isApprovedForAll(msg.sender, address(this)), "Must approve marketplace for NFT");

        bytes32 key = _getListingKey(_collection, tokenId, msg.sender);  // AGGIUNTO: + msg.sender
        require(!listings[key].active, "Already listed by you");  // Cambiato messaggio

        if (!_isEth) {
            require(_boosterToken != address(0), "Invalid boosterToken");
            try IBoosterTokenV2(_boosterToken).getTokenSellQuote(1000) returns (uint256 quote) {
                require(quote >= 0, "Invalid boosterToken quote");
            } catch {
                revert("Invalid boosterToken contract");
            }
        }

        bytes32 tokenKey = _getTokenKey(_collection, tokenId);
        _activeSellersForToken[tokenKey].push(msg.sender);  // Track seller per token

        listings[key] = Listing({
            tokenId: tokenId,
            collection: _collection,
            boosterToken: _boosterToken,
            seller: msg.sender,
            price: _price,
            isEth: _isEth,
            active: true
        });
        emit ListingCreated(tokenId, _collection, msg.sender, _price, _isEth);
    }

    function createListingBatch(
        bool _isEth,
        BatchListingItem[] calldata items
    ) external {
        require(items.length > 0 && items.length <= MAX_BATCH_SIZE, "Invalid batch size");
        for (uint i = 0; i < items.length; i++) {
            BatchListingItem calldata item = items[i];
            require(item.price > 0, "Price must be greater than 0");
            if (!_isEth) {
                require(item.boosterToken != address(0), "Invalid boosterToken for item");
            }
            createListing(item.collection, item.boosterToken, item.tokenId, item.price, _isEth);
        }
    }

    function buyListing(address _collection, uint256 tokenId, address seller) external payable nonReentrant {
        bytes32 key = _getListingKey(_collection, tokenId, seller);  // AGGIUNTO: + seller
        Listing storage listing = listings[key];
        require(listing.active, "Not active or wrong seller");

        _processPayment(listing, msg.sender);

        IERC721(listing.collection).safeTransferFrom(listing.seller, msg.sender, listing.tokenId);
        listing.active = false;

        // Cleanup activeSellers
        bytes32 tokenKey = _getTokenKey(_collection, tokenId);
        address[] storage sellers = _activeSellersForToken[tokenKey];
        for (uint i = 0; i < sellers.length; i++) {
            if (sellers[i] == seller) {
                sellers[i] = sellers[sellers.length - 1];
                sellers.pop();
                break;
            }
        }

        emit ListingBought(tokenId, listing.collection, msg.sender, listing.seller, listing.price, listing.isEth);
    }

    function batchBuy(BatchItem[] calldata items) external payable nonReentrant {
        require(items.length > 0 && items.length <= MAX_BATCH_SIZE, "Invalid batch size");

        bool isEth = false;
        uint256 totalPrice = 0;

        // First pass: validate and compute total
        for (uint i = 0; i < items.length; i++) {
            BatchItem calldata item = items[i];
            bytes32 key = _getListingKey(item.collection, item.tokenId, item.seller);
            Listing storage listing = listings[key];
            require(listing.active, "Inactive listing");
            if (i == 0) {
                isEth = listing.isEth;
            } else {
                require(listing.isEth == isEth, "Mixed currencies not supported");
            }
            totalPrice += listing.price;
        }

        if (isEth) {
            require(msg.value >= totalPrice, "Insufficient ETH");
            for (uint i = 0; i < items.length; i++) {
                _processBuy(items[i].collection, items[i].tokenId, items[i].seller, msg.sender, isEth);
            }
            if (msg.value > totalPrice) {
                payable(msg.sender).transfer(msg.value - totalPrice);
            }
        } else {
            for (uint i = 0; i < items.length; i++) {
                _processBuy(items[i].collection, items[i].tokenId, items[i].seller, msg.sender, isEth);
            }
        }
    }

    function _processBuy(address _collection, uint256 tokenId, address seller, address buyer, bool isEth) internal {
        bytes32 key = _getListingKey(_collection, tokenId, seller);
        Listing storage listing = listings[key];

        _processPayment(listing, buyer);

        IERC721(listing.collection).safeTransferFrom(listing.seller, buyer, listing.tokenId);
        listing.active = false;

        // Cleanup activeSellers
        bytes32 tokenKey = _getTokenKey(_collection, tokenId);
        address[] storage sellers = _activeSellersForToken[tokenKey];
        for (uint i = 0; i < sellers.length; i++) {
            if (sellers[i] == seller) {
                sellers[i] = sellers[sellers.length - 1];
                sellers.pop();
                break;
            }
        }

        emit ListingBought(tokenId, listing.collection, buyer, listing.seller, listing.price, listing.isEth);
    }

    function _processPayment(Listing storage listing, address buyer) internal {
        uint256 fee = (listing.price * FEE_BPS) / 10000;
        uint256 sellerAmount = listing.price - fee;
        if (listing.isEth) {
            payable(feeWallet).transfer(fee);
            payable(listing.seller).transfer(sellerAmount);
        } else {
            IERC20(listing.boosterToken).transferFrom(buyer, feeWallet, fee);
            IERC20(listing.boosterToken).transferFrom(buyer, listing.seller, sellerAmount);
        }
    }

    function delist(address _collection, uint256 tokenId, address seller) external {
        bytes32 key = _getListingKey(_collection, tokenId, seller);
        Listing storage listing = listings[key];
        require(listing.active, "Not active");
        require(listing.seller == msg.sender, "Not seller");  
        listing.active = false;

        // Cleanup activeSellers
        bytes32 tokenKey = _getTokenKey(_collection, tokenId);
        address[] storage sellers = _activeSellersForToken[tokenKey];
        for (uint i = 0; i < sellers.length; i++) {
            if (sellers[i] == seller) {
                sellers[i] = sellers[sellers.length - 1];
                sellers.pop();
                break;
            }
        }

        emit ListingDelisted(tokenId, _collection, msg.sender);
    }

    function delistBatch(BatchItem[] calldata items) external {
        require(items.length > 0 && items.length <= MAX_BATCH_SIZE, "Invalid batch size");
        for (uint i = 0; i < items.length; i++) {
            BatchItem calldata item = items[i];
            bytes32 key = _getListingKey(item.collection, item.tokenId, item.seller);
            Listing storage listing = listings[key];
            require(listing.active, "Not active");
            require(listing.seller == msg.sender, "Not seller");
            listing.active = false;

            // Cleanup activeSellers
            bytes32 tokenKey = _getTokenKey(item.collection, item.tokenId);
            address[] storage sellers = _activeSellersForToken[tokenKey];
            for (uint j = 0; j < sellers.length; j++) {
                if (sellers[j] == item.seller) {
                    sellers[j] = sellers[sellers.length - 1];
                    sellers.pop();
                    break;
                }
            }

            emit ListingDelisted(listing.tokenId, item.collection, msg.sender);
        }
    }

    function getListingDetails(address _collection, uint256 tokenId, address seller) external view returns (
        uint256 listingPrice,
        bool isEth,
        address currency
    ) {
        bytes32 key = _getListingKey(_collection, tokenId, seller);
        Listing storage listing = listings[key];
        require(listing.active, "Not listed");
        listingPrice = listing.price;
        isEth = listing.isEth;
        currency = listing.isEth ? address(0) : listing.boosterToken;
    }

    function getListingsForToken(address _collection, uint256 tokenId) external view returns (
        address[] memory sellers,
        uint256[] memory prices,
        bool[] memory isEths,
        address[] memory boosterTokens
    ) {
        bytes32 tokenKey = _getTokenKey(_collection, tokenId);
        address[] memory activeSellers = _activeSellersForToken[tokenKey];
        uint256 len = activeSellers.length;
        sellers = new address[](len);
        prices = new uint256[](len);
        isEths = new bool[](len);
        boosterTokens = new address[](len);
        for (uint i = 0; i < len; i++) {
            address seller = activeSellers[i];
            bytes32 key = _getListingKey(_collection, tokenId, seller);
            Listing storage listing = listings[key];
            sellers[i] = seller;
            prices[i] = listing.price;
            isEths[i] = listing.isEth;
            boosterTokens[i] = listing.boosterToken;
        }
    }

    function setFeeWallet(address _feeWallet) external onlyOwner {
        feeWallet = _feeWallet;
    }
}`}
</pre>
        <h3 className="text-black font-bold text-sm mt-8 mb-2">Wrapper (0xe08287F93fFC3d1d36334b12485467E2618eaf39 - mint and sell nfts for tokens in 1 tx)</h3>
        <pre className="text-black font-mono text-xs leading-relaxed">
          {`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IBoosterDropV2 {
    function mint(uint256 amount, address recipient, address referrer, address originReferrer) external payable;
    function sellAndClaimOfferBatch(uint256[] calldata tokenIds) external;
    function boosterTokenAddress() external view returns (address);
    function getMintPrice(uint256 amount) external view returns (uint256);
}

contract MintAndSellWrapper is IERC721Receiver, Ownable {
    constructor() Ownable(msg.sender) {}

    function mintAndSellWithEth(
        address target,
        uint256 amount,
        uint256 startingTokenId
    ) external payable onlyOwner {
        require(target != address(0), "Target address cannot be zero");
        require(amount > 0, "Amount must be greater than zero");
        require(startingTokenId > 0, "Starting token ID must be >0");
        IBoosterDropV2 booster = IBoosterDropV2(target);
        uint256 requiredEth = booster.getMintPrice(amount);
        require(msg.value >= requiredEth, "Insufficient ETH sent for mint");
        uint256[] memory tokenIds = new uint256[](amount);
        for (uint256 i = 0; i < amount; i++) {
            tokenIds[i] = startingTokenId + i;
        }
        booster.mint{value: msg.value}(
            amount,
            address(this), // recipient
            owner(), // Referrer
            owner() // OriginReferrer
        );
        address rewardToken = booster.boosterTokenAddress();
        uint256 initialBalance = IERC20(rewardToken).balanceOf(address(this));
        booster.sellAndClaimOfferBatch(tokenIds);
        uint256 finalBalance = IERC20(rewardToken).balanceOf(address(this));
        uint256 rewardAmount = finalBalance - initialBalance;
        require(rewardAmount > 0, "No rewards received from sell");
        IERC20(rewardToken).transfer(msg.sender, rewardAmount);
        if (msg.value > requiredEth) {
            payable(msg.sender).transfer(msg.value - requiredEth);
        }
    }

    function onERC721Received(
        address, // operator
        address, // from
        uint256, // tokenId
        bytes calldata // data
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector; 
    }

    receive() external payable {}
}`}
        </pre>
      </div>
<div className="flex-1" /> 
      </div>
    </div>
  </div>
) : (
        <div className="text-center">
          <p className="text-white text-lg mb-4">Connect your wallet to start</p>
          <button onClick={openConnectModal} className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            Connect
          </button>
        </div>
      )}

      {/* Banner pdp + win (dentro il div key, sotto contenuto, su sfondo verde, scrollabile) */}
      <div className="w-full flex flex-col items-start space-y-2 mt-48 pb-14 z-0 pl-4 self-start lg:w-full lg:max-w-none lg:mx-0 lg:pl-0">
        <div className="flex flex-col space-y-2 w-full max-w-full">
          {/* Banner PDP */}
          <div className="flex flex-col items-start">
            <span className="text-left text-xs text-white font-semibold pointer-events-none -mt-3 sm:-mt-4 lg:-mt-7">Support the dev:</span>
            <a href="https://vibechain.com/market/poorly-drawn-pepes" target="_blank" rel="noopener noreferrer" className="w-fit block flex-shrink-0">
              <img src="/pdp.png" alt="Support PDP" className="w-[24rem] h-[12rem] sm:w-[48rem] sm:h-[18rem] lg:w-[140rem] lg:h-[18rem]" />
            </a>
          </div>
          {/* Win $PEPE */}
          <div className="flex flex-col items-start">
            <span className="text-left text-xs text-white font-semibold pointer-events-none -mt-2 ml-2">Win $PEPE:</span>
            <a href="https://vibechain.com/market/poorly-drawn-pepes" target="_blank" rel="noopener noreferrer" className="w-fit block flex-shrink-0">
              <img src="/win.png" alt="Win $PEPE" className="w-56 h-35 sm:w-[14rem] sm:h-50 lg:w-[100rem] lg:h-80 object-contain" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )}
</main>
    </>
  );
}
