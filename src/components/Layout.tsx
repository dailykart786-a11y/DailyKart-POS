import { createContext, Suspense, useContext, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { UserProfile } from "@/components/UserProfile";
import { UserSettings } from "@/components/UserSettings";
import { Button } from "@/components/ui/button";
import { User, Settings, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useStore, ALL_STORES } from "@/hooks/useStore";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Store } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { OfflineStatus } from "@/components/OfflineStatus";
import { AlertsBell } from "@/components/AlertsBell";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LoginSecurity } from "@/components/LoginSecurity";
import { InstallAppButton } from "@/components/InstallAppButton";
import { readQueue } from "@/lib/offline";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageHeading } from "@/components/PageHeading";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageSkeleton, TopProgressBar } from "@/components/feedback";
import { readSidebarOpen, saveSidebarOpen } from "@/hooks/useNavPrefs";

// True inside the app frame, so pages that still wrap themselves in
// <Layout> don't draw a second frame.
const InShell = createContext(false);

interface LayoutProps {
  children: React.ReactNode;
}

/** Older pages call this; inside the app frame it just shows the page. */
export function Layout({ children }: LayoutProps) {
  const inShell = useContext(InShell);
  if (inShell) return <>{children}</>;
  return <AppFrame>{children}</AppFrame>;
}

/** The frame for every signed-in page: sidebar, header, breadcrumbs. Pages load inside it. */
export function AppShell() {
  const { pathname } = useLocation();
  return (
    <AppFrame>
      <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<><TopProgressBar /><PageSkeleton /></>}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </AppFrame>
  );
}

function AppFrame({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const { user, signOut } = useAuth();
  const { stores, isAdmin, selectedStoreId, setSelectedStoreId, homeStoreId } = useStore();
  const homeStoreName = stores.find(s => s.id === homeStoreId)?.name;

  const handleSignOut = async () => {
    const waiting = user ? readQueue().filter(s => s.cashier_id === user.id).length : 0;
    if (waiting > 0) {
      toast({
        title: `${waiting} offline bill${waiting === 1 ? "" : "s"} not synced yet`,
        description: "They stay on this device and are sent when you sign in here again with internet.",
        variant: "destructive",
      });
    }
    await signOut();
    toast({
      title: "Signed out successfully",
      description: "You have been logged out of DailyKart POS.",
    });
  };

  return (
    <InShell.Provider value={true}>
    <SidebarProvider open={sidebarOpen} onOpenChange={(o) => { setSidebarOpen(o); saveSidebarOpen(o); }}>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="sticky top-0 z-30 h-16 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 flex items-center justify-between px-4 md:px-6 box-content pt-[env(safe-area-inset-top)] print:hidden">
            <div className="flex items-center gap-2 md:gap-4">
              <SidebarTrigger aria-label="Show or hide the menu" title="Menu (Ctrl+B)" />
              <div className="flex items-center gap-2 md:gap-3 md:hidden">
                <img src="/lovable-uploads/8339ecb2-3c19-468f-b433-6b7bcb690cf2.png" alt="DailyKart Logo" className="h-6 w-6 md:h-8 md:w-8" />
                <div className="hidden min-[420px]:flex items-center gap-1 md:gap-2">
                  <h1 className="text-lg md:text-xl font-bold text-primary">DailyKart POS</h1>
                  <span className="hidden sm:inline text-xs bg-accent text-accent-foreground px-1.5 py-0.5 md:px-2 md:py-1 rounded">PRO</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4">
              {isAdmin && stores.length > 1 ? (
                <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                  <SelectTrigger className="w-[130px] md:w-[180px]" aria-label="Store">
                    <Store className="h-4 w-4 mr-1 shrink-0" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_STORES}>All stores</SelectItem>
                    {stores.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : stores.length > 1 && homeStoreName ? (
                <span className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground">
                  <Store className="h-4 w-4" /> {homeStoreName}
                </span>
              ) : null}
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium">{user?.user_metadata?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date().toLocaleDateString('en-IN')} • {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              
              <InstallAppButton />
              <ThemeToggle />
              <LanguageToggle />
              <AlertsBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <User className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="p-1">
                    <UserProfile />
                    <UserSettings />
                    <LoginSecurity />
                    <Button 
                      variant="ghost" 
                      className="w-full justify-start gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={handleSignOut}
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <OfflineStatus />

          {/* Main Content */}
          <main id="main" className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 bg-secondary/30 overflow-auto">
            <PageHeading />
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
    </InShell.Provider>
  );
}