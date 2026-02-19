const BASE = '/api';

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Upload failed');
  }
  return res.json();
}

export async function fetchEDA(datasetId) {
  const res = await fetch(`${BASE}/eda/${datasetId}`);
  if (!res.ok) throw new Error('Failed to fetch EDA');
  return res.json();
}

export async function fetchCorrelation(datasetId, method = 'pearson') {
  const res = await fetch(`${BASE}/correlation/${datasetId}?method=${method}`);
  if (!res.ok) throw new Error('Failed to fetch correlation');
  return res.json();
}

export async function fetchFilterPreview(datasetId, filters) {
  const res = await fetch(`${BASE}/filter/${datasetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters }),
  });
  if (!res.ok) throw new Error('Failed to apply filters');
  return res.json();
}

export async function fetchColumnValues(datasetId, column) {
  const res = await fetch(`${BASE}/column-values/${datasetId}/${encodeURIComponent(column)}`);
  if (!res.ok) throw new Error('Failed to fetch column values');
  return res.json();
}

export async function exportFiltered(datasetId, filters, format = 'csv', filename = 'filtered_data') {
  const res = await fetch(`${BASE}/export/${datasetId}?format=${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters }),
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const fullFilename = `${filename}.${format}`;

  if (window.showSaveFilePicker) {
    const mimeType = format === 'csv' ? 'text/csv' : 'application/octet-stream';
    const ext = `.${format}`;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fullFilename,
        types: [{
          description: format === 'csv' ? 'CSV file' : 'Parquet file',
          accept: { [mimeType]: [ext] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled
      throw err;
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fullFilename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
