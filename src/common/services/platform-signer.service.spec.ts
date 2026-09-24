import { PlatformSignerService } from './platform-signer.service';

const config = (values: Record<string, string>) => ({
  get: <T>(name: string): T | undefined => values[name] as T | undefined,
});

describe('PlatformSignerService', () => {
  it('keeps privileged signing disabled by default', async () => {
    const signer = new PlatformSignerService(config({}) as never);
    await expect(
      signer.writeContract({
        address: '0x0000000000000000000000000000000000000001',
        abi: [],
        functionName: 'pause',
      }),
    ).rejects.toThrow('signing is disabled');
  });

  it('allows a local signer only outside production and never exposes its key', () => {
    const signer = new PlatformSignerService(
      config({
        NODE_ENV: 'test',
        PLATFORM_SIGNER_PROVIDER: 'local',
        UAT_PLATFORM_SIGNER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        RPC_URL: 'http://127.0.0.1:8545',
      }) as never,
    );
    expect(signer.provider).toBe('local');
  });

  it('rejects local signing in production', () => {
    expect(
      () =>
        new PlatformSignerService(
          config({
            NODE_ENV: 'production',
            PLATFORM_SIGNER_PROVIDER: 'local',
            UAT_PLATFORM_SIGNER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
            RPC_URL: 'https://rpc.example.test',
          }) as never,
        ),
    ).toThrow('prohibited in production');
  });
});
