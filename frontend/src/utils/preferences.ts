import type { Preferences } from '../api/types';

/** Taste values accepted by the backend (`MeController`): Light/Medium/Rich. */
export const TASTE_OPTIONS = ['Light', 'Medium', 'Rich'] as const;
export const SPICE_OPTIONS = ['None', 'Mild', 'Medium', 'Hot'] as const;

type Taste = (typeof TASTE_OPTIONS)[number];

const isTaste = (v: unknown): v is Taste => typeof v === 'string' && (TASTE_OPTIONS as readonly string[]).includes(v);

/**
 * Normalize a preferences payload from the server or from persisted state.
 * Legacy values (`Balanced`, `0/0` budgets) are mapped to the current contract:
 * taste falls back to `Medium`, an unset/invalid budget becomes null.
 */
export function normalizePreferences(raw: Partial<Preferences> | null | undefined): Preferences {
  const p = raw ?? {};
  const min = typeof p.budgetMinCents === 'number' && Number.isFinite(p.budgetMinCents) ? Math.trunc(p.budgetMinCents) : null;
  const max = typeof p.budgetMaxCents === 'number' && Number.isFinite(p.budgetMaxCents) ? Math.trunc(p.budgetMaxCents) : null;
  const budgetValid = min !== null && max !== null && min > 0 && max >= min;
  return {
    allergens: Array.isArray(p.allergens) ? p.allergens.filter((a): a is string => typeof a === 'string') : [],
    preferredCategories: Array.isArray(p.preferredCategories)
      ? p.preferredCategories.filter((c): c is string => typeof c === 'string')
      : [],
    spicePreference:
      typeof p.spicePreference === 'string' && (SPICE_OPTIONS as readonly string[]).includes(p.spicePreference)
        ? p.spicePreference
        : 'None',
    tastePreference: isTaste(p.tastePreference) ? p.tastePreference : 'Medium',
    budgetMinCents: budgetValid ? min : null,
    budgetMaxCents: budgetValid ? max : null,
    recommendEnabled: p.recommendEnabled === true,
  };
}