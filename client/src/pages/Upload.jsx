import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera, Upload as UploadIcon, Scan, FolderOpen, Plus, Check,
  ChevronRight, CheckCircle2, ArrowLeft, ExternalLink,
} from 'lucide-react';
import { createExpense, getProjectNames, getReimburseNames, getEmployees, ocrScan, createProject } from '../api';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = [
  { id: 'consumables',  label: 'Consumables',        icon: '🛒', color: '#6366f1' },
  { id: 'travel',       label: 'Travel',              icon: '🚗', color: '#f59e0b' },
  { id: 'advance',      label: 'Advance Payment',     icon: '💰', color: '#10b981' },
  { id: 'overhead',     label: 'Overhead Expenses',   icon: '🏢', color: '#3b82f6' },
  { id: 'other',        label: 'Other Expenses',      icon: '📦', color: '#8b5cf6' },
];

const BLANK = {
  vendor:'', invoice_no:'', amount:'', gst:'', total:'', description:'',
  date: new Date().toISOString().slice(0,10),
  category:'', suggestedCategory:'', source:'', project:'',
  advance_paid: '', isReimbursement: false, reimburseTo:''
};

export default function Upload() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [image, setImage] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanPct, setScanPct] = useState(0);
  const [form, setForm] = useState(BLANK);
  const [projects, setProjects] = useState([]);   // string[]
  const [employees, setEmployees] = useState([]);
  const [newProjMode, setNewProjMode] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [savedExpense, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const camRef = useRef();
  const fileRef = useRef();

  // Load project names (string array) + employees on mount
  useEffect(() => {
    Promise.all([getProjectNames(), getEmployees()]).then(([p, e]) => {
      setProjects(p.data || []);
      setEmployees(e.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!scanning) return;
    setScanPct(0);
    const iv = setInterval(() => setScanPct(p => p < 88 ? p + 1.2 : p), 80);
    return () => clearInterval(iv);
  }, [scanning]);

  useEffect(() => {
    if (!scanning || !imageFile) return;
    let cancelled = false;
    ocrScan(imageFile)
      .then(res => {
        if (cancelled) return;
        const data = res.data || {};
        setForm(prev => ({
          ...prev,
          vendor: data.vendor || '',
          invoice_no: data.invoice_no || '',
          date: data.date || new Date().toISOString().slice(0,10),
          amount: data.amount || '',
          gst: data.gst || '0.00',
          total: data.total || '',
          description: data.description || '',
          suggestedCategory: data.suggestedCategory || 'other',
          category: data.suggestedCategory || '',
          source: data.source || 'manual',
        }));
      })
      .catch(err => { if (cancelled) return; console.warn('[OCR]', err.message); })
      .finally(() => {
        if (cancelled) return;
        setScanPct(100);
        setTimeout(() => { setScanning(false); setStep(2); }, 350);
      });
    return () => { cancelled = true; };
  }, [scanning, imageFile]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => { setImage(ev.target.result); setStep(1); setScanning(true); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const projName = newProjMode && newProjName.trim() ? newProjName.trim() : form.project;
      if (projName) { try { await createProject({ name: projName }); } catch(_) {} }
      const fd = new FormData();
      fd.append('vendor',           form.vendor);
      fd.append('invoice_no',       form.invoice_no);
      fd.append('amount',           form.amount);
      fd.append('gst',              form.gst);
      fd.append('total',            form.total);
      fd.append('description',      form.description);
      fd.append('date',             form.date);
      fd.append('category',         form.category);
      fd.append('project_name',     projName);
      fd.append('is_reimbursement', form.isReimbursement);
      fd.append('reimburse_to_name', form.isReimbursement ? form.reimburseTo : '');
      if (imageFile) fd.append('file', imageFile);
      const res = await createExpense(fd);
      setSaved(res.data); setStep(5);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save. Please try again.');
    } finally { setSaving(false); }
  };

  const reset = () => {
    setStep(0); setImage(null); setImageFile(null); setScanning(false);
    setScanPct(0); setForm(BLANK); setNewProjMode(false);
    setNewProjName(''); setSaved(null); setError('');
  };

  const setF = (field, val) => setForm(p => {
    const u = { ...p, [field]: val };
    if (field === 'amount' || field === 'gst') {
      const a = parseFloat(field === 'amount' ? val : p.amount) || 0;
      const g = parseFloat(field === 'gst'    ? val : p.gst)    || 0;
      u.total = (a + g).toFixed(2);
    }
    return u;
  });

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto page-enter">
      {step > 0 && step < 5 && (
        <button onClick={() => setStep(s => Math.max(0, s-1))}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition">
          <ArrowLeft size={15} /> Back
        </button>
      )}
      {step < 5 && (
        <div className="flex gap-1.5 mb-6">
          {[0,1,2,3,4].map(s => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${s < step ? 'bg-indigo-600' : s === step ? 'bg-indigo-400' : 'bg-gray-200'}`} />
          ))}
        </div>
      )}

      {/* Step 0 — capture */}
      {step === 0 && (
        <div>
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Scan size={30} className="text-indigo-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Add an Expense</h2>
            <p className="text-gray-400 text-sm mt-1">Capture any bill, receipt, or payment screenshot</p>
          </div>
          <input ref={camRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFile} />
          <div className="space-y-3">
            <button onClick={() => camRef.current?.click()}
              className="w-full bg-indigo-600 text-white rounded-xl p-4 flex items-center gap-4 hover:bg-indigo-700 transition active:scale-95">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><Camera size={24} /></div>
              <div className="text-left flex-1">
                <div className="font-semibold">Take a Photo</div>
                <div className="text-indigo-200 text-sm">Camera capture on mobile</div>
              </div>
              <ChevronRight size={18} className="opacity-70" />
            </button>
            <button onClick={() => fileRef.current?.click()}
              className="w-full bg-white border-2 border-dashed border-gray-300 text-gray-700 rounded-xl p-4 flex items-center gap-4 hover:border-indigo-400 hover:bg-indigo-50 transition">
              <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center shrink-0"><UploadIcon size={24} className="text-gray-500" /></div>
              <div className="text-left flex-1">
                <div className="font-semibold">Upload Screenshot</div>
                <div className="text-gray-400 text-sm">Gallery, WhatsApp, files</div>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
          </div>
          <p className="text-center text-xs text-gray-400 mt-5">Rapido · Ola · Porter · Swiggy · Amazon · Bank screenshots & more</p>
        </div>
      )}

      {/* Step 1 — scanning */}
      {step === 1 && (
        <div>
          <div className="text-center mb-4">
            <h2 className="text-lg font-bold text-gray-900">AI Scanning…</h2>
            <p className="text-gray-400 text-sm">Extracting all bill details automatically</p>
          </div>
          <div className="relative rounded-2xl overflow-hidden bg-gray-900" style={{ minHeight: 280 }}>
            {image && <img src={image} alt="Captured" className="w-full object-contain" style={{ maxHeight: 340, opacity: 0.75 }} />}
            <div className="absolute inset-0" style={{ background: 'rgba(79,70,229,0.3)' }} />
            <div className="absolute left-0 right-0 h-0.5"
              style={{ top: `${scanPct}%`, background: '#818cf8', boxShadow: '0 0 16px 4px #818cf8, 0 0 4px 1px white', transition: 'none' }} />
            {['top-3 left-3 border-t-2 border-l-2','top-3 right-3 border-t-2 border-r-2','bottom-3 left-3 border-b-2 border-l-2','bottom-3 right-3 border-b-2 border-r-2'].map((cls, i) => (
              <div key={i} className={`absolute w-6 h-6 border-indigo-400 ${cls}`} />
            ))}
            <div className="absolute bottom-4 inset-x-0 flex justify-center">
              <span className="bg-indigo-600 text-white text-xs px-3 py-1 rounded-full animate-pulse font-medium">Reading document…</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4 justify-center">
            {['Vendor','Amount','GST','Date','Invoice','Description'].map((lbl,i) => (
              <span key={lbl} className={`text-xs px-2.5 py-1 rounded-full transition-all font-medium ${scanPct > (i+1)*13 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                {scanPct > (i+1)*13 && '✓ '}{lbl}
              </span>
            ))}
          </div>
          <p className="text-center text-xs text-gray-400 mt-3">Using AI for accurate extraction</p>
        </div>
      )}

      {/* Step 2 — review extracted details */}
      {step === 2 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            {image && <img src={image} alt="Bill" className="w-14 h-14 object-cover rounded-xl border border-gray-200 shrink-0" />}
            <div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-green-500" />
                <h2 className="font-bold text-gray-900">Details Extracted!</h2>
              </div>
              <p className="text-gray-400 text-xs">Review and edit if needed</p>
            </div>
          </div>
          <div className={`border rounded-xl px-3 py-2 text-xs flex items-center gap-2 mb-4 ${form.source === 'manual' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-indigo-50 border-indigo-100 text-indigo-700'}`}>
            <Scan size={13} className="shrink-0" />
            {form.source === 'manual'
              ? 'OCR not configured — please fill in the details manually.'
              : 'AI extracted these details — please verify before saving.'}
          </div>
          <div className="space-y-3">
            {[
              ['Vendor / Merchant *', 'vendor',      'text'],
              ['Invoice / Receipt No.','invoice_no', 'text'],
              ['Date *',              'date',         'date'],
              ['Amount (excl. GST) *','amount',       'number'],
              ['GST Amount',          'gst',          'number'],
              ['Total Amount *',      'total',        'number'],
              ['Advance Paid',        'advance_paid', 'number'],
              ['Description',         'description',  'text'],
            ].map(([label, field, type]) => (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                <input type={type} value={form[field]} onChange={e => setF(field, e.target.value)}
                  className="input" step={type==='number'?'0.01':undefined} />
              </div>
            ))}
          </div>
          {/* Balance Due summary */}
          {(parseFloat(form.advance_paid) > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Bill</span>
                <span className="font-semibold text-gray-800">₹{(parseFloat(form.total)||0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-gray-500">Advance Paid</span>
                <span className="font-semibold text-green-700">₹{(parseFloat(form.advance_paid)||0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm mt-1 pt-1 border-t border-amber-200">
                <span className="font-semibold text-gray-700">Balance Due</span>
                <span className="font-bold text-red-600">₹{((parseFloat(form.total)||0)-(parseFloat(form.advance_paid)||0)).toFixed(2)}</span>
              </div>
            </div>
          )}
          <button onClick={() => setStep(3)} disabled={!form.vendor || !form.total || !form.date}
            className="btn-primary w-full mt-5 flex items-center justify-center gap-2">
            Next: Select Project <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* Step 3 — project (projects is now string[]) */}
      {step === 3 && (
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Which project?</h2>
          <p className="text-gray-400 text-sm mb-5">Select an existing project or create a new one</p>
          <div className="space-y-2">
            {projects.map(name => (
              <button key={name} onClick={() => { setF('project', name); setNewProjMode(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition text-left ${form.project === name && !newProjMode ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <FolderOpen size={17} className={form.project===name&&!newProjMode ? 'text-indigo-600':'text-gray-400'} />
                <span className={`text-sm font-medium ${form.project===name&&!newProjMode ? 'text-indigo-700':'text-gray-700'}`}>{name}</span>
                {form.project===name&&!newProjMode && <Check size={15} className="ml-auto text-indigo-600" />}
              </button>
            ))}
            <button onClick={() => { setNewProjMode(true); setF('project',''); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition ${newProjMode ? 'border-green-500 bg-green-50' : 'border-dashed border-gray-300 hover:border-green-400'}`}>
              <Plus size={17} className="text-green-600" />
              <span className="text-sm font-medium text-green-700">Create New Project</span>
            </button>
          </div>
          {newProjMode && (
            <input autoFocus placeholder="Enter project name…" value={newProjName}
              onChange={e => setNewProjName(e.target.value)}
              className="input mt-3 border-2 border-green-400 focus:ring-green-400" />
          )}
          <button onClick={() => setStep(4)} disabled={!form.project && !(newProjMode && newProjName.trim())}
            className="btn-primary w-full mt-5 flex items-center justify-center gap-2">
            Next: Category <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* Step 4 — category & reimbursement */}
      {step === 4 && (
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Category & Reimbursement</h2>
          <p className="text-gray-400 text-sm mb-4">AI suggested a category · pick who to reimburse if needed</p>
          <div className="space-y-2 mb-5">
            {CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => setF('category', cat.id)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition text-left"
                style={form.category===cat.id ? { borderColor: cat.color, backgroundColor: cat.color+'18' } : { borderColor: '#e5e7eb' }}>
                <span className="text-xl">{cat.icon}</span>
                <span className="text-sm font-medium text-gray-800">{cat.label}</span>
                {form.suggestedCategory===cat.id && form.category!==cat.id && (
                  <span className="ml-auto text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">AI Suggested</span>
                )}
                {form.category===cat.id && (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ background: cat.color }}>
                    {form.suggestedCategory===cat.id ? '✓ AI Pick' : '✓ Selected'}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-200 pt-4">
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Reimbursement?</h3>
            <div className="flex gap-2 mb-4">
              {[{val:false,label:'Company Expense',sub:'Paid from company funds'},{val:true,label:'Needs Reimbursement',sub:'Paid by an employee'}].map(({val,label,sub}) => (
                <button key={String(val)} onClick={() => setF('isReimbursement', val)}
                  className={`flex-1 p-3 rounded-xl border-2 text-left transition ${form.isReimbursement===val ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className={`text-sm font-semibold ${form.isReimbursement===val ? 'text-indigo-700':'text-gray-700'}`}>{label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
                </button>
              ))}
            </div>
            {form.isReimbursement && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Reimburse to:</label>
                {employees.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {employees.map(emp => (
                      <button key={emp.id} onClick={() => setF('reimburseTo', emp.name)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition ${form.reimburseTo===emp.name ? 'border-indigo-500 bg-indigo-50':'border-gray-200 hover:border-gray-300'}`}>
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
                          {emp.name.split(' ').map(n=>n[0]).join('')}
                        </div>
                        <div className="text-left flex-1">
                          <div className={`text-sm font-medium ${form.reimburseTo===emp.name ? 'text-indigo-700':'text-gray-700'}`}>{emp.name}</div>
                          {emp.department && <div className="text-xs text-gray-400">{emp.department}</div>}
                        </div>
                        {form.reimburseTo===emp.name && <Check size={14} className="text-indigo-600" />}
                      </button>
                    ))}
                  </div>
                )}
                <input type="text"
                  placeholder={employees.length > 0 ? 'Or type a name manually…' : "Enter the person's name…"}
                  value={form.reimburseTo} onChange={e => setF('reimburseTo', e.target.value)}
                  className="input" />
              </div>
            )}
          </div>
          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
          <button onClick={handleSave}
            disabled={saving || !form.category || (form.isReimbursement && !form.reimburseTo)}
            className="w-full mt-5 bg-green-600 text-white rounded-xl py-3 font-bold text-sm hover:bg-green-700 disabled:opacity-40 transition flex items-center justify-center gap-2">
            {saving
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving & Uploading…</>
              : <><Check size={16} /> Save Expense</>}
          </button>
        </div>
      )}

      {/* Step 5 — success */}
      {step === 5 && savedExpense && (
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={44} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Expense Saved!</h2>
          <p className="text-gray-400 text-sm mb-5">Categorized, stored{savedExpense.drive_url ? ' & synced to Google Drive' : ''}</p>
          <div className="card p-4 text-left mb-6">
            {image && <img src={image} alt="Bill" className="w-full h-32 object-cover rounded-xl mb-3 border border-gray-200" />}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Vendor',    savedExpense.vendor],
                ['Total',     '₹'+Number(savedExpense.total).toLocaleString('en-IN')],
                ['Project',   savedExpense.project_name],
                ['Category',  savedExpense.category],
                ['Date',      savedExpense.date],
                ['Advance Paid', savedExpense.advance_paid > 0 ? '₹'+Number(savedExpense.advance_paid).toLocaleString('en-IN') : 'Full Payment'],
                ['Balance Due', savedExpense.advance_paid > 0 ? '₹'+((Number(savedExpense.total)||0)-(Number(savedExpense.advance_paid)||0)).toLocaleString('en-IN') : '—'],
                ['Reimburse', savedExpense.reimburse_to_name || 'N/A'],
              ].map(([k,v]) => (
                <div key={k} className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                  <div className="text-gray-400">{k}</div>
                  <div className="font-semibold text-gray-800 truncate">{v}</div>
                </div>
              ))}
            </div>
            {savedExpense.drive_url && (
              <a href={savedExpense.drive_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-indigo-600 hover:underline mt-3">
                <ExternalLink size={12} /> View in Google Drive
              </a>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={reset} className="btn-primary flex-1">+ Add Another</button>
            <button onClick={() => navigate('/dashboard')} className="btn-secondary flex-1">Dashboard</button>
          </div>
        </div>
      )}
    </div>
  );
}
