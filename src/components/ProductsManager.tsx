import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Package } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface UnitVariant {
  unit: string;
  quantity: number;
  price: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  cost_price: number;
  old_purchase_price: number | null;
  new_purchase_price: number | null;
  base_unit: string | null;
  base_unit_quantity: number | null;
  unit_variants: UnitVariant[] | null;
  stock_quantity: number | null;
  sku: string;
  barcode: string | null;
  category: string | null;
  is_active: boolean | null;
  min_stock_level: number | null;
  gst_rate: number | null;
  image_url: string | null;
}

const categories = [
  "Beverages", "Bakery", "Dairy", "Fruits", "Vegetables", 
  "Snacks", "Confectionery", "Personal Care", "Household", "Other"
];

export function ProductsManager() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  // Form state
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [oldPurchasePrice, setOldPurchasePrice] = useState("");
  const [newPurchasePrice, setNewPurchasePrice] = useState("");
  const [baseUnit, setBaseUnit] = useState("pc");
  const [baseUnitQuantity, setBaseUnitQuantity] = useState("1");
  const [stockQuantity, setStockQuantity] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("");
  const [minStockLevel, setMinStockLevel] = useState("");
  const [gstRate, setGstRate] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  
  // Unit calculator state
  const [showUnitCalculator, setShowUnitCalculator] = useState(false);
  const [calculatedUnits, setCalculatedUnits] = useState<UnitVariant[]>([]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const productsWithParsedVariants = (data || []).map(p => ({
        ...p,
        unit_variants: p.unit_variants ? (p.unit_variants as unknown as UnitVariant[]) : null
      }));
      setProducts(productsWithParsedVariants);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch products",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setPrice("");
    setCostPrice("");
    setOldPurchasePrice("");
    setNewPurchasePrice("");
    setBaseUnit("pc");
    setBaseUnitQuantity("1");
    setStockQuantity("");
    setSku("");
    setBarcode("");
    setCategory("");
    setMinStockLevel("");
    setGstRate("");
    setImageUrl("");
    setCalculatedUnits([]);
    setShowUnitCalculator(false);
    setEditingProduct(null);
    setShowForm(false);
  };

  const calculateUnitPrices = () => {
    if (!newPurchasePrice || !baseUnitQuantity) {
      toast({ title: "Error", description: "Enter new purchase price and base unit quantity first", variant: "destructive" });
      return;
    }

    const basePrice = parseFloat(newPurchasePrice);
    const baseQty = parseFloat(baseUnitQuantity);
    const pricePerUnit = basePrice / baseQty;

    const units = [10, 50, 100, 250, 500, 1000];
    const variants: UnitVariant[] = units.map(qty => ({
      unit: baseUnit === "gm" && qty >= 1000 ? `${qty/1000}kg` : `${qty}${baseUnit}`,
      quantity: qty,
      price: parseFloat((pricePerUnit * qty).toFixed(2))
    }));

    setCalculatedUnits(variants);
    setShowUnitCalculator(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const productData = {
        name,
        price: parseFloat(price),
        cost_price: parseFloat(costPrice),
        old_purchase_price: oldPurchasePrice ? parseFloat(oldPurchasePrice) : null,
        new_purchase_price: newPurchasePrice ? parseFloat(newPurchasePrice) : null,
        base_unit: baseUnit || 'pc',
        base_unit_quantity: baseUnitQuantity ? parseFloat(baseUnitQuantity) : 1,
        unit_variants: calculatedUnits.length > 0 ? (calculatedUnits as any) : null,
        stock_quantity: stockQuantity ? parseInt(stockQuantity) : 0,
        sku,
        barcode: barcode || null,
        category: category || null,
        min_stock_level: minStockLevel ? parseInt(minStockLevel) : 10,
        gst_rate: gstRate ? parseFloat(gstRate) : 0,
        image_url: imageUrl || null,
        is_active: true
      };

      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', editingProduct.id);

        if (error) throw error;
        toast({ title: "Success", description: "Product updated successfully" });
      } else {
        const { error } = await supabase
          .from('products')
          .insert(productData);

        if (error) throw error;
        toast({ title: "Success", description: "Product added successfully" });
      }

      resetForm();
      fetchProducts();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save product",
        variant: "destructive"
      });
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setName(product.name);
    setPrice(product.price.toString());
    setCostPrice(product.cost_price.toString());
    setOldPurchasePrice(product.old_purchase_price?.toString() || "");
    setNewPurchasePrice(product.new_purchase_price?.toString() || "");
    setBaseUnit(product.base_unit || "pc");
    setBaseUnitQuantity(product.base_unit_quantity?.toString() || "1");
    setCalculatedUnits(product.unit_variants || []);
    setStockQuantity(product.stock_quantity?.toString() || "");
    setSku(product.sku);
    setBarcode(product.barcode || "");
    setCategory(product.category || "");
    setMinStockLevel(product.min_stock_level?.toString() || "");
    setGstRate(product.gst_rate?.toString() || "");
    setImageUrl(product.image_url || "");
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast({ title: "Success", description: "Product deleted successfully" });
      fetchProducts();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete product",
        variant: "destructive"
      });
    }
  };

  const getStockStatus = (stock: number | null, minLevel: number | null) => {
    if (!stock) return <Badge variant="destructive">Out of Stock</Badge>;
    if (minLevel && stock <= minLevel) return <Badge variant="destructive">Low Stock</Badge>;
    return <Badge variant="secondary">In Stock</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Product Management</h2>
          <p className="text-muted-foreground">Manage your inventory and product catalog</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="h-4 w-4" />
          {editingProduct ? "Cancel Edit" : "Add Product"}
        </Button>
      </div>

      {/* Add/Edit Product Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingProduct ? "Edit Product" : "Add New Product"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Product Name *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter product name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sku">SKU *</Label>
                  <Input
                    id="sku"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="Enter SKU"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Selling Price (₹) *</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Enter selling price"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="costPrice">Cost Price (₹) *</Label>
                  <Input
                    id="costPrice"
                    type="number"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="Enter cost price"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="oldPurchasePrice">Old Purchase Price (₹)</Label>
                  <Input
                    id="oldPurchasePrice"
                    type="number"
                    step="0.01"
                    value={oldPurchasePrice}
                    onChange={(e) => setOldPurchasePrice(e.target.value)}
                    placeholder="Previous purchase price"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newPurchasePrice">New Purchase Price (₹)</Label>
                  <Input
                    id="newPurchasePrice"
                    type="number"
                    step="0.01"
                    value={newPurchasePrice}
                    onChange={(e) => setNewPurchasePrice(e.target.value)}
                    placeholder="Current purchase price"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="baseUnit">Base Unit</Label>
                  <Select value={baseUnit} onValueChange={setBaseUnit}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gm">Grams (gm)</SelectItem>
                      <SelectItem value="kg">Kilograms (kg)</SelectItem>
                      <SelectItem value="ltr">Liters (ltr)</SelectItem>
                      <SelectItem value="ml">Milliliters (ml)</SelectItem>
                      <SelectItem value="pc">Pieces (pc)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="baseUnitQuantity">Base Unit Quantity</Label>
                  <Input
                    id="baseUnitQuantity"
                    type="number"
                    step="0.01"
                    value={baseUnitQuantity}
                    onChange={(e) => setBaseUnitQuantity(e.target.value)}
                    placeholder="e.g., 1000 for 1kg"
                  />
                  <p className="text-xs text-muted-foreground">
                    For price per 1kg, enter 1000 if base unit is gm
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stockQuantity">Stock Quantity</Label>
                  <Input
                    id="stockQuantity"
                    type="number"
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value)}
                    placeholder="Enter stock quantity"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minStockLevel">Minimum Stock Level</Label>
                  <Input
                    id="minStockLevel"
                    type="number"
                    value={minStockLevel}
                    onChange={(e) => setMinStockLevel(e.target.value)}
                    placeholder="Enter minimum stock level"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gstRate">GST Rate (%)</Label>
                  <Input
                    id="gstRate"
                    type="number"
                    step="0.01"
                    value={gstRate}
                    onChange={(e) => setGstRate(e.target.value)}
                    placeholder="Enter GST rate"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode</Label>
                <Input
                  id="barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Enter barcode"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imageUrl">Product Image URL</Label>
                <Input
                  id="imageUrl"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="Enter image URL (optional)"
                />
                {imageUrl && (
                  <div className="mt-2">
                    <img 
                      src={imageUrl} 
                      alt="Product preview" 
                      className="h-20 w-20 object-cover rounded border"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Unit Price Calculator */}
              <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Unit Price Calculator</Label>
                  <Button 
                    type="button" 
                    variant="secondary" 
                    size="sm"
                    onClick={calculateUnitPrices}
                    disabled={!newPurchasePrice || !baseUnitQuantity}
                  >
                    Calculate Prices
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Enter new purchase price and base unit quantity, then click calculate to see prices for different units
                </p>
                
                {showUnitCalculator && calculatedUnits.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <Label className="text-sm font-medium">Calculated Unit Prices:</Label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {calculatedUnits.map((variant, idx) => (
                        <div key={idx} className="p-2 bg-background rounded border">
                          <div className="text-sm font-medium">{variant.unit}</div>
                          <div className="text-lg font-bold text-primary">₹{variant.price.toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      These unit variants will be saved with the product for easy reference
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="submit">
                  {editingProduct ? "Update Product" : "Add Product"}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Products Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Product Inventory ({products.length} items)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">Loading products...</div>
          ) : products.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No products found. Add your first product to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Selling Price</TableHead>
                  <TableHead>Cost Price</TableHead>
                  <TableHead>Old Purchase</TableHead>
                  <TableHead>New Purchase</TableHead>
                  <TableHead>Unit Prices</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {product.image_url && (
                          <img 
                            src={product.image_url} 
                            alt={product.name}
                            className="h-10 w-10 object-cover rounded border"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        )}
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-sm text-muted-foreground">{product.sku}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {product.category && (
                        <Badge variant="outline">{product.category}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-success">
                      ₹{product.price.toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell>₹{product.cost_price.toLocaleString('en-IN')}</TableCell>
                    <TableCell>
                      {product.old_purchase_price ? (
                        <span className="text-sm">₹{product.old_purchase_price.toFixed(2)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {product.new_purchase_price ? (
                        <div>
                          <span className="font-medium">₹{product.new_purchase_price.toFixed(2)}</span>
                          {product.old_purchase_price && product.new_purchase_price !== product.old_purchase_price && (
                            <Badge 
                              variant={product.new_purchase_price > product.old_purchase_price ? "destructive" : "default"}
                              className="ml-2"
                            >
                              {product.new_purchase_price > product.old_purchase_price ? '+' : ''}
                              {((product.new_purchase_price - product.old_purchase_price) / product.old_purchase_price * 100).toFixed(1)}%
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {product.unit_variants && product.unit_variants.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {product.unit_variants.slice(0, 3).map((variant, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {variant.unit}: ₹{variant.price.toFixed(2)}
                            </Badge>
                          ))}
                          {product.unit_variants.length > 3 && (
                            <Badge variant="outline" className="text-xs">+{product.unit_variants.length - 3}</Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No units</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={product.stock_quantity && product.min_stock_level && product.stock_quantity <= product.min_stock_level ? "text-warning font-medium" : ""}>
                        {product.stock_quantity || 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      {getStockStatus(product.stock_quantity, product.min_stock_level)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => handleEdit(product)}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => handleDelete(product.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}