import { useNavigate } from "react-router-dom";
import { ArrowLeft, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorInfo } from "./errorCodes";

interface ErrorStateProps {
  code?: number;
  title?: string;
  description?: string;
  /** Shown as a retry button when given. */
  onRetry?: () => void;
  /** Full screen (outside the app frame) or inside a page. */
  fullScreen?: boolean;
  /** Hide "Go back" / "Dashboard" (e.g. inside a small card). */
  compact?: boolean;
  className?: string;
}

/** Friendly error with a way out. Used by error pages, crash screens and failed loads. */
export function ErrorState({ code, title, description, onRetry, fullScreen, compact, className }: ErrorStateProps) {
  const navigate = useNavigate();
  const info = errorInfo(code ?? 500);
  const Icon = info.icon;
  // A custom message replaces the stock code and tips, which may not fit it
  const custom = title !== undefined;
  const retry = onRetry ?? (info.retry ? () => window.location.reload() : undefined);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center px-4",
        fullScreen ? "min-h-screen bg-secondary/30" : compact ? "py-8" : "py-16",
        className,
      )}
    >
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" aria-hidden />
      </div>
      {code && !compact && !custom && <p className="text-sm font-semibold tracking-wider text-muted-foreground mb-1">ERROR {code}</p>}
      <h2 className="text-xl font-semibold mb-2">{title ?? info.title}</h2>
      <p className="text-muted-foreground max-w-md">{description ?? info.description}</p>
      {!compact && !custom && info.tips.length > 0 && (
        <ul className="mt-4 text-sm text-muted-foreground space-y-1 max-w-md">
          {info.tips.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap justify-center gap-2 mt-6">
        {retry && (
          <Button onClick={retry} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        )}
        {!compact && (
          <>
            <Button variant="outline" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Go back
            </Button>
            <Button variant={retry ? "ghost" : "default"} onClick={() => navigate(code === 401 ? "/auth" : "/")} className="gap-2">
              <Home className="h-4 w-4" /> {code === 401 ? "Sign in" : "Dashboard"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
