import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/router';
import { useAuthStore } from './store/authStore';
import { ToastHost } from './components/ui/ToastHost';

export function App() {
  useEffect(() => {
    void useAuthStore.getState().bootstrap();
  }, []);
  return (
    <>
      <RouterProvider router={router} />
      <ToastHost />
    </>
  );
}
