import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';

type Dependencies = ConstructorParameters<typeof AuthService>;
const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const userId = new Types.ObjectId().toString();
const nonce = 'a1b2c3d4e5f60708';
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function fixture(overrides: Record<string, unknown> = {}) {
  const expiresAt = new Date(Date.now() + 240000);
  const challenge = {
    _id: new Types.ObjectId(),
    nonceHash: digest(nonce),
    domain: 'uat.example.test',
    uri: 'https://uat.example.test',
    allowedChainIds: [11155111],
    expiresAt,
    ...overrides,
  };
  const query = {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(challenge),
  };
  const challenges = {
    create: jest.fn(),
    findOne: jest.fn().mockReturnValue(query),
    findOneAndUpdate: jest.fn().mockResolvedValue(challenge),
  };
  const users = {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: userId }),
      }),
    }),
  };
  const values: Record<string, string> = {
    SIWE_DOMAIN: 'uat.example.test',
    SIWE_URI: 'https://uat.example.test',
    SIWE_CHAIN_IDS: '11155111',
  };
  const config = { get: (key: string) => values[key] } as ConfigService;
  const service = new AuthService(
    users as unknown as Dependencies[0],
    {} as Dependencies[1],
    challenges as unknown as Dependencies[2],
    {} as Dependencies[3],
    config,
    {} as Dependencies[5],
    { log: jest.fn() } as unknown as Dependencies[6],
    {} as Dependencies[7],
    {} as Dependencies[8],
  );
  const message = (changes: Record<string, unknown> = {}) =>
    new SiweMessage({
      domain: challenge.domain,
      address: account.address,
      statement: 'Link this wallet to your Keibo account',
      uri: challenge.uri,
      version: '1',
      chainId: 11155111,
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: expiresAt.toISOString(),
      ...changes,
    }).prepareMessage();
  return { service, challenges, query, message };
}
describe('SIWE wallet-link security', () => {
  it('generates a SIWE-compatible alphanumeric nonce', async () => {
    const { service } = fixture();
    const result = await service.issueSiweNonce(
      userId,
      account.address,
      'link',
    );
    expect(result.nonce).toMatch(/^[a-zA-Z0-9]{8,}$/);
    expect(() =>
      new SiweMessage({
        domain: result.domain,
        uri: result.uri,
        address: account.address,
        version: '1',
        chainId: result.chainIds[0],
        nonce: result.nonce,
        issuedAt: result.issuedAt,
        expirationTime: result.expiresAt,
      }).prepareMessage(),
    ).not.toThrow();
  });
  it('verifies a real signed message then atomically consumes the nonce', async () => {
    const c = fixture();
    const message = c.message();
    await c.service.consumeSiweChallenge(
      userId,
      account.address.toLowerCase(),
      'link',
      message,
      await account.signMessage({ message }),
    );
    expect(c.challenges.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(c.challenges.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: new Types.ObjectId(userId),
        purpose: 'link',
        address: account.address.toLowerCase(),
      }),
    );
  });
  it('rejects an invalid signature without consuming ownership proof', async () => {
    const c = fixture();
    const message = c.message();
    const attacker = privateKeyToAccount(`0x${'2'.repeat(64)}`);
    await expect(
      c.service.consumeSiweChallenge(
        userId,
        account.address,
        'link',
        message,
        await attacker.signMessage({ message }),
      ),
    ).rejects.toThrow('Invalid wallet signature');
    expect(c.challenges.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it.each([
    { domain: 'evil.example.test' },
    { uri: 'https://evil.example.test' },
    { chainId: 1 },
    { nonce: 'wrongnonce123' },
    { expirationTime: new Date(Date.now() - 1000).toISOString() },
  ])('rejects altered challenge fields %j', async (changes) => {
    const c = fixture();
    const message = c.message(changes);
    await expect(
      c.service.consumeSiweChallenge(
        userId,
        account.address,
        'link',
        message,
        await account.signMessage({ message }),
      ),
    ).rejects.toThrow();
    expect(c.challenges.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('rejects an expired/missing nonce and missing signature', async () => {
    const c = fixture();
    c.query.exec.mockResolvedValue(null);
    const message = c.message();
    await expect(
      c.service.consumeSiweChallenge(
        userId,
        account.address,
        'link',
        message,
        await account.signMessage({ message }),
      ),
    ).rejects.toThrow('missing, expired or already used');
    await expect(
      c.service.consumeSiweChallenge(userId, account.address, 'link'),
    ).rejects.toThrow('signature is required');
  });
});
