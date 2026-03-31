import { useMemo } from 'react';
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts';

const CAT_COLORS = {
  consumables: '#6366f1',
  travel:      '#f59e0b',
  advance:     '#10b981',
  overhead:    '#3b82f6',
  other:       '#8b5cf6',
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = n => '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function SpendViz({ expenses = [], projectMode = false, onProjectClick }) {

  /* ── Monthly aggregation ─────────────────────────────────────── */
  const monthlyData = useMemo(() => {
    const map = {};
    expenses.forEach(e => {
      if (!e.date) return;
      const parts = e.date.split('-');
      const y = parts[0], m = parts[1];
      if (!y || !m) return;
      const key = `${y}-${m}`;
      if (!map[key]) map[key] = { key, label: MONTH_NAMES[parseInt(m, 10) - 1] + ' \'' + y.slice(2), total: 0, count: 0 };
      map[key].total += Number(e.total) || 0;
      map[key].count += 1;
    });
    return Object.values(map).sort((a, b) => a.key > b.key ? 1 : -1).slice(-12);
  }, [expenses]);

  /* ── Category aggregation ────────────────────────────────────── */
  const catData = useMemo(() => {
    const map = {};
    expenses.forEach(e => {
      const cat = e.category || 'other';
      map[cat] = (map[cat] || 0) + (Number(e.total) || 0);
    });
    return Object.entries(map)
      .map(([cat, val]) => ({
        name:  cat.charAt(0).toUpperCase() + cat.slice(1),
        value: val,
        color: CAT_COLORS[cat] || '#8b5cf6',
      }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  /* ── Project aggregation (main-view only) ────────────────────── */
  const projectData = useMemo(() => {
    if (projectMode) return [];
    const map = {};
    expenses.forEach(e => {
      const p = e.project_name || 'No Project';
      map[p] = (map[p] || 0) + (Number(e.total) || 0);
    });
    return Object.entries(map)
      .map(([name, total]) => ({
        name:     name.length > 18 ? name.slice(0, 16) + '\u2026' : name,
        fullName: name,
        total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [expenses, projectMode]);

  if (expenses.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
        No expense data yet
      </div>
    );
  }

  /* ── Shared gradient defs ────────────────────────────────────── */
  const GradDef = ({ id }) => (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}   />
      </linearGradient>
    </defs>
  );

  /* ── PROJECT DRILL-DOWN VIEW ─────────────────────────────────── */
  if (projectMode) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Monthly trend */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Spend Over Time</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <GradDef id="pg1" />
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}k`} width={44} tickLine={false} axisLine={false} />
              <Tooltip formatter={v => [fmt(v), 'Spent']} />
              <Area
                type="monotone" dataKey="total"
                stroke="#6366f1" strokeWidth={2}
                fill="url(#pg1)"
                dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Category horizontal bar */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Category Breakdown</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={catData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={88} tickLine={false} axisLine={false} />
              <Tooltip formatter={v => [fmt(v), '']} cursor={{ fill: '#f5f3ff' }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  /* ── MAIN DASHBOARD VIEW ─────────────────────────────────────── */
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Monthly spend trend */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Monthly Spend Trend</p>
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <GradDef id="mg1" />
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}k`} width={44} tickLine={false} axisLine={false} />
            <Tooltip formatter={v => [fmt(v), 'Spent']} labelFormatter={l => `Month: ${l}`} />
            <Area
              type="monotone" dataKey="total"
              stroke="#6366f1" strokeWidth={2}
              fill="url(#mg1)"
              dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Top projects horizontal bar */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Top Projects by Spend</p>
        {projectData.length === 0 ? (
          <div className="flex items-center justify-center h-[210px] text-gray-400 text-sm">No project data</div>
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <BarChart
              data={projectData} layout="vertical"
              margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            >
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} tickLine={false} axisLine={false} />
              <Tooltip formatter={v => [fmt(v), 'Total']} cursor={{ fill: '#f5f3ff' }} />
              <Bar
                dataKey="total" fill="#6366f1" radius={[0, 6, 6, 0]}
                onClick={d => onProjectClick && onProjectClick(d.fullName)}
                className="cursor-pointer"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
        {onProjectClick && (
          <p className="text-xs text-gray-400 text-center mt-1">Click a bar to drill into a project</p>
        )}
      </div>
    </div>
  );
}
