import { createPublicClient, http } from 'viem';
import { celoAlfajores } from 'viem/chains';

const ESCROW_ABI = [
  {
    type: 'function',
    name: 'getProject',
    stateMutability: 'view',
    inputs: [{ name: '_projectId', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'targetAmount', type: 'uint256' },
      { name: 'raisedAmount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'status', type: 'uint8' }, // Enum is uint8
    ],
  },
] as const;

async function check() {
  const client = createPublicClient({
    chain: celoAlfajores,
    transport: http('https://alfajores-forno.celo-testnet.org'),
  });

  const escrowAddress = '0xC13522d9fF924Da679B51eD9FD3A950CD2D3eCc2'; 

  try {
    const data = await client.readContract({
      address: escrowAddress,
      abi: ESCROW_ABI,
      functionName: 'getProject',
      args: [0n],
    });
    console.log('Project 0:', data);
  } catch (e: any) {
    console.error('Failed to read Project 0:', e?.message || e);
  }
}

check();
