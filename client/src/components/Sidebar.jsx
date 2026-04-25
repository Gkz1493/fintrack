import { NavLink, useNavigate } from 'react-router-dom';
import { Home, Camera, FileText, Users, LogOut, ChevronDown, Settings, FolderOpen Landmark, } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';

const links = [
  { to: '/dashboard',      label: 'Dashboard',      icon: Home },
  { to: '/upload',         label: 'Add Expense',     icon: Camera },
  { to: '/expenses',       label: 'All Expenses',    icon: FileText },
  { to: '/reimbursements', label: 'Reimbursements',  icon: Users },
  { to: '/projects',       label: 'Projects',        icon: FolderOpen },
  { to: '/bank-statement', label: 'Bank Statement',  icon: Landmark },
];

export default function Sidebar() {
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = () => {
    signOut();
    navigate('/login');
  };

  const navItems = isAdmin
    ? [...links, { to: '/employees', label: 'Employees', icon: Settings }]
    : links;

  const NavContent = () => (
    <>
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden">
            <img src="/logo.png" alt="GIMS Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="font-bold text-gray-900 text-sm leading-tight">FinTrack</div>
            <div className="text-xs text-gray-400">Smart Finance</div>
          </div>
        </div>
      </div>
      <div className="px-4 py-2 border-b border-gray-50">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isAdmin ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
          {isAdmin ? '👑 Admin' : '👤 Employee'}
        </span>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }>
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
            {user?.name?.split(' ').map(n=>n[0]).join('').slice(0,2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-gray-900 truncate">{user?.name}</div>
            <div className="text-xs text-gray-400 truncate">{user?.email}</div>
          </div>
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="p-1.5 text-gray-400 hover:text-red-500 transition rounded shrink-0">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0">
        <NavContent />
      </aside>
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-40 flex">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2.5 text-xs transition ${isActive ? 'text-indigo-600' : 'text-gray-400'}`
            }>
            <Icon size={18} />
            <span className="mt-0.5">{label === 'Add Expense' ? 'Add' : label === 'Reimbursements' ? 'Reimburse' : label === 'All Expenses' ? 'Expenses' : label}</span>
          </NavLink>
        ))}
      </div>
    </>
  );
}
