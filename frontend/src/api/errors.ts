import { t } from '../i18n/en';

export class ApiError extends Error {
  status: number;
  code: string;
  requestId: string;
  data: unknown;

  constructor(status: number, code: string, message: string, requestId = '', data: unknown = null) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.data = data;
  }
}

const CODE_MESSAGES: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: 'auth.login.failed',
  AUTH_EMAIL_EXISTS: 'auth.emailExists',
  AUTH_UNAUTHORIZED: 'error.unauthorized',
  AUTH_TOKEN_INVALID: 'auth.sessionExpired',
  FORBIDDEN: 'error.forbidden',
  NOT_FOUND: 'error.notFound',
  ORDER_NOT_FOUND: 'orders.notFound',
  DISH_NOT_FOUND: 'error.notFound',
  RATE_LIMITED: 'error.rateLimited',
  VALIDATION_EMAIL_FORMAT: 'auth.emailFormat',
  VALIDATION_EMAIL_LENGTH: 'auth.emailFormat',
  VALIDATION_PASSWORD_POLICY: 'auth.passwordPolicy',
  VALIDATION_SEARCH_LENGTH: 'menu.searchTooLong',
  VALIDATION_ADDRESS_LENGTH: 'checkout.addressRequired',
  VALIDATION_REASON_REQUIRED: 'console.reasonRequired',
  ORDER_LIMIT_EXCEEDED: 'menu.orderLimit',
  ORDER_MEAL_UNAVAILABLE: 'checkout.dateUnavailable',
  IDEMPOTENCY_CONFLICT: 'error.validation',
  IDEMPOTENCY_KEY_REQUIRED: 'error.validation',
  STOCK_INSUFFICIENT: 'error.validation',
  ORDER_STATE_INVALID: 'error.validation',
  ORDER_DUPLICATE: 'error.validation',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const key = CODE_MESSAGES[err.code];
    if (key) return t(key);
    if (err.code.startsWith('VALIDATION_')) return t('error.validation');
    return err.message || t('error.server');
  }
  return t('error.network');
}
