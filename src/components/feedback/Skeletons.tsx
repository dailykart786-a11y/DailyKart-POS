import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Grey placeholder rows shaped like a table. */
export function TableSkeleton({ rows = 6, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn("w-full space-y-2", className)} aria-busy="true" aria-label="Loading">
      <div className="flex gap-3 pb-2 border-b">
        {Array.from({ length: columns }).map((_, i) => <Skeleton key={i} className="h-4 flex-1" />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 py-2">
          {Array.from({ length: columns }).map((_, c) => <Skeleton key={c} className={cn("h-4 flex-1", c === 0 && "flex-[2]")} />)}
        </div>
      ))}
    </div>
  );
}

/** Placeholder number cards (KPI tiles). */
export function CardGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
          <CardContent className="space-y-2"><Skeleton className="h-7 w-32" /><Skeleton className="h-3 w-20" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Placeholder for a chart area. */
export function ChartSkeleton({ height = 260, className }: { height?: number; className?: string }) {
  return (
    <div className={cn("flex items-end gap-2 w-full", className)} style={{ height }} aria-busy="true" aria-label="Loading chart">
      {[40, 65, 50, 80, 55, 90, 70, 60, 75, 45].map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-t-md rounded-b-none" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

/** Whole-page placeholder while a page's code loads. */
export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <CardGridSkeleton />
      <Card><CardContent className="pt-6"><TableSkeleton /></CardContent></Card>
    </div>
  );
}
