import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Plus, 
  Edit, 
  Trash2, 
  Package,
  Filter,
  Upload
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const products = [
  { 
    id: 1, 
    name: "Coca Cola 330ml", 
    price: 2.99, 
    cost: 1.50,
    stock: 150, 
    barcode: "1234567890", 
    category: "Beverages",
    supplier: "Coca Cola Co.",
    status: "active"
  },
  { 
    id: 2, 
    name: "White Bread", 
    price: 1.99, 
    cost: 0.80,
    stock: 80, 
    barcode: "1234567891", 
    category: "Bakery",
    supplier: "Local Bakery",
    status: "active"
  },
  { 
    id: 3, 
    name: "Milk 1L", 
    price: 3.49, 
    cost: 2.10,
    stock: 65, 
    barcode: "1234567892", 
    category: "Dairy",
    supplier: "Dairy Farm Ltd.",
    status: "active"
  },
  { 
    id: 4, 
    name: "Bananas (per kg)", 
    price: 2.79, 
    cost: 1.20,
    stock: 45, 
    barcode: "1234567893", 
    category: "Fruits",
    supplier: "Fresh Fruits Co.",
    status: "low_stock"
  },
  { 
    id: 5, 
    name: "Chocolate Bar", 
    price: 1.49, 
    cost: 0.75,
    stock: 120, 
    barcode: "1234567894", 
    category: "Confectionery",
    supplier: "Sweet Treats Inc.",
    status: "active"
  },
];

export default function Products() {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.barcode.includes(searchTerm) ||
    product.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string, stock: number) => {
    if (stock < 20) return <Badge variant="destructive">Low Stock</Badge>;
    if (status === "active") return <Badge variant="secondary">Active</Badge>;
    return <Badge variant="outline">Inactive</Badge>;
  };

  const calculateProfit = (price: number, cost: number) => {
    return ((price - cost) / cost * 100).toFixed(1);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Products</h1>
          <div className="flex gap-2">
            <Button variant="outline">
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Product Inventory
              </CardTitle>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search products..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-80"
                  />
                </div>
                <Button variant="outline" size="icon">
                  <Filter className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Profit %</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{product.name}</p>
                        <p className="text-sm text-muted-foreground">{product.barcode}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{product.category}</Badge>
                    </TableCell>
                    <TableCell className="font-medium text-success">
                      ${product.price}
                    </TableCell>
                    <TableCell>${product.cost}</TableCell>
                    <TableCell>
                      <span className="text-success font-medium">
                        {calculateProfit(product.price, product.cost)}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={product.stock < 20 ? "text-warning font-medium" : ""}>
                        {product.stock}
                      </span>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(product.status, product.stock)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="icon" className="h-8 w-8">
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button variant="destructive" size="icon" className="h-8 w-8">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}