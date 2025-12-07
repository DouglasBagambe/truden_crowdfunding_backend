export interface NftProjectView {
  id: string;
  name?: string;
}

export interface NftInvestorView {
  id: string;
  walletAddress: string;
}

export interface NftMetadataView {
  name: string;
  description: string;
  attributes: Array<{ trait_type: string; value: string | number }>;
}

export interface NftView {
  id: string;
  tokenId: number;
  projectId: string;
  investorId: string;
  walletAddress: string;
  amountInvested: number;
  metadataUri: string;
  value: number;
  txHash: string;
  createdAt: Date;
  updatedAt: Date;
  project?: NftProjectView;
  investor?: NftInvestorView;
  metadata: NftMetadataView;
}
