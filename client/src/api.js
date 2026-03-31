import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('ft_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ft_token');
      localStorage.removeItem('ft_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/* ── Auth ──────────────────────────────────────────────────────── */
export const login          = (data)   => api.post('/auth/login', data);
export const getMe          = ()       => api.get('/auth/me');
export const registerUser   = (data)   => api.post('/auth/register', data);
export const changePassword = (data)   => api.put('/auth/password', data);
export const getUsers       = ()       => api.get('/auth/users');

/* ── Expenses ──────────────────────────────────────────────────── */
export const getExpenses    = (params) => api.get('/expenses', { params });
export const getStats       = ()       => api.get('/expenses/stats');
export const createExpense  = (fd)     => api.post('/expenses', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
export const updateStatus   = (id, status) => api.put(`/expenses/${id}/status`, { status });
export const reimburseAll   = (name)   => api.put(`/expenses/reimburse-all/${encodeURIComponent(name)}`);
export const deleteExpense  = (id)     => api.delete(`/expenses/${id}`);
export const getReimburseNames = ()    => api.get('/expenses/reimburse-names');

const blobDownload = (url, filename) => {
  const token = localStorage.getItem('ft_token');
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });
};
export const exportExcel = () => blobDownload('/api/expenses/export/excel', 'FinTrack_Expenses.xlsx');
export const exportPdf   = () => blobDownload('/api/expenses/export/pdf',   'FinTrack_Expenses.pdf');

/* ── Projects ──────────────────────────────────────────────────── */
export const getProjects         = ()      => api.get('/projects');
export const getProjectNames     = ()      => api.get('/projects/all-names');
export const getProjectStats     = (id)    => api.get(`/projects/${id}/stats`);
export const getProjectStatsByName = (name) => api.get(`/projects/stats-by-name/${encodeURIComponent(name)}`);
export const createProject       = (data)  => api.post('/projects', data);
export const updateProject       = (id,d)  => api.put(`/projects/${id}`, d);
export const deleteProject       = (id)    => api.delete(`/projects/${id}`);

/* ── OCR ───────────────────────────────────────────────────────── */
export const ocrScan = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/ocr', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

/* ── Employees ─────────────────────────────────────────────────── */
export const getEmployees    = ()       => api.get('/employees');
export const createEmployee  = (data)   => api.post('/employees', data);
export const updateEmployee  = (id, d)  => api.put(`/employees/${id}`, d);
export const deleteEmployee  = (id)     => api.delete(`/employees/${id}`);

export default api;
