import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache'; // Named import for v10+

// Cache in-memory (5 minuti per utente)
const cache = new LRUCache({
  max: 100, // Max 100 utenti
  ttl: 1000 * 60 * 5, // 5 minuti
  dispose: (value, key) => { /* Clean up if needed */ }
});

// Array di chiavi API (principale + fallback)
const apiKeys = [
  '5A8RM-7NVT3-Y4CL4-DOMFU-YAYO2', // Principale
  'RR2C1-EZ7I3-7O792-94NRG-AR07M', // Riserva 1
  'RTDVD-E68MA-2FA63-UGAGA-WJUAR' // Riserva 2
];

// Funzione retry con backoff
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

// Fetch multi-pagina per status
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'Address required' }, { status: 400 });

  const cacheKey = `inventory_${address}`;
  if (cache.has(cacheKey)) {
    return NextResponse.json(cache.get(cacheKey));
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
    cache.set(cacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
