import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache'; // Named import for v10+

// Cache in-memory (5 minuti per utente per inventory; 1min globale per ETH price)
const inventoryCache = new LRUCache({
  max: 100, // Max 100 utenti
  ttl: 1000 * 60 * 5, // 5 minuti
  dispose: (value, key) => { /* Clean up if needed */ }
});

const ethPriceCache = new LRUCache({ // NUOVO: Cache globale per ETH/USD
  max: 1, // Solo 1 entry
  ttl: 1000 * 60, // 1 minuto (ETH varia poco)
  dispose: (value, key) => { }
});

const cardPriceCache = new LRUCache({ // NUOVO: Cache per prezzi cards (per tokenId+contract)
  max: 1000, // Max 1000 unique cards
  ttl: 1000 * 60 * 10, // 10 minuti
  dispose: (value, key) => { }
});

// Array di chiavi API (principale + fallback)
const apiKeys = [
  '5A8RM-7NVT3-Y4CL4-DOMFU-YAYO2', // Principale
  'RR2C1-EZ7I3-7O792-94NRG-AR07M', // Riserva 1
  'RTDVD-E68MA-2FA63-UGAGA-WJUAR' // Riserva 2
];

// NUOVO: Provider RPC server-side (usa public per reads)
const { ethers } = await import('ethers'); // Dynamic import per server
const publicProvider = new ethers.JsonRpcProvider('https://base.publicnode.com');

// NUOVO: Fetch ETH/USD con retry (simile a fetchWithRetry)
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

// NUOVO: Calcola prezzo card (server-side, simile a frontend ma con cache)
async function calculateCardPrice(card) {
  const cacheKey = `${card.tokenId}-${card.contractAddress}`;
  if (cardPriceCache.has(cacheKey)) return cardPriceCache.get(cacheKey);

  if (!card.contract?.tokenAddress) return 'N/A';

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

    if (baseTokens === 0n) return 'N/A';

    const ethBase = await boosterToken.getTokenSellQuote(baseTokens);
    const ethUsd = await fetchEthUsdWithRetry();

    const foilType = card.metadata.foil;
    let foilMult = 100n;
    if (foilType === 'Standard') foilMult = 200n;
    else if (foilType === 'Prize') foilMult = 400n;

    const wear = parseFloat(card.metadata.wear);
    let wearMult = 100n;
    if (wear < 0.05) wearMult = 180n;
    else if (wear < 0.2) wearMult = 160n;
    else if (wear < 0.45) wearMult = 140n;
    else if (wear < 0.75) wearMult = 120n;

    const listingPrice = ((ethBase * foilMult * wearMult * 142n) / 1000000n);
    const priceInEth = parseFloat(ethers.formatEther(listingPrice)).toFixed(6);
    const priceInUsd = (parseFloat(priceInEth) * ethUsd).toFixed(2);
    const price = `${priceInEth} ETH (${priceInUsd} USD)`;

    cardPriceCache.set(cacheKey, price);
    return price;
  } catch (err) {
    console.error('Error calculating price:', err);
    return 'N/A';
  }
}

// Funzione retry con backoff (invariata)
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) { // Rate limit
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Backoff esponenziale (1s, 2s, 4s)
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

// Fetch multi-pagina per status (invariato)
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

// NUOVO: Handler per /api/eth-price
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint') || 'inventory'; // Default a inventory, o specifica ?endpoint=eth-price o card-price?tokenId=...&contract=...

  if (endpoint === 'eth-price') {
    try {
      const price = await fetchEthUsdWithRetry();
      return NextResponse.json({ price });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  if (endpoint === 'card-price') {
    const tokenId = searchParams.get('tokenId');
    const contractAddress = searchParams.get('contractAddress');
    const cardData = searchParams.get('cardData'); // JSON string per metadata/foil/wear/rarity
    if (!tokenId || !contractAddress || !cardData) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }
    try {
      const card = JSON.parse(cardData);
      card.tokenId = tokenId;
      card.contractAddress = contractAddress;
      const price = await calculateCardPrice(card);
      return NextResponse.json({ price });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // Handler originale per inventory
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

    // Remove duplicates
    const uniqueCards = allCards.filter((card, index, self) =>
      index === self.findIndex(c => c.tokenId === card.tokenId && c.contractAddress === card.contractAddress)
    );

    const result = { cards: uniqueCards };
    inventoryCache.set(cacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
