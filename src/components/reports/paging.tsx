// Paging controls shared by the report tables. The database returns one page
// at a time; these pick the page and the page size (10, 25, 50 or 100 rows).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { num } from "./shared";

const SIZES = [10, 25, 50, 100];

// eslint-disable-next-line react-refresh/only-export-components
export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Pager({ page, size, total, setPage, setSize }: { page: number; size: number; total: number; setPage: (n: number) => void; setSize: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : page * size + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm">
      <span className="text-muted-foreground">{first}–{Math.min(total, (page + 1) * size)} of {num(total)}</span>
      <div className="flex items-center gap-2">
        <Select value={String(size)} onValueChange={(v) => { setSize(Number(v)); setPage(0); }}>
          <SelectTrigger className="h-8 w-[92px]" aria-label="Rows per page"><SelectValue /></SelectTrigger>
          <SelectContent>{SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s} rows</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
        <span className="tabular-nums">{page + 1}/{pages}</span>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
