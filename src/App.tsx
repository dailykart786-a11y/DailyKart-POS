import { Toaster } from "@/components/ui/toaster";
import { LanguageLayer } from "@/components/LanguageLayer";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { StoreProvider } from "@/hooks/useStore";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleProtectedRoute } from "@/components/RoleProtectedRoute";
import { ThemeProvider } from "@/hooks/useTheme";
import { AppShell } from "@/components/Layout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FullPageLoader } from "@/components/feedback";
import { installGlobalErrorLogging } from "@/lib/errorLog";
import Index from "./pages/Index";
import SalesPage from "./pages/Sales";
const Products = lazy(() => import("./pages/Products"));
const Customers = lazy(() => import("./pages/Customers"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Accounts = lazy(() => import("./pages/Accounts"));
const Staff = lazy(() => import("./pages/Staff"));
const Orders = lazy(() => import("./pages/Orders"));
const Reports = lazy(() => import("./pages/Reports"));
const Khata = lazy(() => import("./pages/Khata"));
const Returns = lazy(() => import("./pages/Returns"));
const Purchases = lazy(() => import("./pages/Purchases"));
const Register = lazy(() => import("./pages/Register"));
const GstReports = lazy(() => import("./pages/GstReports"));
const Stock = lazy(() => import("./pages/Stock"));
const Offers = lazy(() => import("./pages/Offers"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
import Auth from "./pages/Auth";
const Catalogue = lazy(() => import("./pages/Catalogue"));
import NotFound from "./pages/NotFound";

// Billing, the dashboard and sign-in load straight away so they also open
// offline. Other pages load when first opened, then the rest are fetched in
// the background so they're ready (and saved for offline use).
const ErrorPage = lazy(() => import("./pages/ErrorPage"));
const LATER_PAGES = [
  () => import("./pages/Products"),
  () => import("./pages/Customers"),
  () => import("./pages/Expenses"),
  () => import("./pages/Accounts"),
  () => import("./pages/Staff"),
  () => import("./pages/Orders"),
  () => import("./pages/Reports"),
  () => import("./pages/Khata"),
  () => import("./pages/Returns"),
  () => import("./pages/Purchases"),
  () => import("./pages/Register"),
  () => import("./pages/GstReports"),
  () => import("./pages/Stock"),
  () => import("./pages/Offers"),
  () => import("./pages/ActivityLog"),
  () => import("./pages/UserManagement"),
  () => import("./pages/Catalogue"),
  () => import("./pages/ErrorPage"),
];

function usePrefetchPages() {
  useEffect(() => {
    if (navigator.onLine === false) return;
    const t = window.setTimeout(() => {
      LATER_PAGES.forEach((load, i) => window.setTimeout(() => load().catch(() => undefined), i * 150));
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);
}

installGlobalErrorLogging();

const queryClient = new QueryClient();

const ROUTES: { path: string; permission: string; element: JSX.Element }[] = [
  { path: "/sales", permission: "sales", element: <SalesPage /> },
  { path: "/products", permission: "products", element: <Products /> },
  { path: "/customers", permission: "customers", element: <Customers /> },
  { path: "/expenses", permission: "expenses", element: <Expenses /> },
  { path: "/khata", permission: "khata", element: <Khata /> },
  { path: "/returns", permission: "returns", element: <Returns /> },
  { path: "/purchases", permission: "purchases", element: <Purchases /> },
  { path: "/register", permission: "register", element: <Register /> },
  { path: "/accounts", permission: "accounts", element: <Accounts /> },
  { path: "/staff", permission: "staff", element: <Staff /> },
  { path: "/orders", permission: "sales", element: <Orders /> },
  { path: "/reports", permission: "reports", element: <Reports /> },
  { path: "/stock", permission: "stock", element: <Stock /> },
  { path: "/offers", permission: "offers", element: <Offers /> },
  { path: "/gst", permission: "reports", element: <GstReports /> },
  { path: "/activity", permission: "audit", element: <ActivityLog /> },
  { path: "/users", permission: "users", element: <UserManagement /> },
];

const AppRoutes = () => {
  usePrefetchPages();
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/shop/:slug" element={<Catalogue />} />
        <Route path="/error/:code" element={<ErrorPage />} />
        <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route path="/" element={<Index />} />
          {ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={
              <RoleProtectedRoute requiredPermission={r.permission}>{r.element}</RoleProtectedRoute>
            } />
          ))}
        </Route>
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="light" storageKey="dailykart-theme">
      <AuthProvider>
        <StoreProvider>
        <TooltipProvider>
          <Toaster />
          <LanguageLayer />
          <Sonner />
          <BrowserRouter>
            <ErrorBoundary fullScreen>
              <AppRoutes />
            </ErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
