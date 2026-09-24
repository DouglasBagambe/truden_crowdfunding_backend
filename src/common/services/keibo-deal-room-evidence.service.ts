import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createPublicClient,
  decodeEventLog,
  http,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { KeiboContractConfigService } from './keibo-contract-config.service';
import { PlatformSignerService } from './platform-signer.service';

export const KEIBO_DEAL_ROOM_EVIDENCE_ABI = [
  {
    type: 'function',
    name: 'knownDocuments',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'recordDocument',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'campaignId', type: 'uint256' },
      { name: 'documentHash', type: 'bytes32' },
      { name: 'accessPolicyHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'recordAccess',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'documentHash', type: 'bytes32' },
      { name: 'subjectHash', type: 'bytes32' },
      { name: 'actionHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'DocumentRecorded',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'documentHash', type: 'bytes32' },
      { indexed: true, name: 'accessPolicyHash', type: 'bytes32' },
    ],
  },
  {
    type: 'event',
    name: 'AccessEvidenceRecorded',
    inputs: [
      { indexed: true, name: 'documentHash', type: 'bytes32' },
      { indexed: true, name: 'subjectHash', type: 'bytes32' },
      { indexed: true, name: 'actionHash', type: 'bytes32' },
    ],
  },
] as const;

/** Hash-only boundary; authorization and confidential document storage remain off-chain. */
@Injectable()
export class KeiboDealRoomEvidenceService {
  constructor(
    private readonly config: KeiboContractConfigService,
    private readonly signer: PlatformSignerService,
  ) {}
  async isKnownDocument(documentHash: Hex): Promise<boolean> {
    this.requireHash(documentHash);
    const { client, address } = await this.ready();
    return client.readContract({
      address,
      abi: KEIBO_DEAL_ROOM_EVIDENCE_ABI,
      functionName: 'knownDocuments',
      args: [documentHash],
    });
  }
  async recordDocument(params: {
    campaignId: string;
    documentHash: Hex;
    accessPolicyHash: Hex;
  }): Promise<Hash> {
    if (!/^(0|[1-9][0-9]*)$/.test(params.campaignId))
      throw new ConflictException('Invalid campaign id');
    this.requireHash(params.documentHash);
    this.requireHash(params.accessPolicyHash);
    const { client, address } = await this.ready();
    const exists = await client.readContract({
      address,
      abi: KEIBO_DEAL_ROOM_EVIDENCE_ABI,
      functionName: 'knownDocuments',
      args: [params.documentHash],
    });
    if (exists)
      throw new ConflictException('Document evidence is already recorded');
    const hash = await this.signer.writeContract({
      address,
      abi: KEIBO_DEAL_ROOM_EVIDENCE_ABI,
      functionName: 'recordDocument',
      args: [
        BigInt(params.campaignId),
        params.documentHash,
        params.accessPolicyHash,
      ],
    });
    await this.event(client, address, hash, 'DocumentRecorded');
    return hash;
  }
  async recordAccess(params: {
    documentHash: Hex;
    subjectHash: Hex;
    actionHash: Hex;
  }): Promise<Hash> {
    this.requireHash(params.documentHash);
    this.requireHash(params.subjectHash);
    this.requireHash(params.actionHash);
    const { client, address } = await this.ready();
    const known = await client.readContract({
      address,
      abi: KEIBO_DEAL_ROOM_EVIDENCE_ABI,
      functionName: 'knownDocuments',
      args: [params.documentHash],
    });
    if (!known)
      throw new ConflictException('Document evidence is not recorded');
    const hash = await this.signer.writeContract({
      address,
      abi: KEIBO_DEAL_ROOM_EVIDENCE_ABI,
      functionName: 'recordAccess',
      args: [params.documentHash, params.subjectHash, params.actionHash],
    });
    await this.event(client, address, hash, 'AccessEvidenceRecorded');
    return hash;
  }
  private requireHash(value: Hex) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0+$/.test(value))
      throw new ConflictException(
        'Evidence values must be non-zero bytes32 hashes',
      );
  }
  private async ready() {
    const runtime = this.config.getRequired();
    const client = createPublicClient({ transport: http(runtime.rpcUrl) });
    try {
      const [chain, code] = await Promise.all([
        client.getChainId(),
        client.getCode({ address: runtime.evidence }),
      ]);
      if (chain !== runtime.chainId)
        throw new ServiceUnavailableException(
          'RPC chain ID does not match CHAIN_ID',
        );
      if (!code || code === '0x')
        throw new ServiceUnavailableException(
          'KEIBO evidence address has no deployed bytecode',
        );
      return { client, address: runtime.evidence };
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException(
        'Unable to validate KEIBO evidence runtime',
      );
    }
  }
  private async event(
    client: ReturnType<typeof createPublicClient>,
    address: Address,
    hash: Hash,
    name: 'DocumentRecorded' | 'AccessEvidenceRecorded',
  ) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success')
      throw new ConflictException(
        `KEIBO evidence ${name} transaction reverted`,
      );
    const found = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== address.toLowerCase()) return false;
      try {
        return (
          decodeEventLog({
            abi: KEIBO_DEAL_ROOM_EVIDENCE_ABI,
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
}
