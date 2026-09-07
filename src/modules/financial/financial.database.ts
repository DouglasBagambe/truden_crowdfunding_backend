import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class FinancialDatabase {
  private pool?: Pool;

  constructor(private readonly config: ConfigService) {}

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const connectionString = this.config.get<string>('FINANCIAL_DATABASE_URL');
    if (!connectionString) {
      throw new ServiceUnavailableException(
        'Financial database is unavailable; payment settlement is disabled',
      );
    }
    this.pool = new Pool({ connectionString, max: 10 });
    return this.pool;
  }

  async query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
    return this.getPool().query<T>(text, values);
  }

  async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async readiness(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = undefined;
  }
}
