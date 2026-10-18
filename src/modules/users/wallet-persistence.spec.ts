import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { UserRole } from '../../common/enums/role.enum';
type Dependencies = ConstructorParameters<typeof UsersService>;
const userId = new Types.ObjectId().toString();
const wallet = '0x1111111111111111111111111111111111111111';
function fixture() {
  const user = {
    id: userId,
    _id: userId,
    roles: [UserRole.INVESTOR],
    primaryWallet: undefined as string | undefined,
    linkedWallets: [] as string[],
    toObject() {
      return {
        id: this.id,
        roles: this.roles,
        primaryWallet: this.primaryWallet,
        linkedWallets: this.linkedWallets,
      };
    },
  };
  const repo = {
    findById: jest.fn().mockResolvedValue(user),
    findByWallet: jest.fn().mockResolvedValue(null),
    updateById: jest
      .fn()
      .mockImplementation(
        (
          _id,
          update: { $set: { primaryWallet: string; linkedWallets: string[] } },
        ) => {
          Object.assign(user, update.$set);
          return Promise.resolve(user);
        },
      ),
  };
  const ownership = { updateOne: jest.fn().mockResolvedValue({}) };
  const auth = { consumeSiweChallenge: jest.fn().mockResolvedValue(undefined) };
  const service = new UsersService(
    ownership as unknown as Dependencies[0],
    repo as unknown as Dependencies[1],
    { emit: jest.fn() } as unknown as Dependencies[2],
    auth as unknown as Dependencies[3],
    { get: jest.fn() } as unknown as Dependencies[4],
    { log: jest.fn() } as unknown as Dependencies[5],
    {} as Dependencies[6],
    {} as Dependencies[7],
  );
  return { service, user, repo, ownership, auth };
}
describe('Verified wallet persistence', () => {
  it('makes the first wallet primary and returns persisted account after reload', async () => {
    const c = fixture();
    const result = await c.service.linkWallet(userId, {
      wallet,
      message: 'signed challenge',
      signature: 'signature',
    });
    expect(c.auth.consumeSiweChallenge).toHaveBeenCalledWith(
      userId,
      wallet,
      'link',
      'signed challenge',
      'signature',
    );
    expect(result.primaryWallet).toBe(wallet);
    expect((await c.service.getUserById(userId)).primaryWallet).toBe(wallet);
    expect(c.ownership.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        address: wallet,
        userId: new Types.ObjectId(userId),
      }),
      expect.anything(),
      { upsert: true },
    );
  });
  it('does not silently replace a primary wallet when explicitly linking a second one', async () => {
    const c = fixture();
    c.user.primaryWallet = '0x2222222222222222222222222222222222222222';
    const result = await c.service.linkWallet(userId, {
      wallet,
      message: 'signed challenge',
      signature: 'signature',
    });
    expect(result.primaryWallet).toBe(c.user.primaryWallet);
    expect(result.linkedWallets).toContain(wallet);
  });
  it('rejects conflicting ownership before signature consumption', async () => {
    const c = fixture();
    c.repo.findByWallet.mockResolvedValue({ id: 'another-account' });
    await expect(c.service.linkWallet(userId, { wallet })).rejects.toThrow(
      'another user',
    );
    expect(c.auth.consumeSiweChallenge).not.toHaveBeenCalled();
    expect(c.repo.updateById).not.toHaveBeenCalled();
  });
  it('never writes ownership after rejected proof', async () => {
    const c = fixture();
    c.auth.consumeSiweChallenge.mockRejectedValue(
      new Error('signature required'),
    );
    await expect(c.service.linkWallet(userId, { wallet })).rejects.toThrow(
      'signature required',
    );
    expect(c.ownership.updateOne).not.toHaveBeenCalled();
    expect(c.repo.updateById).not.toHaveBeenCalled();
  });
  it('fails closed on a concurrent ownership claim', async () => {
    const c = fixture();
    c.ownership.updateOne.mockRejectedValue({ code: 11000 });
    await expect(
      c.service.linkWallet(userId, {
        wallet,
        message: 'proof',
        signature: 'signature',
      }),
    ).rejects.toThrow('another user');
    expect(c.repo.updateById).not.toHaveBeenCalled();
  });
});
