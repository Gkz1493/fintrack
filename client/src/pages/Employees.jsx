import { useEffect, useState } from 'react';
import { UserPlus, Pencil, Trash2, X, Check, Users } from 'lucide-react';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from '../api';

const BLANK = { name:'', email:'', phone:'', department:'', password:'' };

export default function Employees() {
  const [employees, setEmps] = useState([]);
  const [loading,   setLoad] = useState(true);
  const [showForm,  setForm] = useState(false);
  const [editing,   setEdit] = useState(null);
  const [data, setData]      = useState(BLANK);
  const [error, setError]    = useState('');
  const [saving, setSaving]  = useState(false);

  const load = async () => {
    setLoad(true);
    const res = await getEmployees();
    setEmps(res.data); setLoad(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEdit(null); setData(BLANK); setError(''); setForm(true); };
  const openEdit = (emp) => {
    setEdit(emp.id); setError('');
    setData({ name: emp.name, email: emp.email, phone: emp.phone||'', department: emp.department||'', password:'' });
    setForm(true);
  };

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (editing) {
        await updateEmployee(editing, data);
        setEmps(prev => prev.map(em => em.id===editing ? { ...em, ...data } : em));
      } else {
        const res = await createEmployee(data);
        setEmps(prev => [res.data, ...prev]);
      }
      setForm(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const del = async (id, name) => {
    if (!confirm(`Delete employee "${name}"? This will also remove their login account.`)) return;
    await deleteEmployee(id);
    setEmps(prev => prev.filter(e => e.id !== id));
  };

  return (
    <div className="p-4 md:p-6 page-enter max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Employees</h1>
        <button onClick={openNew} className="btn-primary flex items-center gap-2 text-sm">
          <UserPlus size={15} /> Add Employee
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">{editing ? 'Edit Employee' : 'Add New Employee'}</h2>
              <button onClick={() => setForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <form onSubmit={save} className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Full Name *</label>
                <input className="input" required value={data.name} onChange={e => setData(p=>({...p,name:e.target.value}))} placeholder="Rahul Kumar" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email Address *</label>
                <input className="input" required type="email" value={data.email} onChange={e => setData(p=>({...p,email:e.target.value}))} placeholder="rahul@company.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                  <input className="input" value={data.phone} onChange={e => setData(p=>({...p,phone:e.target.value}))} placeholder="+91 98765 43210" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
                  <input className="input" value={data.department} onChange={e => setData(p=>({...p,department:e.target.value}))} placeholder="Marketing" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {editing ? 'New Password (leave blank to keep)' : 'Login Password *'}
                </label>
                <input className="input" type="password" value={data.password} onChange={e => setData(p=>({...p,password:e.target.value}))}
                  placeholder="Min 6 characters" required={!editing} minLength={editing ? 0 : 6} />
                <p className="text-xs text-gray-400 mt-1">This creates a login account for the employee to submit expenses.</p>
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setForm(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={15} />}
                  {editing ? 'Update' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Users size={44} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm mb-3">No employees yet.</p>
          <button onClick={openNew} className="btn-primary text-sm">Add First Employee</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {employees.map(emp => (
            <div key={emp.id} className="card p-4 flex items-center gap-3">
              <div className="w-11 h-11 bg-indigo-100 rounded-full flex items-center justify-center font-bold text-indigo-700 text-sm shrink-0">
                {emp.name.split(' ').map(n=>n[0]).join('')}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900">{emp.name}</div>
                <div className="text-xs text-gray-500">{emp.email}</div>
                <div className="flex gap-2 mt-0.5">
                  {emp.department && <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{emp.department}</span>}
                  {emp.phone && <span className="text-xs text-gray-400">{emp.phone}</span>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(emp)} className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition">
                  <Pencil size={14} />
                </button>
                <button onClick={() => del(emp.id, emp.name)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
