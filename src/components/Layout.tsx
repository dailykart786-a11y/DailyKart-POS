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
import { toast } from "@/hooks/use-toast";
import { isLocalMode } from "@/integrations/supabase/client";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: "Signed out successfully",
      description: "You have been logged out of DailyKart POS.",
    });
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <header className="h-16 border-b bg-card flex items-center justify-between px-4 md:px-6">
            <div className="flex items-center gap-2 md:gap-4">
              <SidebarTrigger />
              <div className="flex items-center gap-2 md:gap-3">
                <img src="/lovable-uploads/8339ecb2-3c19-468f-b433-6b7bcb690cf2.png" alt="DailyKart Logo" className="h-6 w-6 md:h-8 md:w-8" />
                <div className="flex items-center gap-1 md:gap-2">
                  <h1 className="text-lg md:text-xl font-bold text-primary">DailyKart POS</h1>
                  <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 md:px-2 md:py-1 rounded">PRO</span>
                  {isLocalMode && <span className="text-xs border rounded px-1.5 py-0.5 text-muted-foreground">LOCAL DATA</span>}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium">{user?.user_metadata?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date().toLocaleDateString('en-IN')} • {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              
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

          {/* Main Content */}
          <main className="flex-1 p-4 md:p-6 bg-secondary/30 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
