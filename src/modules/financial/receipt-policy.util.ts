import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';

export const RECEIPT_POLICY_VERSION = 'KEIBO_RECEIPT_ELIGIBILITY_V1';

export type ReceiptPolicyInput = {
  chainId: number;
  investor: Address;
  campaignId: bigint;
  amount: bigint;
  settlementId: string;
  expiresAt: bigint;
};

/** Fixed ABI tuple prevents JSON serialization or object-key ordering from changing policy truth. */
export function canonicalReceiptPolicy(input: ReceiptPolicyInput) {
  const settlementReferenceHash = keccak256(
    `0x${Buffer.from(input.settlementId, 'utf8').toString('hex')}` as Hex,
  );
  const encoded = encodeAbiParameters(
    parseAbiParameters('string,uint256,address,uint256,uint256,bytes32,uint64'),
    [
      RECEIPT_POLICY_VERSION,
      BigInt(input.chainId),
      input.investor.toLowerCase() as Address,
      input.campaignId,
      input.amount,
      settlementReferenceHash,
      input.expiresAt,
    ],
  );
  return {
    canonicalPayload: encoded,
    policyHash: keccak256(encoded),
    settlementReferenceHash,
  };
}

export function receiptReasonHash(reason: string): Hex {
  return keccak256(
    `0x${Buffer.from(reason.trim(), 'utf8').toString('hex')}` as Hex,
  );
}
