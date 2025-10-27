'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'next/navigation';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'; // FIX V2: Hooks v2
import { ethers } from 'ethers';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

const CONTRACT_ADDRESS = '0x...'; // Sostituisci con address deployato

const ABI = [
  'function createListing(address _collection, address _boosterToken, uint256 tokenId)',
  'function createListingBatch(address _collection, address _boosterToken, uint256[] calldata tokenIds)',
  'function buyListing(uint256 tokenId) external payable',
  'function delist(uint256 tokenId) external',
  'function getListingDetails(uint256 tokenId) external view returns (uint8 rarity, string memory wear, string memory foilType, uint256 baseTokens, uint256 ethBase, uint256 listingPrice)',
];

// Componente interno per useSearchParams (wrap in Suspense)
function ListingContent() {
  const searchParams = useSearchParams();
  const [isMounted, setIsMounted] = useState(false);

  // FIX V2: Hooks v2
  const { address: walletAddress, isConnected } = isMounted ? useAccount() : { address: null, isConnected: false };
  const { writeContractAsync, error: writeError } = isMounted ? useWriteContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
  }) : { writeContractAsync: async () => {}, error: null };
  const { data: txHash } = writeError ? {} : {}; // Track txHash from write
  const { isLoading: txLoading, isSuccess } = isMounted ? useWaitForTransactionReceipt({ hash: txHash }) : { isLoading: false, isSuccess: false };

  const [form, setForm] = useState({ tokenIds: [], collection: '', boosterToken: '', action: 'create' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">Manage Listing</h1>
        <p>Loading listing details...</p>
      </main>
    );
  }

  useEffect(() => {
    const tokenIdsStr = searchParams.get('tokenIds') || '';
    const tokenIds = tokenIdsStr.split(',').filter(id => id.trim());
    setForm({
      tokenIds,
      collection: searchParams.get('collection') || '',
      boosterToken: searchParams.get('boosterToken') || '',
      action: searchParams.get('action') || 'create'
    });
  }, [searchParams]);

  // FIX V2: useReadContract
  const { data: listingDetails } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: 'getListingDetails',
    args: [BigInt(form.tokenIds[0] || 0)],
    enabled: form.action === 'buy' && form.tokenIds.length > 0 && CONTRACT_ADDRESS !== '0x...',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isConnected || form.tokenIds.length === 0) return setError('Connect wallet and select cards');
    setLoading(true);
    setError(null);
    try {
      const collection = form.collection;
      const boosterToken = form.action === 'create' ? form.boosterToken : ethers.ZeroAddress;
      const tokenIdsBigInt = form.tokenIds.map(id => BigInt(id.trim()));

      if (form.action === 'create') {
        if (form.tokenIds.length === 1) {
          await writeContractAsync({ 
            functionName: 'createListing', 
            args: [collection, boosterToken, tokenIdsBigInt[0]] 
          });
        } else {
          await writeContractAsync({ 
            functionName: 'createListingBatch', 
            args: [collection, boosterToken, tokenIdsBigInt] 
          });
        }
      } else if (form.action === 'buy') {
        const ethPerItem = listingDetails?.listingPrice || 0n;
        await Promise.all(tokenIdsBigInt.map(id => 
          writeContractAsync({ 
            functionName: 'buyListing', 
            args: [id], 
            value: ethPerItem 
          })
        ));
      } else if (form.action === 'delist') {
        await Promise.all(tokenIdsBigInt.map(id => 
          writeContractAsync({ 
            functionName: 'delist', 
            args: [id] 
          })
        ));
      }

      if (isSuccess) {
        window.location.href = '/inventory';
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">Manage Listing</h1>
        <p className="text-center">Connect wallet to manage listings.</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Manage Listing</h1>
      <form onSubmit={handleSubmit} className="space-y-4 w-96">
        <select value={form.action} onChange={(e) => setForm({...form, action: e.target.value})}>
          <option value="create">Create Listing</option>
          <option value="buy">Buy Listing</option>
          <option value="delist">Delist</option>
        </select>
        {form.action === 'create' && (
          <>
            <input 
              type="text" 
              placeholder="Collection Address" 
              value={form.collection} 
              onChange={(e) => setForm({...form, collection: e.target.value})} 
              required 
            />
            <input 
              type="text" 
              placeholder="Booster Token Address" 
              value={form.boosterToken} 
              onChange={(e) => setForm({...form, boosterToken: e.target.value})} 
              required 
            />
          </>
        )}
        <textarea 
          placeholder="Token IDs (comma-separated for batch)" 
          value={form.tokenIds.join(', ')} 
          onChange={(e) => setForm({...form, tokenIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})} 
          required 
        />
        {form.action === 'buy' && listingDetails && (
          <p>
            Est. Price per Item: {ethers.formatEther(listingDetails.listingPrice)} ETH 
            <br />
            Total for {form.tokenIds.length}: {ethers.formatEther(listingDetails.listingPrice * BigInt(form.tokenIds.length))} ETH
          </p>
        )}
        <button 
          type="submit" 
          disabled={loading || txLoading} 
          className="bg-blue-500 text-white px-4 py-2 rounded w-full"
        >
          {loading ? 'Processing...' : `${form.action.charAt(0).toUpperCase() + form.action.slice(1)} Selected`}
        </button>
        {error && <p className="text-red-500">{error}</p>}
        {txLoading && <p>Waiting for transaction...</p>}
        {isSuccess && (
          <p>
            Success! <Link href="/inventory" className="text-blue-500 underline">Back to Inventory</Link>
          </p>
        )}
      </form>
    </main>
  );
}

export default function Listing() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">Manage Listing</h1>
        <p>Loading listing params...</p>
      </main>
    }>
      <ListingContent />
    </Suspense>
  );
}
