// Roles and what each one can open. The owner can change the non-admin
// roles on the Users page (role_permissions table); these are the defaults.

export const ROLE_OPTIONS = [
  { value: "cashier", label: "Cashier" },
  { value: "manager", label: "Manager" },
  { value: "inventory", label: "Inventory manager" },
  { value: "accountant", label: "Accountant" },
  { value: "admin", label: "Owner / Admin" },
] as const;

export const roleLabel = (role: string) => ROLE_OPTIONS.find((r) => r.value === role)?.label || role;

export const PERMISSIONS: { key: string; label: string }[] = [
  { key: "sales", label: "Billing" },
  { key: "register", label: "Day closing" },
  { key: "khata", label: "Khata / udhaar" },
  { key: "returns", label: "Returns" },
  { key: "customers", label: "Customers" },
  { key: "products", label: "Products" },
  { key: "stock", label: "Stock & expiry" },
  { key: "purchases", label: "Purchases & suppliers" },
  { key: "offers", label: "Offers & loyalty" },
  { key: "expenses", label: "Expenses" },
  { key: "reports", label: "Reports & GST" },
  { key: "accounts", label: "Accounts" },
  { key: "staff", label: "Staff & salary" },
  { key: "audit", label: "Activity log" },
];

export const EDITABLE_ROLES = ["manager", "cashier", "inventory", "accountant"] as const;

export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  manager: ["sales", "register", "khata", "returns", "purchases", "products", "stock", "customers", "expenses", "reports", "offers", "audit", "staff"],
  cashier: ["sales", "register", "khata"],
  inventory: ["products", "stock", "purchases"],
  accountant: ["khata", "expenses", "reports", "accounts", "audit"],
};

export const roleBadgeClass = (role: string) => ({
  admin: "bg-red-100 text-red-800",
  manager: "bg-blue-100 text-blue-800",
  cashier: "bg-green-100 text-green-800",
  inventory: "bg-amber-100 text-amber-800",
  accountant: "bg-purple-100 text-purple-800",
}[role] || "bg-gray-100 text-gray-800");
