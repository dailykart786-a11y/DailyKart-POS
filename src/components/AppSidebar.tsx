import { useState } from "react";
import { 
  Boxes,
  ScrollText,
  BadgePercent,
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  Users, 
  TrendingUp, 
  DollarSign,
  UserCheck,
  Settings,
  FileBarChart,
  Truck,
  BarChart3,
  BookOpen,
  Undo2,
  Landmark,
  FileSpreadsheet,
  BookText,
  UserCog,
} from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navigationItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, permission: null },
  { title: "Sales", url: "/sales", icon: ShoppingCart, permission: "sales" },
  { title: "Products", url: "/products", icon: Package, permission: "products" },
  { title: "Stock", url: "/stock", icon: Boxes, permission: "stock" },
  { title: "Purchases", url: "/purchases", icon: Truck, permission: "purchases" },
  { title: "Day closing", url: "/register", icon: Landmark, permission: "register" },
  { title: "Khata", url: "/khata", icon: BookOpen, permission: "khata" },
  { title: "Returns", url: "/returns", icon: Undo2, permission: "returns" },
  { title: "Offers & loyalty", url: "/offers", icon: BadgePercent, permission: "offers" },
  { title: "Customers", url: "/customers", icon: Users, permission: "customers" },
  { title: "Expenses", url: "/expenses", icon: DollarSign, permission: "expenses" },
  { title: "Accounts", url: "/accounts", icon: BookText, permission: "accounts" },
  { title: "Staff", url: "/staff", icon: UserCog, permission: "staff" },
  { title: "Reports", url: "/reports", icon: BarChart3, permission: "reports" },
  { title: "GST reports", url: "/gst", icon: FileSpreadsheet, permission: "reports" },
  { title: "Activity log", url: "/activity", icon: ScrollText, permission: "audit" },
  { title: "Users", url: "/users", icon: UserCheck, permission: "users" },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const isCollapsed = state === "collapsed";
  const { hasPermission } = useUserRole();

  const isActive = (path: string) => {
    if (path === "/" && currentPath === "/") return true;
    if (path !== "/" && currentPath.startsWith(path)) return true;
    return false;
  };

  const filteredItems = navigationItems.filter(item => 
    !item.permission || hasPermission(item.permission)
  );

  return (
    <Sidebar className={isCollapsed ? "w-14" : "w-64"} collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link 
                      to={item.url}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        isActive(item.url)
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}