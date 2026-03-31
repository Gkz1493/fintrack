import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  IndianRupee, TrendingUp, Clock, Users,
  FolderOpen, ChevronRight, ArrowLeft, RefreshCw,
} from 'lucide-react';
import { getExpenses, getStats, getProjects, getProjectStats } from '../api';
import { useAuth } from '../context/AuthContext';
import ThreeViz from '../components/ThreeViz';

const CAT_COLORS = {
  consumables: '#6366f1', travel: '#f59e0b', advance: '#10b981',
  overhead: '#3b82f6', other: '#8b5cf6',
};
const CAT_ICONS = { consumables: '🛒', travel: '🚗', advance: '💰', overhead: '🏢', other: '📦' };
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats]   = useState(null);
  const [expenses, setExp]  = useState([]);
  const [projects, setProj] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projStats, setProjStats] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, e, p] = await Promise.all([getStats(), getExpenses(), getProjects()]);
      setStats(s.data); setExp(e.data); setProj(p.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const drillDown = async (projectName) => {
    const proj = projects.find(p => p.name === projectName);
    if (!proj) return;
    const res = await getProjectStats(proj.id);
    setSelectedProject(projectName);
    setProjStats(res.data);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (selectedProject && projStats) {
    const catData = Object.entries(projStats.byCategory).map(([cat, val]) => ({
      name: CAT_ICONS[cat] + ' ' + cat.charAt(0).toUpperCase() + cat.slice(1),
      value: val, color: CAT_COLORS[cat] || '#8b5cf6',
    }));

    return (
      <div className="p-4 md:p-6 page-enter max-w-6xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedProject(null); setProjStats(null); }}
            className="p-2 rounded-lg hover:bg-gray-100 transition"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{selectedProject}</h1>
            <p className="text-sm text-gray-400">{projStats.count} expenses · {fmt(projStats.total)} total</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Spent',  value: fmt(projStats.total),       color: 'text-indigo-600', bg: 'bg-indigo-50' },
            { label: 'Bill Count',   value: projStats.count,             color: 'text-blue-600',   bg: 'bg-blue-50'   },
            { label: 'Pending Reimb', value: fmt(projStats.pendingReimb), color: 'text-amber-600',  bg: 'bg-amber-50'  },
            { label: 'Categories',   value: Object.keys(projStats.byCategory).length, color: 'text-green-600', bg: 'bg-green-50' },
          ].map(c => (
            <div key={c.label} className="card p-4">
              <div className={`text-xs font-semibold uppercase ${c.color} mb-1`}>{c.label}</div>
              <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>

        <div className="card p-4">
          <h3 className="font-semibold text-gray-800 mb-3 text-sm">Expense Analytics — {selectedProject}</h3>
          <ThreeViz expenses={projStats.expenses || []} projectMode={true} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-4">Spending by Category</h3>
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

          <div className="card p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-3">Category Breakdown</h3>
            <div className="space-y-3">
              {catData.map(c => {
                const pct = Math.round((c.value / projStats.total) * 100);
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

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800 text-sm">All Expenses</div>
          <div className="divide-y divide-gray-50">
            {(projStats.expenses || []).map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <span className="text-xl">{CAT_ICONS[e.category] || '📦'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{e.vendor}</div>
                  <div className="text-xs text-gray-400">{e.date} · {e.category}</div>
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

  const byProject = projects.map(p => ({
    name: p.name.length > 20 ? p.name.slice(0,18)+'…' : p.name,
    fullName: p.name,
    total: expenses.filter(e => e.project_name === p.name).reduce((s, e) => s + e.total, 0),
  })).filter(d => d.total > 0);

  const byCat = Object.entries(stats?.byCategory || {}).map(([cat, val]) => ({
    name: (CAT_ICONS[cat] || '📦') + ' ' + cat.charAt(0).toUpperCase() + cat.slice(1),
    value: val, color: CAT_COLORS[cat] || '#8b5cf6',
  }));

  const pendingEmps = Object.entries(stats?.byEmployee || {})
    .filter(([, d]) => d.pending > 0)
    .sort((a, b) => b[1].pending - a[1].pending);

  return (
    <div className="p-4 md:p-6 page-enter max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400">Welcome back, {user?.name} 👋</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
          <RefreshCw size={16} className="text-gray-500" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Total Expenses',    value: fmt(stats?.total || 0),       sub: `${expenses.length} bills`, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Pending Reimb.',    value: fmt(stats?.pendingReimb || 0), sub: 'awaiting payment',         color: 'text-amber-600',  bg: 'bg-amber-50'  },
          { label: 'Pending Approval',  value: stats?.pending || 0,           sub: 'bills',                    color: 'text-rose-500',   bg: 'bg-rose-50'   },
          { label: 'Projects',          value: projects.length,               sub: 'active',                   color: 'text-green-600',  bg: 'bg-green-50'  },
        ].map(c => (
          <div key={c.label} className="card p-4">
            <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${c.color}`}>{c.label}</div>
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 text-sm">Expense Analytics</h3>
          <span className="text-xs text-gray-400">📊 Monthly trend &amp; project breakdown</span>
        </div>
        <ThreeViz expenses={expenses} projectMode={false} onProjectClick={drillDown} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-4">Expenses by Project</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byProject} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} width={42} />
              <Tooltip formatter={v => [fmt(v), 'Total']} cursor={{ fill: '#f3f4ff' }} />
              <Bar dataKey="total" fill="#6366f1" radius={[4,4,0,0]}
                   onClick={d => drillDown(d.fullName)}
                   className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 text-center mt-2">Click a bar to drill into a project</p>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-4">Expenses by Category</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byCat} dataKey="value" cx="50%" cy="50%" outerRadius={78} innerRadius={36} paddingAngle={3}>
                {byCat.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip formatter={v => [fmt(v), '']} />
              <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {pendingEmps.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800 text-sm">⚠️ Pending Reimbursements</h3>
            <button onClick={() => navigate('/reimbursements')} className="text-xs text-indigo-600 hover:underline">Manage →</button>
          </div>
          <div className="flex flex-wrap gap-3">
            {pendingEmps.map(([name, d]) => (
              <div key={name} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-xs font-bold text-indigo-700">
                  {name.split(' ').map(n => n[0]).join('')}
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

      <div className="card">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 text-sm">Projects</h3>
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
