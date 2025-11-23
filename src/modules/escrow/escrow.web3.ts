import { Injectable } from '@nestjs/common';
import type { Address, Hash } from 'viem';
import { EscrowCurrency } from './types';

@Injectable()
export class EscrowWeb3Service {
  async verifyDepositTx(hash: Hash): Promise<boolean> {
    await Promise.resolve();
    void hash;
    throw new Error('verifyDepositTx not implemented yet');
  }

  async depositOnchain(params: {
    projectOnchainId: string;
    investor: Address;
    amount: bigint;
    currency: EscrowCurrency;
  }): Promise<Hash> {
    await Promise.resolve();
    void params;
    throw new Error('depositOnchain not implemented yet');
  }

  async releaseOnchain(params: {
    projectOnchainId: string;
    milestoneId: string;
  }): Promise<Hash> {
    await Promise.resolve();
    void params;
    throw new Error('releaseOnchain not implemented yet');
  }

  async refundOnchain(params: {
    depositOnchainId: string;
    to: Address;
  }): Promise<Hash> {
    await Promise.resolve();
    void params;
    throw new Error('refundOnchain not implemented yet');
  }
}
