import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { pageQuery } from '../../api/client';
import type { MenuFilters, MenuItem, Paged } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useDebounce } from '../../hooks/useDebounce';
import { useMenuStream } from '../../hooks/useMenuStream';
import { useAuthStore } from '../../store/authStore';
import { DishCard } from '../../components/dish/DishCard';
import { AiAssistant } from '../../components/ai/AiAssistant';
import { EmptyState, ErrorState, SkeletonGrid } from '../../components/ui/Feedback';
import { Pagination } from '../../components/ui/Pagination';
import { MAX_SEARCH } from '../../utils/validation';

export function MenuPage() {
  const [params, setParams] = useSearchParams();
  const authStatus = useAuthStore((s) => s.status);

  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const size = Math.min(100, Math.max(1, Number(params.get('size') ?? '20') || 20));
  const search = params.get('search') ?? '';
  const categoryParam = params.get('category') ?? '';
  const categories = useMemo(() => categoryParam.split(',').filter(Boolean), [categoryParam]);
  const sort = params.get('sort') === 'for-you' ? 'for-you' : 'default';
  const aiOpen = params.get('ai') === '1';

  const [searchText, setSearchText] = useState(search);
  const debouncedSearch = useDebounce(searchText, 300);

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '') next.delete(k);
          else next.set(k, v);
        }
        if (resetPage && !('page' in patch)) next.set('page', '1');
        if (!next.get('size')) next.set('size', String(size));
        return next;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    if (debouncedSearch !== (params.get('search') ?? '')) {
      update({ search: debouncedSearch || undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const menuPath = useMemo(
    () =>
      `${EP.menu}${pageQuery({
        page,
        size,
        search: search || undefined,
        category: categories.length ? categories.join(',') : undefined,
        sort: sort === 'for-you' ? 'for-you' : undefined,
      })}`,
    [page, size, search, categoryParam, sort],
  );

  const menu = useApiQuery<Paged<MenuItem>>(menuPath, [menuPath]);
  const filters = useApiQuery<MenuFilters>(EP.filters, []);
  const streamMode = useMenuStream(authStatus === 'authenticated');

  const toggleCategory = (cat: string) => {
    const next = categories.includes(cat) ? categories.filter((c) => c !== cat) : [...categories, cat];
    update({ category: next.join(',') || undefined });
  };

  const clearFilters = () => {
    setSearchText('');
    update({ search: undefined, category: undefined, page: '1', sort: undefined });
  };

  const items = menu.data?.items ?? [];
  const total = menu.data?.total ?? 0;
  const activeFilters = categories.length > 0 || Boolean(search);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('menu.title')}</h1>
          <p className="page-sub">
            {menu.data ? t('menu.found', { count: total }) : t('common.loading')}
            {streamMode === 'live' ? (
              <span className="menu-status status-live" data-testid="stock-mode" style={{ marginLeft: 10 }}>
                <span className="dot" aria-hidden="true" /> {t('stock.live')}
              </span>
            ) : streamMode === 'polling' ? (
              <span className="menu-status status-polling" data-testid="stock-mode" style={{ marginLeft: 10 }}>
                <span className="dot" aria-hidden="true" /> {t('stock.polling')}
              </span>
            ) : null}
          </p>
        </div>
        <div className="row-wrap">
          <button
            type="button"
            className={`chip${sort === 'for-you' ? ' on' : ''}`}
            aria-pressed={sort === 'for-you'}
            onClick={() => update({ sort: sort === 'for-you' ? undefined : 'for-you' })}
            data-testid="sort-for-you"
          >
            ✦ {t('menu.forYou')}
          </button>
        </div>
      </div>

      <div className="menu-toolbar">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </span>
          <input
            className="input"
            type="search"
            placeholder={t('menu.searchPlaceholder')}
            aria-label={t('menu.searchPlaceholder')}
            maxLength={MAX_SEARCH}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value.slice(0, MAX_SEARCH))}
            data-testid="search-input"
          />
        </div>
        <span className="hint tabular">{searchText.length}/{MAX_SEARCH}</span>
        {activeFilters ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters} data-testid="clear-filters">
            {t('menu.clearFilters')}
          </button>
        ) : null}
      </div>

      {filters.data && filters.data.categories.length > 0 ? (
        <div className="card card-pad filter-panel">
          <div className="filter-group" style={{ paddingTop: 0 }}>
            <span className="filter-label">{t('menu.filters')}</span>
            <div className="chips" role="group" aria-label="Cuisine filters">
              {filters.data.categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className="chip"
                  aria-pressed={categories.includes(cat)}
                  onClick={() => toggleCategory(cat)}
                  data-testid={`filter-category-${cat.replace(/\s+/g, '-')}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {menu.loading ? (
        <SkeletonGrid count={6} />
      ) : menu.error ? (
        <ErrorState error={menu.error} onRetry={menu.reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title={activeFilters ? t('menu.noResults') : t('menu.empty')}
          hint={activeFilters ? 'Try a different keyword or clear the filters.' : 'Check back later today.'}
          action={
            activeFilters ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={clearFilters}>
                {t('menu.clearFilters')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="dish-grid" data-testid="menu-grid">
          {items.map((item) => (
            <DishCard key={item.dishId} item={item} />
          ))}
        </div>
      )}

      <Pagination page={page} size={size} total={total} onChange={(p) => update({ page: String(p) }, false)} />

      <button
        type="button"
        className="ai-fab"
        onClick={() => update({ ai: '1' }, false)}
        data-testid="ai-open"
        aria-label={t('ai.title')}
      >
        ✦ {t('ai.send')}
      </button>
      <AiAssistant open={aiOpen} onClose={() => update({ ai: undefined }, false)} />
    </>
  );
}
