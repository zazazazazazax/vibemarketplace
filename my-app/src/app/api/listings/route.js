import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

// Path per file persistente (root project)
const LISTINGS_FILE = path.join(process.cwd(), 'listings.json');

// Funzione helper per load/save Map da/to JSON (dev)
function loadListingsJson() {
  if (!existsSync(LISTINGS_FILE)) return new Map();
  try {
    const data = JSON.parse(readFileSync(LISTINGS_FILE, 'utf8'));
    return new Map(Object.entries(data).map(([k, v]) => [k, { ...v, timestamp: Number(v.timestamp) }]));
  } catch (err) {
    console.error('Load listings JSON error:', err);
    return new Map();
  }
}

function saveListingsJson(map) {
  try {
    const data = Object.fromEntries(Array.from(map.entries()).map(([k, v]) => [k, { ...v, timestamp: v.timestamp }]));
    writeFileSync(LISTINGS_FILE, JSON.stringify(data, null, 2));
    console.log(`JSON save: ${map.size} listings to ${LISTINGS_FILE}`);
  } catch (err) {
    console.error('Save listings JSON error:', err);
  }
}

// Neon DB (prod)
const USE_DB = process.env.NODE_ENV === 'production' || process.env.USE_POSTGRES === 'true';
const sql = neon(process.env.DATABASE_URL);

async function loadListingsDb() {
  try {

    console.log('Executing DB query...');
    const rows = await sql`
      SELECT key, tokenId, collection, seller, price, isEth, currency, timestamp 
      FROM listings 
      ORDER BY timestamp DESC
    `;
    
    console.log('Query rows:', rows?.length || 'null/empty');  // Il tuo originale
    if (!rows || !Array.isArray(rows)) {
      console.warn('Invalid rows from query – fallback empty');
      return new Map();
    }
const mapped = rows.map(r => {
  // FIX: Accedi ai nomi lower-case dal DB (Postgres li salva così)
  const safeTokenId = r.tokenid ? String(r.tokenid).trim() : '0';  // Da r.tokenid (non r.tokenId)
  const safeIsEth = r.iseth !== undefined ? Boolean(r.iseth) : false;  // Da r.iseth (non r.isEth)
  const safeTimestamp = Number(r.timestamp || 0);  // Già stringa, ma safe
  
  
  return [r.key, { 
    key: r.key,
    tokenId: safeTokenId,  // <-- Assegna qui
    collection: r.collection?.toLowerCase() || '',
    seller: r.seller?.toLowerCase() || '',
    price: String(r.price || '0'),
    isEth: safeIsEth,  // <-- Assegna qui
    currency: r.currency || '0x0000000000000000000000000000000000000000',
    timestamp: safeTimestamp
  }];
});
    return new Map(mapped);
  } catch (err) {
    console.error('Load listings DB error:', err);
    return new Map();
  }
}

async function saveListingsDb(map) {
  try {
    console.log('Executing DB save...');
    await sql`DELETE FROM listings`;
    if (map.size === 0) return;
    for (const [key, v] of map.entries()) {
      await sql`
        INSERT INTO listings (key, tokenId, collection, seller, price, isEth, currency, timestamp)
        VALUES (${key}, ${v.tokenId}, ${v.collection}, ${v.seller}, ${v.price}, ${v.isEth}, ${v.currency}, ${v.timestamp})
        ON CONFLICT (key) DO UPDATE SET
          tokenId = EXCLUDED.tokenId, collection = EXCLUDED.collection, seller = EXCLUDED.seller,
          price = EXCLUDED.price, isEth = EXCLUDED.isEth, currency = EXCLUDED.currency, timestamp = EXCLUDED.timestamp
      `;
    }
    console.log(`DB save: ${map.size} listings (upsert)`);
  } catch (err) {
    console.error('Save listings DB error:', err);
  }
}

// Funzione helper per fetch metadata (integrata dal vecchio webhook – usa Vibe API keys da .env)
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
      pricePerPackUsd: 0,
      error: 'API keys not configured' 
    };
  }

  // FIX: Parse tokenId safely e log per debug
  const numTokenId = Number(tokenId);
  if (isNaN(numTokenId) || numTokenId <= 0) {
    console.error(`Invalid tokenId: ${tokenId} (parsed: ${numTokenId}) – skipping API call`);
    return { 
      imageUrl: 'https://via.placeholder.com/300x400?text=Invalid+Token+${tokenId}', 
      name: `Unknown Card (ID: ${tokenId})`, 
      rarity: 'Unknown', 
      wear: '0', 
      foil: 'Normal',
      tokenAddress: '0x0000000000000000000000000000000000000000',
      tokenSymbol: 'UNKNOWN',
      pricePerPackUsd: 0,
      error: 'Invalid tokenId (NaN or <=0)' 
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
      pricePerPackUsd = parseFloat(boosterBox.contract.pricePerPackUsd.replace('$', '').replace(/,/g, '')); // e.g., "$0.07" → 0.07
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

let activeListings = USE_DB ? await loadListingsDb() : loadListingsJson();

export async function POST(request) {
  try {
    const body = await request.json();
    console.log('Manual update payload:', body);

    const { action, items, walletAddress } = body;
    if (!action || !['add', 'remove'].includes(action) || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid action or items' }, { status: 400 });
    }

    activeListings = USE_DB ? await loadListingsDb() : loadListingsJson();

    let changes = 0;
    const zeroAddress = '0x0000000000000000000000000000000000000000';
    for (const item of items) {
      const key = item.key?.toLowerCase();
      if (!key) continue;

      if (action === 'add') {
        const listing = item.listing;
        if (listing && listing.seller?.toLowerCase() === walletAddress?.toLowerCase()) {
          activeListings.set(key, {
            key,
            tokenId: listing.tokenId.toString(),
            collection: listing.collection.toLowerCase(),
            seller: listing.seller.toLowerCase(),
            price: listing.price.toString(),
            isEth: listing.isEth,
            currency: listing.currency || zeroAddress,
            timestamp: Date.now()
          });
          changes++;
          console.log(`Manual add: ${key}`);
        }
      } else if (action === 'remove') {
        if (activeListings.delete(key)) {
          changes++;
          console.log(`Manual remove: ${key}`);
        }
      }
    }

    if (USE_DB) {
      await saveListingsDb(activeListings);
    } else {
      saveListingsJson(activeListings);
    }
    console.log(`Manual update: ${changes} changes. Total: ${activeListings.size}`);

    return NextResponse.json({ success: true, activeCount: activeListings.size });
  } catch (err) {
    console.error('Manual update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET per latest (home, con metadata) o all (con metadata parallel)
export async function GET(request) {
  activeListings = USE_DB ? await loadListingsDb() : loadListingsJson();
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint') || 'latest';

  if (endpoint === 'latest') {
    let latest = null;
    for (const listing of activeListings.values()) {
      if (!latest || listing.timestamp > latest.timestamp) latest = listing;
    }
    if (!latest) {
      return NextResponse.json({ error: 'No active listings' });
    }
    // Aggiungi metadata per home (richiama fetchMetadata)
    const metadata = await fetchMetadata(Number(latest.tokenId), latest.collection);
    const enrichedLatest = { ...latest, ...metadata };
    return NextResponse.json(enrichedLatest);
  }

  if (endpoint === 'all') {
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    let all = Array.from(activeListings.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(offset, offset + limit);
    
    // Aggiungi metadata parallel per ogni listing (per UX completa)
    if (all.length > 0) {
      const metadataPromises = all.map(async (listing) => {
        const metadata = await fetchMetadata(Number(listing.tokenId), listing.collection);
        return { ...listing, ...metadata };
      });
      all = await Promise.all(metadataPromises);
      console.log(`Enriched ${all.length} listings with metadata`);
    }
    
    return NextResponse.json({ listings: all, total: activeListings.size });
  }

  return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
}