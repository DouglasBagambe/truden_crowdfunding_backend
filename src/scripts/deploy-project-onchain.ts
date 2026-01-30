import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Project } from '../modules/projects/schemas/project.schema';
import { ConfigService } from '@nestjs/config';
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
  {
    type: 'event',
    name: 'ProjectCreated',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'title', type: 'string', indexed: false },
      { name: 'targetAmount', type: 'uint256', indexed: false },
    ],
  },
] as const;

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  // Use any to bypass TS checks on model
  const projectModel: any = app.get(getModelToken(Project.name));
  const configService = app.get(ConfigService);

  const blockchain = configService.get('blockchain');
  const rpcUrl = blockchain.rpcUrl || 'https://alfajores-forno.celo-testnet.org';
  const privateKey = blockchain.adminPrivateKey;
  const escrowAddress = blockchain.contracts.escrow;

  if (!privateKey || !escrowAddress) {
    console.error('❌ Blockchain config missing (Private Key or Contract Address)');
    await app.close();
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  const client = createWalletClient({
    account,
    chain: celoAlfajores,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: celoAlfajores,
    transport: http(rpcUrl),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Initial Balance: ${balance} wei`);
  
  if (balance === 0n) {
    console.error(`❌ Admin Wallet ${account.address} has 0 CELO/ETH! Please fund it via faucet.`);
    await app.close();
    process.exit(1);
  }

  const projectId = '697265d7a5d2c76ecb77b23c';
  const project = await projectModel.findById(projectId);

  if (!project) {
    console.log(`❌ Project ${projectId} not found in DB!`);
    await app.close();
    process.exit(1);
  }

  if (project.projectOnchainId) {
    console.log(`⚠️ Project already has on-chain ID: ${project.projectOnchainId}`);
  }

  console.log(`🚀 Creating Project "${project.name}" on-chain...`);

  const targetAmount = parseEther(String(project.targetAmount || 10)); // Convert to wei
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60); // +30 days
  const token = '0x0000000000000000000000000000000000000000'; // Native Currency

  try {
    const hash = await client.writeContract({
      address: escrowAddress,
      abi: ESCROW_ABI,
      functionName: 'createProject',
      args: [project.name, project.summary, targetAmount, deadline, token],
    });

    console.log(`Sent Transaction: ${hash}`);
    console.log('Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.logs.length > 0) {
       const events = await publicClient.getContractEvents({
          address: escrowAddress,
          abi: ESCROW_ABI,
          eventName: 'ProjectCreated',
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
       });

        // @ts-ignore
        const myEvent = events.find(e => e.transactionHash === hash);
        
        if (myEvent) {
             // @ts-ignore
            const onChainId = myEvent.args.projectId.toString();
            console.log(`✅ Project Created! On-Chain ID: ${onChainId}`);

            project.projectOnchainId = onChainId;
            project.status = 'FUNDING'; 
            await project.save();
            console.log(`💾 Saved on-chain ID to MongoDB`);
        } else {
            console.error('❌ Could not find ProjectCreated event in logs');
        }
    }

  } catch (error) {
    console.error('❌ Failed to create project on-chain:', error);
  }

  await app.close();
  process.exit(0);
}

bootstrap();
