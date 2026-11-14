import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { ConsoleLayout } from '../components/layout/ConsoleLayout';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { MenuPage } from '../pages/employee/MenuPage';
import { DishDetailPage } from '../pages/employee/DishDetailPage';
import { CartPage } from '../pages/employee/CartPage';
import { CheckoutPage } from '../pages/employee/CheckoutPage';
import { OrderSuccessPage } from '../pages/employee/OrderSuccessPage';
import { OrdersPage } from '../pages/employee/OrdersPage';
import { OrderDetailPage } from '../pages/employee/OrderDetailPage';
import { PreferencesPage } from '../pages/employee/PreferencesPage';
import { DashboardPage } from '../pages/console/DashboardPage';
import { DishesPage } from '../pages/console/DishesPage';
import { DailyMenuPage } from '../pages/console/DailyMenuPage';
import { ConsoleOrdersPage } from '../pages/console/ConsoleOrdersPage';
import { InventoryPage } from '../pages/console/InventoryPage';
import { AuditPage } from '../pages/console/AuditPage';
import { AiRulesPage } from '../pages/console/AiRulesPage';
import { ForbiddenPage } from '../pages/system/ForbiddenPage';
import { NotFoundPage } from '../pages/system/NotFoundPage';
import { RequireAdmin, RequireAuth } from './guards';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '/console', element: <Navigate to="/admin" replace /> },
  { path: '/console/*', element: <Navigate to="/admin" replace /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <MenuPage /> },
          { path: 'menu', element: <MenuPage /> },
          { path: 'dishes/:dishId', element: <DishDetailPage /> },
          { path: 'cart', element: <CartPage /> },
          { path: 'checkout', element: <CheckoutPage /> },
          { path: 'order-success/:orderId', element: <OrderSuccessPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/:orderId', element: <OrderDetailPage /> },
          { path: 'orders/:orderId/success', element: <OrderSuccessPage /> },
          { path: 'preferences', element: <PreferencesPage /> },
        ],
      },
      {
        element: <RequireAdmin />,
        children: [
          {
            element: <ConsoleLayout />,
            children: [
              { path: 'admin', element: <DashboardPage /> },
              { path: 'admin/dishes', element: <DishesPage /> },
              { path: 'admin/dishes/new', element: <DishesPage /> },
              { path: 'admin/dishes/:dishId/edit', element: <DishesPage /> },
              { path: 'admin/daily-menu', element: <DailyMenuPage /> },
              { path: 'admin/orders', element: <ConsoleOrdersPage /> },
              { path: 'admin/inventory', element: <InventoryPage /> },
              { path: 'admin/audit', element: <AuditPage /> },
              { path: 'admin/ai-rules', element: <AiRulesPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
