import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://flashloan:flashloan@localhost:5432/flashloan_metrics',
});

export async function query(text: string, params?: any[]) {
  const res = await pool.query(text, params);
  return res;
}

export { pool };
