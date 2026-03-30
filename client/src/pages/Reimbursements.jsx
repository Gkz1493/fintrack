import { useEffect, useState } from 'react';
import { Users, CheckCircle2 } from 'lucide-react';
import { getExpenses, getEmployees, reimburseAll } from '../api';
import { useAuth } from '../context/AuthContext';

const CATS = { consumables:'🛒', travel:'🚗', advance:'💰', overhead:'🏢', other:'📦' };
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 });

export default function Reimbursements() {
  const { isAdmin } = useAuth();
  const [expenses,  setExp]  = useState([]);
  const [employees, setEmps] = useState([]);
  const [loading,   setLoad] = useState(true);

  const load = async () => {
    setLoad(true);
    const [e, emp] = await Promise.all([getExpenses(), getEmployees()]);
    setExp(e.data); setEmps(emp.data);
    setLoad(false);
  };
  useEffect(() => { load(); }, []);

  const markPaid = async (name) => {
    await reimburseAll(name);
    setExp(prev => prev.map(e => e.reimburse_to_name === name && e.status === 'pending' ? { ...e, status:'paid' } : e));
  };

  const byEmployee = employees.map(emp => ({
    ...emp,
    pending: expenses.filter(e => e.reimburse_to_name===emp.name && e.status==='pending').reduce((s,e)=>s+e.total,0),
    paid:    expenses.filter(e => e.reimburse_to_name===emp.name && e.status==='paid').reduce((s,e)=>s+e.total,0),
    bills:   expenses.filter(e => e.reimburse_to_name===emp.name),
  })).filter(e => e.bills.length > 0);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 md:p-6 page-enter max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Reimbursements</h1>
      <div className="grid grid-cols-3 gap-3">
        {[{label:'Total Pending',value:fmt(byEmployee.reduce((s,e)=>s+e.pending,0)),color:'text-amber-600'},{label:'Total Paid',value:fmt(byEmployee.reduce((s,e)=>s+e.paid,0)),color:'text-green-600'},{label:'People to Pay',value:byEmployee.filter(e=>e.pending>0).length,color:'text-indigo-600'}].map(s=>(
          <div key={s.label} className="card p-4 text-center"><div className="text-xs text-gray-400 mb-1">{s.label}</div><div className={`text-xl font-bold ${s.color}`}>{s.value}</div></div>
        ))}
      </div>
      {byEmployee.map(emp => (
        <div key={emp.id} className="card overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center font-bold text-indigo-700 text-sm shrink-0">{emp.name.split(' ').map(n=>n[0]).join('')}</div>
            <div className="flex-1 min-w-0"><div className="font-semibold text-gray-900">{emp.name}</div><div className="text-xs text-gray-400">{emp.department||'No department'} · {emp.bills.length} expense{emp.bills.length!==1?'s':''}</div></div>
            {emp.paid>0&&<div className="text-right mr-3"><div className="text-green-600 font-semibold text-sm">{fmt(emp.paid)}</div><div className="text-xs text-gray-400">paid</div></div>}
            {emp.pending>0?(<><div className="text-right"><div className="text-amber-600 font-bold text-sm">{fmt(emp.pending)}</div><div className="text-xs text-gray-400">pending</div></div>{isAdmin&&<button onClick={()=>markPaid(emp.name)} className="ml-2 bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 transition font-semibold shrink-0">Mark Paid</button>}</>):(<span className="ml-2 flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium"><CheckCircle2 size={12}/> All Paid</span>)}
          </div>
          <div className="divide-y divide-gray-50">{emp.bills.map(b=>(<div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"><span className="text-lg shrink-0">{CATS[b.category]||'📦'}</span><div className="flex-1 min-w-0"><div className="text-sm font-medium text-gray-800 truncate">{b.vendor}</div><div className="text-xs text-gray-400 truncate">{b.project_name} · {b.date} · {b.category}</div></div><div className="font-semibold text-gray-900 text-sm shrink-0 mr-2">{fmt(b.total)}</div><span className={`badge-${b.status} shrink-0`}>{b.status}</span></div>))}</div>
        </div>
      ))}
      {byEmployee.length===0&&<div className="text-center py-20 text-gray-400"><Users size={44} className="mx-auto mb-3 opacity-20"/><p className="text-sm">No reimbursements logged yet.</p></div>}
    </div>
  );
}
