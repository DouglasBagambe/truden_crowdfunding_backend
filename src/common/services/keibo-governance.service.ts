import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createPublicClient,
  decodeEventLog,
  http,
  isAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { KeiboContractConfigService } from './keibo-contract-config.service';
import { PlatformSignerService } from './platform-signer.service';

export const KEIBO_GOVERNANCE_ABI = [
  {
    type: 'function',
    name: 'propose',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'action', type: 'uint8' },
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'cancel',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'reasonHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'proposals',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'action', type: 'uint8' },
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
      { name: 'executableAt', type: 'uint64' },
      { name: 'challengeEndsAt', type: 'uint64' },
      { name: 'state', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'ProposalCreated',
    inputs: [
      { indexed: true, name: 'proposalId', type: 'uint256' },
      { indexed: false, name: 'action', type: 'uint8' },
      { indexed: false, name: 'executableAt', type: 'uint64' },
      { indexed: false, name: 'challengeEndsAt', type: 'uint64' },
    ],
  },
  {
    type: 'event',
    name: 'ProposalCancelled',
    inputs: [
      { indexed: true, name: 'proposalId', type: 'uint256' },
      { indexed: true, name: 'reasonHash', type: 'bytes32' },
    ],
  },
  {
    type: 'event',
    name: 'ProposalExecuted',
    inputs: [{ indexed: true, name: 'proposalId', type: 'uint256' }],
  },
] as const;

@Injectable()
export class KeiboGovernanceService {
  constructor(
    private readonly config: KeiboContractConfigService,
    private readonly signer: PlatformSignerService,
  ) {}

  async propose(params: {
    action: 0 | 1 | 2 | 3;
    role: Hex;
    account: Address;
  }): Promise<Hash> {
    if (
      !Number.isInteger(params.action) ||
      params.action < 0 ||
      params.action > 3 ||
      !this.bytes32(params.role) ||
      !isAddress(params.account)
    )
      throw new ConflictException('Invalid bounded governance action');
    const { client, address } = await this.ready();
    const hash = await this.signer.writeContract({
      address,
      abi: KEIBO_GOVERNANCE_ABI,
      functionName: 'propose',
      args: [params.action, params.role, params.account],
    });
    await this.event(client, address, hash, 'ProposalCreated');
    return hash;
  }
  async cancel(proposalId: string, reasonHash: Hex): Promise<Hash> {
    if (
      !this.id(proposalId) ||
      !this.bytes32(reasonHash) ||
      /^0x0+$/.test(reasonHash)
    )
      throw new ConflictException('Invalid governance cancellation');
    const { client, address } = await this.ready();
    const hash = await this.signer.writeContract({
      address,
      abi: KEIBO_GOVERNANCE_ABI,
      functionName: 'cancel',
      args: [BigInt(proposalId), reasonHash],
    });
    await this.event(client, address, hash, 'ProposalCancelled');
    return hash;
  }
  async execute(proposalId: string): Promise<Hash> {
    if (!this.id(proposalId))
      throw new ConflictException('Invalid proposal id');
    const { client, address } = await this.ready();
    const proposal = (await client.readContract({
      address,
      abi: KEIBO_GOVERNANCE_ABI,
      functionName: 'proposals',
      args: [BigInt(proposalId)],
    })) as readonly [number, Hex, Address, bigint, bigint, number];
    if (
      proposal[5] !== 0 ||
      proposal[3] > BigInt(Math.floor(Date.now() / 1000))
    )
      throw new ConflictException('Proposal is not executable');
    const hash = await this.signer.writeContract({
      address,
      abi: KEIBO_GOVERNANCE_ABI,
      functionName: 'execute',
      args: [BigInt(proposalId)],
    });
    await this.event(client, address, hash, 'ProposalExecuted');
    return hash;
  }
  private async ready() {
    const runtime = this.config.getRequired();
    const client = createPublicClient({ transport: http(runtime.rpcUrl) });
    try {
      const [chain, code] = await Promise.all([
        client.getChainId(),
        client.getCode({ address: runtime.governance }),
      ]);
      if (chain !== runtime.chainId)
        throw new ServiceUnavailableException(
          'RPC chain ID does not match CHAIN_ID',
        );
      if (!code || code === '0x')
        throw new ServiceUnavailableException(
          'KEIBO governance address has no deployed bytecode',
        );
      return { client, address: runtime.governance };
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException(
        'Unable to validate KEIBO governance runtime',
      );
    }
  }
  private async event(
    client: ReturnType<typeof createPublicClient>,
    address: Address,
    hash: Hash,
    name: 'ProposalCreated' | 'ProposalCancelled' | 'ProposalExecuted',
  ) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success')
      throw new ConflictException(
        `KEIBO governance ${name} transaction reverted`,
      );
    const found = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== address.toLowerCase()) return false;
      try {
        return (
          decodeEventLog({
            abi: KEIBO_GOVERNANCE_ABI,
            data: log.data,
            topics: log.topics,
          }).eventName === name
        );
      } catch {
        return false;
      }
    });
    if (!found) throw new ConflictException(`Missing ${name} receipt evidence`);
  }
  private id(value: string): boolean {
    return /^(0|[1-9][0-9]*)$/.test(value);
  }
  private bytes32(value: Hex): boolean {
    return /^0x[0-9a-fA-F]{64}$/.test(value);
  }
}
