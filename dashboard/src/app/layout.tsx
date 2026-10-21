export const metadata = {
  title: 'Flashloan Metrics',
  description: 'Opportunities & dry-run/live metrics',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#0b1020', color: '#e6e6e6' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
          <header style={{ marginBottom: 24 }}>
            <h1 style={{ margin: 0 }}>Flashloan Bot - Opportunities & Metrics</h1>
            <p style={{ margin: '4px 0 0', opacity: 0.7 }}>Dry-run vs live, feasible opportunities, simulated gains</p>
          </header>
          {children}
        </div>
      </body>
    </html>
  )
}
