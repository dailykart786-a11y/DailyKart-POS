import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Package, Barcode, Wand2, FileUp, Download, ScanLine } from "lucide-react";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { ProductImportDialog } from "@/components/ProductImportDialog";
import { downloadCsv } from "@/lib/gstReport";
import { generateShopBarcode, printLabels } from "@/lib/labels";
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
  sold_by?: string | null; // newer database only
  plu_code?: string | null;
  gst_rate: number | null;
  hsn_code?: string | null;
  mrp?: number | null;
  image_url: string | null;
}

const categories = [
  "Beverages", "Bakery", "Dairy", "Fruits", "Vegetables", 
  "Snacks", "Confectionery", "Personal Care", "Household", "Other"
];

export function ProductsManager() {
  const { user } = useAuth();
  const { filterStoreId, newRecordFields } = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  // Form state
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [duplicates, setDuplicates] = useState<{ kind: string; code: string; names: string[] }[]>([]);
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
  const [hsnCode, setHsnCode] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [soldBy, setSoldBy] = useState("piece");
  const [pluCode, setPluCode] = useState("");
  
  // Unit calculator state
  const [showUnitCalculator, setShowUnitCalculator] = useState(false);
  const [calculatedUnits, setCalculatedUnits] = useState<UnitVariant[]>([]);

  const [showImport, setShowImport] = useState(false);
  // Camera: "field" fills the barcode box in the form, "find" opens the product with that barcode
  const [scanFor, setScanFor] = useState<null | "field" | "find">(null);

  useEffect(() => {
    fetchProducts();
  }, [filterStoreId]);

  const fetchProducts = async () => {
    try {
      const { data, error } = await inStore(supabase
        .from('products')
        .select('*'), filterStoreId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const productsWithParsedVariants = (data || []).map(p => ({
        ...p,
        unit_variants: p.unit_variants ? (p.unit_variants as unknown as UnitVariant[]) : null
      }));
      setProducts(productsWithParsedVariants);
      // Duplicate SKU / barcode warning (needs the database update; optional)
      inStore(supabase.from('duplicate_product_codes' as any).select('kind, code, names'), filterStoreId)
        .then(({ data, error: dErr }: any) => setDuplicates(dErr ? [] : (data || [])), () => setDuplicates([]));
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
    setMrp("");
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
    setHsnCode("");
    setImageUrl("");
    setSoldBy("piece");
    setPluCode("");
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

    let variants: UnitVariant[] = [];

    // Generate variants based on unit type
    if (baseUnit === "gm") {
      // For grams: show common weights in both grams and kilograms
      const quantities = [10, 50, 100, 250, 500, 1000, 2000, 5000];
      variants = quantities.map(qty => ({
        unit: qty >= 1000 ? `${qty/1000}kg` : `${qty}gm`,
        quantity: qty,
        price: parseFloat((pricePerUnit * qty).toFixed(2))
      }));
    } else if (baseUnit === "kg") {
      // For kilograms: show fractions and whole kilos
      const quantities = [0.25, 0.5, 1, 2, 5, 10];
      variants = quantities.map(qty => ({
        unit: qty < 1 ? `${qty * 1000}gm` : `${qty}kg`,
        quantity: qty,
        price: parseFloat((pricePerUnit * qty).toFixed(2))
      }));
    } else if (baseUnit === "ml") {
      // For milliliters: show common sizes including liters
      const quantities = [50, 100, 250, 500, 1000, 2000, 5000];
      variants = quantities.map(qty => ({
        unit: qty >= 1000 ? `${qty/1000}ltr` : `${qty}ml`,
        quantity: qty,
        price: parseFloat((pricePerUnit * qty).toFixed(2))
      }));
    } else if (baseUnit === "ltr") {
      // For liters: show fractions and whole liters
      const quantities = [0.25, 0.5, 1, 2, 5, 10];
      variants = quantities.map(qty => ({
        unit: qty < 1 ? `${qty * 1000}ml` : `${qty}ltr`,
        quantity: qty,
        price: parseFloat((pricePerUnit * qty).toFixed(2))
      }));
    } else if (baseUnit === "pc") {
      // For pieces: show common pack sizes
      const quantities = [1, 2, 3, 5, 6, 10, 12, 24];
      variants = quantities.map(qty => ({
        unit: qty === 1 ? `${qty}pc` : `${qty}pcs`,
        quantity: qty,
        price: parseFloat((pricePerUnit * qty).toFixed(2))
      }));
    }

    setCalculatedUnits(variants);
    setShowUnitCalculator(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const mrpValue = mrp.trim() ? parseFloat(mrp) : null;
    if (mrpValue !== null && !(mrpValue >= 0)) {
      toast({ title: "Check the MRP", variant: "destructive" });
      return;
    }
    if (mrpValue !== null && parseFloat(price) > mrpValue) {
      toast({ title: "Selling price is above MRP", description: `Selling above MRP (₹${mrpValue}) is not allowed`, variant: "destructive" });
      return;
    }

    try {
      const productData: Record<string, any> = {
        name,
        price: parseFloat(price),
        cost_price: parseFloat(costPrice),
        old_purchase_price: oldPurchasePrice ? parseFloat(oldPurchasePrice) : null,
        new_purchase_price: newPurchasePrice ? parseFloat(newPurchasePrice) : null,
        base_unit: baseUnit || 'pc',
        base_unit_quantity: baseUnitQuantity ? parseFloat(baseUnitQuantity) : 1,
        unit_variants: calculatedUnits.length > 0 ? (calculatedUnits as any) : null,
        stock_quantity: stockQuantity ? (soldBy === 'piece' ? parseInt(stockQuantity) : Math.round(parseFloat(stockQuantity) * 1000) / 1000) : 0,
        sku,
        barcode: barcode || null,
        category: category || null,
        min_stock_level: minStockLevel ? (soldBy === 'piece' ? parseInt(minStockLevel) : parseFloat(minStockLevel)) : 10,
        gst_rate: gstRate ? parseFloat(gstRate) : 0,
        image_url: imageUrl || null,
        is_active: true
      };
      // Only send MRP when there is one, so saving works before the database update
      if (mrpValue !== null || editingProduct?.mrp != null) productData.mrp = mrpValue;
      // Loose goods: only sent when used, so saving works before the database update
      if (soldBy !== 'piece' || (editingProduct?.sold_by && editingProduct.sold_by !== 'piece')) productData.sold_by = soldBy;
      if (pluCode.trim() || editingProduct?.plu_code) productData.plu_code = pluCode.trim() || null;
      // Only send HSN when there is one, so saving still works before the GST database update
      if (hsnCode.trim() || editingProduct?.hsn_code) {
        productData.hsn_code = hsnCode.trim().replace(/\s/g, '') || null;
      }

      const save = (data: Record<string, any>) => editingProduct
        ? supabase.from('products').update(data as any).eq('id', editingProduct.id)
        : supabase.from('products').insert({ ...data, ...newRecordFields } as any);

      let { error } = await save(productData);
      if (error && 'hsn_code' in productData && /hsn_code/.test(error.message || '')) {
        // Database doesn't have the HSN column yet: save everything else
        const { hsn_code, ...rest } = productData;
        ({ error } = await save(rest));
        if (!error) toast({ title: "HSN not saved", description: "Ask your admin to run the GST database update to store HSN codes" });
      }
      if (error && 'mrp' in productData && /mrp/.test(error.message || '')) {
        const { mrp: _m, ...rest } = productData;
        ({ error } = await save(rest));
        if (!error) toast({ title: "MRP not saved", description: "Ask your admin to run the latest database update to store MRP" });
      }
      if (error && ('sold_by' in productData || 'plu_code' in productData) && /sold_by|plu_code/.test(error.message || '')) {
        const { sold_by: _s, plu_code: _p, ...rest } = productData;
        if (soldBy !== 'piece') {
          toast({ title: "Loose goods need the database update", description: "Run the latest dailykart-updates.sql, then set this product as sold by weight", variant: "destructive" });
          return;
        }
        ({ error } = await save(rest));
      }
      if (error && /uq_products_plu/.test(error.message || '')) {
        toast({ title: "Scale code already used", description: "Another product in this store has this scale item code", variant: "destructive" });
        return;
      }
      if (error) throw error;
      toast({ title: "Success", description: editingProduct ? "Product updated successfully" : "Product added successfully" });

      resetForm();
      fetchProducts();
    } catch (error: any) {
      const dup = error?.code === '23505';
      toast({
        title: dup ? "Already in use" : "Error",
        description: dup
          ? `Another product in this store already has this ${/barcode/.test(error.message || '') ? 'barcode' : 'SKU'}`
          : "Failed to save product",
        variant: "destructive"
      });
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setName(product.name);
    setPrice(product.price.toString());
    setCostPrice(product.cost_price.toString());
    setMrp(product.mrp != null ? String(product.mrp) : "");
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
    setHsnCode(product.hsn_code || "");
    setImageUrl(product.image_url || "");
    setSoldBy(product.sold_by || "piece");
    setPluCode(product.plu_code || "");
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) {
        // Products on old bills are kept for the records: hide instead of delete
        if (error.code === '23503' || /foreign key|violates/i.test(error.message || '')) {
          const { error: hideErr } = await supabase.from('products').update({ is_active: false } as any).eq('id', id);
          if (hideErr) throw hideErr;
          toast({ title: "Product hidden", description: "It is on past bills, so it was hidden from billing instead of deleted. Edit and save it to bring it back." });
          fetchProducts();
          return;
        }
        throw error;
      }
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

  const onScan = (code: string) => {
    const c = code.trim();
    if (!c) return false;
    if (scanFor === "field") {
      setBarcode(c);
      return `Barcode ${c} filled in`;
    }
    const found = products.find(p => (p.barcode || "").trim() === c) || products.find(p => p.sku.trim().toLowerCase() === c.toLowerCase());
    if (found) {
      handleEdit(found);
      return `Opened ${found.name}`;
    }
    resetForm();
    setEditingProduct(null);
    setBarcode(c);
    setShowForm(true);
    return `New product with barcode ${c}`;
  };

  return (
    <div className="space-y-6">
      <BarcodeScannerDialog
        open={scanFor !== null}
        onOpenChange={(o) => { if (!o) setScanFor(null); }}
        onDetected={onScan}
        single
        title={scanFor === "field" ? "Scan the product's barcode" : "Scan a product"}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Product Management</h2>
          <p className="text-muted-foreground">Manage your inventory and product catalog</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={() => setScanFor("find")} className="gap-2" title="Scan a barcode to open that product, or add it if it's new">
            <ScanLine className="h-4 w-4" /> Scan
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)} className="gap-2">
            <FileUp className="h-4 w-4" /> Import Excel
          </Button>
          <Button variant="outline" className="gap-2" disabled={!products.length} onClick={() => downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, products.map(p => ({
            Name: p.name, SKU: p.sku, Barcode: p.barcode || "", Category: p.category || "", Price: p.price, "Cost price": p.cost_price,
            "GST %": p.gst_rate ?? 0, HSN: p.hsn_code || "", Stock: p.stock_quantity ?? 0, "Min stock": p.min_stock_level ?? 0, Unit: (p as any).base_unit || "pc",
          })))}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <Plus className="h-4 w-4" />
            {editingProduct ? "Cancel Edit" : "Add Product"}
          </Button>
        </div>
      </div>

      <ProductImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        existing={products.map(p => ({ id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, location_id: (p as any).location_id }))}
        onDone={fetchProducts}
      />

      {duplicates.length > 0 && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm space-y-1">
            <p className="font-medium text-destructive">Some products share the same code. Fix them so scanning picks the right item:</p>
            {duplicates.slice(0, 10).map((d) => (
              <p key={d.kind + d.code}>{d.kind === 'barcode' ? 'Barcode' : 'SKU'} {d.code}: {d.names.join(', ')}</p>
            ))}
          </CardContent>
        </Card>
      )}

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
                  <Label htmlFor="mrp">MRP (₹)</Label>
                  <Input
                    id="mrp"
                    type="number"
                    step="0.01"
                    value={mrp}
                    onChange={(e) => setMrp(e.target.value)}
                    placeholder="Printed MRP (optional)"
                  />
                  {mrp && price && parseFloat(price) > parseFloat(mrp) && (
                    <p className="text-xs text-destructive">Selling price is above MRP</p>
                  )}
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
                  <Label>Sold by</Label>
                  <Select value={soldBy} onValueChange={setSoldBy}>
                    <SelectTrigger aria-label="Sold by"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="piece">Piece / packet</SelectItem>
                      <SelectItem value="weight">Loose, by weight (price per kg)</SelectItem>
                      <SelectItem value="volume">Loose, by volume (price per litre)</SelectItem>
                    </SelectContent>
                  </Select>
                  {soldBy !== "piece" && <p className="text-xs text-muted-foreground">Stock and bills are in {soldBy === "weight" ? "kg" : "litres"}, like 0.750</p>}
                </div>
                {soldBy !== "piece" && (
                  <div className="space-y-2">
                    <Label htmlFor="pluCode">Scale item code (PLU)</Label>
                    <Input id="pluCode" inputMode="numeric" value={pluCode} onChange={(e) => setPluCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Same code as on the weighing scale" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="stockQuantity">Stock Quantity{soldBy !== "piece" ? (soldBy === "weight" ? " (kg)" : " (L)") : ""}</Label>
                  <Input
                    id="stockQuantity"
                    type="number"
                    step={soldBy === "piece" ? "1" : "0.001"}
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
                <Label htmlFor="hsnCode">HSN code</Label>
                <Input
                  id="hsnCode"
                  value={hsnCode}
                  onChange={(e) => setHsnCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
                  placeholder="e.g. 1006 for rice"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode</Label>
                <div className="flex gap-2">
                  <Input
                    id="barcode"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Scan or type the barcode"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setScanFor("field")} className="shrink-0" aria-label="Scan barcode with camera" title="Scan with camera">
                    <ScanLine className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setBarcode(generateShopBarcode())} className="gap-1 shrink-0" title="Make a barcode for items that don't have one">
                    <Wand2 className="h-4 w-4" /> New
                  </Button>
                </div>
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
                          <p className="font-medium">{product.name}{product.is_active === false && <Badge variant="outline" className="ml-2">Hidden</Badge>}</p>
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
                        {product.stock_quantity || 0}{product.sold_by === 'weight' ? ' kg' : product.sold_by === 'volume' ? ' L' : ''}
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
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="Print barcode label"
                          aria-label="Print barcode label"
                          onClick={() => {
                            if (!printLabels([{ product, copies: 1 }])) {
                              toast({ title: "Can't print label", description: "Add a barcode or SKU, and allow pop-ups for this site", variant: "destructive" });
                            }
                          }}
                        >
                          <Barcode className="h-3 w-3" />
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