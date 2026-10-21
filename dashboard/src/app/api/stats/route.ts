import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const total = await query('SELECT COUNT(*) as c FROM opportunities');
    const dryrun = await query("SELECT COUNT(*) as c FROM opportunities WHERE mode='dryrun'");
    const live = await query("SELECT COUNT(*) as c FROM opportunities WHERE mode='live'");
    const executed = await query('SELECT COUNT(*) as c FROM opportunities WHERE executed=true');
    const totalProfit = await query("SELECT COALESCE(SUM(CAST(net_profit AS numeric)),0) as s FROM opportunities WHERE net_profit IS NOT NULL");
    const last = await query('SELECT created_at, chain, mode, pair, net_profit, buy_dex, sell_dex FROM opportunities ORDER BY created_at DESC LIMIT 10');
    return NextResponse.json({
      total: Number(total.rows[0].c),
      dryrun: Number(dryrun.rows[0].c),
      live: Number(live.rows[0].c),
      executed: Number(executed.rows[0].c),
      totalNetProfitRaw: totalProfit.rows[0].s,
      recent: last.rows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
