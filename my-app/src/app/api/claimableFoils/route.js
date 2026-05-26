// app/api/claimableFoils/route.js
import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import { getAddress, createPublicClient, http } from 'viem';
import { base } from 'wagmi/chains';
import { readContract } from 'wagmi/actions';

const PDP_COLLECTION = getAddress('0x8cb5b730943b25403ccac6d5fd649bd0cbde76d8');
const CLAIM_CONTRACT = getAddress('0x34E06Df657d7D326Fda89B97109586be3c3BD461');

const VIBE_BASE_URL = 'https://build.wield.xyz/vibe/boosterbox/owner';

const apiKeys = process.env.VIBE_API_KEYS ? process.env.VIBE_API_KEYS.split(',') : [];

const client = createPublicClient({
  chain: base,
  transport: http(process.env.ALCHEMY_BASE_URL),
});

const PREVIEW_ABI = [
  {
    name: 'previewClaim',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256[]', name: 'tokenIds' }],
    outputs: [{ type: 'uint256', name: '' }],
  },
];

const cache = new LRUCache({ max: 200, ttl: 1000 * 60 * 5 });

// Exact reward logic copied from VibePepeFoilClaimV3.sol (without 1e18 scaling)
function getReward(rarityLevel, foilType) {
  if (foilType === 'Normal' || !foilType) return 0;

  if (foilType === 'Prize') {
    if (rarityLevel === 1) return 420000;
    if (rarityLevel === 2) return 4200000;
    if (rarityLevel === 3) return 6900000;
    if (rarityLevel === 4) return 42000000;
  } else if (foilType === 'Standard') {
    if (rarityLevel === 1) return 140000;
    if (rarityLevel === 2) return 1400000;
    if (rarityLevel === 3) return 4200000;
    if (rarityLevel === 4) return 14000000;
  }
  return 0;
}

async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function getAllUserPDPFoils(address) {
  let allCards = [];
  let page = 1;
  const limit = 50;

  while (true) {
    let success = false;
    let pageSize = 0;

    for (const key of apiKeys) {
      try {
        const url = `${VIBE_BASE_URL}/${address}?page=${page}&limit=${limit}&contractAddress=${PDP_COLLECTION}&includeMetadata=true`;
        const data = await fetchWithRetry(url, { headers: { 'API-KEY': key.trim() } });

        if (!data.success) continue;

        const filtered = (data.boxes || []).filter(card => {
          const foil = card.metadata?.foil;
          return card.rarity > 0 && (foil === 'Standard' || foil === 'Prize');
        });

        allCards = [...allCards, ...filtered];
        pageSize = data.boxes?.length || 0;
        success = true;
        break;
      } catch (err) {
        // continue with next key
      }
    }

    if (!success) break;

    // End of pagination: fewer results than limit
    if (pageSize < limit) break;

    page++;
  }

  return allCards;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json({ error: 'Address required' }, { status: 400 });
  }
  if (apiKeys.length === 0) {
    return NextResponse.json({ error: 'No VIBE_API_KEYS configured' }, { status: 500 });
  }

  const cacheKey = `claimfoils_${address.toLowerCase()}`;
  if (cache.has(cacheKey)) {
    return NextResponse.json(cache.get(cacheKey));
  }

  try {
    const owner = getAddress(address);
    const rawFoils = await getAllUserPDPFoils(owner);

    const tokenIds = rawFoils
      .map(c => BigInt(c.tokenId || 0))
      .filter(id => id > 0n);

    let verifiedTotal = 0n;
    try {
      if (tokenIds.length > 0) {
        verifiedTotal = await readContract({
          client,
          address: CLAIM_CONTRACT,
          abi: PREVIEW_ABI,
          functionName: 'previewClaim',
          args: [tokenIds],
        });
      }
    } catch (e) {
      console.warn('previewClaim failed:', e.shortMessage || e.message);
    }

    const cards = rawFoils.map(card => {
      const tokenId = Number(card.tokenId);
      if (!tokenId) return null;

      const rarity = card.rarity;
      const foil = card.metadata?.foil || 'Normal';
      const expectedReward = getReward(rarity, foil);

      if (expectedReward === 0) return null;

      return {
        tokenId,
        rarity,
        foil,
        expectedReward,
      };
    }).filter(Boolean);

    const result = {
      cards,
      verifiedTotalClaimable: Number(verifiedTotal),
      expectedTotal: cards.reduce((sum, c) => sum + c.expectedReward, 0),
    };

    cache.set(cacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('claimableFoils error:', {
      address,
      message: err.message,
      stack: err.stack,
    });
    return NextResponse.json(
      { error: 'Internal error while fetching claimable foils', details: err.message },
      { status: 500 }
    );
  }
}
