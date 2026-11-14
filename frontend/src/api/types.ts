export type Role = 'EMPLOYEE' | 'ADMIN';
export type OrderStatus = 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';
export type MealType = 'Lunch' | 'Dinner';

export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface UserInfo {
  id: number;
  email: string;
  role: Role;
  displayName?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserInfo;
}

export interface MenuItem {
  dishId: number;
  name: string;
  description: string;
  priceCents: number;
  priceDisplay: string;
  category: string;
  spiceLevel: string;
  imageUrl: string | null;
  available: boolean;
  availableQty: number;
  lowStock: boolean;
  soldOut: boolean;
  hasOptions: boolean;
  hasRequiredOptions: boolean;
  forYou: boolean;
}

export interface OptionItem {
  optionId: number;
  name: string;
  priceDeltaCents: number;
}

export interface OptionGroup {
  groupId: number;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: OptionItem[];
}

export interface DishDetail {
  dishId: number;
  name: string;
  description: string;
  priceCents: number;
  priceDisplay: string;
  category: string;
  protein?: string | null;
  allergens: string[];
  spiceLevel: string;
  imageUrl: string | null;
  available: boolean;
  availableQty: number;
  optionGroups: OptionGroup[];
}

export interface MenuFilters {
  categories: string[];
  spiceLevels: string[];
  allergens: string[];
  dates: { date: string; published: boolean }[];
}

export interface Preferences {
  allergens: string[];
  preferredCategories: string[];
  spicePreference: string | null;
  tastePreference: string | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  recommendEnabled: boolean;
}

export interface Address {
  id: number;
  address: string;
  lastUsedAt?: string | null;
}

export interface CartItemPayload {
  dishId: number;
  qty: number;
  optionIds: number[];
}

export interface PreviewLine {
  dishName: string;
  options: { name: string; priceDeltaCents: number }[];
  qty: number;
  unitPriceCents: number;
  subtotalCents: number;
}

export interface OrderPreview {
  items: PreviewLine[];
  totalCents: number;
  itemCount: number;
  effectiveDate: string;
  effectiveMeal: MealType | string;
  cutoffAt: string;
  autoSwitched: boolean;
  budgetExceeded: boolean;
  existingOrderId?: number | null;
  addresses?: Address[];
}

export interface OrderSummary {
  orderId: number;
  orderNo: string;
  status: OrderStatus;
  totalCents: number;
  itemCount: number;
  deliveryDate: string;
  mealType: MealType | string;
  createdAt: string;
}

export interface OrderLine {
  dishId: number;
  dishName: string;
  unitPriceCents: number;
  options: { name: string; priceDeltaCents: number }[];
  qty: number;
  subtotalCents: number;
}

export interface OrderDetail extends OrderSummary {
  address: string;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  estimatedDelivery?: string | null;
  items: OrderLine[];
}

export interface CreatedOrder {
  orderId: number;
  orderNo: string;
  status: OrderStatus;
  deliveryDate: string;
  mealType: string;
  address: string;
  totalCents: number;
  itemCount: number;
  autoSwitched: boolean;
  estimatedDelivery?: string;
}

export interface AdminDish {
  dishId: number;
  name: string;
  description: string;
  priceCents: number;
  category: string;
  protein?: string | null;
  allergens: string[];
  spiceLevel: string;
  imageUrl: string | null;
  status: 'ON_SHELF' | 'OFF_SHELF' | string;
}

export interface DailyMenuRow {
  dishId: number;
  dishName: string;
  totalQty: number;
  reservedQty: number;
  soldQty: number;
  available: number;
  lowStock: boolean;
  inventoryMode: string;
  published: boolean;
}

export interface AdminOrderRow {
  orderId: number;
  orderNo: string;
  status: OrderStatus;
  totalCents: number;
  itemCount: number;
  deliveryDate: string;
  mealType: string;
  createdAt: string;
  address?: string;
}

export interface DashboardData {
  today: { orders: number; revenueCents: number; completed: number; pending: number; cancelled: number };
  topDishes: { dishId: number; name: string; soldQty: number }[];
  mealSplit: { lunch: number; dinner: number };
  trend: { date: string; orders: number; revenueCents: number }[];
  lowStock: { dishId: number; name: string; available: number }[];
}

export interface AuditRow {
  id?: number;
  createdAt?: string;
  actorId?: number | string;
  actorEmail?: string;
  action?: string;
  objectType?: string;
  objectId?: number | string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

export interface ReconcileResult {
  date: string;
  checked: number;
  drift: { dishId: number; bookAvailable: number; ledgerDerived: number }[];
}

export interface AiRule {
  configKey: string;
  version: number;
  config: unknown;
  updatedAt: string;
}

export interface StockEvent {
  dishId: number;
  available: number;
}
