import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { t } from '../../i18n/en';
import { useAuthStore } from '../../store/authStore';

const ITEMS = [
  { to: '/admin', label: 'console.dashboard', end: true },
  { to: '/admin/dishes', label: 'console.dishes' },
  { to: '/admin/daily-menu', label: 'console.dailyMenu' },
  { to: '/admin/orders', label: 'console.orders' },
  { to: '/admin/inventory', label: 'console.inventory' },
  { to: '/admin/audit', label: 'console.audit' },
  { to: '/admin/ai-rules', label: 'console.aiRules' },
];

export function ConsoleLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="console-shell">
      <aside className={`console-side${open ? ' open' : ''}`} aria-label="Console navigation">
        <Link to="/admin" className="brand">
          <span className="brand-mark" aria-hidden="true">WB</span>
          <span>Console</span>
        </Link>
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}
            onClick={() => setOpen(false)}
          >
            {t(item.label)}
          </NavLink>
        ))}
        <div className="side-foot">
          <Link to="/menu" className="side-link">{t('nav.backToStore')}</Link>
          <span style={{ padding: '0 11px', opacity: 0.75 }}>{user?.email}</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={handleLogout}>
            {t('nav.logout')}
          </button>
        </div>
      </aside>
      <div className="console-main">
        <div className="console-mobile-bar">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            ☰ {t('console.title')}
          </button>
          <Link to="/menu" className="btn btn-ghost btn-sm">{t('nav.backToStore')}</Link>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
