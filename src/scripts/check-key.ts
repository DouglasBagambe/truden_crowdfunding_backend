import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celoAlfajores } from 'viem/chains';

const ESCROW_ABI = [
  {
    type: 'function',
    name: 'createProject',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_title', type: 'string' },
      { name: '_description', type: 'string' },
      { name: '_targetAmount', type: 'uint256' },
      { name: '_deadline', type: 'uint256' },
      { name: '_token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function run() {
  const privateKey = process.env.BLOCKCHAIN_ADMIN_PRIVATE_KEY || '0x426E92C9c78ed9a7744b1Bb0E5a69BFD3892f104'; // Putting explicit just for script test
  // NOTE: You used a public address as private key in previous logs??
  // 0x426E92C9... looks like an address!
  // Private keys are 64 hex chars (32 bytes). Addresses are 40 hex chars (20 bytes).
  
  // WAIT A SECOND!
  // In the error logs you showed earlier:
  // from: 0x426E92C9c78ed9a7744b1Bb0E5a69BFD3892f104
  // sender: 0x426E92C9c78ed9a7744b1Bb0E5a69BFD3892f104
  
  // If you pasted an ADDRESS into .env as the PRIVATE KEY...
  // viem privateKeyToAccount(addr) -> It treats the address as a private key?!
  // 0x426... is 42 chars. Private key should be 66 chars (with 0x).
  
  // If '0x426...' is actually your address, and you pasted it as private key, 
  // then viem derived a NEW Account from that 20-byte seed?
  // Or it padded it?
  
  // privateKeyToAccount expects 32 bytes (64 hex).
  // If you provided an Address, it's invalid private key.
  
  // CHECK YOUR .ENV!
  console.log('Please verify your .env BLOCKCHAIN_ADMIN_PRIVATE_KEY is a generic 64-char hex string, NOT an address.');
}
run();
