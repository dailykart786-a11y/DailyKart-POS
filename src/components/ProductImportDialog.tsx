import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { downloadCsv } from "@/lib/gstReport";
import { ImportExisting, ImportRow, TEMPLATE_HEADERS, parseCsv, parseProductRows } from "@/lib/productImport";
import { FileUp, Download } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Products already in the store, to match against */
  existing: (ImportExisting & { location_id?: string | null })[];
  onDone: () => void;
}

const CHUNK = 200;

export function ProductImportDialog({ open, onOpenChange, existing, onDone }: Props) {
  const { isAdmin, filterStoreId, workingStoreId, newRecordFields, stores } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  // An admin looking at "all stores" must pick which store to import into
  const needsStore = isAdmin && !filterStoreId && stores.length > 1;
  const storeProducts = useMemo(
    () => existing.filter((p) => !workingStoreId || !p.location_id || p.location_id === workingStoreId),
    [existing, workingStoreId],
  );

  const counts = useMemo(() => ({
    bad: rows.filter((r) => r.errors.length).length,
    add: rows.filter((r) => !r.errors.length && !r.existingId).length,
    update: rows.filter((r) => !r.errors.length && r.existingId).length,
  }), [rows]);

  const reset = () => { setRows([]); setFileName(""); setProgress(""); if (fileRef.current) fileRef.current.value = ""; };

  const readFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    try {
      let sheet: unknown[][];
      if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
        sheet = parseCsv(await file.text());
      } else if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        sheet = (await readSheet(file)) as unknown[][];
      } else {
        toast({ title: "Use an Excel (.xlsx) or CSV file", description: "Old .xls files: open in Excel and Save As .xlsx", variant: "destructive" });
        return;
      }
      const result = parseProductRows(sheet, storeProducts);
      if (result.missingColumns.length) {
        toast({ title: "Columns not found", description: `The first row needs headings for: ${result.missingColumns.join(", ")}. Download the template to see the layout.`, variant: "destructive" });
        return;
      }
      if (!result.rows.length) { toast({ title: "No products found in the file", variant: "destructive" }); return; }
      if (result.rows.length > 5000) { toast({ title: "Too many rows", description: "Import up to 5000 products at a time", variant: "destructive" }); return; }
      setRows(result.rows);
    } catch (e: any) {
      console.error(e);
      toast({ title: "Could not read the file", description: e?.message || "Is it a valid Excel or CSV file?", variant: "destructive" });
    }
  };

  const runImport = async () => {
    const good = rows.filter((r) => !r.errors.length);
    const toAdd = good.filter((r) => !r.existingId);
    const toUpdate = updateExisting ? good.filter((r) => r.existingId) : [];
    if (!toAdd.length && !toUpdate.length) { toast({ title: "Nothing to import" }); return; }
    setBusy(true);
    let added = 0, updated = 0, failed = 0;
    let withHsn = true;
    const record = (r: ImportRow, isNew: boolean) => {
      const o: Record<string, any> = {
        name: r.name, sku: r.sku, barcode: r.barcode, category: r.category, price: r.price,
        cost_price: r.cost_price, gst_rate: r.gst_rate, min_stock_level: r.min_stock_level, base_unit: r.base_unit,
      };
      if (isNew) Object.assign(o, { stock_quantity: r.stock_quantity, is_active: true, ...newRecordFields });
      if (withHsn && r.hsn_code) o.hsn_code = r.hsn_code;
      return o;
    };
    try {
      for (let i = 0; i < toAdd.length; i += CHUNK) {
        const part = toAdd.slice(i, i + CHUNK);
        setProgress(`Adding ${Math.min(i + CHUNK, toAdd.length)} of ${toAdd.length}...`);
        let { error } = await supabase.from("products").insert(part.map((r) => record(r, true)) as any);
        if (error && withHsn && /hsn_code/.test(error.message || "")) {
          withHsn = false; // database update for HSN not run yet
          ({ error } = await supabase.from("products").insert(part.map((r) => record(r, true)) as any));
        }
        if (error) { failed += part.length; console.error(error); toast({ title: `Lines ${part[0].row}-${part[part.length - 1].row} not added`, description: error.message, variant: "destructive" }); }
        else added += part.length;
      }
      for (let i = 0; i < toUpdate.length; i++) {
        const r = toUpdate[i];
        if (i % 20 === 0) setProgress(`Updating ${i + 1} of ${toUpdate.length}...`);
        let { error } = await supabase.from("products").update(record(r, false) as any).eq("id", r.existingId!);
        if (error && withHsn && /hsn_code/.test(error.message || "")) {
          withHsn = false;
          ({ error } = await supabase.from("products").update(record(r, false) as any).eq("id", r.existingId!));
        }
        if (error) failed++; else updated++;
      }
      toast({
        title: "Import finished",
        description: `${added} added, ${updated} updated${failed ? `, ${failed} failed` : ""}${!withHsn ? ". HSN codes skipped: run the latest database update to save them." : ""}`,
        variant: failed ? "destructive" : "default",
      });
      onDone();
      if (!failed) { reset(); onOpenChange(false); }
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const template = () => downloadCsv("dailykart-products-template.csv", [
    Object.fromEntries(TEMPLATE_HEADERS.map((h, i) => [h, ["Basmati Rice 1kg", "RICE1", "8901234567890", "Grocery", 120, 95, 5, "1006", 50, 10, "pc"][i]])),
  ]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import products from Excel</DialogTitle>
          <DialogDescription>
            First row must be headings. Needed: Name and Price. Optional: SKU, Barcode, Category, Cost price, GST %, HSN, Stock, Min stock, Unit.
            Products with the same barcode or SKU are updated instead of added twice.
          </DialogDescription>
        </DialogHeader>

        {needsStore ? (
          <p className="text-sm text-destructive">Pick a store at the top of the screen first, so the products go to the right store.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
                aria-label="Product file" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
              <Button onClick={() => fileRef.current?.click()} className="gap-2" disabled={busy}><FileUp className="h-4 w-4" /> Choose file</Button>
              <Button variant="outline" onClick={template} className="gap-2"><Download className="h-4 w-4" /> Download template</Button>
              {fileName && <span className="self-center text-sm text-muted-foreground">{fileName}</span>}
            </div>

            {rows.length > 0 && (
              <>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="secondary">{counts.add} new</Badge>
                  <Badge variant="secondary">{counts.update} already in the shop</Badge>
                  {counts.bad > 0 && <Badge variant="destructive">{counts.bad} with problems (skipped)</Badge>}
                </div>
                {counts.update > 0 && (
                  <div className="flex items-center gap-2">
                    <Checkbox id="imp-update" checked={updateExisting} onCheckedChange={(v) => setUpdateExisting(!!v)} />
                    <Label htmlFor="imp-update" className="text-sm font-normal">
                      Update price, cost, GST and details of products already in the shop (stock is not changed; use the Stock page for that)
                    </Label>
                  </div>
                )}
                <div className="max-h-[45vh] overflow-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Line</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">GST</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 500).map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="text-muted-foreground">{r.row}</TableCell>
                          <TableCell>
                            <div className="font-medium">{r.name || "—"}</div>
                            <div className="text-xs text-muted-foreground">{r.sku}{r.barcode ? ` · ${r.barcode}` : ""}</div>
                          </TableCell>
                          <TableCell className="text-right">₹{r.price.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{r.gst_rate}%</TableCell>
                          <TableCell className="text-right">{r.existingId ? "—" : r.stock_quantity}</TableCell>
                          <TableCell className="text-sm">
                            {r.errors.length ? <span className="text-destructive">{r.errors.join("; ")}</span>
                              : r.existingId ? "Update" : "New"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {rows.length > 500 && <p className="p-2 text-xs text-muted-foreground">Showing the first 500 of {rows.length} lines. All will be imported.</p>}
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={runImport} disabled={busy || (counts.add === 0 && (!updateExisting || counts.update === 0))}>
                    {busy ? "Importing..." : `Import ${counts.add + (updateExisting ? counts.update : 0)} products`}
                  </Button>
                  {progress && <span className="text-sm text-muted-foreground">{progress}</span>}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
