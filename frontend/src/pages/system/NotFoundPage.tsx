import { Link } from 'react-router-dom';
import { t } from '../../i18n/en';

export function NotFoundPage() {
  return (
    <div className="auth-wrap" data-testid="not-found-page">
      <div className="card auth-card center">
        <div className="empty-icon" style={{ margin: '0 auto 14px' }} aria-hidden="true">404</div>
        <h1 style={{ fontSize: 24 }}>{t('notFound.title')}</h1>
        <p className="muted" style={{ margin: '10px 0 20px' }}>{t('notFound.message')}</p>
        <Link to="/menu" className="btn btn-primary">{t('notFound.back')}</Link>
      </div>
    </div>
  );
}
