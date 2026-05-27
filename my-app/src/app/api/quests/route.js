import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import { neon } from '@neondatabase/serverless';
import seedNames from '../../../../data/pdp-card-name-tokenids.json';

const PDP_COLLECTION = '0x8cB5B730943b25403CCac6d5fD649bd0cbDE76D8'.toLowerCase();
const apiKeys = process.env.VIBE_API_KEYS ? process.env.VIBE_API_KEYS.split(',').map(key => key.trim()).filter(Boolean) : [];
const USE_DB = String(process.env.USE_POSTGRES || '').toLowerCase() === 'true';
const sql = USE_DB && process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

const questInventoryCache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 3,
});

const seedNameByTokenId = new Map();
Object.entries(seedNames.tokenIdsByCardName || {}).forEach(([name, tokenIds]) => {
  tokenIds.forEach((tokenId) => seedNameByTokenId.set(String(tokenId), name));
});

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

function getTraitName(metadata) {
  const traits = Array.isArray(metadata?.traits) ? metadata.traits : [];
  const nameTrait = traits.find((trait) => {
    const key = String(trait?.key || trait?.trait_type || '').toLowerCase();
    return key === 'name';
  });
  return nameTrait?.value ? String(nameTrait.value) : '';
}

async function loadTokenNamesFromDb(tokenIds) {
  if (!sql || tokenIds.length === 0) return new Map();

  try {
    const numericTokenIds = tokenIds.map(tokenId => Number(tokenId)).filter(Number.isFinite);
    if (numericTokenIds.length === 0) return new Map();

    const rows = await sql`
      SELECT token_id, card_name
      FROM pdp_token_names
      WHERE token_id = ANY(${numericTokenIds})
    `;

    return new Map(rows.map(row => [String(row.token_id), row.card_name]));
  } catch (err) {
    console.error('PDP token name DB load failed:', err.message);
    return new Map();
  }
}

async function upsertTokenNamesToDb(nameRows) {
  if (!sql || nameRows.length === 0) return;

  try {
    for (const row of nameRows) {
      const metadataJson = row.metadata ? JSON.stringify(row.metadata) : null;
      await sql`
        INSERT INTO pdp_token_names (token_id, card_name, source, metadata)
        VALUES (${Number(row.tokenId)}, ${row.name}, 'wield', ${metadataJson}::jsonb)
        ON CONFLICT (token_id) DO UPDATE SET
          card_name = EXCLUDED.card_name,
          source = EXCLUDED.source,
          metadata = COALESCE(EXCLUDED.metadata, pdp_token_names.metadata),
          updated_at = now()
      `;
    }
  } catch (err) {
    console.error('PDP token name DB upsert failed:', err.message);
  }
}

function getImageUrl(card) {
  return (
    card?.metadata?.imageUrl ||
    card?.metadata?.image_url ||
    card?.metadata?.image ||
    card?.imageUrl ||
    card?.image ||
    ''
  );
}

function normalizeCard(card, dbNameByTokenId = new Map()) {
  const tokenId = String(card?.tokenId || card?.token_id || '');
  const contractAddress = String(card?.contractAddress || card?.contract_address || card?.contract?.address || '').toLowerCase();
  const metadata = card?.metadata || {};
  const seedName = Number(tokenId) <= 6454 ? seedNameByTokenId.get(tokenId) : '';
  const traitName = getTraitName(metadata);
  const dbName = dbNameByTokenId.get(tokenId);
  const name = traitName || (USE_DB ? dbName : seedName) || metadata.name || `PDP #${tokenId}`;

  return {
    tokenId,
    contractAddress,
    name,
    traitName,
    dbName,
    imageUrl: getImageUrl(card),
    rarity: card?.rarity || metadata?.rarity || null,
    status: card?.status || '',
    metadata,
  };
}

async function fetchOwnerCardsForStatus(address, status, apiKey) {
  const baseUrl = 'https://build.wield.xyz/vibe/boosterbox';
  const cardsPerPage = 50;
  let page = 1;
  let cards = [];

  while (true) {
    const params = new URLSearchParams({
      status,
      includeMetadata: 'true',
      includeContractDetails: 'true',
      chainId: '8453',
      contractAddress: PDP_COLLECTION,
      page: String(page),
      limit: String(cardsPerPage),
    });
    const url = `${baseUrl}/owner/${address}?${params.toString()}`;
    const response = await fetchWithRetry(url, { headers: { 'API-KEY': apiKey } });
    if (!response.ok) throw new Error(`Wield API ${response.status}`);

    const data = await response.json();
    if (!data.success) throw new Error(data.message || 'Wield API error');

    const pageCards = Array.isArray(data.boxes)
      ? data.boxes
      : data.boosterBox
        ? [data.boosterBox]
        : [];

    cards = cards.concat(pageCards);
    if (pageCards.length < cardsPerPage) break;
    page++;
  }

  return cards;
}

async function fetchSingleTokenMetadata(tokenId, contractAddress) {
  for (const apiKey of apiKeys) {
    try {
      const params = new URLSearchParams({
        includeMetadata: 'true',
        tokenId: String(tokenId),
        contractAddress,
      });
      const response = await fetchWithRetry(`https://build.wield.xyz/vibe/boosterbox/?${params.toString()}`, {
        headers: { 'API-KEY': apiKey },
      });
      if (!response.ok) throw new Error(`Wield token API ${response.status}`);

      const data = await response.json();
      if (!data.success) throw new Error(data.message || 'Wield token API error');

      const box = data.boosterBox || data.boxes?.[0];
      if (box) return box;
    } catch (err) {
      console.error(`Single token metadata error for ${tokenId}:`, err.message);
    }
  }

  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json({ error: 'Address required' }, { status: 400 });
  }

  if (apiKeys.length === 0) {
    return NextResponse.json({ error: 'No API keys configured' }, { status: 500 });
  }

  const cacheKey = `quests_${address.toLowerCase()}`;
  if (questInventoryCache.has(cacheKey)) {
    return NextResponse.json(questInventoryCache.get(cacheKey));
  }

  try {
    let allCards = [];
    for (const status of ['rarity_assigned', 'opened']) {
      let fetched = false;
      for (const apiKey of apiKeys) {
        try {
          const cards = await fetchOwnerCardsForStatus(address, status, apiKey);
          allCards = allCards.concat(cards);
          fetched = true;
          break;
        } catch (err) {
          console.error(`Quest inventory error for ${status}:`, err.message);
        }
      }
      if (!fetched) throw new Error(`Failed to fetch PDP inventory for ${status}`);
    }

    const pdpCards = allCards
      .filter(card => String(card?.contractAddress || card?.contract_address || card?.contract?.address || '').toLowerCase() === PDP_COLLECTION)
      .filter(card => String(card?.tokenId || card?.token_id || ''));

    const tokenIds = [...new Set(pdpCards.map(card => String(card?.tokenId || card?.token_id || '')))];
    const dbNameByTokenId = await loadTokenNamesFromDb(tokenIds);

    if (USE_DB) {
      for (let i = 0; i < pdpCards.length; i++) {
        const tokenId = String(pdpCards[i]?.tokenId || pdpCards[i]?.token_id || '');
        const metadata = pdpCards[i]?.metadata || {};
        if (dbNameByTokenId.has(tokenId) || getTraitName(metadata)) continue;

        const singleTokenCard = await fetchSingleTokenMetadata(tokenId, PDP_COLLECTION);
        if (singleTokenCard?.metadata && getTraitName(singleTokenCard.metadata)) {
          pdpCards[i] = {
            ...pdpCards[i],
            ...singleTokenCard,
            tokenId,
            contractAddress: PDP_COLLECTION,
            metadata: singleTokenCard.metadata,
          };
        }
      }
    }

    const cards = pdpCards
      .map(card => normalizeCard(card, dbNameByTokenId))
      .filter(card => card.tokenId);

    const uniqueCards = cards.filter((card, index, self) =>
      index === self.findIndex(other => other.tokenId === card.tokenId && other.contractAddress === card.contractAddress)
    );

    const namesToUpsert = uniqueCards
      .filter(card => card.traitName && !dbNameByTokenId.has(card.tokenId))
      .map(card => ({ tokenId: card.tokenId, name: card.traitName, metadata: card.metadata || null }));

    await upsertTokenNamesToDb(namesToUpsert);

    const result = { cards: uniqueCards };
    questInventoryCache.set(cacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Quest inventory failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
