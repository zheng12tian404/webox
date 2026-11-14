import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api, pageQuery } from '../../api/client';
import type { AdminDish, Paged } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useDebounce } from '../../hooks/useDebounce';
import { notify } from '../../store/uiStore';
import { formatMoney, parseYuanToCents } from '../../utils/money';
import { resolveImage } from '../../utils/image';
import { MAX_DESC, MAX_NAME, MAX_PROTEIN, MAX_SEARCH } from '../../utils/validation';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { ImageWithFallback } from '../../components/ui/ImageWithFallback';
import { ConfirmReasonModal } from '../../components/console/ConfirmReasonModal';

const CATEGORIES = ['Chinese', 'Western', 'Japanese', 'Light Meal', 'Korean', 'Southeast Asian'];
const ALLERGENS = ['Peanuts', 'Dairy', 'Egg', 'Gluten', 'Soy', 'Fish', 'Shellfish'];
const SPICE = ['None', 'Mild', 'Medium', 'Hot'];

interface DishForm {
  name: string;
  description: string;
  priceYuan: string;
  category: string;
  protein: string;
  allergens: string[];
  spiceLevel: string;
  imageUrl: string;
}

const EMPTY_FORM: DishForm = {
  name: '',
  description: '',
  priceYuan: '',
  category: 'Chinese',
  protein: '',
  allergens: [],
  spiceLevel: 'None',
  imageUrl: '',
};

export function DishesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNew = location.pathname.endsWith('/dishes/new');
  const editId = params.dishId ? Number(params.dishId) : null;
  const isEdit = Boolean(editId);

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const status = searchParams.get('status') ?? '';
  const category = searchParams.get('category') ?? '';
  const search = searchParams.get('search') ?? '';
  const [searchText, setSearchText] = useState(search);
  const debounced = useDebounce(searchText, 300);

  useEffect(() => {
    if (debounced !== (searchParams.get('search') ?? '')) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (debounced) next.set('search', debounced);
          else next.delete('search');
          next.set('page', '1');
          return next;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const listPath = useMemo(
    () =>
      `${EP.adminDishes}${pageQuery({
        page,
        size: 20,
        search: search || undefined,
        category: category || undefined,
        status: status || undefined,
      })}`,
    [page, search, category, status],
  );
  const list = useApiQuery<Paged<AdminDish>>(listPath, [listPath]);
  const allForEdit = useApiQuery<Paged<AdminDish>>(isEdit ? `${EP.adminDishes}?page=1&size=100` : null, [isEdit]);

  const editingDish = useMemo(() => {
    if (!editId) return null;
    const found = list.data?.items.find((d) => d.dishId === editId);
    if (found) return found;
    return allForEdit.data?.items.find((d) => d.dishId === editId) ?? null;
  }, [editId, list.data, allForEdit.data]);

  const [form, setForm] = useState<DishForm>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{ dish: AdminDish; next: 'ON_SHELF' | 'OFF_SHELF' } | null>(null);

  useEffect(() => {
    if (!editingDish) return;
    setForm({
      name: editingDish.name,
      description: editingDish.description,
      priceYuan: (editingDish.priceCents / 100).toFixed(2),
      category: editingDish.category,
      protein: editingDish.protein ?? '',
      allergens: editingDish.allergens ?? [],
      spiceLevel: editingDish.spiceLevel,
      imageUrl: editingDish.imageUrl ?? '',
    });
  }, [editingDish]);

  useEffect(() => {
    if (!isNew && !isEdit) setForm(EMPTY_FORM);
  }, [isNew, isEdit]);

  const closeForm = () => {
    setForm(EMPTY_FORM);
    setFile(null);
    setFormError('');
    navigate('/admin/dishes');
  };

  const validate = (): number | null => {
    if (!form.name.trim() || form.name.length > MAX_NAME) {
      setFormError('Name is required (max 100 characters).');
      return null;
    }
    if (form.description.length > MAX_DESC) {
      setFormError('Description is limited to 1000 characters.');
      return null;
    }
    const cents = parseYuanToCents(form.priceYuan);
    if (cents === null || cents <= 0) {
      setFormError('Enter a valid price greater than 0.');
      return null;
    }
    if (form.protein.length > MAX_PROTEIN) {
      setFormError('Protein source is limited to 50 characters.');
      return null;
    }
    return cents;
  };

  const uploadImage = async (dishId: number) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error(t('console.imageTooLarge'));
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(t('console.imageType'));
    const fd = new FormData();
    fd.append('file', file);
    await api.post(EP.adminDishImage(dishId), fd);
  };

  const saveNew = async (e: FormEvent) => {
    e.preventDefault();
    const cents = validate();
    if (cents === null) return;
    setBusy(true);
    try {
      const env = await api.post<{ dishId: number }>(EP.adminDishes, {
        name: form.name.trim(),
        description: form.description,
        priceCents: cents,
        category: form.category,
        protein: form.protein,
        allergens: form.allergens,
        spiceLevel: form.spiceLevel,
        ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
      });
      await uploadImage(env.data.dishId);
      notify.success(t('console.saved'));
      closeForm();
      list.reload();
    } catch (err) {
      notify.error(err);
      setFormError(err instanceof Error && !('code' in err) ? err.message : '');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (reason: string) => {
    if (!editId) return;
    const cents = validate();
    if (cents === null) {
      setReasonOpen(false);
      return;
    }
    setBusy(true);
    try {
      await api.put(EP.adminDish(editId), {
        name: form.name.trim(),
        description: form.description,
        priceCents: cents,
        category: form.category,
        protein: form.protein,
        allergens: form.allergens,
        spiceLevel: form.spiceLevel,
        ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
        confirm: true,
        reason,
      });
      await uploadImage(editId);
      notify.success(t('console.saved'));
      setReasonOpen(false);
      closeForm();
      list.reload();
    } catch (err) {
      notify.error(err);
      setReasonOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const submitStatus = async (reason: string) => {
    if (!statusTarget) return;
    setBusy(true);
    try {
      await api.patch(EP.adminDishStatus(statusTarget.dish.dishId), {
        status: statusTarget.next,
        confirm: true,
        reason,
      });
      notify.success(statusTarget.next === 'OFF_SHELF' ? t('console.offShelf') : t('console.onShelf'));
      setStatusTarget(null);
      list.reload();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  const formOpen = isNew || isEdit;

  return (
    <div>
      <div className="console-top">
        <div>
          <h1 style={{ fontSize: 23 }}>{t('console.dishes')}</h1>
          <p className="page-sub">Create dishes, edit prices and toggle availability. Changes are audited.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/dishes/new')} data-testid="dish-create">
          + {t('console.newDish')}
        </button>
      </div>

      <div className="card card-pad console-toolbar" style={{ marginBottom: 16 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label" htmlFor="dish-search">{t('console.searchPlaceholder')}</label>
          <input
            id="dish-search"
            className="input"
            maxLength={MAX_SEARCH}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value.slice(0, MAX_SEARCH))}
            placeholder={t('console.searchPlaceholder')}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="dish-category">{t('console.category')}</label>
          <select
            id="dish-category"
            className="select"
            value={category}
            onChange={(e) =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set('category', e.target.value);
                else next.delete('category');
                next.set('page', '1');
                return next;
              }, { replace: true })
            }
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="dish-status">{t('console.statusFilter')}</label>
          <select
            id="dish-status"
            className="select"
            value={status}
            onChange={(e) =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set('status', e.target.value);
                else next.delete('status');
                next.set('page', '1');
                return next;
              }, { replace: true })
            }
          >
            <option value="">All</option>
            <option value="ON_SHELF">{t('console.onShelf')}</option>
            <option value="OFF_SHELF">{t('console.offShelf')}</option>
          </select>
        </div>
      </div>

      {list.loading ? (
        <SkeletonRows />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <div className="card"><EmptyState title="No dishes found." /></div>
      ) : (
        <div className="card table-wrap">
          <table className="console-table-cards" data-testid="console-dishes">
            <thead>
              <tr>
                <th>Dish</th>
                <th>{t('console.category')}</th>
                <th>{t('console.price')}</th>
                <th>{t('console.spice')}</th>
                <th>{t('console.status')}</th>
                <th>{t('console.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((dish) => (
                <tr key={dish.dishId}>
                  <td data-label="Dish">
                    <div className="row" style={{ gap: 10 }}>
                      <ImageWithFallback src={resolveImage(dish.imageUrl)} alt={dish.name} className="cart-thumb" />
                      <div>
                        <div className="cell-strong">{dish.name}</div>
                        <div className="small muted">#{dish.dishId}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label={t('console.category')}><span className="badge">{dish.category}</span></td>
                  <td data-label={t('console.price')} className="tabular">{formatMoney(dish.priceCents)}</td>
                  <td data-label={t('console.spice')} className="small">{dish.spiceLevel}</td>
                  <td data-label={t('console.status')}>
                    <span className={`badge ${dish.status === 'ON_SHELF' ? 'badge-green' : 'badge-red'}`}>
                      {dish.status === 'ON_SHELF' ? t('console.onShelf') : t('console.offShelf')}
                    </span>
                  </td>
                  <td data-label={t('console.actions')}>
                    <div className="actions-cell">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => navigate(`/admin/dishes/${dish.dishId}/edit`)}
                        data-testid={`dish-edit-${dish.dishId}`}
                      >
                        {t('console.edit')}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${dish.status === 'ON_SHELF' ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() =>
                          setStatusTarget({
                            dish,
                            next: dish.status === 'ON_SHELF' ? 'OFF_SHELF' : 'ON_SHELF',
                          })
                        }
                        data-testid={`dish-status-${dish.dishId}`}
                      >
                        {dish.status === 'ON_SHELF' ? t('console.offShelf') : t('console.onShelf')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        size={20}
        total={list.data?.total ?? 0}
        onChange={(p) =>
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('page', String(p));
            return next;
          }, { replace: true })
        }
      />

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={isEdit ? t('console.editDish') : t('console.newDish')}
        large
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={closeForm}>{t('common.cancel')}</button>
            {isEdit ? (
              <button type="button" className="btn btn-primary" onClick={() => setReasonOpen(true)} disabled={busy} data-testid="dish-save">
                {busy ? t('common.loading') : t('console.confirmUpdate')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={(e) => void saveNew(e)} disabled={busy} data-testid="dish-save">
                {busy ? t('common.loading') : t('common.save')}
              </button>
            )}
          </>
        }
      >
        {isEdit && !editingDish && allForEdit.loading ? (
          <SkeletonRows count={2} />
        ) : (
          <form className="form-grid" onSubmit={(e) => e.preventDefault()}>
            <div className="field full">
              <label className="label" htmlFor="dish-name">{t('console.name')}</label>
              <input id="dish-name" className="input" maxLength={MAX_NAME} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field full">
              <label className="label" htmlFor="dish-desc">{t('console.description')}</label>
              <textarea id="dish-desc" className="textarea" maxLength={MAX_DESC} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="dish-price">{t('console.price')}</label>
              <input id="dish-price" className="input tabular" inputMode="decimal" value={form.priceYuan} onChange={(e) => setForm({ ...form, priceYuan: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="dish-cat">{t('console.category')}</label>
              <select id="dish-cat" className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="dish-protein">{t('console.protein')}</label>
              <input id="dish-protein" className="input" maxLength={MAX_PROTEIN} value={form.protein} onChange={(e) => setForm({ ...form, protein: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="dish-spice">{t('console.spice')}</label>
              <select id="dish-spice" className="select" value={form.spiceLevel} onChange={(e) => setForm({ ...form, spiceLevel: e.target.value })}>
                {SPICE.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field full">
              <span className="label">{t('console.allergens')}</span>
              <div className="chips">
                {ALLERGENS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className="chip"
                    aria-pressed={form.allergens.includes(a)}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        allergens: f.allergens.includes(a) ? f.allergens.filter((x) => x !== a) : [...f.allergens, a],
                      }))
                    }
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="field full">
              <label className="label" htmlFor="dish-image">{t('console.image')}</label>
              <input
                id="dish-image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span className="hint">{t('console.imageHint')}</span>
            </div>
            {formError ? <p className="error-text full" role="alert">{formError}</p> : null}
          </form>
        )}
      </Modal>

      <ConfirmReasonModal
        open={reasonOpen}
        title={t('console.editDish')}
        description={`Updating "${form.name}" affects prices and menu details immediately.`}
        busy={busy}
        onClose={() => setReasonOpen(false)}
        onConfirm={(reason) => void saveEdit(reason)}
        confirmLabel={t('console.confirmUpdate')}
      />

      <ConfirmReasonModal
        open={Boolean(statusTarget)}
        title={statusTarget?.next === 'OFF_SHELF' ? t('console.offShelf') : t('console.onShelf')}
        description={statusTarget?.next === 'OFF_SHELF' ? t('console.confirmOffShelf') : 'This dish will be visible to employees.'}
        danger={statusTarget?.next === 'OFF_SHELF'}
        busy={busy}
        onClose={() => setStatusTarget(null)}
        onConfirm={(reason) => void submitStatus(reason)}
      />
    </div>
  );
}
