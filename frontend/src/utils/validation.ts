export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_EMAIL = 200;
export const MAX_SEARCH = 50;
export const MAX_ADDRESS = 200;
export const MAX_NAME = 100;
export const MAX_DESC = 1000;
export const MAX_PROTEIN = 50;
export const MAX_REASON = 200;
export const MAX_PROMPT = 500;

export function validateEmail(email: string): string | null {
  if (!email || email.length > MAX_EMAIL) return 'auth.emailFormat';
  if (!EMAIL_RE.test(email)) return 'auth.emailFormat';
  return null;
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8 || pw.length > 64) return 'auth.passwordPolicy';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'auth.passwordPolicy';
  return null;
}

export const clampText = (v: string, max: number): string => (v.length > max ? v.slice(0, max) : v);

export const isIntInRange = (v: string, min: number, max: number): boolean => {
  if (!/^\d+$/.test(v)) return false;
  const n = Number(v);
  return n >= min && n <= max;
};
