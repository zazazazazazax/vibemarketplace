'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { readContract, waitForTransaction, writeContract } from 'wagmi/actions';
import { useAccount, useBalance, useChainId, useConfig, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useWalletSignature } from '../hooks/useWalletSignature';
import { useFarcasterMiniApp } from '../hooks/useFarcasterMiniApp';

const QUEST_CONTRACT = '0x2D2199cf2a93Aa4ffc661E5E1E281e21188Ce4B4';
const BASE_CHAIN_ID = 8453;
const MAX_UINT256 = (1n << 256n) - 1n;

const questAbi = [
  { inputs: [], name: 'activeQuestId', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'nextQuestId', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pdpToken', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'entryFee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'restoreLifeFee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ name: 'questId', type: 'uint256' }],
    name: 'getQuest',
    outputs: [{
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'active', type: 'bool' },
        { name: 'startedAt', type: 'uint256' },
        { name: 'stoppedAt', type: 'uint256' },
        { name: 'prizePool', type: 'uint256' },
        { name: 'entryCount', type: 'uint256' },
        { name: 'canceled', type: 'bool' },
        { name: 'rulesCommitment', type: 'bytes32' },
        { name: 'firstEntryId', type: 'uint256' },
        { name: 'secondEntryId', type: 'uint256' },
        { name: 'thirdEntryId', type: 'uint256' },
        { name: 'paidFirst', type: 'uint256' },
        { name: 'paidSecond', type: 'uint256' },
        { name: 'paidThird', type: 'uint256' },
        { name: 'revealedRulesJson', type: 'string' },
        { name: 'revealedSalt', type: 'string' },
      ],
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [{ name: 'questId', type: 'uint256' }], name: 'getQuestEntryIds', outputs: [{ type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ name: 'entryId', type: 'uint256' }],
    name: 'getEntry',
    outputs: [{
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'questId', type: 'uint256' },
        { name: 'player', type: 'address' },
        { name: 'tokenIds', type: 'uint256[]' },
        { name: 'paid', type: 'uint256' },
        { name: 'createdAt', type: 'uint256' },
      ],
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [{ name: 'entryId', type: 'uint256' }], name: 'getEntryTokenIds', outputs: [{ type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'tokenId', type: 'uint256' }], name: 'getTokenLives', outputs: [{ name: 'remaining', type: 'uint8' }, { name: 'maxLives', type: 'uint8' }, { name: 'initialized', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'questId', type: 'uint256' }, { name: 'tokenId', type: 'uint256' }], name: 'questTokenUsed', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'tokenIds', type: 'uint256[]' }], name: 'join', outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'tokenId', type: 'uint256' }], name: 'restoreLife', outputs: [], stateMutability: 'nonpayable', type: 'function' },
];

const erc20Abi = [
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
];

function normalizeHash(result) {
  return typeof result === 'string' ? result : result?.hash;
}

function bigIntToNumber(value) {
  return Number(value || 0n);
}

function formatTokenAmount(value, decimals, symbol) {
  if (value === null || value === undefined) return `0 ${symbol}`;
  const formatted = formatUnits(value, decimals || 18);
  const [whole, fraction = ''] = formatted.split('.');
  const trimmedFraction = fraction.slice(0, 2).replace(/0+$/, '');
  return `${whole}${trimmedFraction ? `.${trimmedFraction}` : ''} ${symbol}`;
}

function formatDate(seconds) {
  const value = Number(seconds || 0n);
  if (!value) return 'Not set';
  return new Date(value * 1000).toLocaleString();
}

function shortHash(hash) {
  if (!hash) return 'Unavailable';
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function rarityName(rarity) {
  const names = { 1: 'Common', 2: 'Rare', 3: 'Epic', 4: 'Legendary', 5: 'Mythic' };
  return names[Number(rarity)] || 'Unknown';
}

function prizeShare(pool, percentage) {
  return pool ? (pool * BigInt(percentage)) / 100n : 0n;
}

function AssetImage({ src, fallback, alt, className }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback || null;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

function Shell({ children, isConnected, showHeader, setShowHeader, address, formattedEthBalance, disconnectWallet }) {
  return (
    <>
      <div
        className="fixed top-0 left-8 w-full h-8 sm:h-16 md:h-16 z-[5] bg-no-repeat bg-center bg-cover"
        style={{ backgroundImage: 'url(/band.png)' }}
      />

      <Link href="/" className="fixed top-[-13px] left-[-14px] z-50">
        <img src="/pdb.png" alt="PDB Logo" className="w-40 h-28 sm:w-48 sm:h-32 md:w-60 md:h-40" />
      </Link>

      <div className="fixed top-0 left-0 w-36 sm:w-44 md:w-60 flex flex-col pt-36 sm:pt-40 md:pt-52 pb-4 z-40 h-screen bg-transparent overflow-y-auto">
        <div className="flex flex-col space-y-0">
          <Link href="/quests" className="self-start -ml-2 sm:-ml-3 md:-ml-4">
            <img src="/quest.png" alt="Quest" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 scale-100 brightness-100" />
          </Link>
          <nav className="flex flex-col space-y-0 text-white text-sm mt-0">
            <Link href="/" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/home.png" alt="Home" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/inventory" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/mybinder.png" alt="My Binder" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/binders" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/binders.png" alt="Binders" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/dex" className="self-start -ml-2 sm:-ml-3 md:-ml-4 hover:brightness-110">
              <img src="/dex.png" alt="Dex" className="w-32 h-10 sm:w-40 sm:h-12 md:w-48 md:h-16 brightness-50 grayscale" />
            </Link>
            <Link href="/claim" className="self-start -ml-1 sm:-ml-2 md:-ml-3 hover:brightness-110">
              <img src="/claim.png" alt="Claim" className="scale-y-95 w-32 h-12 sm:w-40 sm:h-16 md:w-48 md:h-20 brightness-50 grayscale" />
            </Link>
          </nav>
        </div>
      </div>

      {isConnected && !showHeader && (
        <button
          onClick={() => setShowHeader(true)}
          className="fixed top-0 right-2 z-10 p-0 border-none bg-transparent cursor-pointer"
        >
          <img src="/pepe.png" alt="Show Wallet Header" className="w-20 h-18 sm:w-32 sm:h-28 md:w-40 md:h-36 object-contain transition-opacity hover:opacity-100" />
        </button>
      )}

      {isConnected && showHeader && (
        <div className="fixed top-0 right-2 z-10">
          <div className="relative w-40 h-36 sm:w-52 sm:h-52 md:w-56 md:h-108 rounded">
            <div className="absolute inset-0 w-full h-full object-contain bg-no-repeat translate-x-1">
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
              <button onClick={disconnectWallet} className="p-0 border-none bg-transparent self-end mr-1 pr-0.5 mt-0.5">
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
        {children}
      </main>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-black/80 border border-white/10 rounded p-3 min-h-[82px]">
      <div className="text-[11px] uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1 text-lg md:text-xl font-black text-white break-words">{value}</div>
    </div>
  );
}

function Lives({ remaining, max, selected }) {
  const count = Math.max(Number(max || 0), 1);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: count }).map((_, index) => {
        const alive = index < Number(remaining || 0);
        return (
          <img
            key={index}
            src="/pepe.png"
            alt={alive ? 'Life' : 'Spent life'}
            className={`w-5 h-5 object-contain transition-all duration-200 ${alive ? (selected ? 'brightness-100' : 'brightness-75') : 'brightness-0'}`}
          />
        );
      })}
    </div>
  );
}

export default function QuestContent() {
  const router = useRouter();
  const config = useConfig();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: ethBalance } = useBalance({ address });
  const { openConnectModal } = useConnectModal();
  const { resetSignature } = useWalletSignature(address);
  useFarcasterMiniApp();

  const [showHeader, setShowHeader] = useState(false);
  const [mode, setMode] = useState('quest');
  const [questState, setQuestState] = useState({
    loading: true,
    activeQuestId: 0n,
    nextQuestId: 0n,
    activeQuest: null,
    previousQuest: null,
    entryIds: [],
    pdpToken: null,
    entryFee: 0n,
    restoreLifeFee: 0n,
    tokenDecimals: 18,
    tokenSymbol: 'PDP',
    tokenBalance: 0n,
    allowance: 0n,
  });
  const [cards, setCards] = useState([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [txStatus, setTxStatus] = useState('idle');

  const formattedEthBalance = ethBalance ? parseFloat(ethBalance.formatted).toFixed(7) : '0';
  const activeQuest = questState.activeQuest;
  const previousQuest = questState.previousQuest;
  const hasActiveQuest = Boolean(activeQuest?.active);
  const selectedCards = useMemo(() => cards.filter(card => selectedIds.includes(card.tokenId)), [cards, selectedIds]);

  const refreshQuest = useCallback(async () => {
    if (!config) return;
    setQuestState(prev => ({ ...prev, loading: true }));
    try {
      const [activeQuestId, nextQuestId, pdpToken, entryFee, restoreLifeFee] = await Promise.all([
        readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'activeQuestId', chainId: BASE_CHAIN_ID }),
        readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'nextQuestId', chainId: BASE_CHAIN_ID }),
        readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'pdpToken', chainId: BASE_CHAIN_ID }),
        readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'entryFee', chainId: BASE_CHAIN_ID }),
        readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'restoreLifeFee', chainId: BASE_CHAIN_ID }),
      ]);

      const previousQuestId = activeQuestId > 0n ? activeQuestId - 1n : nextQuestId > 1n ? nextQuestId - 1n : 0n;
      const [activeQuestData, previousQuestData, entryIds, decimals, symbol, balance, allowance] = await Promise.all([
        activeQuestId > 0n ? readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'getQuest', args: [activeQuestId], chainId: BASE_CHAIN_ID }) : null,
        previousQuestId > 0n ? readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'getQuest', args: [previousQuestId], chainId: BASE_CHAIN_ID }) : null,
        activeQuestId > 0n ? readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'getQuestEntryIds', args: [activeQuestId], chainId: BASE_CHAIN_ID }) : [],
        readContract(config, { address: pdpToken, abi: erc20Abi, functionName: 'decimals', chainId: BASE_CHAIN_ID }).catch(() => 18),
        readContract(config, { address: pdpToken, abi: erc20Abi, functionName: 'symbol', chainId: BASE_CHAIN_ID }).catch(() => 'PDP'),
        address ? readContract(config, { address: pdpToken, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: BASE_CHAIN_ID }).catch(() => 0n) : 0n,
        address ? readContract(config, { address: pdpToken, abi: erc20Abi, functionName: 'allowance', args: [address, QUEST_CONTRACT], chainId: BASE_CHAIN_ID }).catch(() => 0n) : 0n,
      ]);

      setQuestState({
        loading: false,
        activeQuestId,
        nextQuestId,
        activeQuest: activeQuestData,
        previousQuest: previousQuestData,
        entryIds: entryIds || [],
        pdpToken,
        entryFee,
        restoreLifeFee,
        tokenDecimals: Number(decimals || 18),
        tokenSymbol: symbol || 'PDP',
        tokenBalance: balance || 0n,
        allowance: allowance || 0n,
      });
    } catch (err) {
      console.error('Quest refresh failed:', err);
      setQuestState(prev => ({ ...prev, loading: false }));
      setError(`Quest read failed: ${err.shortMessage || err.message || 'Unknown error'}`);
    }
  }, [address, config]);

  const refreshCardLives = useCallback(async (baseCards, activeId) => {
    if (!config || !baseCards.length) return baseCards;
    const withLives = await Promise.all(baseCards.map(async (card) => {
      try {
        const tokenId = BigInt(card.tokenId);
        const [lives, used] = await Promise.all([
          readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'getTokenLives', args: [tokenId], chainId: BASE_CHAIN_ID }),
          activeId > 0n
            ? readContract(config, { address: QUEST_CONTRACT, abi: questAbi, functionName: 'questTokenUsed', args: [activeId, tokenId], chainId: BASE_CHAIN_ID })
            : false,
        ]);
        return {
          ...card,
          livesRemaining: Number(lives?.[0] ?? lives?.remaining ?? 0),
          livesMax: Number(lives?.[1] ?? lives?.maxLives ?? 0),
          livesInitialized: Boolean(lives?.[2] ?? lives?.initialized),
          usedInQuest: Boolean(used),
        };
      } catch (err) {
        console.error(`Lives read failed for ${card.tokenId}:`, err);
        return { ...card, livesRemaining: 0, livesMax: 0, livesInitialized: false, usedInQuest: false, livesError: true };
      }
    }));
    return withLives;
  }, [config]);

  const fetchCards = useCallback(async () => {
    if (!address || !isConnected) {
      setCards([]);
      setSelectedIds([]);
      return;
    }
    setCardsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/quests?address=${address}`);
      if (!response.ok) throw new Error(`Inventory API ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      const withLives = await refreshCardLives(data.cards || [], questState.activeQuestId);
      setCards(withLives);
      setSelectedIds(prev => prev.filter(tokenId => withLives.some(card => card.tokenId === tokenId && card.livesRemaining > 0 && !card.usedInQuest)));
    } catch (err) {
      console.error('Quest card fetch failed:', err);
      setError(`Could not load your PDP cards: ${err.message}`);
    } finally {
      setCardsLoading(false);
    }
  }, [address, isConnected, questState.activeQuestId, refreshCardLives]);

  useEffect(() => {
    refreshQuest();
  }, [refreshQuest]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    localStorage.clear();
    resetSignature();
    setCards([]);
    setSelectedIds([]);
    setShowHeader(false);
    router.push('/');
  }, [disconnect, resetSignature, router]);

  const toggleCard = (card) => {
    if (!hasActiveQuest || card.usedInQuest || card.livesRemaining <= 0) return;
    setSelectedIds(prev => {
      if (prev.includes(card.tokenId)) return prev.filter(tokenId => tokenId !== card.tokenId);
      if (prev.length >= 4) return prev;
      return [...prev, card.tokenId];
    });
  };

  const refreshAfterJoin = async () => {
    await refreshQuest();
    const updated = await refreshCardLives(cards, questState.activeQuestId);
    setCards(updated);
    setSelectedIds([]);
  };

  const handleJoin = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (chainId !== BASE_CHAIN_ID) {
      setError('Please switch to Base chain (ID: 8453) before joining.');
      return;
    }
    if (!hasActiveQuest) {
      setError('No active quest to join right now.');
      return;
    }
    if (selectedCards.length < 1 || selectedCards.length > 4) {
      setError('Select 1 to 4 PDP cards.');
      return;
    }
    if (questState.tokenBalance < questState.entryFee) {
      setError(`Not enough ${questState.tokenSymbol} for the entry fee.`);
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      if (questState.allowance < questState.entryFee) {
        setTxStatus('approving');
        const approveResult = await writeContract(config, {
          address: questState.pdpToken,
          abi: erc20Abi,
          functionName: 'approve',
          args: [QUEST_CONTRACT, MAX_UINT256],
          chainId: BASE_CHAIN_ID,
        });
        const approveHash = normalizeHash(approveResult);
        if (approveHash) await waitForTransaction(config, { hash: approveHash, chainId: BASE_CHAIN_ID });
      }

      setTxStatus('joining');
      const tokenIds = selectedCards.map(card => BigInt(card.tokenId));
      const joinResult = await writeContract(config, {
        address: QUEST_CONTRACT,
        abi: questAbi,
        functionName: 'join',
        args: [tokenIds],
        chainId: BASE_CHAIN_ID,
      });
      const joinHash = normalizeHash(joinResult);
      if (joinHash) await waitForTransaction(config, { hash: joinHash, chainId: BASE_CHAIN_ID });

      setSuccess('Joined the active quest. Lives refreshed.');
      await refreshAfterJoin();
    } catch (err) {
      console.error('Join failed:', err);
      setError(`Join failed: ${err.shortMessage || err.message || 'Unknown error'}`);
    } finally {
      setTxStatus('idle');
    }
  };

  const txLabel = txStatus === 'approving' ? 'Approving entry fee...' : txStatus === 'joining' ? 'Joining quest...' : '';
  const joinDisabled = txStatus !== 'idle' || !hasActiveQuest || selectedCards.length === 0 || selectedCards.length > 4 || chainId !== BASE_CHAIN_ID;
  const activePrizePool = activeQuest?.prizePool || 0n;

  return (
    <Shell
      isConnected={isConnected}
      showHeader={showHeader}
      setShowHeader={setShowHeader}
      address={address}
      formattedEthBalance={formattedEthBalance}
      disconnectWallet={disconnectWallet}
    >
      {txStatus !== 'idle' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70">
          <img src="/loading.png" alt="Loading" className="w-20 h-20 animate-spin" />
          <p className="text-white text-lg mt-4 font-bold">{txLabel}</p>
        </div>
      )}

      <div className="w-full max-w-6xl mx-auto flex flex-col items-center">
        <div className="flex space-x-4 mb-8 z-10">
          <button
            onClick={() => setMode('quest')}
            className="p-0 bg-transparent border-none transition-all duration-200 hover:scale-110"
          >
            <AssetImage
              src="/quests.png"
              alt="Quests"
              className={`w-24 h-16 object-contain transition-all duration-200 ${mode === 'quest' ? 'brightness-125 scale-105' : 'brightness-75'}`}
              fallback={<span className={`block px-4 py-3 bg-black text-white font-black rounded ${mode === 'quest' ? 'brightness-125 scale-105' : 'brightness-75'}`}>quests</span>}
            />
          </button>
          <button
            onClick={() => setMode('faq')}
            className="p-0 bg-transparent border-none transition-all duration-200 hover:scale-110"
          >
            <img
              src="/faq.png"
              alt="FAQ"
              className={`w-16 h-16 transition-all duration-200 ${mode === 'faq' ? 'brightness-125 scale-105' : 'brightness-75'}`}
            />
          </button>
        </div>

        {mode === 'faq' ? (
          <section className="flex flex-col items-center space-y-4">
            <img src="/welcome.png" alt="Welcome" className="w-80 h-auto rounded-lg" />
            <div className="max-w-2xl text-white text-base leading-relaxed text-center px-4">
              <h2 className="text-xl font-bold mb-2">What's a quest?</h2>
              <p className="mb-4">
                Quests are skill-based PDP campaigns. You enter with 1 to 4 Poorly Drawn Pepes, pay the on-chain participation quote in $PDP, and compete for the prize pool.
              </p>

              <h2 className="text-xl font-bold mb-2">How does it work?</h2>
              <ul className="text-left mb-4 space-y-1 list-disc list-inside">
                <li>Connect your wallet on Base and pick up to 4 owned PDP cards.</li>
                <li>Each card has lives based on rarity: Common 1, Rare 2, Epic 3, Legendary 4.</li>
                <li>Joining spends 1 life from every selected token ID.</li>
                <li>The same token ID can enter the same quest only once.</li>
                <li>Cards with 0 lives cannot be selected until a life is restored.</li>
              </ul>

              <h2 className="text-xl font-bold mb-2">Are the rules public?</h2>
              <p className="mb-4">
                Not while the quest is active. The contract stores a commitment hash first, then after the quest stops the rules JSON and salt can be revealed so everyone can verify the rules were fixed before entries.
              </p>

              <p className="text-sm italic">
                Quest transactions are final and at your own risk. Check selected cards, lives, and $PDP balance before joining.
              </p>
            </div>
          </section>
        ) : (
          <>
            {questState.loading ? (
              <div className="bg-black/80 border border-white/10 rounded p-6 text-white/80">Loading quest data...</div>
            ) : (
              <section className="space-y-5">
                {hasActiveQuest ? (
                  <>
                    <div className="w-full flex flex-col items-center">
                      <img src="/quests-liquidity-event-banner.png" alt="Active quest" className="w-full max-w-3xl h-auto object-contain mb-4" />
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 w-full">
                      <Stat label="Quest" value={`#${bigIntToNumber(activeQuest.id)}`} />
                      <Stat label="Participants" value={String(bigIntToNumber(activeQuest.entryCount))} />
                      <Stat label="Collected" value={formatTokenAmount(activePrizePool, questState.tokenDecimals, questState.tokenSymbol)} />
                      <Stat label="1st Prize" value={formatTokenAmount(prizeShare(activePrizePool, 60), questState.tokenDecimals, questState.tokenSymbol)} />
                      <Stat label="2nd Prize" value={formatTokenAmount(prizeShare(activePrizePool, 30), questState.tokenDecimals, questState.tokenSymbol)} />
                      <Stat label="3rd Prize" value={formatTokenAmount(prizeShare(activePrizePool, 10), questState.tokenDecimals, questState.tokenSymbol)} />
                    </div>
                    <div className="bg-black/80 border border-white/10 rounded p-4 w-full">
                      <div className="grid md:grid-cols-2 gap-3 mb-4">
                        <Stat label="Participation Quote" value={formatTokenAmount(questState.entryFee, questState.tokenDecimals, questState.tokenSymbol)} />
                        <Stat label="Your $PDP Balance" value={formatTokenAmount(questState.tokenBalance, questState.tokenDecimals, questState.tokenSymbol)} />
                      </div>
                      <div className="flex items-center justify-center gap-3 mb-4">
                        <span className="text-sm font-bold text-white/80">I have no $PDP</span>
                        <Link href="/dex?tab=buy" className="inline-flex hover:scale-105 transition-transform">
                          <img src="/buy.png" alt="Buy" className="w-20 h-auto object-contain" />
                        </Link>
                      </div>
                      <div className="text-xs uppercase tracking-wide text-white/50">Rules commitment</div>
                      <div className="font-mono text-sm break-all mt-1">{activeQuest.rulesCommitment}</div>
                      <p className="text-white/60 text-sm mt-2">Rules are hidden until this quest is stopped.</p>
                    </div>
                  </>
                ) : (
                  <div className="w-full flex flex-col items-center py-8">
                    <AssetImage
                      src="/noquestsfound.png"
                      alt="No quests found"
                      className="w-72 h-auto object-contain"
                      fallback={<div className="text-2xl font-black text-center bg-black/80 rounded p-6">No quests found</div>}
                    />
                  </div>
                )}

                <div className="w-full">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                    <p className="text-white/80 text-sm font-bold">Select 1 to 4 cards with lives available.</p>
                    <div className="flex flex-col items-start md:items-end gap-1 text-sm text-white/80">
                      <span>Balance: {formatTokenAmount(questState.tokenBalance, questState.tokenDecimals, questState.tokenSymbol)}</span>
                      <Link href="/dex?tab=buy" className="inline-flex hover:scale-105 transition-transform">
                        <img src="/buy.png" alt="Buy" className="w-16 h-auto object-contain" />
                      </Link>
                    </div>
                  </div>

                  {!isConnected ? (
                    <div className="text-center py-10">
                      <button onClick={() => openConnectModal?.()} className="cursor-pointer border-none bg-transparent">
                        <img src="/connect.png" alt="Connect Wallet" className="w-72 h-28 mx-auto object-contain" />
                      </button>
                    </div>
                  ) : chainId !== BASE_CHAIN_ID ? (
                    <div className="p-4 bg-red-950/80 border border-red-500/40 rounded text-red-100">Please switch to Base chain (ID: 8453).</div>
                  ) : cardsLoading ? (
                    <div className="py-10 text-center text-white/70">Loading your PDP cards...</div>
                  ) : cards.length === 0 ? (
                    <div className="py-8 text-center">
                      <img src="/nocardsfound.png" alt="No cards found" className="w-48 h-48 mx-auto object-contain opacity-80" />
                      <p className="text-white/60">No owned PDP cards found for this wallet.</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                        {cards.map((card) => {
                          const selected = selectedIds.includes(card.tokenId);
                          const disabled = !hasActiveQuest || card.usedInQuest || card.livesRemaining <= 0;
                          return (
                            <button
                              key={`${card.contractAddress}-${card.tokenId}`}
                              onClick={() => toggleCard(card)}
                              disabled={disabled}
                              className={`text-center border-none bg-transparent transition ${selected ? 'brightness-100 scale-105' : 'brightness-75'} ${disabled ? 'opacity-55 cursor-not-allowed' : 'hover:-translate-y-0.5 cursor-pointer'}`}
                            >
                              <div className="aspect-[4/5] flex items-center justify-center">
                                {card.imageUrl ? (
                                  <img src={card.imageUrl} alt={card.name} className="w-full h-full object-contain" />
                                ) : (
                                  <div className="text-white/30 text-sm">No image</div>
                                )}
                              </div>
                              <div className="pt-2 space-y-2 flex flex-col items-center">
                                <div className="text-xs font-black text-white/80">#{card.tokenId}</div>
                                <Lives remaining={card.livesRemaining} max={card.livesMax} selected={selected} />
                                {card.usedInQuest && <div className="text-xs text-red-300 font-bold">Already used in this quest</div>}
                                {!card.usedInQuest && card.livesRemaining <= 0 && <div className="text-xs text-red-300 font-bold">No lives left</div>}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="sticky bottom-3 mt-5 bg-black border border-white/10 rounded p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="text-sm text-white/75">
                          Selected: <span className="font-black text-white">{selectedIds.length}/4</span>
                        </div>
                        <button
                          onClick={handleJoin}
                          disabled={joinDisabled}
                          className={`p-0 border-none bg-transparent ${joinDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-105 transition-transform'}`}
                        >
                          <AssetImage
                            src="/join.png"
                            alt={questState.allowance < questState.entryFee ? 'Approve and join' : 'Join quest'}
                            className="w-32 h-auto object-contain"
                            fallback={<span className="block px-6 py-3 rounded font-black bg-yellow-300 text-black">{questState.allowance < questState.entryFee ? 'Approve and Join' : 'Join Quest'}</span>}
                          />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {previousQuest && bigIntToNumber(previousQuest.id) > 0 && (
                  <div className="bg-black/80 border border-white/10 rounded p-4 w-full">
                    <h2 className="font-black text-xl mb-3 text-center">Previous Quest Leaderboard #{bigIntToNumber(previousQuest.id)}</h2>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                      <Stat label="Status" value={previousQuest.canceled ? 'Canceled' : previousQuest.active ? 'Active' : 'Stopped'} />
                      <Stat label="Entries" value={String(bigIntToNumber(previousQuest.entryCount))} />
                      <Stat label="Pool" value={formatTokenAmount(previousQuest.prizePool, questState.tokenDecimals, questState.tokenSymbol)} />
                      <Stat label="Stopped" value={formatDate(previousQuest.stoppedAt)} />
                    </div>
                    <div className="grid md:grid-cols-3 gap-3 text-sm">
                      <div className="bg-white/5 rounded p-3">1st entry #{bigIntToNumber(previousQuest.firstEntryId)} paid {formatTokenAmount(previousQuest.paidFirst, questState.tokenDecimals, questState.tokenSymbol)}</div>
                      <div className="bg-white/5 rounded p-3">2nd entry #{bigIntToNumber(previousQuest.secondEntryId)} paid {formatTokenAmount(previousQuest.paidSecond, questState.tokenDecimals, questState.tokenSymbol)}</div>
                      <div className="bg-white/5 rounded p-3">3rd entry #{bigIntToNumber(previousQuest.thirdEntryId)} paid {formatTokenAmount(previousQuest.paidThird, questState.tokenDecimals, questState.tokenSymbol)}</div>
                    </div>
                    {previousQuest.revealedRulesJson ? (
                      <div className="mt-4 grid md:grid-cols-2 gap-3">
                        <div className="bg-white/5 rounded p-3">
                          <div className="text-xs uppercase text-white/50 mb-1">Revealed rules</div>
                          <pre className="whitespace-pre-wrap text-xs text-white/80">{previousQuest.revealedRulesJson}</pre>
                        </div>
                        <div className="bg-white/5 rounded p-3">
                          <div className="text-xs uppercase text-white/50 mb-1">Salt</div>
                          <div className="font-mono text-xs break-all">{previousQuest.revealedSalt}</div>
                          <div className="text-xs uppercase text-white/50 mt-3 mb-1">Commitment</div>
                          <div className="font-mono text-xs break-all">{previousQuest.rulesCommitment}</div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-white/60 text-sm">Rules reveal is not available yet. Commitment: <span className="font-mono">{shortHash(previousQuest.rulesCommitment)}</span></p>
                    )}
                  </div>
                )}

                {(error || success) && (
                  <div className="text-center font-bold">
                    {error && <p className="text-red-200 bg-red-950/70 border border-red-500/30 rounded p-3">{error}</p>}
                    {success && <p className="text-green-100 bg-green-950/70 border border-green-400/30 rounded p-3">{success}</p>}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
