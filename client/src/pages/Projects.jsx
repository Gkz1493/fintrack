import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen, ChevronRight, ArrowLeft, Search,
  ReceiptText, IndianRupee, Clock, Download,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getProjectNames, getProjectStatsByName, exportExcel } from '../api';

const CAT_COLORS = {
  consumables: '#6366f1', travel: '#f59e0b', advance: '#10b981',
  overhead: '#3b82f6', other: '#8b5cf6',
};
const CAT_ICONS = { consumables:'🛒', travel:'🚗', advance:'💰', overhead:'🏢', other:'📦' };
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/* ── Download chart ──────────────────────────────────────────── */
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
  const [names,    setNames]   = useState([]);
  const [search,   setSearch]  = useState('');
  const [loading,  setLoading] = useState(true);
  const [selected, setSelected] = useState(null);   // active project name
  const [stats,    setStats]   = useState(null);    // active project stats
  const [loadingSt,setLoadingSt] = useState(false);

  useEffect(() => {
    getProjectNames()
      .then(r => setNames(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const openProject = async (name) => {
    setSelected(name);
    setLoadingSt(true);
    try {
      const r = await getProjectStatsByName(name);
      setStats(r.data);
    } finally { setLoadingSt(false); }
  };

  const filtered = names.filter(n => n.toLowerCase().includes(search.toLowerCase()));

  /* ── PROJECT DETAIL VIEW ──────────────────────────────────── */
  if (selected) {
    const catData = stats
      ? Object.entries(stats.byCategory || {}).map(([cat, val]) => ({
          name:  (CAT_ICONS[cat]||'📦') + ' ' + cat.charAt(0).toUpperCase() + cat.slice(1),
          value: val,
          color: CAT_COLORS[cat] || '#8b5cf6',
        }))
      : [];

    return (
      <div className="p-4 md:p-6 page-enter max-w-5xl mx-auto space-y-5">
        {/* Back button */}
        <button onClick={() => { setSelected(null); setStats(null); }}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={15} /> Back to Projects
        </button>

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
            <FolderOpen size={22} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{selected}</h1>
            {stats && (
              <p className="text-sm text-gray-400">
                {stats.count} bills · {fmt(stats.total)} total · {fmt(stats.pendingReimb)} pending reimb.
              </p>
            )}
          </div>
        </div>

        {loadingSt && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {stats && !loadingSt && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label:'Total Spent',   value: fmt(stats.total),        color:'text-indigo-600' },
                { label:'Bills',         value: stats.count,             color:'text-blue-600'   },
                { label:'Pending Reimb', value: fmt(stats.pendingReimb), color:'text-amber-600'  },
                { label:'Categories',    value: Object.keys(stats.byCategory||{}).length, color:'text-green-600' },
              ].map(c => (
                <div key={c.label} className="card p-4">
                  <div className={`text-xs font-semibold uppercase ${c.color} mb-1`}>{c.label}</div>
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                </div>
              ))}
            </div>

            {/* Charts */}
            {catData.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-800 text-sm">Spend by Category</h3>
                    <button onClick={() => dlSVG('proj-cat', selected + '_categories.svg')}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded px-2 py-0.5">
                      <Download size={10} /> SVG
                    </button>
                  </div>
                  <div id="proj-cat">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={catData} dataKey="value" cx="50%" cy="50%"
                          outerRadius={75} innerRadius={34} paddingAngle={3}>
                          {catData.map((e,i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={v => [fmt(v), '']} />
                        <Legend iconSize={10} formatter={v => <span style={{ fontSize:11 }}>{v}</span>} />
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
                      <BarChart data={catData} layout="vertical">
                        <XAxis type="number" tick={{ fontSize:10 }}
                          tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize:11 }} width={100}
                          tickLine={false} axisLine={false} />
                        <Tooltip formatter={v => [fmt(v), '']} />
                        <Bar dataKey="value" radius={[0,4,4,0]}>
                          {catData.map((e,i) => <Cell key={i} fill={e.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Category progress bars */}
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
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bills list */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 text-sm">
                  All Bills <span className="text-gray-400 font-normal">({stats.expenses?.length || 0})</span>
                </h3>
                <button onClick={exportExcel}
                  className="flex items-center gap-1 text-xs text-green-700 hover:text-green-800 border border-green-200 rounded px-2 py-1">
                  <Download size={11} /> Export Excel
                </button>
              </div>
              {(stats.expenses || []).length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No bills in this project yet.</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {(stats.expenses || []).map(e => (
                    <div key={e.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                        style={{ background: (CAT_COLORS[e.category]||'#8b5cf6') + '18' }}>
                        {CAT_ICONS[e.category] || '📦'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{e.vendor}</div>
                        <div className="text-xs text-gray-400">{e.date} · {e.category}
                          {e.reimburse_to_name && <span className="ml-1 text-amber-600">→ {e.reimburse_to_name}</span>}
                        </div>
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
                      <span className={`badge-${e.status} shrink-0`}>{e.status}</span>
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

  /* ── PROJECT LIST / FOLDER VIEW ───────────────────────────── */
  return (
    <div className="p-4 md:p-6 page-enter max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Projects</h1>
        <span className="text-sm text-gray-400">{names.length} project{names.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          placeholder="Search projects…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input pl-9 py-2.5 text-sm w-full"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">
          <FolderOpen size={40} className="mx-auto mb-3 opacity-20" />
          {search ? 'No projects match your search.' : 'No projects yet. Create one when uploading a bill.'}
        </div>
      )}

      {/* Folder grid */}
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
