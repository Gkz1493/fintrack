import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen, ChevronRight, ArrowLeft, Search,
  ReceiptText, IndianRupee, Clock, Download,
  Link, Edit3, Check, X, Plus, Trash2,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getProjectNames, getProjectStatsByName, exportExcel, getProjectDetails, saveProjectDetails } from '../api';

const CAT_COLORS = {
  consumables: '#6366f1', travel: '#f59e0b', advance: '#10b981',
  overhead: '#3b82f6', other: '#8b5cf6',
};
const CAT_ICONS = { consumables:'🧾', travel:'✈️', advance:'💰', overhead:'🏢', other:'📦' };
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function dlSVG(id, name) {
  const svg = document.querySelector(`#${id} svg`);
  if (!svg) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Projects() {
  const navigate = useNavigate();
  const [names,       setNames]      = useState([]);
  const [search,      setSearch]     = useState('');
  const [loading,     setLoading]    = useState(true);
  const [selected,    setSelected]   = useState(null);
  const [stats,       setStats]      = useState(null);
  const [loadingSt,   setLoadingSt]  = useState(false);
  const [details,     setDetails]    = useState(null);
  const [editMode,    setEditMode]   = useState(false);
  const [detailsForm, setDetailsForm] = useState(null);

  useEffect(() => {
    getProjectNames()
      .then(r => setNames(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const openProject = async (name) => {
    setSelected(name);
    setStats(null);
    setDetails(null);
    setEditMode(false);
    setLoadingSt(true);
    try {
      const [sRes, dRes] = await Promise.allSettled([
        getProjectStatsByName(name),
        getProjectDetails(name),
      ]);
      if (sRes.status === 'fulfilled') setStats(sRes.value.data);
      if (dRes.status === 'fulfilled') setDetails(dRes.value.data);
    } finally { setLoadingSt(false); }
  };

  const filtered = names.filter(n => n.toLowerCase().includes(search.toLowerCase()));

  const startEdit = () => {
    setDetailsForm({
      client_name:      details?.client_name      || '',
      mobile:           details?.mobile           || '',
      email:            details?.email            || '',
      address:          details?.address          || '',
      fund_allocated:   details?.fund_allocated   || '',
      fund_releases:    details?.fund_releases    || [],
      drive_folder_url: details?.drive_folder_url || '',
    });
    setEditMode(true);
  };

  const handleSave = async () => {
    try {
      const res = await saveProjectDetails({ project_name: selected, ...detailsForm,
        fund_allocated: Number(detailsForm.fund_allocated) || 0 });
      setDetails(res.data);
      setEditMode(false);
    } catch (e) { console.error('Save details error', e); }
  };

  const addRelease = () =>
    setDetailsForm(f => ({ ...f, fund_releases: [...(f.fund_releases || []), { date: '', amount: '', note: '' }] }));

  const updateRelease = (i, field, val) =>
    setDetailsForm(f => {
      const arr = [...f.fund_releases];
      arr[i] = { ...arr[i], [field]: val };
      return { ...f, fund_releases: arr };
    });

  const removeRelease = i =>
    setDetailsForm(f => ({ ...f, fund_releases: f.fund_releases.filter((_, idx) => idx !== i) }));

  /* ── PROJECT DETAIL VIEW ──────────────────────────────── */
  if (selected) {
    const catData = stats
      ? Object.entries(stats.byCategory || {}).map(([cat, val]) => ({
          name:  (CAT_ICONS[cat] || '📦') + ' ' + cat.charAt(0).toUpperCase() + cat.slice(1),
          value: val,
          color: CAT_COLORS[cat] || '#8b5cf6',
        }))
      : [];

    const fundReleases   = details?.fund_releases || [];
    const totalReleased  = fundReleases.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const fundAllocated  = Number(details?.fund_allocated || 0);
    const totalSpent     = stats?.total || 0;
    const balance        = totalReleased - totalSpent;

    return (
      <div className="p-4 md:p-6 page-enter max-w-5xl mx-auto space-y-5">

        <button onClick={() => { setSelected(null); setStats(null); setDetails(null); setEditMode(false); }}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={15} /> Back to Projects
        </button>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
              <FolderOpen size={22} className="text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{selected}</h1>
              {stats && <p className="text-sm text-gray-400">{stats.count} bills · {fmt(stats.total)} total</p>}
            </div>
          </div>
          <button
            onClick={editMode ? handleSave : startEdit}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition ${
              editMode ? 'bg-indigo-600 text-white border-indigo-600' : 'text-gray-600 border-gray-200 hover:border-indigo-300'
            }`}>
            {editMode ? <><Check size={14} /> Save</> : <><Edit3 size={14} /> Edit Details</>}
          </button>
        </div>

        {loadingSt && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loadingSt && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Spent',    value: fmt(totalSpent),    color: 'text-indigo-600' },
                { label: 'Bills',          value: stats?.count || 0,  color: 'text-blue-600'   },
                { label: 'Fund Allocated', value: fmt(fundAllocated), color: 'text-purple-600' },
                { label: 'Balance',        value: fmt(balance), color: balance >= 0 ? 'text-green-600' : 'text-red-600' },
              ].map(c => (
                <div key={c.label} className="card p-4">
                  <div className={`text-xs font-semibold uppercase ${c.color} mb-1`}>{c.label}</div>
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                </div>
              ))}
            </div>

            {/* Project Details card */}
            {editMode ? (
              <div className="card p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 text-sm">Edit Project Details</h3>
                  <button onClick={() => setEditMode(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[['client_name','Client Name','text'],['mobile','Mobile','tel'],['email','Email','email'],['fund_allocated','Fund Allocated (₹)','number']].map(([key, label, type]) => (
                    <div key={key}>
                      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                      <input type={type} value={detailsForm[key] || ''} onChange={e => setDetailsForm(f => ({ ...f, [key]: e.target.value }))}
                        className="input w-full text-sm py-2" placeholder={label} />
                    </div>
                  ))}
                  <div className="md:col-span-2">
                    <label className="text-xs text-gray-500 mb-1 block">Company Address</label>
                    <textarea value={detailsForm.address || ''} onChange={e => setDetailsForm(f => ({ ...f, address: e.target.value }))}
                      className="input w-full text-sm py-2 resize-none" rows={2} placeholder="Company address…" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-gray-500 mb-1 block">Google Drive Folder Link</label>
                    <input type="url" value={detailsForm.drive_folder_url || ''}
                      onChange={e => setDetailsForm(f => ({ ...f, drive_folder_url: e.target.value }))}
                      className="input w-full text-sm py-2" placeholder="https://drive.google.com/drive/folders/…" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Fund Releases (Installments)</span>
                    <button onClick={addRelease} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800">
                      <Plus size={12} /> Add
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(detailsForm.fund_releases || []).map((r, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input type="date" value={r.date || ''} onChange={e => updateRelease(i, 'date', e.target.value)} className="input text-sm py-1.5 w-36" />
                        <input type="number" value={r.amount || ''} onChange={e => updateRelease(i, 'amount', e.target.value)} className="input text-sm py-1.5 w-32" placeholder="Amount (₹)" />
                        <input type="text" value={r.note || ''} onChange={e => updateRelease(i, 'note', e.target.value)} className="input text-sm py-1.5 flex-1" placeholder="Note (optional)" />
                        <button onClick={() => removeRelease(i)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    ))}
                    {!(detailsForm.fund_releases || []).length && (
                      <p className="text-xs text-gray-400">No installments yet. Click Add to record a fund release.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : details ? (
              <div className="card p-4 space-y-4">
                <h3 className="font-semibold text-gray-800 text-sm">Project Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  {details.client_name && <div><span className="text-gray-400 text-xs block">Client</span><span className="font-medium text-gray-800">{details.client_name}</span></div>}
                  {details.mobile && <div><span className="text-gray-400 text-xs block">Mobile</span><span className="font-medium text-gray-800">{details.mobile}</span></div>}
                  {details.email && <div><span className="text-gray-400 text-xs block">Email</span><span className="font-medium text-gray-800">{details.email}</span></div>}
                  {details.address && <div className="md:col-span-2"><span className="text-gray-400 text-xs block">Address</span><span className="font-medium text-gray-800 whitespace-pre-wrap">{details.address}</span></div>}
                </div>
                {details.drive_folder_url && (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <Link size={16} className="text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-blue-500 font-medium mb-0.5">Google Drive Folder</div>
                      <a href={details.drive_folder_url} target="_blank" rel="noreferrer"
                        className="text-sm text-blue-700 hover:underline truncate block">{details.drive_folder_url}</a>
                    </div>
                    <a href={details.drive_folder_url} target="_blank" rel="noreferrer"
                      className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition">
                      Open Folder
                    </a>
                  </div>
                )}
                {fundReleases.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Fund Releases</div>
                    <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                      {fundReleases.map((r, i) => (
                        <div key={i} className="flex items-center px-3 py-2 text-sm">
                          <span className="text-gray-400 w-28 shrink-0">{r.date}</span>
                          <span className="flex-1 text-gray-600">{r.note}</span>
                          <span className="font-semibold text-green-700">{fmt(r.amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 text-sm font-semibold">
                        <span className="text-gray-600">Total Released</span>
                        <span className="text-green-700">{fmt(totalReleased)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="card p-4 border-dashed border-gray-200 text-center">
                <p className="text-sm text-gray-400">No project details yet.</p>
                <button onClick={startEdit} className="mt-2 text-xs text-indigo-600 hover:underline">
                  + Add client info &amp; fund details
                </button>
              </div>
            )}

            {/* Charts */}
            {catData.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-800 text-sm">Spend by Category</h3>
                    <button onClick={() => dlSVG('proj-catpie', selected + '_pie.svg')}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded px-2 py-0.5">
                      <Download size={10} /> SVG
                    </button>
                  </div>
                  <div id="proj-catpie">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={catData} dataKey="value" cx="50%" cy="50%" outerRadius={70}
                          label={({ percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                          {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={v => [fmt(v), '']} />
                        <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-800 text-sm">Category Breakdown</h3>
                    <button onClick={() => dlSVG('proj-catbar', selected + '_bar.svg')}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded px-2 py-0.5">
                      <Download size={10} /> SVG
                    </button>
                  </div>
                  <div id="proj-catbar">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={catData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => '₹' + (v / 1000).toFixed(0) + 'k'} />
                        <Tooltip formatter={v => [fmt(v), 'Amount']} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Category % bars */}
            {catData.length > 0 && (
              <div className="card p-4">
                <h3 className="font-semibold text-gray-800 text-sm mb-3">Category % of Spend</h3>
                <div className="space-y-3">
                  {catData.map(c => {
                    const pct = stats.total > 0 ? Math.round((c.value / stats.total) * 100) : 0;
                    return (
                      <div key={c.name}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-700">{c.name}</span>
                          <span className="font-semibold">{fmt(c.value)} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: pct + '%', background: c.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* All Bills */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 text-sm">
                  All Bills <span className="text-gray-400 font-normal">({stats?.expenses?.length || 0})</span>
                </h3>
                <button onClick={exportExcel}
                  className="flex items-center gap-1 text-xs text-green-700 hover:text-green-800 border border-green-200 rounded px-2 py-1">
                  <Download size={11} /> Export Excel
                </button>
              </div>
              {!(stats?.expenses?.length) ? (
                <div className="text-center py-12 text-gray-400 text-sm">No bills in this project yet.</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {(stats.expenses || []).map(e => (
                    <div key={e.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                        style={{ background: (CAT_COLORS[e.category] || '#8b5cf6') + '18' }}>
                        {CAT_ICONS[e.category] || '📦'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{e.vendor}</div>
                        <div className="text-xs text-gray-400">{e.date} · {e.category}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold text-sm text-gray-900">{fmt(e.total)}</div>
                        {e.file_path || e.drive_url ? (
                          <a href={e.drive_url || e.file_path} target="_blank" rel="noreferrer"
                            className="text-xs text-indigo-600 hover:underline">View Receipt</a>
                        ) : (
                          <span className="text-xs text-gray-300">No receipt</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ── PROJECT LIST / FOLDER VIEW ─────────────────────────── */
  return (
    <div className="p-4 md:p-6 page-enter max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Projects</h1>
        <span className="text-sm text-gray-400">{names.length} project{names.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input placeholder="Search projects…" value={search} onChange={e => setSearch(e.target.value)}
          className="input pl-9 py-2.5 text-sm w-full" />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <FolderOpen size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">{search ? 'No projects match your search.' : 'No projects yet. Create one when uploading a bill.'}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {filtered.map(name => (
          <button key={name} onClick={() => openProject(name)}
            className="card p-4 text-left hover:shadow-md hover:border-indigo-200 border border-transparent transition group">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-indigo-100 group-hover:bg-indigo-200 rounded-xl flex items-center justify-center transition shrink-0">
                <FolderOpen size={18} className="text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 text-sm truncate">{name}</div>
              </div>
              <ChevronRight size={14} className="text-gray-400 group-hover:text-indigo-500 transition shrink-0" />
            </div>
            <p className="text-xs text-gray-400">Click to view bills &amp; analytics</p>
          </button>
        ))}
      </div>
    </div>
  );
}
