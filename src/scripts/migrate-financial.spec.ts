import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('built financial migration runner', () => {
  it('uses the compiled entrypoint and fails closed without a ledger URL', () => {
    const root = resolve(__dirname, '../..');
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const command = manifest.scripts['financial:migrate'];
    expect(command).toBe('node dist/src/scripts/migrate-financial.js');

    const runner = resolve(root, 'dist/src/scripts/migrate-financial.js');
    expect(existsSync(runner)).toBe(true);
    const env = { ...process.env };
    delete env.FINANCIAL_DATABASE_URL;
    const result = spawnSync(process.execPath, [runner], {
      cwd: root,
      env: { ...env, NODE_ENV: 'test' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Financial database is unavailable');
    expect(result.stderr).not.toContain('Cannot find module');
  });
});
