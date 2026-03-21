// /app/api/claimStats/route.js
import { NextResponse } from 'next/server';
import { createPublicClient, http, formatEther, getAddress } from 'viem';
import { base, mainnet } from 'wagmi/chains';

const CLAIM_ADDRESS = getAddress('0x34E06Df657d7D326Fda89B97109586be3c3BD461');
const PEPE_ADDRESS = getAddress('0x6982508145454Ce325dDbE47a25d4ec3d2311933');

const CLAIM_ABI = [
  {
    "inputs": [],
    "name": "getHighestClaimed",
    "outputs": [
      { "internalType": "uint256", "name": "tokenId", "type": "uint256" },
      { "internalType": "address", "name": "claimer", "type": "address" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getPepeReceiver",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  }
];

const ERC20_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

const baseClient = createPublicClient({ chain: base, transport: http() });
const mainnetClient = createPublicClient({ chain: mainnet, transport: http() });

function formatBalance(num) {
  if (isNaN(num) || num <= 0) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(0);
}

export async function GET() {
  try {
    console.log('Fetching highest claimed...');
    const highest = await baseClient.readContract({
      address: CLAIM_ADDRESS,
      abi: CLAIM_ABI,
      functionName: 'getHighestClaimed',
    });
    const tokenId = highest[0].toString();
    const claimer = highest[1];
    console.log('Highest claimed:', { tokenId, claimer });

    let pepeBalance = '0 $PEPE';

    console.log('Reading PepeReceiver from Base contract...');
    const receiver = await baseClient.readContract({
      address: CLAIM_ADDRESS,
      abi: CLAIM_ABI,
      functionName: 'getPepeReceiver',
    });
    console.log('PepeReceiver address returned:', receiver);

    if (receiver && receiver !== '0x0000000000000000000000000000000000000000') {
      console.log(`Attempting balanceOf(${receiver}) on Ethereum for PEPE token...`);
      try {
        const raw = await mainnetClient.readContract({
          address: PEPE_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [receiver],
        });
        console.log('Raw PEPE balance (wei):', raw.toString());
        const num = Number(formatEther(raw));
        console.log('Formatted PEPE balance (ether units):', num);
        pepeBalance = formatBalance(num) + ' $PEPE';
      } catch (balErr) {
        console.error('PEPE balanceOf call failed:', {
          receiver,
          errorMessage: balErr.message,
          errorShort: balErr.shortMessage || 'no short message',
          errorDetails: balErr,
        });
        pepeBalance = 'Error fetching balance';
      }
    } else {
      console.log('PepeReceiver is zero address → skipping balance check');
    }

    return NextResponse.json({
      tokenId,
      claimer,
      pepeBalance,
    });
  } catch (error) {
    console.error('claimStats overall failed:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
