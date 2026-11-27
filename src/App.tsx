import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { StoreProvider } from "@/hooks/useStore";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleProtectedRoute } from "@/components/RoleProtectedRoute";
import { ThemeProvider } from "@/hooks/useTheme";
import Index from "./pages/Index";
import SalesPage from "./pages/Sales";
import Products from "./pages/Products";
import Customers from "./pages/Customers";
import Expenses from "./pages/Expenses";
import Reports from "./pages/Reports";
import Khata from "./pages/Khata";
import Returns from "./pages/Returns";
import UserManagement from "./pages/UserManagement";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="light" storageKey="dailykart-theme">
      <AuthProvider>
        <StoreProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              } />
              <Route path="/sales" element={
                <ProtectedRoute>
                  <RoleProtectedRoute requiredPermission="sales">
                    <SalesPage />
                  </RoleProtectedRoute>
                </ProtectedRoute>
              } />
              <Route path="/products" element={
                <ProtectedRoute>
                  <RoleProtectedRoute requiredPermission="products">
                    <Products />
                  </RoleProtectedRoute>
                </ProtectedRoute>
              } />
              <Route path="/customers" element={
                <ProtectedRoute>
                  <RoleProtectedRoute requiredPermission="customers">
                    <Customers />
                  </RoleProtectedRoute>
                </ProtectedRoute>
              } />
              <Route path="/expenses" element={
                <ProtectedRoute>
                  <RoleProtectedRoute requiredPermission="expenses">
                    <Expenses />
                  </RoleProtectedRoute>
                </ProtectedRoute>
              } />
              <Route path="/khata" element={
                <ProtectedRoute>
                  <RoleProtectedRoute requiredPermission="khata">
                    <Khata />
                  </RoleProtectedRoute>
                </ProtectedRoute>
              } />
              <Route path="/returns" element={
                <ProtectedRoute>
                  <RoleProtectedRoute requiredPermission="returns">
                    <Returns />
                  </RoleProtectedRoute>
                </ProtectedRoute>
              } />
              <Route path="/reports" element={
                <ProtectedRoute>
                  <RoleProtectedRoute requiredPermission="reports">
                    <Reports />
                  </RoleProtectedRoute>
                </ProtectedRoute>
              } />
              <Route path="/users" element={
                <ProtectedRoute>
                  <RoleProtectedRoute requiredPermission="users">
                    <UserManagement />
                  </RoleProtectedRoute>
                </ProtectedRoute>
              } />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
