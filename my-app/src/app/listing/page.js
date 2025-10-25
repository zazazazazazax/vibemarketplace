'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ethers } from 'ethers';

const CONTRACT_ADDRESS = '0x...'; // SOSTITUISCI CON DEPLOYATO

const ABI = [
  // Da VibeMarketplaceV2.sol
  'function createListing(address _collection, address _boosterToken, uint256 tokenId)',
  'function createListingBatch(address _collection, address _boosterToken, uint256[] calldata tokenIds)',
  'function buyListing(uint256 tokenId) external payable',
  'function delist(uint256 tokenId) external',
  'function getListingDetails(uint256 tokenId) external view returns (uint8 rarity, string memory wear, string memory foilType, uint256 baseTokens, uint256 ethBase, uint256 listingPrice)',
  // Aggiungi delistBatch se implementi nel contratto
];

export default function Listing() {
  const router = useRouter();
  const { address: walletAddress, isConnected } = useAccount();
  const { writeContract, data: txHash } = useWriteContract();
  const { isLoading: txLoading, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const [form, setForm] = useState({ tokenIds: [], collection: '', boosterToken: '', action: 'create' }); // 'create', 'buy', 'delist'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (router.query) {
      const tokenId = router.query.tokenId ? [router.query.tokenId] : [];
      setForm({
        tokenIds: tokenId,
        collection: router.query.collection || '',
        boosterToken: router.query.boosterToken || '',
        action: 'create' // Default
      });
    }
  }, [router.query]);

  // Read prezzo/details on-chain (per confirm)
  const { data: listingDetails } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: 'getListingDetails',
    args: [BigInt(form.tokenIds[0] || 0)], // Solo primo per preview
    enabled: form.action === 'buy' && form.tokenIds.length > 0,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isConnected || form.tokenIds.length === 0) return setError('Connect wallet and select cards');
    setLoading(true);
    setError(null);
    try {
      const args = [form.collection, form.boosterToken, form.tokenIds.map(id => BigInt(id))];
      const value = form.action === 'buy' ? ethers.parseEther((listingDetails?.listingPrice * form.tokenIds.length / 1e18).toString()) : 0n; // ETH per buy batch approx

      if (form.action === 'create' && form.tokenIds.length === 1) {
        writeContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'createListing', args: args.slice(2) }); // Single
      } else if (form.action === 'create') {
        writeContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'createListingBatch', args });
      } else if (form.action === 'buy') {
        // Loop per buy (aggiungi batch fn al contratto per parallel)
        await Promise.all(form.tokenIds.map(id => 
          writeContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'buyListing', args: [BigInt(id)], value })
        ));
      } else if (form.action === 'delist') {
        // Loop per delist (aggiungi batch al contratto)
        await Promise.all(form.tokenIds.map(id => 
          writeContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'delist', args: [BigInt(id)] })
        ));
      }

      if (isSuccess) router.push('/inventory');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) return <p className="text-center">Connect wallet to list.</p>;

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Manage Listing</h1>
      <form onSubmit={handleSubmit} className="space-y-4 w-96">
        <select value={form.action} onChange={(e) => setForm({...form, action: e.target.value})}>
          <option value="create">Create Listing</option>
          <option value="buy">Buy Listing</option>
          <option value="delist">Delist</option>
        </select>
        <input type="text" placeholder="Collection Address" value={form.collection} onChange={(e) => setForm({...form, collection: e.target.value})} required={form.action === 'create'} />
        <input type="text" placeholder="Booster Token Address" value={form.boosterToken} onChange={(e) => setForm({...form, boosterToken: e.target.value})} required={form.action === 'create'} />
        <textarea placeholder="Token IDs (comma-separated for batch)" value={form.tokenIds.join(', ')} onChange={(e) => setForm({...form, tokenIds: e.target.value.split(',').map(s => s.trim())})} />
        {form.action === 'buy' && listingDetails && <p>Price: {ethers.formatEther(listingDetails.listingPrice)} ETH</p>}
        <button type="submit" disabled={loading || txLoading} className="bg-blue-500 text-white px-4 py-2 rounded w-full">
          {loading ? 'Processing...' : `${form.action === 'create' ? 'List' : form.action.toUpperCase()} Selected`}
        </button>
        {error && <p className="text-red-500">{error}</p>}
        {txLoading && <p>Waiting for tx...</p>}
        {isSuccess && <p>Success! Redirecting...</p>}
      </form>
    </main>
  );
}
