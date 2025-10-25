'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'next/navigation'; // FIX: useSearchParams solo; Link per nav
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic'; // FIX: No SSR/prerender
export const revalidate = 0; // FIX: No static cache

const CONTRACT_ADDRESS = '0x...'; // Sostituisci con deployato

const ABI = [
  'function createListing(address _collection, address _boosterToken, uint256 tokenId)',
  'function createListingBatch(address _collection, address _boosterToken, uint256[] calldata tokenIds)',
  'function buyListing(uint256 tokenId) external payable',
  'function delist(uint256 tokenId) external',
  'function getListingDetails(uint256 tokenId) external view returns (uint8 rarity, string memory wear, string memory foilType, uint256 baseTokens, uint256 ethBase, uint256 listingPrice)',
];

export default function Listing() {
  const searchParams = useSearchParams();
  const { address: walletAddress, isConnected } = useAccount();
  const { writeContract, data: txHash } = useWriteContract();
  const { isLoading: txLoading, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const [form, setForm] = useState({ tokenIds: [], collection: '', boosterToken: '', action: 'create' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
      const boosterToken = form.action === 'create' ? form.boosterToken : ethers.ZeroAddress; // Safe dummy
      const tokenIdsBigInt = form.tokenIds.map(id => BigInt(id.trim()));
      let value = 0n;

      if (form.action === 'create') {
        if (form.tokenIds.length === 1) {
          writeContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'createListing', args: [collection, boosterToken, tokenIdsBigInt[0]] });
        } else {
          writeContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'createListingBatch', args: [collection, boosterToken, tokenIdsBigInt] });
        }
      } else if (form.action === 'buy') {
        // Safe BigInt calc per total ETH
        const ethPerItem = listingDetails?.listingPrice || 0n;
        value = ethPerItem * BigInt(form.tokenIds.length);
        await Promise.all(tokenIdsBigInt.map(id => 
          writeContract({ 
            address: CONTRACT_ADDRESS, 
            abi: ABI, 
            functionName: 'buyListing', 
            args: [id], 
            value: ethPerItem // Per item, non total
          })
        ));
      } else if (form.action === 'delist') {
        await Promise.all(tokenIdsBigInt.map(id => 
          writeContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'delist', args: [id] })
        ));
      }

      if (isSuccess) {
        // FIX: Usa Link per redirect invece di router.push
        window.location.href = '/inventory'; // Fallback safe
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) return <p className="text-center">Connect wallet to manage listings.</p>;

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
            <input type="text" placeholder="Collection Address" value={form.collection} onChange={(e) => setForm({...form, collection: e.target.value})} required />
            <input type="text" placeholder="Booster Token Address" value={form.boosterToken} onChange={(e) => setForm({...form, boosterToken: e.target.value})} required />
          </>
        )}
        <textarea placeholder="Token IDs (comma-separated for batch)" value={form.tokenIds.join(', ')} onChange={(e) => setForm({...form, tokenIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})} required />
        {form.action === 'buy' && listingDetails && (
          <p>Est. Price per Item: {ethers.formatEther(listingDetails.listingPrice)} ETH 
            (Total for {form.tokenIds.length}: {ethers.formatEther(listingDetails.listingPrice * BigInt(form.tokenIds.length))} ETH)</p>
        )}
        <button type="submit" disabled={loading || txLoading} className="bg-blue-500 text-white px-4 py-2 rounded w-full">
          {loading ? 'Processing...' : `${form.action.charAt(0).toUpperCase() + form.action.slice(1)} Selected`}
        </button>
        {error && <p className="text-red-500">{error}</p>}
        {txLoading && <p>Waiting for transaction...</p>}
        {isSuccess && <p>Success! <Link href="/inventory" className="text-blue-500 underline">Back to Inventory</Link></p>}
      </form>
    </main>
  );
}
