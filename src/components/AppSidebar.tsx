import { useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, Clock, Star } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useNavPrefs } from "@/hooks/useNavPrefs";
import { NAV_GROUPS, NAV_ITEMS, findNavItem, type NavItem } from "@/lib/nav";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const collapsed = state === "collapsed" && !isMobile;
  const { hasPermission, loading, role } = useUserRole();
  const { favourites, recent, closedGroups, toggleFavourite, toggleGroup, addRecent } = useNavPrefs();

  const allowed = (i: NavItem) => (!i.permission || hasPermission(i.permission)) && (!i.roles || i.roles.includes(role));
  const current = findNavItem(pathname);

  // Remember pages the person actually opened (only ones they can see)
  useEffect(() => {
    if (current && !loading && allowed(current)) addRecent(current.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.url, loading]);

  const byUrl = useMemo(() => new Map(NAV_ITEMS.map((i) => [i.url, i])), []);
  const favItems = favourites.map((u) => byUrl.get(u)).filter((i): i is NavItem => !!i && allowed(i));
  const recentItems = recent
    .filter((u) => u !== pathname)
    .map((u) => byUrl.get(u))
    .filter((i): i is NavItem => !!i && allowed(i))
    .slice(0, 4);

  const isActive = (url: string) => current?.url === url;
  const onNavigate = () => { if (isMobile) setOpenMobile(false); };

  const renderItem = (item: NavItem, keyPrefix: string, showStar = true) => {
    const fav = favourites.includes(item.url);
    return (
      <SidebarMenuItem key={`${keyPrefix}-${item.url}`}>
        <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}
          className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-medium">
          <Link to={item.url} onClick={onNavigate} aria-current={isActive(item.url) ? "page" : undefined}>
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
        {showStar && !collapsed && (
          <SidebarMenuAction
            showOnHover={!fav}
            onClick={() => toggleFavourite(item.url)}
            aria-label={fav ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`}
            title={fav ? "Remove from favourites" : "Add to favourites"}
          >
            <Star className={cn("h-3.5 w-3.5", fav && "fill-warning text-warning")} />
          </SidebarMenuAction>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b h-16 justify-center">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2 px-1" aria-label="DailyKart home">
          <img src="/lovable-uploads/8339ecb2-3c19-468f-b433-6b7bcb690cf2.png" alt="" className="h-7 w-7 shrink-0" />
          {!collapsed && (
            <span className="font-bold text-primary dark:text-foreground truncate">DailyKart POS</span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {!collapsed && favItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="gap-1"><Star className="h-3 w-3" /> Favourites</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{favItems.map((i) => renderItem(i, "fav"))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {!collapsed && recentItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="gap-1"><Clock className="h-3 w-3" /> Recent</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{recentItems.map((i) => renderItem(i, "recent", false))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {!collapsed && (favItems.length > 0 || recentItems.length > 0) && <SidebarSeparator />}

        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(allowed);
          if (items.length === 0) return null;
          // Collapsed rail: just icons, no folding
          if (collapsed || group.id === "home") {
            return (
              <SidebarGroup key={group.id} className="py-1">
                <SidebarGroupContent>
                  <SidebarMenu>{items.map((i) => renderItem(i, group.id))}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          }
          const hasActive = items.some((i) => isActive(i.url));
          const open = hasActive || !closedGroups.includes(group.id);
          return (
            <Collapsible key={group.id} open={open} onOpenChange={() => !hasActive && toggleGroup(group.id)} asChild>
              <SidebarGroup className="py-1">
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="w-full justify-between hover:bg-sidebar-accent">
                    {group.label}
                    <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>{items.map((i) => renderItem(i, group.id))}</SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
