// app/dex/actions.js (updated to use pagination.pages for starting tokenId)
'use server';

const VIBE_API_URL = 'https://build.wield.xyz/vibe/boosterbox/range';
const VIBE_API_KEYS = process.env.VIBE_API_KEYS || '';
const VIBE_API_KEY = VIBE_API_KEYS.split(',')[0] || '';

export async function fetchCollectionDataServer(prevState, formData) {
  const contractAddress = formData.get('contractAddress');
  if (!contractAddress) {
    return { error: 'No contract address provided' };
  }
  try {
    const params = new URLSearchParams({
      page: '1',
      limit: '1',
      sortBy: 'latestUpdateTimestamp',
      sortOrder: 'desc',
      includeContractDetails: 'true',
      contractAddress,
      startTokenId: '1',
      endTokenId: '99999999',
    });
    console.log('Fetching with params:', params.toString()); // Debug log
    console.log('Using API key:', VIBE_API_KEY ? 'Set' : 'EMPTY'); // Debug log (hides actual key)
    const response = await fetch(`${VIBE_API_URL}?${params}`, {
      headers: { 'API-KEY': VIBE_API_KEY },
    });
    console.log('Response status:', response.status); // Debug log
    const data = await response.json();
    console.log('Response body preview:', JSON.stringify(data).substring(0, 500) + '...'); // Debug log (truncated)
    if (!response.ok) throw new Error(`API request failed: ${response.status}`);
    if (data.boxes && data.boxes.length > 0 && data.pagination) {
      const item = data.boxes[0];
      const startingTokenId = data.pagination.pages + 1; // Use pages + 1 for starting tokenId
      console.log('Extracted item:', item.tokenId, item.contract?.tokenName, 'Starting Token ID:', startingTokenId); // Debug log
      return {
        success: true,
        collectionData: {
          startingTokenId, // Changed from tokenId to startingTokenId
          name: item.contract.tokenName,
          imageUrl: item.contract.imageUrl,
          symbol: item.contract.tokenSymbol,
          tokenAddress: item.contract.tokenAddress,
        },
      };
    } else {
      console.log('No boxes or pagination found in response'); // Debug log
      return { error: 'No data found for this contract' };
    }
  } catch (err) {
    console.error('Fetch error:', err.message); // Debug log
    return { error: err.message };
  }
}

// Aggiungi questa export alla fine del file
export async function fetchEthPriceServer() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', {
      next: { revalidate: 60 }, // Cache per 1 min
    });
    if (!response.ok) throw new Error(`API request failed: ${response.status}`);
    const data = await response.json();
    return {
      success: true,
      ethPrice: data.ethereum.usd || 0,
    };
  } catch (err) {
    console.error('Fetch ETH price error:', err.message);
    return { error: err.message };
  }
}