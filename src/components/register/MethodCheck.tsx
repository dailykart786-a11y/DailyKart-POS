import { Badge } from "@/components/ui/badge";
import { rupees } from "@/lib/cashCount";

export interface MethodRow {
  key: string;
  label: string;
  expected: number;
  /** null = not checked */
  counted: number | null;
}

export function DiffBadge({ d }: { d: number | null }) {
  if (d === null || Number.isNaN(d)) return <Badge variant="outline" className="text-muted-foreground">Not checked</Badge>;
  if (Math.abs(d) < 0.01) return <Badge variant="secondary">Matches</Badge>;
  return d < 0 ? <Badge variant="destructive">Short {rupees(-d)}</Badge> : <Badge variant="outline">Extra {rupees(d)}</Badge>;
}

/** Expected (from bills) vs counted, one row per payment method. */
export function MethodCheck({ rows }: { rows: MethodRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Method</th>
            <th className="px-3 py-2 text-right font-medium">Expected</th>
            <th className="px-3 py-2 text-right font-medium">Counted</th>
            <th className="px-3 py-2 text-left font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="px-3 py-2">{r.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(r.expected)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.counted === null ? "—" : rupees(r.counted)}</td>
              <td className="px-3 py-2"><DiffBadge d={r.counted === null ? null : r.counted - r.expected} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
