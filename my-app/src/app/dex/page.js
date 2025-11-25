// src/app/dex/page.js (updated for further aesthetic changes: larger dropfinder, fully hidden search, larger collection img with proportions, transparent previous, buttons outside boxes, X-centered layout in boxes)
'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useTransition } from 'react';
import { useActionState } from 'react';
import { useAccount, useBalance, useDisconnect, useReadContract, useWriteContract } from 'wagmi';
import { base } from 'wagmi/chains';
import { useWalletSignature } from '../hooks/useWalletSignature';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { parseEther, formatEther, parseUnits, formatUnits } from 'viem';
import { fetchCollectionDataServer, fetchEthPriceServer } from './actions';
import { useFarcasterMiniApp } from '../hooks/useFarcasterMiniApp';

export const dynamic = 'force-dynamic';

const WRAPPER_ADDRESS = '0xe08287F93fFC3d1d36334b12485467E2618eaf39';
const REFERRER_ADDRESS = '0x5164Ae67050373dE925bf29e6808221223912cbC'; // Referrer and originReferrer for sell
const DEFAULT_CONTRACT_ADDRESS = '0x8cb5b730943b25403ccac6d5fd649bd0cbde76d8'; // Default collection on load

// Function to format token balance with k/m suffixes
const formatTokenBalance = (balance) => {
  const num = parseFloat(balance);
  if (num >= 1e6) {
    return (num / 1e6).toFixed(1) + 'm';
  } else if (num >= 1e3) {
    return (num / 1e3).toFixed(1) + 'k';
  }
  return num.toFixed(2);
};

// Function to format tokens received approximation
const formatTokensReceived = (amount) => {
  const total = amount * 100;
  if (total >= 1000) {
    return `~${(total / 1000).toFixed(0)}m`;
  } else {
    return `~${total}k`;
  }
};

// ABI snippets for contracts
const BOOSTER_DROP_ABI = [
  {
    name: 'getMintPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256', name: 'amount' }],
    outputs: [{ type: 'uint256', name: '' }],
  },
];

const BOOSTER_TOKEN_ABI = [
  {
    name: 'getTokenSellQuote',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256', name: 'tokenAmount' }],
    outputs: [{ type: 'uint256', name: '' }],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'uint256', name: 'tokensToSell' },
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'minPayoutSize' },
      { type: 'address', name: 'referrer' },
      { type: 'address', name: 'originReferrer' },
    ],
    outputs: [{ type: 'uint256', name: '' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256', name: '' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8', name: '' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string', name: '' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string', name: '' }],
  },
];

const WRAPPER_ABI = [
  {
    name: 'mintAndSellWithEth',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { type: 'address', name: 'target' },
      { type: 'uint256', name: 'amount' },
      { type: 'uint256', name: 'startingTokenId' },
    ],
    outputs: [],
  },
];

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256', name: '' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8', name: '' }],
  },
];

export default function Dex() {
  const router = useRouter();
  const { address, isConnected, isConnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const { writeContract, isPending: isWritePending, data: txData } = useWriteContract(); // Use full hook for hash
  const { openConnectModal } = useConnectModal();
  const { data: ethBalance, refetch: refetchEthBalance } = useBalance({ address });
  const { hasSigned, isSigning, error: signatureError, handleSignature, resetSignature } = useWalletSignature(address);

// NUOVO: Hook per Mini App (navigate, embedded wallet—non altera connect)
  const { navigateTo } = useFarcasterMiniApp();

  // Transition hook for server actions
  const [isTransitionPending, startTransition] = useTransition();

  // States for DEX logic
  const [contractAddress, setContractAddress] = useState(''); // Keep empty for search bar
  const [collectionData, setCollectionData] = useState(null); // { startingTokenId, name, imageUrl, symbol, tokenAddress }
  const [activeTab, setActiveTab] = useState(null); // 'buy' or 'sell'
  const [selectedAmount, setSelectedAmount] = useState(0); // For buy: packs (1,10,100,400); For sell: percentage (25,50,75,100)
  const [error, setError] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showHeader, setShowHeader] = useState(false);
  const [ethPrice, setEthPrice] = useState(0);

  // Server action state
  const [state, action, isPending] = useActionState(fetchCollectionDataServer, { error: null });

  // Server action state per ETH price
  const [ethState, ethAction, isEthPending] = useActionState(fetchEthPriceServer, { success: false, ethPrice: 0 });

  const formattedEthBalance = ethBalance ? (parseFloat(ethBalance.formatted)).toFixed(7) : '0';

  // Update collectionData and error from server action
  useEffect(() => {
    if (state.success && state.collectionData) {
      setCollectionData(state.collectionData);
      setError(null);
    } else if (state.error) {
      setError(state.error);
    }
  }, [state]);

  // Fetch ETH price via server action
  useEffect(() => {
    startTransition(() => {
      if (!isEthPending) {
        ethAction();
      }
    });
  }, []);

  // Update ethPrice from server action state
  useEffect(() => {
    if (ethState.success && ethState.ethPrice > 0) {
      setEthPrice(ethState.ethPrice);
    } else if (ethState.error) {
      console.error('ETH price fetch error:', ethState.error);
      setEthPrice(2500);
    }
  }, [ethState]);

  // Fetch default collection on initial load (keep input empty, wrap in transition)
  useEffect(() => {
    if (!isPending && !collectionData && !error) {
      startTransition(() => {
        const defaultFormData = new FormData();
        defaultFormData.append('contractAddress', DEFAULT_CONTRACT_ADDRESS);
        action(defaultFormData);
      });
    }
  }, [action, isPending, collectionData, error, startTransition]);

  // Token balance and decimals via hooks
  const { data: tokenBalanceRaw, refetch: refetchBalance } = useReadContract({
    address: collectionData?.tokenAddress,
    abi: BOOSTER_TOKEN_ABI,
    functionName: 'balanceOf',
    args: [address],
    enabled: !!collectionData?.tokenAddress && !!address,
  });

  const { data: tokenDecimalsRaw, refetch: refetchDecimals } = useReadContract({
    address: collectionData?.tokenAddress,
    abi: BOOSTER_TOKEN_ABI,
    functionName: 'decimals',
    enabled: !!collectionData?.tokenAddress,
  });

  const tokenDecimals = tokenDecimalsRaw ?? 18;
  const tokenBalance = tokenBalanceRaw ? formatUnits(tokenBalanceRaw, tokenDecimals) : '0';

  // Full balance ETH value
  const { data: fullBalanceEthRaw, refetch: refetchFullBalance } = useReadContract({
    address: collectionData?.tokenAddress,
    abi: BOOSTER_TOKEN_ABI,
    functionName: 'getTokenSellQuote',
    args: [tokenBalanceRaw],
    enabled: !!collectionData?.tokenAddress && !!tokenBalanceRaw && !!address && parseFloat(tokenBalance) > 0,
  });

  const fullBalanceEth = fullBalanceEthRaw ? formatEther(fullBalanceEthRaw) : '0';
  const balanceUsd = ethPrice > 0 ? (parseFloat(fullBalanceEth) * ethPrice).toFixed(2) : '0';

// Mint price via hook (added query key and refetch trigger for better reactivity)
const { data: mintPriceRaw, refetch: refetchMintPrice } = useReadContract({
  address: collectionData?.address || contractAddress || DEFAULT_CONTRACT_ADDRESS, // Use collectionData.address if available, fallback to input or default
  abi: BOOSTER_DROP_ABI,
  functionName: 'getMintPrice',
  args: [BigInt(selectedAmount)],
  enabled: !!(collectionData?.address || contractAddress || DEFAULT_CONTRACT_ADDRESS) && selectedAmount > 0,
  query: { refetchOnWindowFocus: false }, // Prevent unnecessary refetches
});

const mintPrice = mintPriceRaw ? formatEther(mintPriceRaw).slice(0, 9) : '0'; // Max 6 decimals
const buyUsd = ethPrice > 0 ? (parseFloat(mintPrice) * ethPrice).toFixed(2) : '0';

// Update mint price refetch in useEffect for selection changes
useEffect(() => {
  if (selectedAmount > 0 && collectionData) {
    refetchMintPrice();
  }
}, [selectedAmount, collectionData, refetchMintPrice]);

  // Sell quote via hook
  const tokensAmountForSell = useMemo(() => {
    if (!collectionData || selectedAmount === 0 || !tokenBalanceRaw || parseFloat(tokenBalance) === 0) return 0n;
    const balanceNum = parseFloat(tokenBalance);
    const sellNum = balanceNum * (selectedAmount / 100);
    const sellBigInt = BigInt(Math.floor(sellNum * 10 ** tokenDecimals));
    return sellBigInt > 0n ? sellBigInt : 0n;
  }, [collectionData, selectedAmount, tokenBalanceRaw, tokenBalance, tokenDecimals]);

  const { data: sellQuoteRaw, refetch: refetchSellQuote } = useReadContract({
    address: collectionData?.tokenAddress,
    abi: BOOSTER_TOKEN_ABI,
    functionName: 'getTokenSellQuote',
    args: [tokensAmountForSell],
    enabled: !!collectionData?.tokenAddress && tokensAmountForSell > 0n && !!address,
  });

  const sellQuote = sellQuoteRaw ? formatEther(sellQuoteRaw).slice(0, 9) : '0'; // Max 6 decimals
  const sellUsd = ethPrice > 0 ? (parseFloat(sellQuote) * ethPrice).toFixed(2) : '0';

  // Refresh all relevant data after TX
  useEffect(() => {
    if (refreshTrigger > 0) {
      refetchBalance();
      refetchDecimals();
      refetchFullBalance();
      refetchSellQuote();
      refetchMintPrice();
      refetchEthBalance();
      console.log('All data refreshed post-TX');
    }
  }, [refreshTrigger, refetchBalance, refetchDecimals, refetchFullBalance, refetchSellQuote, refetchMintPrice, refetchEthBalance]);

  // Handle TX hash from writeContract data
  useEffect(() => {
    if (txData) {
      console.log('TX hash received:', txData);
      // Start timeout for refresh after send
      setTimeout(() => {
        setRefreshTrigger((prev) => prev + 1);
        setActiveTab(null);
        setSelectedAmount(0);
      }, 8000); // 8s wait for confirmation
    }
  }, [txData]);

  // Buy logic
  const handleBuySelect = (amount) => {
    setSelectedAmount(amount);
  };

const handleBuyTrade = async () => {
  if (!collectionData || selectedAmount === 0 || !mintPriceRaw) return; // Aggiungi check su raw per sicurezza
  const startingTokenId = BigInt(collectionData.startingTokenId);
  const value = mintPriceRaw; // <-- Usa direttamente il bigint wei, senza format/parse
  setError(null);
  try {
    await writeContract({
      address: WRAPPER_ADDRESS,
      abi: WRAPPER_ABI,
      functionName: 'mintAndSellWithEth',
      args: [contractAddress || DEFAULT_CONTRACT_ADDRESS, selectedAmount, startingTokenId],
      value, // Ora è bigint esatto
    });
  } catch (err) {
    console.error('Buy TX error:', err);
    setError('Buy failed: ' + err.message);
  }
};

  // Sell logic
  const handleSellSelect = (percentage) => {
    setSelectedAmount(percentage);
  };

  const handleSellTrade = async () => {
    if (!collectionData || selectedAmount === 0 || tokensAmountForSell === 0n) return;
    const minPayoutSize = 0n;
    setError(null);
    try {
      await writeContract({
        address: collectionData.tokenAddress,
        abi: BOOSTER_TOKEN_ABI,
        functionName: 'sell',
        args: [tokensAmountForSell, address, minPayoutSize, REFERRER_ADDRESS, REFERRER_ADDRESS],
      });
    } catch (err) {
      console.error('Sell TX error:', err);
      setError('Sell failed: ' + err.message);
    }
  };

  const disconnectWallet = () => {
    disconnect();
    localStorage.clear();
    resetSignature();
    setShowHeader(false);
    setContractAddress('');
    setCollectionData(null);
    setActiveTab(null);
    setSelectedAmount(0);
    setRefreshTrigger(0);
    setError(null);
  };

  return (
    <>
      <div className="fixed top-0 left-8 w-full h-8 sm:h-16 md:h-16 z-[5] bg-no-repeat bg-center bg-cover" style={{ backgroundImage: 'url(/band.png)' }} />
      <Link href="/" className="fixed top-[-13px] left-[-14px] z-50">
        <img src="/pdb.png" alt="PDB Logo" className="w-40 h-28 sm:w-48 sm:h-32 md:w-60 md:h-40" />
      </Link>
      <div className="fixed top-0 left-0 w-36 sm:w-44 md:w-60 flex flex-col pt-36 sm:pt-40 md:pt-52 pb-4 z-40 h-screen bg-transparent overflow-y-auto">
        <div className="flex flex-col space-y-0">
          <Link href="/dex" className="self-start -ml-2 sm:-ml-3 md:-ml-4">
            <img src="/dex.png" alt="Dex" className="scale-y-95 w-32 h-12 sm:w-40 sm:h-16 md:w-48 md:h-20 scale-100 brightness-100" />
          </Link>
          <nav className="flex flex-col space-y-0 text-white text-sm mt-0">
            <Link href="/" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/home.png" alt="Home" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/inventory" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/mybinder.png" alt="My Binder" className="scale-x-110 w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/binders" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/binders.png" alt="Binders" className="scale-x-105 w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
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
                {window.innerWidth < 640 ? `${address.slice(0, 3)}...${address.slice(-3)}` : `${address.slice(0, 6)}...${address.slice(-4)}`}
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
        ) : (
          <div className="flex flex-col items-center space-y-4 w-full max-w-2xl">
{/* Contract Input - Form with server action */}
<form action={action} className="relative w-96 sm:w-112 md:w-144">
  <img 
    src="/dropfinder.png" 
    alt="Drop Finder" 
    className="w-full h-16 object-fill scale-x-125" // Keep wide for image
  />
  <input
    type="text"
    name="contractAddress"
    placeholder="Drop address"
    value={contractAddress}
    onChange={(e) => setContractAddress(e.target.value)}
    autoComplete="off"
    className="absolute top-1 left-8 sm:left-12 md:left-16 w-48 sm:w-56 md:w-64 h-14 bg-transparent text-white border-none outline-none pl-4 pr-8 text-base placeholder-gray-300 cursor-text" // Increased width for more text visibility
  />
  <button
    type="submit"
    disabled={isPending || !contractAddress.trim()}
    className="absolute top-1 right-4 w-12 h-14 bg-transparent border-none cursor-pointer hover:opacity-80 flex items-center justify-center opacity-0" // Adjusted top-1 to match input
  >
    {/* Empty content to avoid any text */}
  </button>
</form>

            {/* Collection Info */}
            {collectionData && (
              <div className="flex flex-col items-center space-y-2 text-center">
                <img 
                  src={collectionData.imageUrl} 
                  alt={collectionData.name} 
                  className="w-48 h-64 sm:w-56 sm:h-80 object-contain rounded" // Larger with maintained proportions (contain)
                />
                <h2 className="text-lg font-bold">{collectionData.name} ({collectionData.symbol})</h2>
                <p className="text-sm">Balance: {formatTokenBalance(tokenBalance)} {collectionData.symbol} (${balanceUsd})</p>
              </div>
            )}

            {/* Buy/Sell Tabs - Hide during TX */}
            {collectionData && !activeTab && !isWritePending && (
              <div className="flex space-x-4">
                <button onClick={() => setActiveTab('buy')} className="p-2">
                  <img src="/buy.png" alt="Buy" className="w-34 h-24" />
                </button>
                <button onClick={() => setActiveTab('sell')} className="p-2">
                  <img src="/sell.png" alt="Sell" className="w-22 h-16" />
                </button>
              </div>
            )}

{/* Buy Interface */}
{activeTab === 'buy' && (
  <div className="flex flex-col items-center space-y-4">
    <div className="flex space-x-2">
      {[1, 10, 100, 400].map((amt) => (
        <button
          key={amt}
          onClick={() => handleBuySelect(amt)}
          className={`p-2 transition-all ${selectedAmount === amt ? 'brightness-125' : ''}`}
        >
          <img src={`/${amt === 1 ? '100k' : amt === 10 ? '1m' : amt === 100 ? '10m' : '40m'}.png`} alt={`${amt * 100}k`} className="w-16 h-16" />
        </button>
      ))}
    </div>
    {selectedAmount > 0 && (
      <div className="relative rounded h-52 w-80">
        <img 
          src="/txlist.png" 
          alt="" 
          className="absolute top-0 bottom-0 w-[80%] object-contain" 
          style={{ left: '20%', objectPosition: 'right center' }} 
        />
        <div className="relative flex flex-col justify-center items-center h-full p-1 bg-transparent">
          <span className="text-center text-black text-sm font-bold">ETH: {mintPrice}</span>
          <span className="text-center text-black text-sm font-bold">(${buyUsd})</span>
          <span className="text-2xl font-bold text-green-500">X</span>
          <span className="text-center text-black text-sm font-bold">Tokens: {formatTokensReceived(selectedAmount)} {collectionData.symbol}</span>
        </div>
        <button
          onClick={handleBuyTrade}
          disabled={parseFloat(mintPrice) === 0 || isWritePending}
          className="absolute bottom-2 right-2 p-1 bg-transparent border-none cursor-pointer disabled:opacity-50"
        >
<img src="/buy.png" alt="Buy" className="w-28 h-22 translate-y-3 translate-x-4" />        </button>
      </div>
    )}
    <button onClick={() => { setActiveTab(null); setSelectedAmount(0); }} className="p-0 border-none bg-transparent opacity-70 hover:opacity-100 transition-opacity">
      <img src="/previous.png" alt="Previous" className="w-22 h-14" />
    </button>
  </div>
)}

{activeTab === 'sell' && (
  <div className="flex flex-col items-center space-y-4">
    <div className="flex space-x-2">
      {[25, 50, 75, 100].map((pct) => (
        <button
          key={pct}
          onClick={() => handleSellSelect(pct)}
          className={`p-2 transition-all ${selectedAmount === pct ? 'brightness-125' : ''}`}
        >
          <img src={`/${pct}.png`} alt={`${pct}%`} className="w-16 h-16" />
        </button>
      ))}
    </div>
    {selectedAmount > 0 && (
      <div className="relative rounded h-52 w-80">
        <img 
          src="/txlist.png" 
          alt="" 
          className="absolute top-0 bottom-0 w-[80%] object-contain" 
          style={{ left: '20%', objectPosition: 'right center' }} 
        />
        <div className="relative flex flex-col justify-center items-center h-full p-1 bg-transparent">
          <span className="text-center text-black text-sm font-bold">Tokens: {(parseFloat(tokenBalance) * selectedAmount / 100).toFixed(2)} {collectionData.symbol}</span>
          <span className="text-2xl font-bold text-red-500">X</span>
          <span className="text-center text-black text-sm font-bold">ETH: {sellQuote}</span>
          <span className="text-center text-black text-sm font-bold">(${sellUsd})</span>
        </div>
        <button
          onClick={handleSellTrade}
          disabled={parseFloat(sellQuote) === 0 || isWritePending || parseFloat(tokenBalance) === 0}
          className="absolute bottom-2 right-2 p-1 bg-transparent border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <img src="/sell.png" alt="Sell" className="w-20 h-14" />
        </button>
      </div>
    )}
    <button onClick={() => { setActiveTab(null); setSelectedAmount(0); }} className="p-0 border-none bg-transparent opacity-70 hover:opacity-100 transition-opacity">
      <img src="/previous.png" alt="Previous" className="w-22 h-14" />
    </button>
  </div>
)}

            {error && <p className="text-red-500">{error}</p>}
            {isPending && <img src="/loading.png" alt="Loading" className="w-60 h-30" />}
          </div>
        )}

        {signatureError && <p className="text-red-500 mt-2">{signatureError}</p>}
      </main>
    </>
  );
}
