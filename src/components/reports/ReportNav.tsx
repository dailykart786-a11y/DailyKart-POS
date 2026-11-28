// The report picker: a searchable list grouped by category. A sidebar on wide
// screens; on phones the page shows it in a slide-over sheet.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CATEGORIES } from "@/lib/reports/catalog";
import { cn } from "@/lib/utils";

export function ReportNav({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return CATEGORIES;
    return CATEGORIES.map((c) => ({
      ...c,
      reports: c.reports.filter((r) => `${c.title} ${r.title} ${r.about}`.toLowerCase().includes(s)),
    })).filter((c) => c.reports.length > 0);
  }, [q]);

  return (
    <nav aria-label="Reports" className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report" className="pl-8" aria-label="Find a report" />
      </div>
      {groups.length === 0 && <p className="text-sm text-muted-foreground px-1">No report matches “{q}”.</p>}
      {groups.map((c) => (
        <div key={c.id}>
          <div className="flex items-center gap-2 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <c.icon className="h-3.5 w-3.5" aria-hidden /> {c.title}
          </div>
          <ul className="space-y-0.5">
            {c.reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r.id)}
                  title={r.about}
                  aria-current={current === r.id ? "page" : undefined}
                  className={cn(
                    "w-full text-left rounded-md px-2 py-1.5 text-sm flex items-center justify-between gap-2 transition-colors",
                    current === r.id ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    r.phase && current !== r.id && "text-muted-foreground",
                  )}
                >
                  <span className="truncate">{r.title}</span>
                  {r.phase && <span className={cn("text-[10px] rounded px-1 py-0.5 shrink-0", current === r.id ? "bg-primary-foreground/20" : "bg-muted")}>Soon</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
