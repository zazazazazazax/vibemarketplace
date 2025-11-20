import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import { ethers } from 'ethers'; // FIX: Import at top, no dynamic for server

// Cache in-memory (5 minuti per utente per inventory; 1min globale per ETH price)
const inventoryCache = new LRUCache({
  max: 100, // Max 100 utenti
  ttl: 1000 * 60 * 5, // 5 minuti
  dispose: (value, key) => { /* Clean up if needed */ }
});

const ethPriceCache = new LRUCache({ // Cache globale per ETH/USD
  max: 1, // Solo 1 entry
  ttl: 1000 * 60, // 1 minuto
  dispose: (value, key) => { }
});

const cardPriceCache = new LRUCache({ // Cache per prezzi cards
  max: 1000, // Max 1000 unique cards
  ttl: 1000 * 60 * 10, // 10 minuti
  dispose: (value, key) => { }
});

// Array di chiavi API (principale + fallback)
const apiKeys = process.env.VIBE_API_KEYS ? process.env.VIBE_API_KEYS.split(',') : [];

// Provider RPC server-side (usa public per reads)
const publicProvider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_ALCHEMY_BASE_URL || 'https://base.publicnode.com');

// Fetch ETH/USD con retry (nuovo)
async function fetchEthUsdWithRetry(retries = 3, delay = 1000) {
  const cacheKey = 'eth_usd';
  if (ethPriceCache.has(cacheKey)) return ethPriceCache.get(cacheKey);

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      const data = await response.json();
      const price = data.ethereum.usd || 0;
      ethPriceCache.set(cacheKey, price);
      return price;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

// Calcola prezzo card (dal tuo snippet, server-side) - FIX: Aggiunto tokenValue corretto (baseTokens in tokens, non wei; surplus 1.42)
async function calculateCardPrice(card) {
  const cacheKey = `${card.tokenId}-${card.contractAddress}`;
  if (cardPriceCache.has(cacheKey)) return cardPriceCache.get(cacheKey);

  if (!card.contract?.tokenAddress) return { ethValue: 0, usdValue: 0, tokenValue: 0 };

  try {
    const collectionDrop = new ethers.Contract(
      card.contractAddress,
      [
        'function COMMON_OFFER() external view returns (uint256)',
        'function RARE_OFFER() external view returns (uint256)',
        'function EPIC_OFFER() external view returns (uint256)',
        'function LEGENDARY_OFFER() external view returns (uint256)',
        'function MYTHIC_OFFER() external view returns (uint256)'
      ],
      publicProvider
    );

    const boosterToken = new ethers.Contract(
      card.contract.tokenAddress,
      ['function getTokenSellQuote(uint256 tokenAmount) external view returns (uint256)'],
      publicProvider
    );

    let baseTokens;
    const rarity = card.rarity;
    if (rarity === 1) baseTokens = await collectionDrop.COMMON_OFFER();
    else if (rarity === 2) baseTokens = await collectionDrop.RARE_OFFER();
    else if (rarity === 3) baseTokens = await collectionDrop.EPIC_OFFER();
    else if (rarity === 4) baseTokens = await collectionDrop.LEGENDARY_OFFER();
    else if (rarity === 5) baseTokens = await collectionDrop.MYTHIC_OFFER();
    else throw new Error('Invalid rarity');

    if (baseTokens === 0n) return { ethValue: 0, usdValue: 0, tokenValue: 0 };

    // Calcola ETH value (logica originale)
    const ethBase = await boosterToken.getTokenSellQuote(baseTokens);
    const ethUsd = await fetchEthUsdWithRetry();
    const foilType = card.metadata.foil || 'Normal';
    let foilMult = 100n;
    if (foilType === 'Standard') foilMult = 200n;
    else if (foilType === 'Prize') foilMult = 400n;

    const wear = parseFloat(card.metadata.wear);
    let wearMult = 100n;
    if (wear < 0.05) wearMult = 180n;
    else if (wear < 0.2) wearMult = 160n;
    else if (wear < 0.45) wearMult = 140n;
    else if (wear < 0.75) wearMult = 120n;

    const listingPrice = ((ethBase * foilMult * wearMult * 142n) / 1000000n); // Surplus 42% = *1.42
    const ethValue = parseFloat(ethers.formatEther(listingPrice));
    const usdValue = ethValue * ethUsd;

    // Calcola tokenValue (FIX: baseTokens in tokens, multipliers decimali, surplus 1.42)
    const baseTokensFormatted = Number(ethers.formatUnits(baseTokens, 18)); // Dividi per 10^18 se in wei
    const tokenValue = Math.round(baseTokensFormatted * (Number(wearMult) / 100) * (Number(foilMult) / 100) * 1.42);

    const result = { ethValue, usdValue, tokenValue };
    cardPriceCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error('Error calculating price:', err);
    return { ethValue: 0, usdValue: 0, tokenValue: 0 };
  }
}

// Funzione retry con backoff (dal tuo)
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      return response;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

// Fetch multi-pagina per status (dal tuo)
async function fetchPagesForStatus(address, status, apiKey) {
  let allCards = [];
  let page = 1;
  const baseUrl = 'https://build.wield.xyz/vibe/boosterbox';
  const cardsPerPage = 50;

  while (true) {
    const url = `${baseUrl}/owner/${address}?status=${status}&includeMetadata=true&includeContractDetails=true&chainId=8453&page=${page}&limit=${cardsPerPage}`;
    const response = await fetchWithRetry(url, {
      headers: { 'API-KEY': apiKey }
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.message);

    const filteredCards = data.boxes.filter((card) => card.rarity > 0);
    allCards = [...allCards, ...filteredCards];

    if (data.boxes.length < cardsPerPage) break;
    page++;
  }
  return allCards;
}

// Handler principale GET
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint') || 'inventory'; // Default 'inventory'

  // Check API keys qui, dentro la funzione
  if (apiKeys.length === 0) {
    return NextResponse.json({ error: 'No API keys configured' }, { status: 500 });
  }

  console.log('API called with endpoint:', endpoint); // Debug log

  if (endpoint === 'eth-price') {
    try {
      const price = await fetchEthUsdWithRetry();
      return NextResponse.json({ price });
    } catch (err) {
      console.error('Eth price error:', err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  if (endpoint === 'card-price') {
    const tokenId = searchParams.get('tokenId');
    const contractAddress = searchParams.get('contractAddress');
    const cardData = searchParams.get('cardData');
    if (!tokenId || !contractAddress || !cardData) {
      return NextResponse.json({ error: 'Missing params: tokenId, contractAddress, cardData' }, { status: 400 });
    }
    try {
      const card = JSON.parse(cardData);
      card.tokenId = tokenId;
      card.contractAddress = contractAddress;
      const result = await calculateCardPrice(card);
      return NextResponse.json(result);
    } catch (err) {
      console.error('Card price error:', err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  if (endpoint === 'card-metadata') {
    const tokenId = searchParams.get('tokenId');
    const contractAddress = searchParams.get('contractAddress');
    if (!tokenId || !contractAddress) {
      return NextResponse.json({ error: 'Missing params: tokenId, contractAddress' }, { status: 400 });
    }

    let success = false;
    for (const key of apiKeys) {
      try {
        const url = `https://build.wield.xyz/vibe/boosterbox/?includeMetadata=true&tokenId=${tokenId}&contractAddress=${contractAddress}`;
        const response = await fetchWithRetry(url, {
          headers: { 'API-KEY': key }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.message);
        
        // Prendi prima card (assumi single tokenId)
        const card = data.boxes[0];
        if (!card || card.rarity <= 0) throw new Error('Invalid card data');
        
        // Estrai imageUrl da metadata (adatta se path diverso)
        const imageUrl = card.metadata?.imageUrl || card.metadata?.image || '';
        
        success = true;
        return NextResponse.json({
          imageUrl,
          metadata: card.metadata,
          rarity: card.rarity,
          // Aggiungi altri campi se needed
        });
      } catch (err) {
        console.error(`Metadata fetch error with key ${key}: ${err.message}`);
        continue;
      }
    }
    if (!success) {
      return NextResponse.json({ error: 'Failed to fetch metadata from all APIs' }, { status: 500 });
    }
  }

  // Default: inventory
  const address = searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'Address required' }, { status: 400 });

  const cacheKey = `inventory_${address}`;
  if (inventoryCache.has(cacheKey)) {
    return NextResponse.json(inventoryCache.get(cacheKey));
  }

  try {
    let allCards = [];
    const statuses = ['rarity_assigned', 'opened'];

    for (const status of statuses) {
      let success = false;
      for (const key of apiKeys) {
        try {
          const cards = await fetchPagesForStatus(address, status, key);
          allCards = [...allCards, ...cards];
          success = true;
          break;
        } catch (err) {
          console.error(`Error with key ${key}: ${err.message}`);
          continue;
        }
      }
      if (!success) throw new Error(`Failed to fetch for status ${status}`);
    }

    // Remove duplicates - Usa tokenId
    const uniqueCards = allCards.filter((card, index, self) =>
      index === self.findIndex(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress)
    );

    const result = { cards: uniqueCards };
    inventoryCache.set(cacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Inventory error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
