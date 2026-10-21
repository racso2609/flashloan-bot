import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get('limit') || 100);
    const chain = searchParams.get('chain');
    const mode = searchParams.get('mode');
    let sql = `SELECT * FROM opportunities WHERE 1=1`;
    const params: any[] = [];
    if (chain) { params.push(chain); sql += ` AND chain = $${params.length}`; }
    if (mode) { params.push(mode); sql += ` AND mode = $${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
    const res = await query(sql, params);
    return NextResponse.json({ opportunities: res.rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
