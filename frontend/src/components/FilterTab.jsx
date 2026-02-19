import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronRight, Search, Download, RotateCcw } from 'lucide-react'
import { fetchFilterPreview, fetchColumnValues, exportFiltered } from '../utils/api'

function CategoricalFilter({ datasetId, column, filter, onUpdate }) {
  const [values, setValues] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchColumnValues(datasetId, column.name)
      .then(data => { if (!cancelled) setValues(data) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [datasetId, column.name])

  if (loading || !values) return <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: 4 }}>Loading…</div>

  const selected = filter?.values || []
  const filtered = values.values.filter(v =>
    !search || v.toLowerCase().includes(search.toLowerCase())
  )

  const toggleValue = (val) => {
    const newSelected = selected.includes(val)
      ? selected.filter(v => v !== val)
      : [...selected, val]

    if (newSelected.length === 0) {
      onUpdate(null)
    } else {
      onUpdate({ column: column.name, op: 'in', values: newSelected })
    }
  }

  const selectAll = () => {
    onUpdate({ column: column.name, op: 'in', values: [...filtered] })
  }

  const clearAll = () => onUpdate(null)

  return (
    <div>
      {values.values.length > 8 && (
        <input
          className="search-input"
          placeholder="Search values…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <button
          style={{ fontSize: '0.7rem', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          onClick={selectAll}
        >
          Select visible
        </button>
        <button
          style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          onClick={clearAll}
        >
          Clear
        </button>
      </div>
      <div className="filter-values">
        {filtered.map(val => (
          <button
            key={val}
            className={`filter-chip ${selected.includes(val) ? 'selected' : ''}`}
            onClick={() => toggleValue(val)}
          >
            {val.length > 25 ? val.slice(0, 24) + '…' : val}
          </button>
        ))}
      </div>
      {values.truncated && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
          Showing {values.values.length} of {values.total_unique} unique values
        </div>
      )}
      <NullToggle column={column} filter={filter} onUpdate={onUpdate} />
    </div>
  )
}

function NumericFilter({ column, filter, onUpdate }) {
  const [min, setMin] = useState(filter?.min_val ?? '')
  const [max, setMax] = useState(filter?.max_val ?? '')
  const debounceRef = useRef(null)

  const commit = useCallback((newMin, newMax) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const minVal = newMin === '' ? null : parseFloat(newMin)
      const maxVal = newMax === '' ? null : parseFloat(newMax)
      if (minVal === null && maxVal === null) {
        onUpdate(null)
      } else {
        onUpdate({ column: column.name, op: 'range', min_val: minVal, max_val: maxVal })
      }
    }, 400)
  }, [column.name, onUpdate])

  const handleMin = (e) => { setMin(e.target.value); commit(e.target.value, max) }
  const handleMax = (e) => { setMax(e.target.value); commit(min, e.target.value) }

  return (
    <div>
      <div className="range-inputs">
        <input type="number" placeholder="Min" value={min} onChange={handleMin} />
        <span>to</span>
        <input type="number" placeholder="Max" value={max} onChange={handleMax} />
      </div>
      <NullToggle column={column} filter={filter} onUpdate={onUpdate} />
    </div>
  )
}

function TextFilter({ column, filter, onUpdate }) {
  const [pattern, setPattern] = useState(filter?.pattern || '')
  const debounceRef = useRef(null)

  const commit = useCallback((val) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!val) {
        onUpdate(null)
      } else {
        onUpdate({ column: column.name, op: 'contains', pattern: val })
      }
    }, 400)
  }, [column.name, onUpdate])

  const handleChange = (e) => {
    setPattern(e.target.value)
    commit(e.target.value)
  }

  return (
    <div>
      <input
        className="search-input"
        placeholder="Contains…"
        value={pattern}
        onChange={handleChange}
      />
      <NullToggle column={column} filter={filter} onUpdate={onUpdate} />
    </div>
  )
}

function NullToggle({ column, filter, onUpdate }) {
  if (column.null_count === 0) return null

  const nullOp = filter?.op === 'is_null' ? 'is_null' : filter?.op === 'not_null' ? 'not_null' : null

  return (
    <div className="null-toggle">
      <button
        className={nullOp === 'not_null' ? 'active' : ''}
        onClick={() => onUpdate(nullOp === 'not_null' ? null : { column: column.name, op: 'not_null' })}
      >
        exclude nulls
      </button>
      <button
        className={nullOp === 'is_null' ? 'active' : ''}
        onClick={() => onUpdate(nullOp === 'is_null' ? null : { column: column.name, op: 'is_null' })}
      >
        only nulls
      </button>
    </div>
  )
}

function FilterColumn({ datasetId, column, filter, onUpdate, isOpen, onToggle }) {
  const hasFilter = filter != null
  const colType = column.col_type

  return (
    <div className="filter-item" style={hasFilter ? { borderColor: 'var(--accent-dim)' } : {}}>
      <div className="filter-item-header" onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span style={hasFilter ? { color: 'var(--accent)' } : {}}>{column.name}</span>
        </div>
        <span className="col-type-badge">{colType}</span>
      </div>
      {isOpen && (
        <div className="filter-item-body">
          {(colType === 'categorical' || colType === 'numeric_categorical' || colType === 'boolean') && (
            <CategoricalFilter datasetId={datasetId} column={column} filter={filter} onUpdate={onUpdate} />
          )}
          {colType === 'numeric_continuous' && (
            <NumericFilter column={column} filter={filter} onUpdate={onUpdate} />
          )}
          {colType === 'datetime' && (
            <TextFilter column={column} filter={filter} onUpdate={onUpdate} />
          )}
          {!['categorical', 'numeric_categorical', 'boolean', 'numeric_continuous', 'datetime'].includes(colType) && (
            <TextFilter column={column} filter={filter} onUpdate={onUpdate} />
          )}
        </div>
      )}
    </div>
  )
}


export default function FilterTab({ dataset }) {
  const [filters, setFilters] = useState({}) // column_name -> FilterSpec
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [openCols, setOpenCols] = useState({})
  const [colSearch, setColSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportFilename, setExportFilename] = useState('filtered_data')
  const debounceRef = useRef(null)

  const filterList = Object.values(filters).filter(Boolean)

  // Fetch preview on filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      fetchFilterPreview(dataset.dataset_id, filterList)
        .then(setPreview)
        .finally(() => setLoading(false))
    }, 300)
  }, [dataset.dataset_id, JSON.stringify(filterList)])

  const updateFilter = useCallback((colName, spec) => {
    setFilters(prev => {
      const next = { ...prev }
      if (spec === null) {
        delete next[colName]
      } else {
        next[colName] = spec
      }
      return next
    })
  }, [])

  const clearAllFilters = () => setFilters({})

  const handleExport = async (format) => {
    setExporting(true)
    try {
      await exportFiltered(dataset.dataset_id, filterList, format, exportFilename)
    } finally {
      setExporting(false)
    }
  }

  const toggleCol = (name) => {
    setOpenCols(prev => ({ ...prev, [name]: !prev[name] }))
  }

  const filteredColumns = dataset.columns.filter(c =>
    !colSearch || c.name.toLowerCase().includes(colSearch.toLowerCase())
  )

  const rowCount = preview?.n_rows ?? dataset.n_rows
  const rowCountOriginal = preview?.n_rows_original ?? dataset.n_rows
  const pctKept = rowCountOriginal > 0 ? ((rowCount / rowCountOriginal) * 100).toFixed(1) : '100.0'

  return (
    <div className="filter-panel">
      <div className="filter-sidebar">
        <div className="section-title">Column Filters</div>
        <input
          className="search-input"
          placeholder="Search columns…"
          value={colSearch}
          onChange={e => setColSearch(e.target.value)}
        />
        {filterList.length > 0 && (
          <button
            onClick={clearAllFilters}
            style={{
              fontSize: '0.75rem', color: 'var(--danger)', background: 'none',
              border: 'none', cursor: 'pointer', marginBottom: 8, fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <RotateCcw size={11} /> Clear all filters ({filterList.length})
          </button>
        )}
        {filteredColumns.map(col => (
          <FilterColumn
            key={col.name}
            datasetId={dataset.dataset_id}
            column={col}
            filter={filters[col.name]}
            onUpdate={(spec) => updateFilter(col.name, spec)}
            isOpen={!!openCols[col.name]}
            onToggle={() => toggleCol(col.name)}
          />
        ))}
      </div>

      <div className="filter-main">
        <div className="action-bar">
          <div className="row-count">
            <strong>{rowCount.toLocaleString()}</strong> / {rowCountOriginal.toLocaleString()} rows
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({pctKept}%)</span>
            {loading && <span className="spinner" style={{ marginLeft: 10 }} />}
          </div>
          <div className="btn-group">
            <input
              className="search-input"
              style={{ width: 160, marginRight: 4 }}
              placeholder="Filename…"
              value={exportFilename}
              onChange={e => setExportFilename(e.target.value)}
            />
            <button className="btn btn-accent" onClick={() => handleExport('csv')} disabled={exporting}>
              <Download size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              CSV
            </button>
            <button className="btn" onClick={() => handleExport('parquet')} disabled={exporting}>
              <Download size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              Parquet
            </button>
            {exporting && <span className="spinner" style={{ marginLeft: 8 }} />}
          </div>
        </div>

        {preview && preview.preview && (
          <div className="preview-table-container">
            <table className="preview-table">
              <thead>
                <tr>
                  {dataset.columns.map(col => (
                    <th key={col.name}>{col.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((row, i) => (
                  <tr key={i}>
                    {dataset.columns.map(col => {
                      const val = row[col.name]
                      const isNull = val === null || val === undefined
                      return (
                        <td key={col.name} className={isNull ? 'null-cell' : ''}>
                          {isNull ? 'null' : String(val)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {preview && preview.preview && preview.preview.length === 0 && (
          <div className="empty-state">No rows match the current filters.</div>
        )}
      </div>
    </div>
  )
}
