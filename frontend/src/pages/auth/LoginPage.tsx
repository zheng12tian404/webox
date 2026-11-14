import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { t } from '../../i18n/en';
import { isAdmin, useAuthStore } from '../../store/authStore';
import { ApiError, errorMessage } from '../../api/errors';
import { validateEmail } from '../../utils/validation';

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      navigate(next || (isAdmin(user) ? '/admin' : '/menu'), { replace: true });
    }
  }, [status, user, next, navigate]);

  if (status === 'authenticated') {
    return <Navigate to={next || (isAdmin(user) ? '/admin' : '/menu')} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email.trim());
    if (emailErr) {
      setError(t(emailErr));
      return;
    }
    if (!password) {
      setError(t('auth.passwordPolicy'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const u = await login(email.trim(), password);
      navigate(next || (isAdmin(u) ? '/admin' : '/menu'), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">WB</span>
          <span style={{ fontWeight: 800, fontSize: 19 }}>WeBox</span>
        </div>
        <h1 className="auth-title">{t('auth.login.title')}</h1>
        <p className="auth-sub">Order your office meals in seconds.</p>
        <form className="stack-sm" onSubmit={submit} noValidate>
          <div className="field">
            <label className="label" htmlFor="login-email">{t('auth.email')}</label>
            <input
              id="login-email"
              data-testid="login-email"
              className="input"
              type="email"
              autoComplete="email"
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="login-password">{t('auth.password')}</label>
            <input
              id="login-password"
              data-testid="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              maxLength={64}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>
          {error ? (
            <p className="error-text" role="alert" data-testid="login-error">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy} data-testid="login-submit">
            {busy ? t('common.loading') : t('auth.login.submit')}
          </button>
        </form>
        <div className="auth-foot">
          <Link to="/register">{t('auth.toRegister')}</Link>
        </div>
        <p className="hint center" style={{ marginTop: 14 }}>{t('auth.demoHint')}</p>
      </div>
    </div>
  );
}
