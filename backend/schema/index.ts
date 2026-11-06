import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';
import schema from '../sql/001_marketplace.sql';

// Explicit, operator-invoked schema initialization; never runs on application startup.
export async function handler(event: { action?: string }) {
  if (!['migrate', 'check'].includes(event.action ?? '')) throw new Error('Expected action: migrate or check');
  const result = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const credentials = JSON.parse(result.SecretString ?? '{}');
  const client = new pg.Client({
    host: process.env.DB_HOST, database: process.env.DB_NAME,
    user: credentials.username, password: credentials.password,
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  try {
    await client.connect();
    if (event.action === 'migrate') await client.query(schema);
    // Fail instead of silently reporting success when schema is absent.
    await client.query('SELECT id, seller_id, stock FROM products LIMIT 0');
    await client.query('SELECT id, idempotency_key, status FROM orders LIMIT 0');
    return { ok: true, action: event.action, schema: '001_marketplace' };
  } finally { await client.end(); }
}
