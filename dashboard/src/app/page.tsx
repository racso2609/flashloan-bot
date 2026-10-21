'use client'
import { useEffect, useState } from 'react'

type Opp = any
type Stat = any

export default function Home() {
  const [stats, setStats] = useState<any>(null)
  const [opps, setOpps] = useState<Opp[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [s, o] = await Promise.all([
        fetch('/api/stats').then(r => r.json()),
        fetch('/api/opportunities?limit=100').then(r => r.json()),
      ])
      setStats(s)
      setOpps(o.opportunities || [])
      setLoading(false)
    }
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  if (loading) return <div>Loading...</div>

  return (
    <main>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Card title="Total" value={stats.total} />
        <Card title="Dry-run" value={stats.dryrun} />
        <Card title="Live" value={stats.live} />
        <Card title="Executed" value={stats.executed} />
        <Card title="Total Net Profit (raw)" value={String(stats.totalNetProfitRaw)} />
      </section>
      <section>
        <h2 style={{ marginBottom: 12 }}>Recent Opportunities</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                <Th>Created</Th>
                <Th>Chain</Th>
                <Th>Mode</Th>
                <Th>Type</Th>
                <Th>Pair</Th>
                <Th>Buy</Th>
                <Th>Sell</Th>
                <Th>Net Profit</Th>
                <Th>Simulated</Th>
                <Th>Executed</Th>
                <Th>TX</Th>
              </tr>
            </thead>
            <tbody>
              {opps.map((o: any) => (
                <tr key={o.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <Td>{new Date(o.created_at).toLocaleString()}</Td>
                  <Td>{o.chain}</Td>
                  <Td>{o.mode}</Td>
                  <Td>{o.type}</Td>
                  <Td>{o.pair}</Td>
                  <Td>{o.buy_dex}</Td>
                  <Td>{o.sell_dex}</Td>
                  <Td>{o.net_profit}</Td>
                  <Td>{String(o.simulated)}</Td>
                  <Td>{String(o.executed)}</Td>
                  <Td>{o.tx_hash ? o.tx_hash.slice(0, 10) : '-'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function Card({ title, value }: any) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 8 }}>
      <div style={{ opacity: 0.7, fontSize: 12 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function Th({ children }: any) { return <th style={{ padding: 8, textAlign: 'left' }}>{children}</th> }
function Td({ children }: any) { return <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{children}</td> }
