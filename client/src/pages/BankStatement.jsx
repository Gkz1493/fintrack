import { useState, useEffect, useRef } from 'react';
import { Upload, Download, Save, Trash2, Paperclip, X, Plus } from 'lucide-react';
import axios from 'axios';
import * as XLSX from 'xlsx';

const API = axios.create({ baseURL: '' });
API.interceptors.request.use(cfg => {
  const t = localStorage.getItem('ft_token');
  if (t) cfg.headers.Authorization = 'Bearer ' + t;
  return cfg;
});

const COLS = ['date','vendor','amount','type','invoice_no','utr_number','remark'];
const LABELS = { date:'Date', vendor:'Vendor / Narration', amount:'Amount', type:'Type',
                 invoice_no:'Invoice No', utr_number:'UTR Number', remark:'Remark' };

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

export default function BankStatement() {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [statName, setStatName]   = useState('');
  const [msg, setMsg]             = useState('');
  const [editCell, setEditCell]   = useState(null); // {rowIdx, col}
  const fileRef = useRef();

  // Load saved entries on mount
  useEffect(() => {
    setLoading(true);
    API.get('/api/bankstatement/entries')
      .then(r => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Parse uploaded statement ──────────────────────────────────────────────
  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('statement', file);
      const res = await API.post('/api/bankstatement/parse', fd);
      const newRows = res.data.entries.map(r => ({ ...r, reference_files: [], _new: true }));
      setRows(prev => [...newRows, ...prev]);
      setStatName(res.data.statementName || file.name);
      setMsg(`Parsed ${newRows.length} transactions. Review and click Save.`);
    } catch (err) {
      setMsg('Parse error: ' + (err.response?.data?.error || err.message));
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  }

  // ── Save all unsaved rows ─────────────────────────────────────────────────
  async function handleSave() {
    const newRows = rows.filter(r => r._new);
    if (!newRows.length) { setMsg('No new rows to save.'); return; }
    setSaving(true);
    try {
      await API.post('/api/bankstatement/save', { entries: newRows, statementName: statName });
      // Reload from DB
      const res = await API.get('/api/bankstatement/entries');
      setRows(res.data);
      setMsg(`Saved ${newRows.length} entries.`);
    } catch (err) {
      setMsg('Save error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  }

  // ── Inline cell edit ─────────────────────────────────────────────────────
  function startEdit(rowIdx, col) { setEditCell({ rowIdx, col }); }

  function handleCellChange(rowIdx, col, value) {
    setRows(prev => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [col]: value };
      return next;
    });
  }

  async function commitEdit(rowIdx) {
    setEditCell(null);
    const row = rows[rowIdx];
    if (row._new) return; // will be saved in bulk
    try {
      await API.patch(`/api/bankstatement/entries/${row.id}`, row);
    } catch {}
  }

  // ── Delete row ────────────────────────────────────────────────────────────
  async function deleteRow(rowIdx) {
    const row = rows[rowIdx];
    if (!row._new) {
      try { await API.delete(`/api/bankstatement/entries/${row.id}`); } catch {}
    }
    setRows(prev => prev.filter((_, i) => i !== rowIdx));
  }

  // ── Add empty row ─────────────────────────────────────────────────────────
  function addEmptyRow() {
    setRows(prev => [{ date:'', vendor:'', amount:0, type:'', invoice_no:'',
                        utr_number:'', remark:'', reference_files:[], _new:true }, ...prev]);
  }

  // ── Upload reference files for a row ─────────────────────────────────────
  async function uploadRefs(rowIdx, files) {
    const row = rows[rowIdx];
    if (row._new) {
      // Attach locally only (will save on bulk save — for simplicity just note filenames)
      const fileList = Array.from(files).map(f => ({ name: f.name, file: f.name }));
      setRows(prev => {
        const next = [...prev];
        next[rowIdx] = { ...next[rowIdx], reference_files: [...(next[rowIdx].reference_files||[]), ...fileList] };
        return next;
      });
      return;
    }
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await API.post(`/api/bankstatement/reference/${row.id}`, fd);
      setRows(prev => {
        const next = [...prev];
        next[rowIdx] = { ...next[rowIdx], reference_files: res.data.reference_files };
        return next;
      });
    } catch (err) {
      setMsg('Upload error: ' + (err.response?.data?.error || err.message));
    }
  }

  // ── Export as Excel ───────────────────────────────────────────────────────
  function handleExport() {
    const data = rows.map(r => ({
      'DATE':           r.date,
      'VENDOR':         r.vendor,
      'AMOUNT':         r.amount,
      'TYPE':           r.type,
      'INVOICE NUMBER': r.invoice_no,
      'UTR NUMBER':     r.utr_number,
      'REMARK':         r.remark,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [14,35,14,10,20,22,30].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Bank Statement');
    XLSX.writeFile(wb, 'bank_statement.xlsx');
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const newCount = rows.filter(r => r._new).length;

  return (
    <div className="p-6 min-h-screen bg-gray-50">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Bank Statement</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload SBI statement (Excel/CSV/PDF) · Review &amp; edit · Save to database
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Upload */}
          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Upload size={16} />
            {parsing ? 'Parsing...' : 'Upload Statement'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={handleFileUpload} disabled={parsing} />
          </label>
          {/* Add row */}
          <button onClick={addEmptyRow} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} /> Add Row
          </button>
          {/* Save */}
          {newCount > 0 && (
            <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
              <Save size={16} /> {saving ? 'Saving...' : `Save ${newCount} new`}
            </button>
          )}
          {/* Export */}
          <button onClick={handleExport} disabled={rows.length === 0} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            <Download size={16} /> Export Excel
          </button>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className="mb-4 flex items-center justify-between bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-2 text-sm">
          <span>{msg}</span>
          <button onClick={() => setMsg('')}><X size={14} /></button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading entries...</div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs">
                <th className="px-3 py-3 text-left w-8">#</th>
                {COLS.map(c => (
                  <th key={c} className="px-3 py-3 text-left whitespace-nowrap">{LABELS[c]}</th>
                ))}
                <th className="px-3 py-3 text-left">Reference</th>
                <th className="px-3 py-3 text-left w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={COLS.length + 3} className="py-16 text-center text-gray-400">
                  No entries yet. Upload a bank statement to get started.
                </td></tr>
              )}
              {rows.map((row, ri) => (
                <tr key={ri} className={`border-t ${row._new ? 'bg-yellow-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-3 py-2 text-gray-400 text-xs">{ri + 1}</td>
                  {COLS.map(col => {
                    const isEditing = editCell?.rowIdx === ri && editCell?.col === col;
                    const val = row[col] ?? '';
                    return (
                      <td key={col} className="px-2 py-1" onClick={() => startEdit(ri, col)}>
                        {isEditing ? (
                          <input
                            autoFocus
                            className="w-full border border-blue-400 rounded px-1 py-0.5 text-sm outline-none"
                            value={val}
                            onChange={e => handleCellChange(ri, col, e.target.value)}
                            onBlur={() => commitEdit(ri)}
                            onKeyDown={e => e.key === 'Enter' && commitEdit(ri)}
                          />
                        ) : (
                          <span className={`block cursor-text min-w-[60px] ${col === 'amount' ? 'text-right font-medium' : ''} ${col === 'type' && val === 'debit' ? 'text-red-600' : ''} ${col === 'type' && val === 'credit' ? 'text-green-600' : ''}`}>
                            {col === 'amount' ? fmt(val) : (val || <span className="text-gray-300 italic">—</span>)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {/* Reference column */}
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1 items-center">
                      {(row.reference_files || []).map((f, fi) => (
                        <span key={fi} className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-xs rounded px-2 py-0.5">
                          <Paperclip size={10} />
                          {f.name}
                        </span>
                      ))}
                      <label className="cursor-pointer text-blue-500 hover:text-blue-700 text-xs inline-flex items-center gap-1">
                        <Paperclip size={12} /> Attach
                        <input type="file" multiple className="hidden"
                          onChange={e => uploadRefs(ri, e.target.files)} />
                      </label>
                    </div>
                  </td>
                  {/* Delete */}
                  <td className="px-2 py-1">
                    <button onClick={() => deleteRow(ri)} className="text-red-400 hover:text-red-600 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length > 0 && (
            <div className="px-4 py-3 border-t bg-gray-50 text-sm text-gray-500 flex justify-between">
              <span>{rows.length} entries{newCount > 0 ? ` · ${newCount} unsaved (highlighted)` : ''}</span>
              <span className="font-semibold text-gray-700">
                Total Debit: ₹{fmt(rows.filter(r=>r.type==='debit').reduce((s,r)=>s+Number(r.amount||0),0))} &nbsp;|&nbsp;
                Total Credit: ₹{fmt(rows.filter(r=>r.type==='credit').reduce((s,r)=>s+Number(r.amount||0),0))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
