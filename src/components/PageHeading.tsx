import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Info, Star } from "lucide-react";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PAGE_HELP } from "@/lib/pageHelp";
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

  if (!item) return null;
  const help = PAGE_HELP[item.url];
  // The dashboard has no breadcrumb, just the (i) button.
  if (item.url === "/") {
    return help ? (
      <div className="mb-2 flex justify-end print:hidden"><PageInfo title={item.title} help={help} /></div>
    ) : null;
  }
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
      <div className="flex items-center gap-1 shrink-0">
      {help && <PageInfo title={item.title} help={help} />}
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
    </div>
  );
}

/** The (i) button: what this module is for, in a line or two. Tap or click to open. */
function PageInfo({ title, help }: { title: string; help: { about: string; uses: string[] } }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" aria-label={`About ${title}`}>
          <Info className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">About</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
        <p className="font-semibold mb-1">{title}</p>
        <p className="text-muted-foreground">{help.about}</p>
        {help.uses.length > 0 && (
          <>
            <p className="mt-3 mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Use it to</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {help.uses.map((u) => <li key={u}>{u}</li>)}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
