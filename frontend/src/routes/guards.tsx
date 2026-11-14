import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { t } from '../i18n/en';
import { isAdmin, useAuthStore } from '../store/authStore';

function LoadingScreen() {
  return (
    <div className="auth-wrap" data-testid="app-loading">
      <div className="row muted">
        <span className="spinner" aria-hidden="true" />
        <span>{t('common.loading')}</span>
      </div>
    </div>
  );
}

export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  if (!isAdmin(user)) return <Navigate to="/403" replace />;
  return <Outlet />;
}
