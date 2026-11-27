import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Star } from "lucide-react";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { findNavGroup, findNavItem } from "@/lib/nav";
import { useNavPrefs } from "@/hooks/useNavPrefs";
import { cn } from "@/lib/utils";

/**
 * Breadcrumbs and a favourite star at the top of every inner page, worked
 * out from the address so no page has to add it. Pages keep their own titles.
 */
export function PageHeading() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  const group = item ? findNavGroup(item) : undefined;
  const { favourites, toggleFavourite } = useNavPrefs();

  useEffect(() => {
    document.title = item && item.url !== "/" ? `${item.title} · DailyKart POS` : "DailyKart POS";
  }, [item]);

  if (!item || item.url === "/") return null;
  const fav = favourites.includes(item.url);

  return (
    <div className="mb-3 md:mb-4 flex items-center justify-between gap-2 print:hidden" title={item.description}>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild><Link to="/">Dashboard</Link></BreadcrumbLink>
          </BreadcrumbItem>
          {group && group.id !== "home" && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem><span>{group.label}</span></BreadcrumbItem>
            </>
          )}
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{item.title}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground shrink-0"
        onClick={() => toggleFavourite(item.url)}
        aria-label={fav ? "Remove from favourites" : "Add to favourites"}
      >
        <Star className={cn("h-3.5 w-3.5", fav && "fill-warning text-warning")} />
        <span className="hidden sm:inline">{fav ? "Favourite" : "Add to favourites"}</span>
      </Button>
    </div>
  );
}
