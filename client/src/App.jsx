import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Sidebar        from './components/Sidebar';
import Login          from './pages/Login';
import Dashboard      from './pages/Dashboard';
import Upload         from './pages/Upload';
import Expenses       from './pages/Expenses';
import Reimbursements from './pages/Reimbursements';
import Employees      from './pages/Employees';
import Projects       from './pages/Projects';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/*" element={
        <RequireAuth>
          <div className="flex h-screen bg-gray-50 overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
              <main className="flex-1 overflow-y-auto scrollable">
                <Routes>
                  <Route path="/dashboard"      element={<Dashboard />} />
                  <Route path="/upload"         element={<Upload />} />
                  <Route path="/expenses"       element={<Expenses />} />
                  <Route path="/reimbursements" element={<Reimbursements />} />
                  <Route path="/projects"       element={<Projects />} />
                  <Route path="/employees"      element={<RequireAdmin><Employees /></RequireAdmin>} />
                  <Route path="*"               element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </main>
            </div>
          </div>
        </RequireAuth>
      } />
    </Routes>
  );
}
