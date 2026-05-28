'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { readContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
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

const QUEST_CONTRACT_DISPLAY = `// Quest contract on Base
// Address: 0x2D2199cf2a93Aa4ffc661E5E1E281e21188Ce4B4
// Source file: contracts/Quest.sol

// Core user flow:
// - join(uint256[] tokenIds)
// - getTokenLives(uint256 tokenId)
// - questTokenUsed(uint256 questId, uint256 tokenId)
// - getQuest(uint256 questId)

contract Quest {
    uint256 public constant MIN_CARDS = 1;
    uint256 public constant MAX_CARDS = 4;

    IERC20 public immutable pdpToken;
    IBoosterDrop public immutable pdpCollection;

    uint256 public nextQuestId = 1;
    uint256 public nextEntryId = 1;
    uint256 public activeQuestId;
    uint256 public entryFee = 10_000 ether;
    uint256 public restoreLifeFee = 20_000 ether;

    mapping(uint256 => QuestData) private quests;
    mapping(uint256 => Entry) private entries;
    mapping(uint256 => uint256[]) private questEntryIds;
    mapping(uint256 => TokenLives) public tokenLives;
    mapping(uint256 => mapping(uint256 => bool)) public questTokenUsed;
    mapping(uint8 => uint8) public rarityMaxLives;

    struct QuestData {
        uint256 id;
        bool active;
        uint256 startedAt;
        uint256 stoppedAt;
        uint256 prizePool;
        uint256 entryCount;
        bool canceled;
        bytes32 rulesCommitment;
        uint256 firstEntryId;
        uint256 secondEntryId;
        uint256 thirdEntryId;
        uint256 paidFirst;
        uint256 paidSecond;
        uint256 paidThird;
        string revealedRulesJson;
        string revealedSalt;
    }

    struct Entry {
        uint256 id;
        uint256 questId;
        address player;
        uint256[] tokenIds;
        uint256 paid;
        uint256 createdAt;
    }

    struct TokenLives {
        uint8 remaining;
        uint8 max;
        bool initialized;
    }

    function join(uint256[] calldata tokenIds) external returns (uint256 entryId);
    function getQuest(uint256 questId) external view returns (QuestData memory);
    function getQuestEntryIds(uint256 questId) external view returns (uint256[] memory);
    function getEntry(uint256 entryId) external view returns (Entry memory);
    function getTokenLives(uint256 tokenId) external view returns (uint8 remaining, uint8 maxLives, bool initialized);
    function restoreLife(uint256 tokenId) external;
}`;

function normalizeHash(result) {
  return typeof result === 'string' ? result : result?.hash;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function formatCompactTokenAmount(value, decimals, symbol) {
  if (value === null || value === undefined) return `0 ${symbol}`;
  const amount = Number(formatUnits(value, decimals || 18));
  if (!Number.isFinite(amount)) return formatTokenAmount(value, decimals, symbol);

  const units = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'k' },
  ];
  const unit = units.find(item => Math.abs(amount) >= item.threshold);
  const displayValue = unit ? amount / unit.threshold : amount;
  const formatted = displayValue.toFixed(1).replace(/\.0$/, '');
  return `${formatted}${unit?.suffix || ''} ${symbol}`;
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

function Lives({ remaining, max, selected, onRestore, disabled }) {
  const count = Math.max(Number(max || 0), 1);
  const remainingCount = Number(remaining || 0);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: count }).map((_, index) => {
        const alive = index < remainingCount;
        const canRestore = !alive && onRestore && !disabled;
        return (
          <button
            key={index}
            type="button"
            disabled={!canRestore}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (canRestore) onRestore();
            }}
            className={`relative z-[60] p-0 border-none bg-transparent ${canRestore ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}`}
          >
            <img
              src="/pepe.png"
              alt={alive ? 'Life' : 'Restore spent life'}
              className={`w-10 h-10 object-contain transition-all duration-200 ${alive ? 'brightness-100' : 'brightness-0'}`}
            />
          </button>
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
  const [enteredIds, setEnteredIds] = useState([]);
  const [enteredCards, setEnteredCards] = useState([]);
  const [enteredEntries, setEnteredEntries] = useState([]);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0);
  const [entryPagerDirection, setEntryPagerDirection] = useState('next');
  const [usedTokenPlayers, setUsedTokenPlayers] = useState({});
  const [hoveredQuestCardId, setHoveredQuestCardId] = useState(null);
  const [hiddenQuestCases, setHiddenQuestCases] = useState({});
  const [zoomedQuestLabels, setZoomedQuestLabels] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [showQuestDetails, setShowQuestDetails] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [txStatus, setTxStatus] = useState('idle');

  const formattedEthBalance = ethBalance ? parseFloat(ethBalance.formatted).toFixed(7) : '0';
  const activeQuest = questState.activeQuest;
  const previousQuest = questState.previousQuest;
  const hasActiveQuest = Boolean(activeQuest?.active);
  const selectedCards = useMemo(() => cards.filter(card => selectedIds.includes(card.tokenId)), [cards, selectedIds]);
  const clampedEntryIndex = Math.min(selectedEntryIndex, Math.max(enteredEntries.length - 1, 0));
  const displayEntry = enteredEntries[clampedEntryIndex] || null;
  const displaySelectedIds = selectedIds.length > 0 ? selectedIds : displayEntry?.tokenIds || enteredIds;
  const displaySelectedCards = useMemo(() => displaySelectedIds.map(tokenId => {
    const card = cards.find(item => item.tokenId === tokenId);
    const enteredCard = enteredCards.find(item => item.tokenId === tokenId);
    return { tokenId, name: card?.name || enteredCard?.name || 'PDP card' };
  }), [cards, displaySelectedIds, enteredCards]);
  const cardsPerPage = 8;
  const totalPages = Math.max(1, Math.ceil(cards.length / cardsPerPage));
  const paginatedCards = useMemo(() => {
    const startIndex = (currentPage - 1) * cardsPerPage;
    return cards.slice(startIndex, startIndex + cardsPerPage);
  }, [cards, currentPage]);

  const goToPage = useCallback((page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  }, [totalPages]);

  const copyToClipboard = useCallback((text) => {
    navigator.clipboard.writeText(String(text)).then(() => {
      alert('Copied to clipboard!');
    }).catch((err) => {
      console.error('Failed to copy:', err);
    });
  }, []);

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

      const nextState = {
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
      };

      setQuestState(nextState);
      return nextState;
    } catch (err) {
      console.error('Quest refresh failed:', err);
      setQuestState(prev => ({ ...prev, loading: false }));
      setError(`Quest read failed: ${err.shortMessage || err.message || 'Unknown error'}`);
      return null;
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
      setEnteredIds([]);
      setEnteredCards([]);
      setEnteredEntries([]);
      setSelectedEntryIndex(0);
      setEntryPagerDirection('next');
      setUsedTokenPlayers({});
      setHoveredQuestCardId(null);
      setHiddenQuestCases({});
      setZoomedQuestLabels({});
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
      setCurrentPage(1);
      setSelectedIds(prev => prev.filter(tokenId => withLives.some(card => card.tokenId === tokenId && card.livesRemaining > 0 && !card.usedInQuest)));
    } catch (err) {
      console.error('Quest card fetch failed:', err);
      setError(`Could not load your PDP cards: ${err.message}`);
    } finally {
      setCardsLoading(false);
    }
  }, [address, isConnected, questState.activeQuestId, refreshCardLives]);

  const refreshUserEntryData = useCallback(async (activeQuestId, entryIds, preferredIndex = null) => {
    if (!config || !address || activeQuestId <= 0n || !entryIds.length) {
      setEnteredIds([]);
      setEnteredCards([]);
      setEnteredEntries([]);
      setSelectedEntryIndex(0);
      setEntryPagerDirection('next');
      setUsedTokenPlayers({});
      return;
    }

    const entries = await Promise.all(entryIds.map(async (entryId) => {
      const entry = await readContract(config, {
        address: QUEST_CONTRACT,
        abi: questAbi,
        functionName: 'getEntry',
        args: [entryId],
        chainId: BASE_CHAIN_ID,
      });
      return entry;
    }));

    const tokenPlayerMap = entries.reduce((map, entry) => {
      const player = String(entry?.player || entry?.[2] || '');
      const tokenIds = entry?.tokenIds || entry?.[3] || [];
      tokenIds.forEach(tokenId => {
        map[tokenId.toString()] = player;
      });
      return map;
    }, {});
    setUsedTokenPlayers(tokenPlayerMap);

    const ownedEntries = entries
      .filter(entry => String(entry?.player || entry?.[2] || '').toLowerCase() === address.toLowerCase())
      .map(entry => ({
        entryId: (entry?.id || entry?.[0] || 0n).toString(),
        tokenIds: (entry?.tokenIds || entry?.[3] || []).map(tokenId => tokenId.toString()),
      }))
      .filter(entry => entry.tokenIds.length > 0);

    setEnteredEntries(ownedEntries);
    setSelectedEntryIndex(prev => Math.min(preferredIndex ?? prev, Math.max(ownedEntries.length - 1, 0)));
    if (preferredIndex !== null && preferredIndex >= ownedEntries.length - 1) {
      setEntryPagerDirection('previous');
    }
    setEnteredIds(ownedEntries[0]?.tokenIds || []);

    const tokenIds = [...new Set(ownedEntries.flatMap(entry => entry.tokenIds))];
    if (!tokenIds.length) {
      setEnteredCards([]);
      return;
    }

    const response = await fetch(`/api/quests?tokenIds=${encodeURIComponent(tokenIds.join(','))}`);
    if (!response.ok) throw new Error(`Entry token API ${response.status}`);
    const data = await response.json();
    setEnteredCards(Array.isArray(data.cards) ? data.cards : []);
  }, [address, config]);

  const refreshUserEntry = useCallback(async () => {
    if (!config || !address || questState.activeQuestId <= 0n || !questState.entryIds.length) {
      setEnteredIds([]);
      setEnteredCards([]);
      setEnteredEntries([]);
      setSelectedEntryIndex(0);
      setEntryPagerDirection('next');
      setUsedTokenPlayers({});
      return;
    }

    try {
      await refreshUserEntryData(questState.activeQuestId, questState.entryIds);
    } catch (err) {
      console.error('User quest entry refresh failed:', err);
      setEnteredIds([]);
      setEnteredCards([]);
      setEnteredEntries([]);
      setSelectedEntryIndex(0);
      setEntryPagerDirection('next');
      setUsedTokenPlayers({});
    }
  }, [address, config, questState.activeQuestId, questState.entryIds, refreshUserEntryData]);

  useEffect(() => {
    refreshQuest();
  }, [refreshQuest]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  useEffect(() => {
    refreshUserEntry();
  }, [refreshUserEntry]);

  useEffect(() => {
    setCurrentPage(prev => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (enteredEntries.length <= 1) {
      setEntryPagerDirection('next');
    }
  }, [enteredEntries.length]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    localStorage.clear();
    resetSignature();
    setCards([]);
    setSelectedIds([]);
    setEnteredIds([]);
    setEnteredCards([]);
    setEnteredEntries([]);
    setSelectedEntryIndex(0);
    setEntryPagerDirection('next');
    setUsedTokenPlayers({});
    setHoveredQuestCardId(null);
    setHiddenQuestCases({});
    setZoomedQuestLabels({});
    setCurrentPage(1);
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

  const waitForJoinReflection = async (tokenIds, activeId) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const usedFlags = await Promise.all(tokenIds.map(tokenId => readContract(config, {
        address: QUEST_CONTRACT,
        abi: questAbi,
        functionName: 'questTokenUsed',
        args: [activeId, BigInt(tokenId)],
        chainId: BASE_CHAIN_ID,
      }).catch(() => false)));

      if (usedFlags.every(Boolean)) return;
      await delay(1500);
    }
  };

  const waitForRestoreReflection = async (tokenId, previousRemaining) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const lives = await readContract(config, {
        address: QUEST_CONTRACT,
        abi: questAbi,
        functionName: 'getTokenLives',
        args: [BigInt(tokenId)],
        chainId: BASE_CHAIN_ID,
      }).catch(() => null);
      const remaining = Number(lives?.[0] ?? lives?.remaining ?? previousRemaining);
      if (remaining > previousRemaining) return;
      await delay(1500);
    }
  };

  const refreshAfterMutation = async (baseCards = cards, preferredEntryIndex = null) => {
    const freshQuest = await refreshQuest();
    const activeId = freshQuest?.activeQuestId ?? questState.activeQuestId;
    const updated = await refreshCardLives(baseCards, activeId);
    setCards(updated);
    if (freshQuest?.activeQuestId > 0n && freshQuest?.entryIds?.length) {
      await refreshUserEntryData(freshQuest.activeQuestId, freshQuest.entryIds, preferredEntryIndex);
    }
  };

  const approveQuestSpendingIfNeeded = async (requiredAmount) => {
    if (questState.allowance >= requiredAmount) return;

    setTxStatus('approving');
    const approveResult = await writeContract(config, {
      address: questState.pdpToken,
      abi: erc20Abi,
      functionName: 'approve',
      args: [QUEST_CONTRACT, MAX_UINT256],
      chainId: BASE_CHAIN_ID,
    });
    const approveHash = normalizeHash(approveResult);
    if (approveHash) await waitForTransactionReceipt(config, { hash: approveHash, chainId: BASE_CHAIN_ID });

    for (let attempt = 0; attempt < 8; attempt++) {
      const latestAllowance = await readContract(config, {
        address: questState.pdpToken,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, QUEST_CONTRACT],
        chainId: BASE_CHAIN_ID,
      }).catch(() => 0n);

      if (latestAllowance >= requiredAmount) {
        setQuestState(prev => ({ ...prev, allowance: latestAllowance }));
        return;
      }

      await delay(1200);
    }

    throw new Error('Approval confirmed, but allowance is not visible yet. Please retry in a few seconds.');
  };

  const handleRestoreLife = async (card) => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (chainId !== BASE_CHAIN_ID) {
      setError('Please switch to Base chain (ID: 8453) before restoring a life.');
      return;
    }
    const livesRemaining = Number(card.livesRemaining || 0);
    const livesMax = Math.max(Number(card.livesMax || 0), 1);
    if (livesRemaining >= livesMax) {
      setError(`Token #${card.tokenId} already has full lives.`);
      return;
    }
    if (questState.tokenBalance < questState.restoreLifeFee) {
      setError(`Not enough ${questState.tokenSymbol} to restore a life.`);
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await approveQuestSpendingIfNeeded(questState.restoreLifeFee);

      setTxStatus('restoring');
      const restoreResult = await writeContract(config, {
        address: QUEST_CONTRACT,
        abi: questAbi,
        functionName: 'restoreLife',
        args: [BigInt(card.tokenId)],
        chainId: BASE_CHAIN_ID,
      });
      const restoreHash = normalizeHash(restoreResult);
      if (restoreHash) await waitForTransactionReceipt(config, { hash: restoreHash, chainId: BASE_CHAIN_ID });

      await waitForRestoreReflection(card.tokenId, livesRemaining);
      await refreshAfterMutation(cards);
      setSuccess(`Restored one life for #${card.tokenId}.`);
    } catch (err) {
      console.error('Restore life failed:', err);
      setError(`Restore failed: ${err.shortMessage || err.message || 'Unknown error'}`);
    } finally {
      setTxStatus('idle');
    }
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
      await approveQuestSpendingIfNeeded(questState.entryFee);

      setTxStatus('joining');
      const joiningCards = selectedCards;
      const tokenIds = joiningCards.map(card => BigInt(card.tokenId));
      const tokenIdStrings = joiningCards.map(card => card.tokenId);
      const joinResult = await writeContract(config, {
        address: QUEST_CONTRACT,
        abi: questAbi,
        functionName: 'join',
        args: [tokenIds],
        chainId: BASE_CHAIN_ID,
      });
      const joinHash = normalizeHash(joinResult);
      if (joinHash) await waitForTransactionReceipt(config, { hash: joinHash, chainId: BASE_CHAIN_ID });

      await waitForJoinReflection(tokenIdStrings, questState.activeQuestId);
      setSelectedIds([]);
      await refreshAfterMutation(cards, enteredEntries.length);
      setSuccess('Joined the active quest. Lives refreshed.');
    } catch (err) {
      console.error('Join failed:', err);
      setError(`Join failed: ${err.shortMessage || err.message || 'Unknown error'}`);
    } finally {
      setTxStatus('idle');
    }
  };

  const txLabel = txStatus === 'approving' ? 'Approving PDP spending...' : txStatus === 'joining' ? 'Joining quest...' : txStatus === 'restoring' ? 'Restoring life...' : '';
  const joinDisabled = txStatus !== 'idle' || !hasActiveQuest || selectedCards.length === 0 || selectedCards.length > 4 || chainId !== BASE_CHAIN_ID;
  const activePrizePool = activeQuest?.prizePool || 0n;
  const showEntryPager = selectedIds.length === 0 && enteredEntries.length > 1;
  const entryPagerIsPrevious = entryPagerDirection === 'previous';
  const questInfoBox = hasActiveQuest && showQuestDetails ? (
    <div
      className="bg-center bg-no-repeat bg-contain px-12 py-9 min-w-[300px] min-h-[315px] flex flex-col items-center justify-center text-black"
      style={{ backgroundImage: 'url(/addressbg.png)' }}
    >
      <div className="w-48 -translate-y-10 space-y-1.5 text-center text-[11px] font-black leading-tight">
        <div>Quest #{bigIntToNumber(activeQuest.id)}</div>
        <div>Participants: {bigIntToNumber(activeQuest.entryCount)}</div>
        <div>Collected: {formatCompactTokenAmount(activePrizePool, questState.tokenDecimals, questState.tokenSymbol)}</div>
        <div>Quote: {formatCompactTokenAmount(questState.entryFee, questState.tokenDecimals, questState.tokenSymbol)}</div>
        <div>1st: {formatCompactTokenAmount(prizeShare(activePrizePool, 60), questState.tokenDecimals, questState.tokenSymbol)}</div>
        <div>2nd: {formatCompactTokenAmount(prizeShare(activePrizePool, 30), questState.tokenDecimals, questState.tokenSymbol)}</div>
        <div>3rd: {formatCompactTokenAmount(prizeShare(activePrizePool, 10), questState.tokenDecimals, questState.tokenSymbol)}</div>
        <div className="pt-1 uppercase text-[10px]">Rules commitment</div>
        <div className="max-h-12 overflow-y-auto break-all font-mono text-[9px] leading-tight">
          {activeQuest.rulesCommitment}
        </div>
      </div>
    </div>
  ) : null;
  const balanceBox = (
    <div
      className="bg-center bg-no-repeat bg-contain px-12 py-9 min-w-[275px] min-h-[175px] flex flex-col items-center justify-center"
      style={{ backgroundImage: 'url(/addressbg.png)' }}
    >
      <span className="text-xs font-black uppercase leading-none text-black">
        Balance
      </span>
      <span className="mt-1 max-w-[190px] text-center text-base font-black leading-tight text-black break-words">
        {formatCompactTokenAmount(questState.tokenBalance, questState.tokenDecimals, questState.tokenSymbol)}
      </span>
      <Link href="/dex?tab=buy" className="inline-flex hover:scale-105 transition-transform -mt-2 -translate-y-3">
        <img src="/buy.png" alt="Buy" className="w-28 h-auto object-contain" />
      </Link>
    </div>
  );
  const selectedBox = (
    <div
      className="bg-center bg-no-repeat bg-contain px-12 py-8 min-w-[275px] min-h-[175px] flex flex-col items-center justify-center"
      style={{ backgroundImage: 'url(/addressbg.png)' }}
    >
      <div className="-translate-y-3 flex flex-col items-center">
        {showEntryPager && (
          <button
            type="button"
            className="mb-1 border-none bg-transparent p-0 hover:scale-105 transition-transform"
            onClick={() => {
              setSelectedEntryIndex(prev => {
                const lastIndex = enteredEntries.length - 1;
                if (entryPagerDirection === 'previous') {
                  const nextIndex = Math.max(prev - 1, 0);
                  if (nextIndex === 0) setEntryPagerDirection('next');
                  return nextIndex;
                }

                const nextIndex = Math.min(prev + 1, lastIndex);
                if (nextIndex === lastIndex) setEntryPagerDirection('previous');
                return nextIndex;
              });
            }}
          >
            <img
              src={entryPagerIsPrevious ? '/previous.png' : '/next.png'}
              alt={entryPagerIsPrevious ? 'Previous entry' : 'Next entry'}
              className="h-7 w-10 object-contain"
            />
          </button>
        )}
        <span className="text-sm font-black text-black leading-none">
          Selected: {displaySelectedIds.length}/4
        </span>
        {displaySelectedCards.length > 0 && (
          <div className="mt-2 max-h-16 w-44 overflow-y-auto text-center text-[10px] font-black leading-tight text-black">
            {displaySelectedCards.map(({ tokenId, name }) => (
              <div key={tokenId} className="break-words">
                #{tokenId} {name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

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
      {success && txStatus === 'idle' && (
        <div className="fixed top-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded border border-green-300/40 bg-black/90 px-4 py-3 text-center text-sm font-black text-green-100 shadow-lg">
          {success}
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
              className={`w-32 h-20 object-contain transition-all duration-200 ${mode === 'quest' ? 'brightness-125 scale-105' : 'brightness-75'}`}
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
          <button
            onClick={() => setMode('dev')}
            className="p-0 bg-transparent border-none transition-all duration-200 hover:scale-110"
          >
            <img
              src="/dev.png"
              alt="Dev"
              className={`w-16 h-16 transition-all duration-200 ${mode === 'dev' ? 'brightness-125 scale-105' : 'brightness-75'}`}
            />
          </button>
        </div>

        {mode === 'faq' ? (
          <section className="flex flex-col items-center space-y-4">
            <AssetImage
              src="/questime.png"
              alt="Quest time"
              className="w-80 h-auto rounded-lg"
              fallback={<img src="/welcome.png" alt="Welcome" className="w-80 h-auto rounded-lg" />}
            />
            <div className="max-w-2xl text-white text-base leading-relaxed text-center px-4">
              <h2 className="text-xl font-bold mb-2">What's a quest?</h2>
              <p className="mb-4">
                Quests are skill-based PDP memetic guess games. You enter with 1 to 4 Poorly Drawn Pepes, pay the on-chain participation quote in $PDP, and compete for the prize pool. The prize pool is funded by 100% of the revenue generated from entries.
              </p>

              <h2 className="text-xl font-bold mb-2">How does it work?</h2>
              <ul className="text-left mb-4 space-y-1 list-disc list-inside">
                <li>Connect your wallet on Base and pick up to 4 owned PDP cards.</li>
                <li>Each card has lives based on rarity: Common 1, Rare 2, Epic 3, Legendary 4.</li>
                <li>Joining spends 1 life from every selected token ID.</li>
                <li>The same token ID can enter the same quest only once.</li>
                <li>Cards with 0 lives cannot be selected until a life is restored.</li>
                <li>Click a missing life and pay 20k $PDP to restore it.</li>
              </ul>

              <h2 className="text-xl font-bold mb-2">Are the rules public?</h2>
              <p className="mb-4">
                Not while the quest is active. The contract stores a commitment hash first, then after the quest stops the rules JSON and salt can be revealed so everyone can verify the rules were fixed before entries.
              </p>

              <h2 className="text-xl font-bold mb-2">How do I win?</h2>
              <p className="mb-4">
                Every quest has hidden scoring. Card names can score positive or negative points, and some combinations can trigger secret synergies. The best entries are selected after the quest closes, then the rules and salt are revealed so the commitment can be checked.
              </p>

              <h2 className="text-xl font-bold mb-2">Any tip?</h2>
              <p className="mb-4">
                Read the quest banner and the quest name like a clue. The answer is usually hiding in the vibe, not in the obvious stats.
              </p>

              <p className="text-sm italic">
                Quest transactions are final and at your own risk. Check selected cards, lives, and $PDP balance before joining.
              </p>
            </div>
          </section>
        ) : mode === 'dev' ? (
          <div className="w-full flex items-center justify-center px-4">
            <div className="w-full max-w-4xl h-[80vh] bg-white rounded overflow-y-auto p-5 shadow-lg">
              <div className="text-black text-sm leading-relaxed">
                <h2 className="text-lg font-bold mb-2">Quest ({QUEST_CONTRACT})</h2>
                <pre className="text-black font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {QUEST_CONTRACT_DISPLAY}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <>
            {questState.loading ? (
              <div className="flex items-center justify-center py-10">
                <img src="/loading.png" alt="Loading quest data" className="w-40 h-30 sm:w-48 sm:h-36 md:w-56 md:h-40 animate-spin" />
              </div>
            ) : (
              <section className="space-y-5">
                {hasActiveQuest ? (
                  <>
                    <div className="w-full flex flex-col items-center">
                      <button
                        onClick={() => setShowQuestDetails(prev => !prev)}
                        className="p-0 border-none bg-transparent cursor-pointer hover:scale-[1.01] transition-transform"
                      >
                        <img src="/quests-liquidity-event-banner.png" alt="Active quest" className="w-full max-w-3xl h-auto object-contain mb-4" />
                      </button>
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
                  {!isConnected ? (
                    <div className="text-center py-10">
                      <button onClick={() => openConnectModal?.()} className="cursor-pointer border-none bg-transparent">
                        <img src="/connect.png" alt="Connect Wallet" className="w-72 h-28 mx-auto object-contain" />
                      </button>
                    </div>
                  ) : chainId !== BASE_CHAIN_ID ? (
                    <div className="p-4 bg-red-950/80 border border-red-500/40 rounded text-red-100">Please switch to Base chain (ID: 8453).</div>
                  ) : cardsLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <img src="/loading.png" alt="Loading your PDP cards" className="w-40 h-30 sm:w-48 sm:h-36 md:w-56 md:h-40 animate-spin" />
                    </div>
                  ) : cards.length === 0 ? (
                    <div className="flex flex-col lg:flex-row gap-6 items-start">
                      <div className="flex-1 min-w-0 w-full flex justify-center lg:justify-start py-8">
                        <img src="/nocardsfound.png" alt="No cards found" className="w-56 h-56 object-contain opacity-80" />
                      </div>

                      <div className="w-full lg:w-72 flex-shrink-0 flex flex-col items-center lg:items-end gap-4">
                        {questInfoBox}
                        {balanceBox}
                        {displaySelectedCards.length > 0 && selectedBox}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col lg:flex-row gap-6 items-start">
                        <div className="flex-1 min-w-0 w-full">
                          <div className="grid grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
                            {paginatedCards.map((card) => {
                              const cacheKey = `${card.contractAddress}-${card.tokenId}`;
                              const selected = selectedIds.includes(card.tokenId);
                              const selectionBlocked = !hasActiveQuest || card.usedInQuest || card.livesRemaining <= 0;
                              const selectable = hasActiveQuest && !card.usedInQuest && card.livesRemaining > 0;
                              const hovered = hoveredQuestCardId === cacheKey;
                              const caseHidden = hiddenQuestCases[cacheKey];
                              const showCase = card.usedInQuest ? !caseHidden : selected || (selectable && hovered);
                              const caseOpacity = card.usedInQuest || selected ? 'opacity-100 scale-100' : 'opacity-40 scale-100';
                              const labelPlayer = card.usedInQuest ? usedTokenPlayers[card.tokenId] : address;
                              const labelZoomed = zoomedQuestLabels[cacheKey];
                              return (
                                <div
                                  key={cacheKey}
                                  onMouseEnter={() => setHoveredQuestCardId(cacheKey)}
                                  onMouseLeave={() => {
                                    setHoveredQuestCardId(null);
                                    setHiddenQuestCases(prev => {
                                      if (!prev[cacheKey]) return prev;
                                      const next = { ...prev };
                                      delete next[cacheKey];
                                      return next;
                                    });
                                  }}
                                  onClick={() => {
                                    if (card.usedInQuest) {
                                      setHiddenQuestCases(prev => ({ ...prev, [cacheKey]: !prev[cacheKey] }));
                                      return;
                                    }
                                    toggleCard(card);
                                  }}
                                  className={`group text-center transition ${selected ? 'scale-105' : ''} ${selectable || card.usedInQuest ? 'hover:-translate-y-0.5 cursor-pointer' : 'opacity-55'}`}
                                  role="button"
                                  tabIndex={selectionBlocked ? -1 : 0}
                                  onKeyDown={(event) => {
                                    if (!selectionBlocked && (event.key === 'Enter' || event.key === ' ')) {
                                      event.preventDefault();
                                      toggleCard(card);
                                    }
                                  }}
                                >
                                  <div className="relative mx-auto h-[30.375rem] w-80 overflow-hidden">
                                    {card.imageUrl ? (
                                      <div className="absolute top-[139px] left-1/2 z-10 h-[320px] w-[220px] -translate-x-1/2 overflow-hidden rounded-lg transition-transform duration-300 group-hover:scale-95">
                                        <img
                                          src={card.imageUrl}
                                          alt={card.name}
                                          className="block h-full w-full object-fill transition-all duration-300 brightness-100"
                                        />
                                      </div>
                                    ) : (
                                      <div className="absolute top-[139px] left-1/2 z-10 flex h-[320px] w-[220px] -translate-x-1/2 items-center justify-center rounded-lg text-sm text-white/30">
                                        No image
                                      </div>
                                    )}
                                    <div
                                      className={`absolute inset-0 z-30 pointer-events-none ${showCase ? caseOpacity : 'opacity-0 scale-95'} translate-x-[5px] translate-y-[24px] transition-all duration-300`}
                                      style={{
                                        backgroundImage: 'url(/casetemp.png)',
                                        backgroundSize: '96% 96%',
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'center',
                                      }}
                                    />
                                    <div
                                      className={`absolute top-[81px] left-1/2 z-40 h-[52px] w-[192px] -translate-x-1/2 translate-x-[-96px] transition-opacity duration-200 ${showCase ? 'opacity-100' : 'opacity-0'} cursor-pointer`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setZoomedQuestLabels(prev => ({ ...prev, [cacheKey]: !prev[cacheKey] }));
                                      }}
                                    >
                                      <div className={`relative z-10 flex h-full w-full flex-col justify-center overflow-hidden bg-white p-1 pt-[3px] text-left text-[8px] leading-tight text-black shadow ${labelZoomed ? 'scale-150 origin-center' : ''}`}>
                                        <button
                                          type="button"
                                          className="block w-full cursor-pointer truncate bg-transparent p-0 text-left text-black hover:underline"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            copyToClipboard(card.tokenId);
                                          }}
                                        >
                                          <span className="font-black">TokenID:</span> #{card.tokenId}
                                        </button>
                                        <button
                                          type="button"
                                          className="block w-full cursor-pointer break-all bg-transparent p-0 text-left font-mono text-[7px] text-black hover:underline"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            copyToClipboard(labelPlayer || '');
                                          }}
                                        >
                                          <span className="font-black">Player:</span> {labelPlayer || 'Unknown player'}
                                        </button>
                                      </div>
                                      {labelZoomed && (
                                        <div
                                          className="absolute z-20 scale-125 origin-center pointer-events-none"
                                          style={{
                                            top: '-12.5%',
                                            left: '-18.5%',
                                            width: '140%',
                                            height: '125%',
                                            backgroundImage: `url('/label.png')`,
                                            backgroundSize: 'cover',
                                            backgroundRepeat: 'no-repeat',
                                            backgroundPosition: 'center',
                                          }}
                                        />
                                      )}
                                    </div>
                                    <div className="absolute bottom-2 left-1/2 z-50 flex -translate-x-1/2 items-center justify-center">
                                      <Lives
                                        remaining={card.livesRemaining}
                                        max={card.livesMax}
                                        selected={selected}
                                        disabled={txStatus !== 'idle'}
                                        onRestore={() => handleRestoreLife(card)}
                                      />
                                    </div>
                                  </div>
                                  <div className="-mt-9 space-y-2 flex flex-col items-center transition-all duration-200 brightness-100">
                                    {!card.usedInQuest && card.livesRemaining <= 0 && <div className="text-xs text-red-300 font-bold">No lives left</div>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {totalPages > 1 && (
                            <div className="flex items-center justify-center mt-5 space-x-4">
                              <button
                                onClick={() => goToPage(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="p-0 bg-transparent border-none disabled:cursor-not-allowed"
                              >
                                <img
                                  src="/previous.png"
                                  alt="Previous"
                                  className={`w-20 h-16 sm:w-24 sm:h-18 md:w-28 md:h-20 transition-opacity scale-x-110 ${currentPage === 1 ? 'brightness-50 grayscale opacity-50' : ''}`}
                                />
                              </button>
                              <span className="text-white font-black text-sm">
                                {currentPage}/{totalPages}
                              </span>
                              <button
                                onClick={() => goToPage(currentPage + 1)}
                                disabled={currentPage === totalPages}
                                className="p-0 bg-transparent border-none disabled:cursor-not-allowed"
                              >
                                <img
                                  src="/next.png"
                                  alt="Next"
                                  className={`w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20 transition-opacity ${currentPage === totalPages ? 'brightness-50 grayscale opacity-50' : ''}`}
                                />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="w-full lg:w-72 flex-shrink-0 flex flex-col items-center lg:items-end gap-4">
                          {questInfoBox}
                          {balanceBox}
                          {selectedBox}

                          <button
                            onClick={handleJoin}
                            disabled={joinDisabled}
                            className={`p-0 border-none bg-transparent lg:self-center ${joinDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-105 transition-transform'}`}
                          >
                            <AssetImage
                              src="/join.png"
                              alt={questState.allowance < questState.entryFee ? 'Approve and join' : 'Join quest'}
                              className="w-32 h-auto object-contain"
                              fallback={<span className="block px-6 py-3 rounded font-black bg-yellow-300 text-black">{questState.allowance < questState.entryFee ? 'Approve and Join' : 'Join Quest'}</span>}
                            />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {previousQuest && bigIntToNumber(previousQuest.id) > 0 ? (
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
                ) : (
                  <div className="h-16 sm:h-20 lg:h-24" aria-hidden="true" />
                )}

                <div className="w-full flex flex-col items-start space-y-2 mt-24 pb-14 z-0 pl-4 self-start lg:pl-0">
                  <div className="flex flex-col space-y-2 w-fit max-w-full">
                    {/* Banner PDP */}
                    <div className="flex flex-col items-start">
                      <span className="text-left text-xs text-white font-semibold pointer-events-none -mt-3 sm:-mt-4 lg:-mt-5">Support the dev:</span>
                      <a
                        href="https://vibechain.com/market/poorly-drawn-pepes"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-fit block flex-shrink-0"
                      >
                        <img src="/pdp.png" alt="Support PDP" className="w-[24rem] sm:w-[42rem] lg:w-[54rem] max-w-full h-auto object-contain" />
                      </a>
                    </div>
                    {/* Win $PEPE */}
                    <div className="flex flex-col items-start">
                      <span className="text-left text-xs text-white font-semibold pointer-events-none -mt-2 ml-2">Win $PEPE:</span>
                      <Link href="/claim" className="w-fit block flex-shrink-0">
                        <img src="/win.png" alt="Win $PEPE" className="w-56 sm:w-[16rem] lg:w-[22rem] max-w-full h-auto object-contain" />
                      </Link>
                    </div>
                  </div>
                </div>

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
