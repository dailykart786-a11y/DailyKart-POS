// One list of every page in the app, grouped the way the sidebar shows them.
// The sidebar, breadcrumbs, page titles and favourites all read from here,
// so a new page only needs adding once.
import type { LucideIcon } from "lucide-react";
import {
  BadgePercent, BarChart3, BookOpen, BookText, Boxes, ClipboardList, DollarSign, FileSpreadsheet,
  Landmark, LayoutDashboard, Package, ScrollText, ShoppingCart, Truck, Undo2, UserCheck, UserCog, Users,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Permission key from lib/roles.ts; null = everyone signed in. */
  permission: string | null;
  /** One line shown under the page title. */
  description: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    label: "Home",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard, permission: null, description: "Today's business at a glance" },
    ],
  },
  {
    id: "counter",
    label: "Counter",
    items: [
      { title: "Sales", url: "/sales", icon: ShoppingCart, permission: "sales", description: "Make bills and take payments" },
      { title: "Orders", url: "/orders", icon: ClipboardList, permission: "sales", description: "Phone, WhatsApp and delivery orders" },
      { title: "Returns", url: "/returns", icon: Undo2, permission: "returns", description: "Take back items and issue credit notes" },
      { title: "Day closing", url: "/register", icon: Landmark, permission: "register", description: "Open and close the cash drawer" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    items: [
      { title: "Products", url: "/products", icon: Package, permission: "products", description: "Items, prices, barcodes and GST" },
      { title: "Stock", url: "/stock", icon: Boxes, permission: "stock", description: "Stock levels, reorder list, adjustments and expiry" },
      { title: "Purchases", url: "/purchases", icon: Truck, permission: "purchases", description: "Suppliers, purchase orders and goods received" },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    items: [
      { title: "Customers", url: "/customers", icon: Users, permission: "customers", description: "Customer list and purchase history" },
      { title: "Khata", url: "/khata", icon: BookOpen, permission: "khata", description: "Udhaar balances and payments" },
      { title: "Offers & loyalty", url: "/offers", icon: BadgePercent, permission: "offers", description: "Discounts, coupons and loyalty points" },
    ],
  },
  {
    id: "money",
    label: "Money",
    items: [
      { title: "Expenses", url: "/expenses", icon: DollarSign, permission: "expenses", description: "Shop expenses and approvals" },
      { title: "Accounts", url: "/accounts", icon: BookText, permission: "accounts", description: "Books, profit and loss, balance sheet" },
      { title: "Reports", url: "/reports", icon: BarChart3, permission: "reports", description: "Sales, profit and product reports" },
      { title: "GST reports", url: "/gst", icon: FileSpreadsheet, permission: "reports", description: "GSTR-1, GSTR-3B and HSN summaries" },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { title: "Staff", url: "/staff", icon: UserCog, permission: "staff", description: "Attendance, advances and salary" },
      { title: "Activity log", url: "/activity", icon: ScrollText, permission: "audit", description: "Who changed what, and when" },
      { title: "Users", url: "/users", icon: UserCheck, permission: "users", description: "Sign-ins, roles and stores" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** The page a path belongs to (longest match), or undefined. */
export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === "/") return NAV_ITEMS[0];
  return NAV_ITEMS
    .filter((i) => i.url !== "/" && (pathname === i.url || pathname.startsWith(i.url + "/")))
    .sort((a, b) => b.url.length - a.url.length)[0];
}

export function findNavGroup(item: NavItem): NavGroup | undefined {
  return NAV_GROUPS.find((g) => g.items.includes(item));
}
