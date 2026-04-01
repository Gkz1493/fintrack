import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import {
  IndianRupee, TrendingUp, Clock, FolderOpen, ChevronRight,
  ArrowLeft, RefreshCw, Download, BarChart2, X,
} from 'lucide-react';
import { getExpenses, getStats, getProjectNames, getProjectStatsByName } from '../api';
import { useAuth } from '../context/AuthContext';
import ThreeViz from '../components/ThreeViz';

const CAT_COLORS = {
  consumables: '#6366f1', travel: '#f59e0b', advance: '#10b981',
  overhead: '#3b82f6', other: '#8b5cf6',
};
const CAT_ICONS  = { consumables:'ð', travel:'ð', advance:'ð°', overhead:'ð¢', other:'ð¦' };
const PROJ_COLORS = ['#6366f1','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const fmt = n => 'â¹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/* ââ Download chart SVG ââââââââââââââââââââââââââââââââââââââââââââ */
function downloadSVG(containerId, filename) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const svg = el.querySelector('svg');
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [stats,           setStats]    = useState(null);
  const [expenses,        setExp]      = useState([]);
  const [projectNames,    setProj]     = useState([]);
  const [loading,         setLoading]  = useState(true);

  /* Drill-down state */
  const [selectedProject, setSelectedProject] = useState(null);
  const [projStats,        setProjStats]       = useState(null);

  /* Project filter for KPI cards */
  const [selectedProjectFilter, setSelectedProjectFilter] = useState(null);
  const [filterStats,           setFilterStats]           = useState(null);

  /* Multi-project compare state */
  const [compareMode,      setCompareMode]    = useState(false);
  const [selectedForComp,  setSelectedForComp] = useState([]);
  const [compData,         setCompData]        = useState([]);
  const [loadingComp,      setLoadingComp]     = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, e, p] = await Promise.all([getStats(), getExpenses(), getProjectNames()]);
      setStats(s.data);
      setExp(e.data);
      setProj(p.data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  /* Drill into any project by name (works for both DB and freeform) */
  const drillDown = async (projectName) => {
    try {
      const res = await getProjectStatsByName(projectName);
      setSelectedProject(projectName);
      setProjStats(res.data);
    } catch (e) { console.error('Drill-down failed', e); }
  };

  /* Build multi-project comparison data */
  const runCompare = async () => {
    if (selectedForComp.length < 1) return;
    setLoadingComp(true);
    try {
      const results = await Promise.all(selectedForComp.map(n => getProjectStatsByName(n)));
      setCompData(results.map((r, i) => ({
        name: r.data.name,
        total: r.data.total,
        count: r.data.count,
        pending: r.data.pendingReimb,
        color: PROJ_COLORS[i % PROJ_COLORS.length],
        byCategory: r.data.byCategory,
      })));
    } finally { setLoadingComp(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  /* ââ PROJECT DRILL-DOWN VIEW âââââââââââââââââââââââââââââââââââââ */
  if (selectedProject && projStats) {
    const catData = Object.entries(projStats.byCategory || {}).map(([cat, val]) => ({
      name: (CAT_ICONS[cat] || 'ð¦') + ' ' + cat.charAt(0).toUpperCase() + cat.slice(1),
      value: val, color: CAT_COLORS[cat] || '#8b5cf6',
    }));
    return (
      <div className="p-4 md:p-6 page-enter max-w-6xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedProject(null); setProjStats(null); }}
            className="p-2 rounded-lg hover:bg-gray-100 transition">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{selectedProject}</h1>
            <p className="text-sm text-gray-400">{projStats.count} expenses Â· {fmt(projStats.total)} total</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label:'Total Spent',    value: fmt(projStats.total),        color:'text-indigo-600', bg:'bg-indigo-50' },
            { label:'Bill Count',     value: projStats.count,             color:'text-blue-600',   bg:'bg-blue-50'   },
            { label:'Pending Reimb',  value: fmt(projStats.pendingReimb), color:'text-amber-600',  bg:'bg-amber-50'  },
            { label:'Categories',     value: Object.keys(projStats.byCategory||{}).length, color:'text-green-600', bg:'bg-green-50' },
          ].map(c => (
            <div key={c.label} className="card p-4">
              <div className={`text-xs font-semibold uppercase ${c.color} mb-1`}>{c.label}</div>
              <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Expense Analytics (ThreeViz = SpendViz) */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800 mb-3 text-sm">Expense Analytics â {selectedProject}</h3>
            <button onClick={() => downloadSVG('proj-viz', `${selectedProject}_analytics.svg`)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded-lg px-2 py-1 transition">
              <Download size={12} /> Download
            </button>
          </div>
          <div id="proj-viz">
            <ThreeViz expenses={projStats.expenses || []} projectMode={true} />
          </div>
        </div>

        {/* Category pie + breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800 text-sm">Spending by Category</h3>
              <button onClick={() => downloadSVG('proj-cat-pie', `${selectedProject}_categories.svg`)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded-lg px-2 py-1">
                <Download size={12} /> Download
              </button>
            </div>
            <div id="proj-cat-pie">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={catData} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={40} paddingAngle={3}>
                    {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={v => [fmt(v), '']} />
                  <Legend formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-3">Category Breakdown</h3>
            <div className="space-y-3">
              {catData.map(c => {
                const pct = projStats.total > 0 ? Math.round((c.value / projStats.total) * 100) : 0;
                return (
                  <div key={c.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700">{c.name}</span>
                      <span className="font-semibold">{fmt(c.value)} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: c.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Expense table */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800 text-sm">All Expenses</div>
          <div className="divide-y divide-gray-50">
            {(projStats.expenses || []).map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <span className="text-xl">{CAT_ICONS[e.category] || 'ð¦'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{e.vendor}</div>
                  <div className="text-xs text-gray-400">{e.date} Â· {e.category}</div>
                </div>
                <div className="font-semibold text-sm">{fmt(e.total)}</div>
                <span className={`badge-${e.status}`}>{e.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ââ MAIN DASHBOARD VIEW âââââââââââââââââââââââââââââââââââââââââââ */
  const byProject = projectNames.map(name => ({
    name:     name.length > 20 ? name.slice(0,18)+'â¦' : name,
    fullName: name,
    total:    expenses.filter(e => e.project_name === name).reduce((s,e) => s+e.total, 0),
  })).filter(d => d.total > 0);

  const byCat = Object.entries(stats?.byCategory || {}).map(([cat, val]) => ({
    name:  (CAT_ICONS[cat] || 'ð¦') + ' ' + cat.charAt(0).toUpperCase() + cat.slice(1),
    value: val,
    color: CAT_COLORS[cat] || '#8b5cf6',
  }));

  const pendingEmps = Object.entries(stats?.byEmployee || {})
    .filter(([,d]) => d.pending > 0)
    .sort((a,b) => b[1].pending - a[1].pending);

  /* Radar data for multi-project compare */
  const radarData = compData.length > 0
    ? ['consumables','travel','advance','overhead','other'].map(cat => {
        const row = { cat: cat.charAt(0).toUpperCase()+cat.slice(1) };
        compData.forEach(p => { row[p.name] = p.byCategory[cat] || 0; });
        return row;
      })
    : [];

  return (
    <div className="p-4 md:p-6 page-enter max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400">Welcome back, {user?.name} ð</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setCompareMode(v=>!v); setCompData([]); setSelectedForComp([]); }}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition ${compareMode ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 hover:bg-gray-50 text-gray-600'}`}>
            <BarChart2 size={14} /> Compare Projects
          </button>
          <button onClick={load} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
            <RefreshCw size={16} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* Project filter pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-400 font-medium mr-1">Filter by project:</span>
        <button
          onClick={() => setSelectedProjectFilter(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
            !selectedProjectFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300'
          }`}>
          All Projects
        </button>
        {projectNames.map(name => (
          <button key={name}
            onClick={() => setSelectedProjectFilter(prev => prev === name ? null : name)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              name === selectedProjectFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300'
            }`}>
            {name}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      {(() => {
        const s       = (selectedProjectFilter && filterStats) ? filterStats : (stats || {});
        const cashIn  = Number(s.cashflowIn  || 0);
        const cashOut = Number(selectedProjectFilter ? (s.total || 0) : (s.cashflowOut || s.total || 0));
        const balance = selectedProjectFilter ? Number(s.availableBalance ?? (cashIn - cashOut)) : Number(s.availableBalance ?? (cashIn - cashOut));
        const pendReim  = Number(s.pendingReimb || 0);
        const pendAppr  = Number(s.pendingApproval || s.pending || 0);
        const projCount = selectedProjectFilter ? 1 : (s.projectCount || projectNames.length);
        const billCount = selectedProjectFilter ? (filterStats?.count || 0) : expenses.length;
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label:'Cashflow In',       value: fmt(cashIn),    sub: 'fund releases',    color:'text-emerald-600', bg:'bg-emerald-50' },
              { label:'Cashflow Out',      value: fmt(cashOut),   sub: `${billCount} bills`, color:'text-rose-600',    bg:'bg-rose-50'   },
              { label:'Available Balance', value: fmt(balance),   sub: balance >= 0 ? 'surplus' : 'deficit',
                color: balance >= 0 ? 'text-indigo-600' : 'text-red-600' },
              { label:'Pending Reimb.',    value: fmt(pendReim),  sub: 'awaiting payment', color:'text-amber-600',   bg:'bg-amber-50'  },
              { label:'Projects',          value: projCount,      sub: selectedProjectFilter || 'tracked', color:'text-blue-600', bg:'bg-blue-50' },
              { label:'Pending Approval',  value: pendAppr,       sub: 'bills',            color:'text-orange-600',  bg:'bg-orange-50' },
            ].map(c => (
              <div key={c.label} className="card p-4">
                <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${c.color}`}>{c.label}</div>
                <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ââ COMPARE MODE PANEL âââââââââââââââââââââââââââââââââââ */}
      {compareMode && (
        <div className="card p-4 border-2 border-indigo-200 bg-indigo-50/40">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800 text-sm">Compare Projects</h3>
            <button onClick={() => { setCompareMode(false); setCompData([]); setSelectedForComp([]); }}
              className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <p className="text-xs text-gray-500 mb-3">Select 2â4 projects, then click Compare.</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {projectNames.map(name => {
              const sel = selectedForComp.includes(name);
              return (
                <button key={name}
                  onClick={() => setSelectedForComp(prev =>
                    sel ? prev.filter(n=>n!==name) : prev.length < 4 ? [...prev, name] : prev
                  )}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition ${sel ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300'}`}>
                  {name}
                </button>
              );
            })}
          </div>
          <button onClick={runCompare} disabled={selectedForComp.length < 1 || loadingComp}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-40">
            {loadingComp ? 'Loadingâ¦' : 'Compare Selected'}
          </button>

          {/* Comparison charts */}
          {compData.length > 0 && (
            <div className="mt-5 space-y-4">
              {/* Total spend bar chart */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Total Spend Comparison</p>
                  <button onClick={() => downloadSVG('comp-bar', 'project_comparison.svg')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded px-2 py-0.5">
                    <Download size={10} /> SVG
                  </button>
                </div>
                <div id="comp-bar">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={compData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `â¹${(v/1000).toFixed(0)}k`} width={44} tickLine={false} axisLine={false} />
                      <Tooltip formatter={v => [fmt(v), 'Total']} />
                      <Bar dataKey="total" radius={[4,4,0,0]}>
                        {compData.map((d,i) => <Cell key={i} fill={d.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Category radar */}
              {radarData.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Category Radar</p>
                    <button onClick={() => downloadSVG('comp-radar', 'project_radar.svg')}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded px-2 py-0.5">
                      <Download size={10} /> SVG
                    </button>
                  </div>
                  <div id="comp-radar">
                    <ResponsiveContainer width="100%" height={220}>
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="cat" tick={{ fontSize: 11 }} />
                        {compData.map((d,i) => (
                          <Radar key={d.name} name={d.name} dataKey={d.name} stroke={d.color} fill={d.color} fillOpacity={0.15} />
                        ))}
                        <Tooltip formatter={v => [fmt(v), '']} />
                        <Legend />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Summary table */}
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>{['Project','Total Spent','Bills','Pending Reimb'].map(h=>(
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {compData.map(d => (
                      <tr key={d.name} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-800 flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ background: d.color }} />
                          {d.name}
                        </td>
                        <td className="px-4 py-2 font-semibold">{fmt(d.total)}</td>
                        <td className="px-4 py-2 text-gray-600">{d.count}</td>
                        <td className="px-4 py-2 text-amber-600">{fmt(d.pending)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expense Analytics */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 text-sm">Expense Analytics</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">ð Monthly trend &amp; project breakdown</span>
            <button onClick={() => downloadSVG('main-viz', 'expense_analytics.svg')}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded-lg px-2 py-1">
              <Download size={12} /> Download
            </button>
          </div>
        </div>
        <div id="main-viz">
          <ThreeViz expenses={expenses} projectMode={false} onProjectClick={drillDown} />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800 text-sm">Expenses by Project</h3>
            <button onClick={() => downloadSVG('proj-bar', 'project_spend.svg')}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded-lg px-2 py-1">
              <Download size={12} /> Download
            </button>
          </div>
          <div id="proj-bar">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byProject} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `â¹${(v/1000).toFixed(0)}k`} width={42} />
                <Tooltip formatter={v => [fmt(v), 'Total']} cursor={{ fill: '#f3f4ff' }} />
                <Bar dataKey="total" fill="#6366f1" radius={[4,4,0,0]}
                  onClick={d => drillDown(d.fullName)} className="cursor-pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-400 text-center mt-2">Click a bar to drill into a project</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800 text-sm">Expenses by Category</h3>
            <button onClick={() => downloadSVG('cat-pie', 'category_spend.svg')}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded-lg px-2 py-1">
              <Download size={12} /> Download
            </button>
          </div>
          <div id="cat-pie">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byCat} dataKey="value" cx="50%" cy="50%" outerRadius={78} innerRadius={36} paddingAngle={3}>
                  {byCat.map((e,i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={v => [fmt(v), '']} />
                <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Pending reimbursements widget */}
      {pendingEmps.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800 text-sm">â ï¸ Pending Reimbursements</h3>
            <button onClick={() => navigate('/reimbursements')} className="text-xs text-indigo-600 hover:underline">Manage â</button>
          </div>
          <div className="flex flex-wrap gap-3">
            {pendingEmps.map(([name, d]) => (
              <div key={name} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-xs font-bold text-indigo-700">
                  {name.split(' ').map(n=>n[0]).join('').toUpperCase()}
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-800">{name.split(' ')[0]}</div>
                  <div className="text-xs font-bold text-amber-600">{fmt(d.pending)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Projects list */}
      <div className="card">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 text-sm">Projects</h3>
          <button onClick={() => navigate('/projects')} className="text-xs text-indigo-600 hover:underline">View all â</button>
        </div>
        <div className="divide-y divide-gray-50">
          {byProject.map(p => (
            <button key={p.name} onClick={() => drillDown(p.fullName)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left">
              <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                <FolderOpen size={15} className="text-indigo-600" />
              </div>
              <span className="flex-1 text-sm font-medium text-gray-800">{p.fullName}</span>
              <span className="text-sm font-semibold text-gray-900">{fmt(p.total)}</span>
              <ChevronRight size={14} className="text-gray-400" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
