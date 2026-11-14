import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { t } from '../../i18n/en';
import { useAuthStore, isAdmin } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { formatMoney } from '../../utils/money';

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const qty = useCartStore((s) => s.lines.reduce((sum, l) => sum + l.qty, 0));
  const total = useCartStore((s) => s.lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0));
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const links = (
    <>
      <NavLink to="/menu" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setNavOpen(false)}>
        {t('nav.menu')}
      </NavLink>
      <NavLink to="/orders" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setNavOpen(false)}>
        {t('nav.orders')}
      </NavLink>
      <NavLink to="/preferences" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setNavOpen(false)}>
        {t('nav.preferences')}
      </NavLink>
      <NavLink to="/cart" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setNavOpen(false)} data-testid="nav-cart">
        {t('nav.cart')}
        {qty > 0 ? <span className="nav-badge">{qty}</span> : null}
      </NavLink>
      {isAdmin(user) ? (
        <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setNavOpen(false)}>
          {t('nav.console')}
        </NavLink>
      ) : null}
    </>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/menu" className="brand" aria-label="WeBox home">
            <span className="brand-mark" aria-hidden="true">WB</span>
            <span>WeBox</span>
          </Link>
          <nav className={`nav${navOpen ? ' open' : ''}`} aria-label="Main navigation">
            {links}
          </nav>
          <div className="topbar-user">
            <span data-testid="current-user">{user?.email}</span>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleLogout} data-testid="logout">
              {t('nav.logout')}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline mobile-menu-btn"
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      {qty > 0 ? (
        <div className="bottom-bar">
          <div>
            <div className="small muted">{qty} item{qty > 1 ? 's' : ''}</div>
            <div className="price tabular" data-testid="bottom-bar-total">{formatMoney(total)}</div>
          </div>
          <Link to="/cart" className="btn btn-primary">
            {t('nav.cart')}
          </Link>
        </div>
      ) : null}
    </>
  );
}
