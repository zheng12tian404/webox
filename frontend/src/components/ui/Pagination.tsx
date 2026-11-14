import { t } from '../../i18n/en';

interface PaginationProps {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, size, total, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, size)));
  if (total <= size) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        data-testid="pagination-prev"
      >
        {t('common.previous')}
      </button>
      <span className="pager-text" data-testid="pagination-info">
        {t('common.page', { page, total: totalPages })} · {total}
      </span>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        data-testid="pagination-next"
      >
        {t('common.next')}
      </button>
    </nav>
  );
}
