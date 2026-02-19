import React, { useState, useCallback } from 'react'
import { Upload, BarChart3, Filter, X } from 'lucide-react'
import { uploadFile } from './utils/api'
import EDATab from './components/EDATab'
import FilterTab from './components/FilterTab'

export default function App() {
  const [dataset, setDataset] = useState(null)
  const [activeTab, setActiveTab] = useState('eda')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dragover, setDragover] = useState(false)

  const handleFile = useCallback(async (file) => {
    setLoading(true)
    setError(null)
    try {
      const result = await uploadFile(file)
      setDataset(result)
      setActiveTab('eda')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragover(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onFileInput = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const clearDataset = () => {
    setDataset(null)
    setActiveTab('eda')
  }

  const formatNum = (n) => n?.toLocaleString() ?? '—'

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">Data Scout</h1>
        <span className="app-subtitle">EDA · Filter · Export</span>
      </header>

      {!dataset && !loading && (
        <div
          className={`upload-zone ${dragover ? 'dragover' : ''}`}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
          onDragLeave={() => setDragover(false)}
          onClick={() => document.getElementById('file-input').click()}
        >
          <Upload size={28} color="var(--text-muted)" style={{ marginBottom: 12 }} />
          <h2>Drop a dataset here</h2>
          <p>or click to browse</p>
          <div className="formats">.csv · .tsv · .xlsx · .parquet</div>
          <input
            id="file-input"
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,.parquet,.tab"
            style={{ display: 'none' }}
            onChange={onFileInput}
          />
        </div>
      )}

      {loading && (
        <div className="loading">
          <span className="spinner" />
          Parsing file…
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', padding: 20, textAlign: 'center' }}>
          {error}
        </div>
      )}

      {dataset && (
        <>
          <div className="dataset-badge">
            <span className="filename">{dataset.filename}</span>
            <span className="meta">
              {formatNum(dataset.n_rows)} rows × {dataset.n_cols} cols
            </span>
            <button onClick={clearDataset} title="Remove dataset">
              <X size={14} />
            </button>
          </div>

          <div className="tabs">
            <button
              className={`tab ${activeTab === 'eda' ? 'active' : ''}`}
              onClick={() => setActiveTab('eda')}
            >
              <BarChart3 size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
              EDA
            </button>
            <button
              className={`tab ${activeTab === 'filter' ? 'active' : ''}`}
              onClick={() => setActiveTab('filter')}
            >
              <Filter size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
              Filter & Export
            </button>
          </div>

          {activeTab === 'eda' && <EDATab dataset={dataset} />}
          {activeTab === 'filter' && <FilterTab dataset={dataset} />}
        </>
      )}
    </div>
  )
}
