import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { readContract } from 'viem/actions';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

// Path per file persistente (root project)
const LISTINGS_FILE = path.join(process.cwd(), 'listings.json');

// Funzione helper per load/save Map da/to JSON
function loadListings() {
  if (!existsSync(LISTINGS_FILE)) return new Map();
  try {
    const data = JSON.parse(readFileSync(LISTINGS_FILE, 'utf8'));
    return new Map(Object.entries(data).map(([k, v]) => [k, { ...v, timestamp: Number(v.timestamp) }]));
  } catch (err) {
    console.error('Load listings error:', err);
    return new Map();
  }
}

function saveListings(map) {
  try {
    const data = Object.fromEntries(map.entries());
    writeFileSync(LISTINGS_FILE, JSON.stringify(data, null, 2));
    console.log(`Saved ${map.size} listings to ${LISTINGS_FILE}`);
  } catch (err) {
    console.error('Save listings error:', err);
  }
}

// Global store (load on startup, ma ricarica su GET/POST)
let activeListings = loadListings();

// ABI events per parsing
const EVENTS_ABI = [
  "event ListingCreated(uint256 indexed tokenId, address indexed collection, address indexed seller, uint256 price, bool isEth)",
  "event ListingDelisted(uint256 indexed tokenId, address indexed collection, address indexed seller)"
];
const iface = new ethers.Interface(EVENTS_ABI);

const LISTING_CREATED_SIG = '0x3cf8eaa46d9accaa9c8e76a1b58ee317d0eac0885fb7635711309f21e5a25fb9';
const LISTING_DELISTED_SIG = '0xf9741fa638211b5a51b463b897364db27647d45fe2225a423a26a61cc293333f';

const MARKETPLACE_ABI = [  // Snippet da page.js
  {
    "inputs": [
      {"name": "_collection", "type": "address"},
      {"name": "tokenId", "type": "uint256"}
    ],
    "name": "getListingDetails",
    "outputs": [
      {"name": "listingPrice", "type": "uint256"},
      {"name": "isEth", "type": "bool"},
      {"name": "currency", "type": "address"}
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

const CONTRACT_ADDRESS = '0x37E6ca374bCF8622c0C7e3E0c51EfD1D37fE79d4';
const publicClient = createPublicClient({
  chain: base,
  transport: http('https://base-mainnet.g.alchemy.com/v2/b5LYIHG47qjRrmAHoacre'), // Dal tuo log
});

// Webhook ID dal dashboard Alchemy (.env) - COMMENTATO PER DEBUG
const ALCHEMY_WEBHOOK_ID = process.env.ALCHEMY_WEBHOOK_ID || 'debug-mode-no-check';

// Funzione helper per fetch metadata indipendente (usa Wield API)
async function fetchMetadata(tokenId, contractAddress) {
  const vibeApiKeys = process.env.VIBE_API_KEYS?.split(',') || [];
  if (vibeApiKeys.length === 0) {
    console.error('VIBE_API_KEYS not set in .env');
    return { 
      imageUrl: 'https://via.placeholder.com/300x400?text=NFT+Card', 
      name: 'Unknown Card', 
      rarity: 'Unknown', 
      wear: '0', 
      foil: 'Normal',
      tokenAddress: '0x0000000000000000000000000000000000000000',
      tokenSymbol: 'UNKNOWN',
      pricePerPackUsd: 0, // Fallback
      error: 'API keys not configured' 
    };
  }

  const apiKey = vibeApiKeys[0].trim();
  const wieldUrl = `https://build.wield.xyz/vibe/boosterbox/?includeMetadata=true&tokenId=${tokenId}&contractAddress=${contractAddress}`;

  try {
    const response = await fetch(wieldUrl, {
      method: 'GET',
      headers: {
        'API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Wield fetch error: HTTP ${response.status} for tokenId=${tokenId}, contract=${contractAddress}`);
      return { 
        imageUrl: 'https://via.placeholder.com/300x400?text=NFT+Card', 
        name: 'Unknown Card', 
        rarity: 'Unknown', 
        wear: '0', 
        foil: 'Normal',
        tokenAddress: '0x0000000000000000000000000000000000000000',
        tokenSymbol: 'UNKNOWN',
        pricePerPackUsd: 0,
        error: `Metadata not found (HTTP ${response.status})` 
      };
    }

    const data = await response.json();
    const boosterBox = data.boosterBox;
    const imageUrl = boosterBox?.metadata?.imageUrl || 'https://via.placeholder.com/300x400?text=NFT+Card';
    let name = boosterBox?.metadata?.name || 'Unknown Card';
    let rarity = boosterBox?.rarityName || 'Unknown';
    const wear = boosterBox?.metadata?.wear || '0';
    const foil = boosterBox?.metadata?.foil || 'Normal';
    const tokenAddress = boosterBox?.contract?.tokenAddress || '0x0000000000000000000000000000000000000000';
    const tokenSymbol = boosterBox?.contract?.tokenSymbol || 'UNKNOWN';
    let pricePerPackUsd = 0;
    if (boosterBox?.contract?.pricePerPackUsd) {
      pricePerPackUsd = parseFloat(boosterBox.contract.pricePerPackUsd.replace('$', '')); // e.g., "$0.07" → 0.07
    }

    // Fix: Title case rarity (e.g., "COMMON" → "Common")
    rarity = rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase();

    // Fix: Strip #digits da name (e.g., "BlackHole #3" → "BlackHole")
    name = name.replace(/#\d+$/, '');

    console.log(`Fetched metadata for tokenId=${tokenId}: imageUrl=${imageUrl}, name=${name}, rarity=${rarity}, wear=${wear}, foil=${foil}, token=${tokenAddress}, symbol=${tokenSymbol}, pricePerPackUsd=${pricePerPackUsd}`);

    return { imageUrl, name, rarity, wear, foil, tokenAddress, tokenSymbol, pricePerPackUsd };
  } catch (err) {
    console.error('Metadata fetch error:', err);
    return { 
      imageUrl: 'https://via.placeholder.com/300x400?text=NFT+Card', 
      name: 'Unknown Card', 
      rarity: 'Unknown', 
      wear: '0', 
      foil: 'Normal',
      tokenAddress: '0x0000000000000000000000000000000000000000',
      tokenSymbol: 'UNKNOWN',
      pricePerPackUsd: 0,
      error: 'Failed to fetch metadata' 
    };
  }
}

export async function POST(request) {
  const body = await request.json();
  console.log('=== FULL WEBHOOK PAYLOAD ==='); // Debug aggressivo
  console.log(JSON.stringify(body, null, 2)); // Log completo per inspect
  console.log('=== END PAYLOAD ===');

  // TEMP: Commenta check per debug (riattiva dopo)
  // if (!ALCHEMY_WEBHOOK_ID) {
  //   console.error('Webhook ID not configured in .env');
  //   return NextResponse.json({ error: 'Webhook ID not configured' }, { status: 500 });
  // }
  // if (body.event?.type !== 'GRAPHQL' || body.webhookId !== ALCHEMY_WEBHOOK_ID) {
  //   console.error('Invalid event or webhook ID:', body.event?.type, body.webhookId);
  //   return NextResponse.json({ error: 'Invalid event or webhook ID' }, { status: 401 });
  // }

  // Ricarica Map da file (in caso di cold start)
  activeListings = loadListings();

  // Payload: body.event.data.block.logs (array di logs per block/tx)
  const logs = body.event?.data?.block?.logs || [];
  console.log('Logs count:', logs.length); // Debug batch
  let changes = 0;

for (const log of logs) {
  try {
    const topics = log.topics || [];
    const topic0 = topics[0];
    if (!topic0) continue; // Skip invalid logs

    console.log('Processing log:', { 
      address: log.account?.address, 
      topic0: topic0, 
      topicsCount: topics.length, 
      dataSample: log.data?.substring(0,50) + '...' 
    });

    // Manual decode basato su topic[0]
if (topic0 === LISTING_CREATED_SIG && topics.length === 4) {
  const data = log.data;
  console.log('Full data for ListingCreated:', data); // Debug full hex

  // Flexible: Expected 130, ma accetta 126+ (troncato OK, slice dinamico)
  if (data.length < 66) { // Min per price
    throw new Error(`Data too short: ${data.length} chars`);
  }

  const hexData = data.startsWith('0x') ? data.slice(2) : data;
  const priceHex = hexData.slice(0, 64); // Primi 64 hex chars (32 bytes) per price
  const isEthHex = hexData.length > 64 ? hexData.slice(64, 128) : '0000000000000000000000000000000000000000000000000000000000000000'; // Pad se short

const tokenId = ethers.toBigInt(topics[1]).toString();
const collectionRaw = topics[2];
const sellerRaw = topics[3];
console.log('Raw topics for addresses:', { collectionRaw, sellerRaw }); // Debug

const collection = ethers.getAddress(collectionRaw.slice(-40)).toLowerCase();
const seller = ethers.getAddress(sellerRaw.slice(-40)).toLowerCase();

const price = ethers.toBigInt('0x' + priceHex).toString();
const isEth = Boolean(Number(ethers.toBigInt('0x' + isEthHex)));
  const key = `${collection}-${tokenId}`;

let currency = isEth ? '0x0000000000000000000000000000000000000000' : null;
if (!isEth) {
  try {
    const details = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: MARKETPLACE_ABI,
      functionName: 'getListingDetails',
      args: [collection, BigInt(tokenId)],
    });
    currency = details[2]; // currency address
    console.log(`Fetched boosterToken for ${key}: ${currency}`);
  } catch (fetchErr) {
    console.error(`Failed to fetch boosterToken for ${key}:`, fetchErr);
    currency = '0x0000000000000000000000000000000000000000'; // Fallback
  }
}

activeListings.set(key, {
  tokenId,
  collection: ethers.getAddress(collectionRaw.slice(-40)),
  seller,
  price,
  isEth,
  currency,  // Ora popola solo se !isEth
  timestamp: Date.now()
});

  console.log(`Added listing: ${key} (price: ${price}, isEth: ${isEth})`);
  changes++;
}
else if (topic0 === LISTING_DELISTED_SIG && topics.length === 4) {
      // ListingDelisted: topics[1]=tokenId, [2]=collection, [3]=seller; no data
      const data = log.data;
      if (data !== '0x') {
        console.warn(`Unexpected data for Delisted: ${data}`);
      }

const tokenId = ethers.toBigInt(topics[1]).toString();
const collectionRaw = topics[2];
const key = `${ethers.getAddress(collectionRaw.slice(-40)).toLowerCase()}-${tokenId}`;      if (activeListings.delete(key)) {
        console.log(`Removed listing: ${key}`);
        changes++;
      } else {
        console.log(`Delisted key not found: ${key}`);
      }

    } else {
      console.log(`Skipped log: unknown topic0 ${topic0.slice(0,10)}...`);
    }
  } catch (err) {
    console.error('Manual parse error:', err.message, 'Log:', { topics: log.topics, data: log.data });
  }
}

  // Salva dopo process
  saveListings(activeListings);
  console.log(`Processed ${changes} changes. Total active: ${activeListings.size}`);

  return NextResponse.json({ success: true, activeCount: activeListings.size });
}

// GET per latest (home) o all (futuro)
export async function GET(request) {
  // Ricarica da file per fresh data
  activeListings = loadListings();
  console.log(`GET hit for endpoint=${new URL(request.url).searchParams.get('endpoint')}. Loaded ${activeListings.size} listings.`);

  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint') || 'latest';

  if (endpoint === 'latest') {
    let latest = null;
    for (const listing of activeListings.values()) {
      if (!latest || listing.timestamp > latest.timestamp) {
        latest = listing;
      }
    }
    if (latest) {
      // Fetch metadata indipendente per latest
      const metadata = await fetchMetadata(latest.tokenId, latest.collection);
      latest = { ...latest, ...metadata };
    }
    // Se latest, fetch currency se !isEth via contract? Per ora skip
    return NextResponse.json(latest || { error: 'No active listings found.' });
  }

  if (endpoint === 'all') {
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const all = Array.from(activeListings.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(offset, offset + limit);
    return NextResponse.json({ listings: all, total: activeListings.size });
  }

  return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
}