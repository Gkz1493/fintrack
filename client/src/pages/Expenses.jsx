import { useEffect, useState } from 'react';
import { Search, FileSpreadsheet, FileText, Trash2, ExternalLink } from 'lucide-react';
import { getExpenses, getProjectNames, getReimburseNames, updateStatus, deleteExpense, exportExcel, exportPdf } from '../api';
import { useAuth } from '../context/AuthContext';

const CATS      = { consumables:'🛒', travel:'🚗', advance:'💰', overhead:'🏢', other:'📦' };
const CAT_COLORS = { consumables:'#6366f1', travel:'#f59e0b', advance:'#10b981', overhead:'#3b82f6', other:'#8b5cf6' };
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 });

export default function Expenses() {
  const { isAdmin } = useAuth();
  const [expenses,      setExp]  = useState([]);
  const [projectNames,  setProj] = useState([]);
  const [reimburseNames,setEmp]  = useState([]);
  const [loading,       setLoad] = useState(true);
  const [filters, setFlt] = useState({ project:'', category:'', status:'', employee:'', search:'' });

  /* Load filter options once */
  useEffect(() => {
    Promise.all([getProjectNames(), getReimburseNames()]).then(([p, e]) => {
      setProj(p.data || []);
      setEmp(e.data  || []);
    }).catch(() => {});
  }, []);

  /* Reload expenses whenever filters change */
  const load = async () => {
    setLoad(true);
    try {
      const params = {};
      if (filters.project)  params.project  = filters.project;
      if (filters.category) params.category = filters.category;
      if (filters.status)   params.status   = filters.status;
      if (filters.employee) params.employee = filters.employee;
      if (filters.search)   params.search   = filters.search;
      const e = await getExpenses(params);
      setExp(e.data);
    } finally { setLoad(false); }
  };
  useEffect(() => { load(); }, [filters]);

  const changeStatus = async (id, status) => {
    await updateStatus(id, status);
    setExp(prev => prev.map(e => e.id === id ? { ...e, status } : e));
  };

  const del = async (id) => {
    if (!confirm('Delete this expense?')) return;
    await deleteExpense(id);
    setExp(prev => prev.filter(e => e.id !== id));
  };

  const total     = expenses.reduce((s,e) => s + parseFloat(e.total||0), 0);
  const pendReimb = expenses.filter(e => e.is_reimbursement && e.status==='pending').reduce((s,e)=>s+parseFloat(e.total||0),0);

  return (
    <div className="p-4 md:p-6 page-enter max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">All Expenses</h1>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="flex items-center gap-1.5 btn-secondary text-sm py-1.5 px-3">
            <FileSpreadsheet size={14} className="text-green-600" /> Excel
          </button>
          <button onClick={exportPdf} className="flex items-center gap-1.5 btn-secondary text-sm py-1.5 px-3">
            <FileText size={14} className="text-red-500" /> PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1" style={{ minWidth: 160 }}>
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              placeholder="Search…"
              value={filters.search}
              onChange={e => setFlt(p => ({...p, search: e.target.value}))}
              className="input pl-8 py-2 text-sm"
            />
          </div>
          {/* Project filter — uses ALL project names including freeform */}
          <select value={filters.project} onChange={e => setFlt(p => ({...p, project: e.target.value}))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All Projects</option>
            {projectNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {/* Category filter */}
          <select value={filters.category} onChange={e => setFlt(p => ({...p, category: e.target.value}))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All Categories</option>
            {['consumables','travel','advance','overhead','other'].map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>
            ))}
          </select>
          {/* Status filter */}
          <select value={filters.status} onChange={e => setFlt(p => ({...p, status: e.target.value}))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All Statuses</option>
            {['pending','approved','paid','rejected'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>
            ))}
          </select>
          {/* Employee filter — uses ALL reimbursement names including manually typed */}
          <select value={filters.employee} onChange={e => setFlt(p => ({...p, employee: e.target.value}))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All Employees</option>
            {reimburseNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm px-1">
        <span><strong className="text-gray-900">{expenses.length}</strong> <span className="text-gray-500">expenses</span></span>
        <span><strong className="text-gray-900">{fmt(total)}</strong> <span className="text-gray-500">total</span></span>
        <span><strong className="text-amber-600">{fmt(pendReimb)}</strong> <span className="text-gray-500">pending reimbursement</span></span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Date','Vendor','Category','Project','Amount','Adv. Paid','Balance','Receipt',isAdmin&&'Actions'].filter(Boolean).map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {expenses.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{e.date}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-medium text-gray-900 truncate">{e.vendor}</div>
                      {e.description && <div className="text-xs text-gray-400 truncate">{e.description}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-1 text-xs font-medium" style={{ color: CAT_COLORS[e.category]||'#8b5cf6' }}>
                        {CATS[e.category]||'📦'} {e.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap max-w-xs truncate">{e.project_name}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                      {fmt(e.total)}
                      {e.gst > 0 && <div className="text-xs text-gray-400 font-normal">GST: {fmt(e.gst)}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {e.advance_paid > 0 ? fmt(e.advance_paid) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {e.advance_paid > 0 ? <span className="font-semibold text-red-600">{fmt((e.total||0)-(e.advance_paid||0))}</span> : '—'}
                    </td>
                    
                    
                    <td className="px-4 py-3 whitespace-nowrap">
                      {e.drive_url ? (
                        <a href={e.drive_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">
                          <ExternalLink size={12} /> Drive
                        </a>
                      ) : e.file_path ? (
                        <a href={e.file_path} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">View</a>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button onClick={() => del(e.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition rounded">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 0 && (
              <div className="text-center py-16 text-gray-400 text-sm">
                <Search size={36} className="mx-auto mb-3 opacity-20" />
                No expenses match your filters.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
