// app/claim/page.tsx

'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAccount, useBalance, useDisconnect, useWriteContract } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { formatEther } from 'viem';
import { useWalletSignature } from '../hooks/useWalletSignature';
import { useFarcasterMiniApp } from '../hooks/useFarcasterMiniApp';

export const dynamic = 'force-dynamic';

const CLAIM_CONTRACT_ADDRESS = '0x34E06Df657d7D326Fda89B97109586be3c3BD461';

const CLAIM_ABI = [
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256[]', name: 'tokenIds' }],
    outputs: [],
  },
  {
    name: 'getHighestClaimed',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint256', name: 'tokenId' },
      { type: 'address', name: 'claimer' },
    ],
  },
  {
    name: 'getPepeReceiver',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: '' }],
  },
];

const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
  return num.toString();
};

const getRarityName = (rarity) => {
  const names = { 1: 'Common', 2: 'Rare', 3: 'Epic', 4: 'Legendary' };
  return names[rarity] || 'Unknown';
};

export default function Claim() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { writeContract, isPending: isWritePending, data: txData } = useWriteContract();
  const { openConnectModal } = useConnectModal();
  const { data: ethBalance } = useBalance({ address });
  const { resetSignature } = useWalletSignature(address);
  const { navigateTo } = useFarcasterMiniApp();

  const [showHeader, setShowHeader] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [foilCards, setFoilCards] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);
  
  // Global stats
  const [highestClaimed, setHighestClaimed] = useState(null);
  const [pepeBalance, setPepeBalance] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [txStatus, setTxStatus] = useState('idle'); // 'idle' | 'pending'

  const formattedEthBalance = ethBalance ? parseFloat(ethBalance.formatted).toFixed(7) : '0';
  const totalClaimable = foilCards.reduce((sum, card) => sum + (card.reward || card.expectedReward || 0), 0);
  const hasFoilCards = foilCards.length > 0;

  // Fetch global stats
  useEffect(() => {
    async function fetchGlobalStats() {
      setLoadingStats(true);
      try {
        const res = await fetch('/api/claimStats');
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        setHighestClaimed({
          tokenId: data.tokenId ? Number(data.tokenId) : 0,
          claimer: data.claimer || null,
        });
        setPepeBalance(data.pepeBalance || '0 $PEPE');
      } catch (err) {
        console.error('Error fetching global stats:', err);
      } finally {
        setLoadingStats(false);
      }
    }
    fetchGlobalStats();
  }, []);

  // Fetch user's foil cards
  useEffect(() => {
    async function fetchFoilCards() {
      if (!address || !isConnected) {
        setFoilCards([]);
        return;
      }

      setLoadingCards(true);
      try {
        const response = await fetch(`/api/claimableFoils?address=${address}`);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        const foils = (data.cards || []).map(card => ({
          tokenId: card.tokenId,
          rarity: card.rarity,
          foil: card.foil,
          reward: card.expectedReward || 0,
          imageUrl: '',
        }));

        setFoilCards(foils);
      } catch (err) {
        console.error('Error fetching foil cards:', err);
        setError('Failed to load your foil cards');
      } finally {
        setLoadingCards(false);
      }
    }

    fetchFoilCards();
  }, [address, isConnected, txData]);

  // Success message
  useEffect(() => {
    if (txData) {
      setSuccess(`Claim submitted! TX: ${txData.hash}`);
      setTxStatus('idle');
      setTimeout(() => setSuccess(null), 10000);
    }
  }, [txData]);

  const handleClaim = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (foilCards.length === 0) {
      setError('No claimable foil NFTs found');
      return;
    }

    setError(null);
    setSuccess(null);
    setLoading(true);
    setTxStatus('pending');

    try {
      const tokenIds = foilCards.map(card => BigInt(card.tokenId));
      await writeContract({
        address: CLAIM_CONTRACT_ADDRESS,
        abi: CLAIM_ABI,
        functionName: 'claim',
        args: [tokenIds],
      });
    } catch (err) {
      console.error('Claim error:', err);
      setError('Claim failed: ' + (err.shortMessage || err.message || 'Unknown error'));
      setTxStatus('idle');
    } finally {
      setLoading(false);
    }
  };

  const disconnectWallet = () => {
    disconnect();
    localStorage.clear();
    resetSignature();
    setShowHeader(false);
    setError(null);
    setSuccess(null);
  };

  return (
    <>
      {/* Top banner */}
      <div
        className="fixed top-0 left-8 w-full h-8 sm:h-16 md:h-16 z-[5] bg-no-repeat bg-center bg-cover"
        style={{ backgroundImage: 'url(/band.png)' }}
      />

      {/* PDB Logo */}
      <Link href="/" className="fixed top-[-13px] left-[-14px] z-50">
        <img
          src="/pdb.png"
          alt="PDB Logo"
          className="w-40 h-28 sm:w-48 sm:h-32 md:w-60 md:h-40"
        />
      </Link>

      {/* Sidebar – narrowed on large screens only (md:w-56) to match your other pages exactly */}
      <div className="fixed top-0 left-0 w-28 sm:w-36 md:w-52 flex flex-col pt-36 sm:pt-40 md:pt-52 pb-4 z-40 h-screen bg-black overflow-y-auto">
        <div className="flex flex-col space-y-0">
          <Link href="/claim" className="self-start -ml-1 sm:-ml-2 md:-ml-2">
            <img
              src="/claim.png"
              alt="Claim"
              className="scale-y-95 w-32 h-12 sm:w-40 sm:h-16 md:w-48 md:h-20 scale-100 brightness-100"
            />
          </Link>

          <nav className="flex flex-col space-y-0 text-white text-sm mt-0">
            {/* New order: Home → My Binder → Binders → Dex */}
            <Link href="/" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img
                src="/home.png"
                alt="Home"
                className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale"
              />
            </Link>
            <Link href="/inventory" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img
                src="/mybinder.png"
                alt="My Binder"
                className="scale-x-110 w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale"
              />
            </Link>
            <Link href="/binders" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img
                src="/binders.png"
                alt="Binders"
                className="scale-x-105 w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale"
              />
            </Link>
            <Link href="/dex" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img
                src="/dex.png"
                alt="Dex"
                className="scale-y-95 w-32 h-12 sm:w-40 sm:h-16 md:w-48 md:h-20 brightness-50 grayscale"
              />
            </Link>
          </nav>
        </div>
      </div>

      {/* Wallet header */}
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
              <img src="/addressbg.png" alt="Address BG" className="w-full h-full" />
            </div>
            <div className="relative z-10 flex flex-col items-end justify-center h-full pl-8 sm:pl-7.5 md:pl-9 pr-1 sm:pr-2 md:pr-3 py-1 space-y-0.5 text-right max-w-full scale-125 translate-y-[-20px] sm:translate-y-[-25px] md:translate-y-[-25px] translate-x-[-50px]">
              <span className="text-[10px] sm:text-sm md:text-sm font-bold text-black/90 overflow-hidden max-w-[110px] sm:max-w-[120px] leading-tight">
                {typeof window !== 'undefined' && window.innerWidth < 640
                  ? `${address?.slice(0, 3)}...${address?.slice(-3)}`
                  : `${address?.slice(0, 6)}...${address?.slice(-4)}`}
              </span>
              <span className="text-[10px] sm:text-sm md:text-sm text-black/70 overflow-hidden max-w-[110px] sm:max-w-[120px] leading-tight">
                {formattedEthBalance} ETH
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  disconnectWallet();
                }}
                className="p-0 border-none bg-transparent self-end mr-1 pr-0.5 mt-0.5"
              >
                <img
                  src="/disconnect.png"
                  alt="Disconnect"
                  className="w-16 h-10 sm:w-28 sm:h-11 md:w-32 md:h-12 object-contain"
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content – padding adjusted for the narrower sidebar on large screens */}
      <main className="min-h-screen bg-[#00893A] text-white pl-28 sm:pl-36 md:pl-52 pt-24 sm:pt-28 md:pt-32 pr-4 pb-8 relative z-0">
        {/* Tx Loading Overlay */}
        {txStatus !== 'idle' && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70">
            <img src="/loading.png" alt="Loading" className="w-20 h-20 animate-spin" />
            <p className="text-white text-lg mt-4 font-bold">Claiming...</p>
          </div>
        )}

        {/* Win banner */}
        <div className="w-full max-w-md mx-auto mb-6">
          <a
            href="https://vibechain.com/market/poorly-drawn-pepes"
            target="_blank"
            rel="noopener noreferrer"
            className="block cursor-pointer hover:opacity-90 transition-opacity"
          >
            <img
              src="/win.png"
              alt="Win $PEPE"
              className="w-56 h-auto sm:w-[14rem] md:w-[18rem] lg:w-[22rem] xl:w-[26rem] object-contain mx-auto"
            />
          </a>
        </div>

        {/* Global stats */}
        <div className="w-full max-w-md mx-auto mb-6">
          <div className="bg-gray-900/80 rounded-lg p-3 border border-gray-700">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-gray-400 text-xs">Latest Claimed</p>
                {loadingStats ? (
                  <p className="text-gray-500 text-sm">Loading...</p>
                ) : highestClaimed && highestClaimed.tokenId > 0 ? (
                  <p className="text-white font-bold font-mono">#{highestClaimed.tokenId}</p>
                ) : (
                  <p className="text-gray-500 text-sm">No claims yet</p>
                )}
              </div>
              <div>
                <p className="text-gray-400 text-xs">Pool Balance</p>
                {loadingStats ? (
                  <p className="text-gray-500 text-sm">Loading...</p>
                ) : pepeBalance ? (
                  <p className="text-green-400 font-bold">{pepeBalance}</p>
                ) : (
                  <p className="text-gray-500 text-sm">0 $PEPE</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Claim button */}
        <div className="w-full max-w-md mx-auto">
          {hasFoilCards ? (
            <button
              onClick={handleClaim}
              disabled={loading || isWritePending || !isConnected}
              className={`w-full cursor-pointer border-none bg-transparent ${loading || isWritePending ? 'opacity-50' : ''}`}
            >
              <img
                src="/claimbutton.png"
                alt="Claim $PEPE"
                className="w-40 h-40 mx-auto object-contain"
              />
            </button>
          ) : (
            <div className="opacity-50 pointer-events-none">
              <img
                src="/claimbutton.png"
                alt="Claim $PEPE"
                className="w-40 h-40 mx-auto object-contain"
              />
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="w-full max-w-md mx-auto mt-4 text-center">
          {error && <p className="text-red-500 font-bold text-sm">{error}</p>}
          {success && <p className="text-green-500 font-bold text-sm">{success}</p>}
        </div>

        {/* User's foil cards */}
        {isConnected && (
          <div className="w-full max-w-2xl mx-auto mt-6">
            {hasFoilCards ? (
              <>
                <div className="bg-gray-900/80 rounded-lg p-4 border border-gray-700 mb-4">
                  <p className="text-gray-400 text-sm text-center">Total Claimable:</p>
                  <p className="text-green-400 text-3xl font-bold text-center">
                    {formatNumber(totalClaimable)} $PEPE
                  </p>
                </div>

                {!loadingCards && foilCards.length > 0 && (
                  <div className="bg-gray-900/80 rounded-lg border border-gray-700 overflow-hidden">
                    <div className="bg-gray-800 px-4 py-2 grid grid-cols-5 gap-2 text-xs font-bold text-gray-300">
                      <div>Token ID</div>
                      <div>Rarity</div>
                      <div>Foil</div>
                      <div className="text-right">Reward</div>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {foilCards.map((card) => (
                        <div
                          key={card.tokenId}
                          className="grid grid-cols-5 gap-2 px-4 py-3 border-t border-gray-700 items-center text-sm"
                        >
                          <div className="text-white font-mono">#{card.tokenId}</div>
                          <div>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-bold ${
                                card.rarity === 4
                                  ? 'bg-orange-500/20 text-orange-400'
                                  : card.rarity === 3
                                  ? 'bg-purple-500/20 text-purple-400'
                                  : card.rarity === 2
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-gray-500/20 text-gray-400'
                              }`}
                            >
                              {getRarityName(card.rarity)}
                            </span>
                          </div>
                          <div>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-bold ${
                                card.foil === 'Prize'
                                  ? 'bg-yellow-500/20 text-yellow-400'
                                  : 'bg-gray-500/20 text-gray-300'
                              }`}
                            >
                              {card.foil}
                            </span>
                          </div>
                          <div className="text-right text-green-400 font-bold">
                            {formatNumber(card.reward)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="w-full max-w-md mx-auto mt-4">
                <img
                  src="/nocardsfound.png"
                  alt="No cards found"
                  className="w-64 h-64 mx-auto object-contain"
                />
                {loadingCards && (
                  <p className="text-gray-500 text-center mt-2">Checking your wallet...</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Connect prompt – no text + big button */}
        {!isConnected && (
          <div className="w-full max-w-md mx-auto mt-6 text-center">
            <button
              onClick={() => openConnectModal?.()}
              className="cursor-pointer border-none bg-transparent"
            >
              <img
                src="/connect.png"
                alt="Connect Wallet"
                className="w-72 h-28 mx-auto object-contain"
              />
            </button>
          </div>
        )}
      </main>
    </>
  );
}
