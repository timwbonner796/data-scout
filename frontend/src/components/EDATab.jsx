import React, { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { fetchEDA, fetchCorrelation } from '../utils/api'

const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
  'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)',
]

function MissingDataSummary({ columns }) {
  const sorted = useMemo(() =>
    [...columns].sort((a, b) => b.null_pct - a.null_pct),
    [columns]
  )

  const hasMissing = sorted.some(c => c.null_pct > 0)

  if (!hasMissing) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>
        No missing values in any column.
      </div>
    )
  }

  return (
    <div className="missing-grid">
      {sorted.filter(c => c.null_pct > 0).map(col => {
        const pct = col.null_pct
        const barColor = pct > 50 ? 'var(--danger)' : pct > 10 ? 'var(--accent)' : 'var(--info)'
        return (
          <div key={col.name} className="missing-row">
            <span className="col-name" title={col.name}>{col.name}</span>
            <div className="missing-bar-container">
              <div className="missing-bar" style={{ width: `${pct}%`, background: barColor }} />
            </div>
            <span className="missing-pct">{pct.toFixed(1)}%</span>
          </div>
        )
      })}
    </div>
  )
}


function HistogramChart({ name, data }) {
  if (!data || !data.bins || data.bins.length === 0) {
    return <div className="empty-state" style={{ padding: 20 }}>No data</div>
  }

  const chartData = data.bins.map((b, i) => ({
    name: b.label?.length > 15 ? b.label.slice(0, 14) + '…' : b.label,
    fullLabel: b.label,
    count: b.count,
    idx: i,
  }))

  const isCategorical = data.type === 'categorical' || data.type === 'datetime'
  const color = CHART_COLORS[Math.abs(hashCode(name)) % CHART_COLORS.length]

  return (
    <div className="histogram-card">
      <div className="histogram-header">
        <span className="col-name">{name}</span>
        <span className="col-type">{data.type}</span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
            interval={isCategorical ? 0 : 'preserveStartEnd'}
            angle={isCategorical && chartData.length > 6 ? -35 : 0}
            textAnchor={isCategorical && chartData.length > 6 ? 'end' : 'middle'}
            height={isCategorical && chartData.length > 6 ? 50 : 20}
          />
          <YAxis
            tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
            width={40}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'var(--text-primary)' }}
            formatter={(value) => [value.toLocaleString(), 'Count']}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.fullLabel || label}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={color} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {data.type === 'numeric' && (
        <div className="histogram-stats">
          <span>μ={fmt(data.mean)}</span>
          <span>med={fmt(data.median)}</span>
          <span>σ={fmt(data.std)}</span>
          <span>range=[{fmt(data.min)}, {fmt(data.max)}]</span>
        </div>
      )}
      {data.n_unique && (
        <div className="histogram-stats">
          <span>{data.n_unique.toLocaleString()} unique</span>
          {data.null_count > 0 && <span>{data.null_count.toLocaleString()} null</span>}
          {data.truncated > 0 && <span>+{data.truncated} more values</span>}
        </div>
      )}
    </div>
  )
}

function CorrelationMatrix({ datasetId }) {
  const [method, setMethod] = useState('pearson')
  const [corrData, setCorrData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCorrelation(datasetId, method)
      .then(data => { if (!cancelled) setCorrData(data) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [datasetId, method])

  if (loading) return <div className="loading"><span className="spinner" />Computing correlations…</div>

  if (!corrData || !corrData.columns || corrData.columns.length < 2) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>
        {method === 'pearson'
          ? 'Need ≥2 continuous numeric columns for Pearson correlation.'
          : 'Need ≥2 categorical columns for Cramér\'s V.'}
      </div>
    )
  }

  const { columns, matrix } = corrData
  const isPearson = method === 'pearson'

  const getCellColor = (val) => {
    if (isPearson) {
      if (val > 0) return `rgba(196, 92, 74, ${Math.abs(val) * 0.85})`
      if (val < 0) return `rgba(59, 106, 155, ${Math.abs(val) * 0.85})`
      return 'transparent'
    }
    return `rgba(212, 160, 84, ${val * 0.85})`
  }

  return (
    <div>
      <div className="correlation-toggle">
        <button className={method === 'pearson' ? 'active' : ''} onClick={() => setMethod('pearson')}>
          Pearson (numeric)
        </button>
        <button className={method === 'cramers_v' ? 'active' : ''} onClick={() => setMethod('cramers_v')}>
          Cramér's V (categorical)
        </button>
      </div>
      <div className="correlation-container">
        <table className="corr-matrix">
          <thead>
            <tr>
              <th></th>
              {columns.map(c => (
                <th key={c} style={{ writingMode: columns.length > 8 ? 'vertical-lr' : undefined, textAlign: 'center' }}>
                  {c.length > 12 ? c.slice(0, 11) + '…' : c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((row, i) => (
              <tr key={row}>
                <th className="row-label" title={row}>{row.length > 14 ? row.slice(0, 13) + '…' : row}</th>
                {columns.map((col, j) => {
                  const val = matrix[i]?.[j] ?? 0
                  return (
                    <td
                      key={col}
                      className="corr-cell"
                      style={{ background: getCellColor(val) }}
                      title={`${row} × ${col}: ${val.toFixed(3)}`}
                    >
                      {Math.abs(val) > 0.005 ? val.toFixed(2) : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


export default function EDATab({ dataset }) {
  const [edaData, setEdaData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState('missing')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchEDA(dataset.dataset_id)
      .then(data => { if (!cancelled) setEdaData(data) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dataset.dataset_id])

  if (loading) return <div className="loading"><span className="spinner" />Running EDA…</div>

  return (
    <div>
      {/* Sub-nav */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${section === 'missing' ? 'active' : ''}`} onClick={() => setSection('missing')}>
          Missing Data
        </button>
        <button className={`tab ${section === 'histograms' ? 'active' : ''}`} onClick={() => setSection('histograms')}>
          Distributions
        </button>
        <button className={`tab ${section === 'correlation' ? 'active' : ''}`} onClick={() => setSection('correlation')}>
          Correlations
        </button>
      </div>

      {section === 'missing' && (
        <div>
          <div className="section-title">Missing Values by Column</div>
          <MissingDataSummary columns={dataset.columns} />
        </div>
      )}

      {section === 'histograms' && edaData && (
        <div>
          <div className="section-title">Distribution by Column</div>
          <div className="histogram-grid">
            {Object.entries(edaData.histograms).map(([name, data]) => (
              <HistogramChart key={name} name={name} data={data} />
            ))}
          </div>
        </div>
      )}

      {section === 'correlation' && (
        <div>
          <div className="section-title">Correlation Matrix</div>
          <CorrelationMatrix datasetId={dataset.dataset_id} />
        </div>
      )}
    </div>
  )
}


// Utilities
function fmt(n) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  if (Number.isInteger(n)) return n.toString()
  return n.toFixed(2)
}

function hashCode(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return hash
}
