import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { t } from '../../i18n/en';
import { isAdmin, useAuthStore } from '../../store/authStore';
import { errorMessage } from '../../api/errors';
import { MAX_NAME, validateEmail, validatePassword } from '../../utils/validation';

export function RegisterPage() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to={isAdmin(user) ? '/admin' : '/menu'} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email.trim());
    if (emailErr) {
      setError(t(emailErr));
      return;
    }
    const pwErr = validatePassword(password);
    if (pwErr) {
      setError(t(pwErr));
      return;
    }
    if (displayName.length > MAX_NAME) {
      setError('Display name must be 100 characters or fewer.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const u = await register(email.trim(), password, displayName.trim() || undefined);
      navigate(isAdmin(u) ? '/admin' : '/menu', { replace: true });
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
        <h1 className="auth-title">{t('auth.register.title')}</h1>
        <p className="auth-sub">One account for daily office meals.</p>
        <form className="stack-sm" onSubmit={submit} noValidate>
          <div className="field">
            <label className="label" htmlFor="register-email">{t('auth.email')}</label>
            <input
              id="register-email"
              data-testid="register-email"
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
            <label className="label" htmlFor="register-password">{t('auth.password')}</label>
            <input
              id="register-password"
              data-testid="register-password"
              className="input"
              type="password"
              autoComplete="new-password"
              maxLength={64}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
            />
            <span className="hint">{t('auth.passwordPolicy')}</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="register-name">{t('auth.displayName')}</label>
            <input
              id="register-name"
              data-testid="register-name"
              className="input"
              maxLength={MAX_NAME}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          {error ? (
            <p className="error-text" role="alert" data-testid="register-error">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy} data-testid="register-submit">
            {busy ? t('common.loading') : t('auth.register.submit')}
          </button>
        </form>
        <div className="auth-foot">
          <Link to="/login">{t('auth.toLogin')}</Link>
        </div>
      </div>
    </div>
  );
}
