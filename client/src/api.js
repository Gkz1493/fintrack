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

export const login         = (data)   => api.post('/auth/login', data);
export const getMe         = ()       => api.get('/auth/me');
export const registerUser  = (data)   => api.post('/auth/register', data);
export const changePassword = (data)  => api.put('/auth/password', data);
export const getUsers      = ()       => api.get('/auth/users');

export const getExpenses   = (params) => api.get('/expenses', { params });
export const getStats      = ()       => api.get('/expenses/stats');
export const createExpense = (formData) => api.post('/expenses', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const updateStatus  = (id, status) => api.put(`/expenses/${id}/status`, { status });
export const reimburseAll  = (name)   => api.put(`/expenses/reimburse-all/${encodeURIComponent(name)}`);
export const deleteExpense = (id)     => api.delete(`/expenses/${id}`);
export const exportExcel   = ()       => window.open('/api/expenses/export/excel');
export const exportPdf     = ()       => window.open('/api/expenses/export/pdf');

export const getProjects    = ()      => api.get('/projects');
export const getProjectStats = (id)   => api.get(`/projects/${id}/stats`);
export const createProject  = (data)  => api.post('/projects', data);
export const updateProject  = (id, d) => api.put(`/projects/${id}`, d);
export const deleteProject  = (id)    => api.delete(`/projects/${id}`);

export const ocrScan = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/ocr', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

export const getEmployees   = ()      => api.get('/employees');
export const createEmployee = (data)  => api.post('/employees', data);
export const updateEmployee = (id, d) => api.put(`/employees/${id}`, d);
export const deleteEmployee = (id)    => api.delete(`/employees/${id}`);

export default api;
