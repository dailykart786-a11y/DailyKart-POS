import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "@/components/feedback/ErrorState";
import { isChunkLoadError, logError } from "@/lib/errorLog";

interface Props {
  children: ReactNode;
  /** Changing this clears the error (e.g. the page address). */
  resetKey?: string;
  fullScreen?: boolean;
}

interface State {
  error: unknown;
}

const RELOAD_FLAG = "dailykart-chunk-reload";

/**
 * Stops one broken screen from blanking the whole app. Shows a friendly
 * message with "Try again" instead, and logs the real error.
 * If a page's code can't be downloaded because a new version went live,
 * it reloads once to pick up the new version.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    logError("Screen crashed", `${error instanceof Error ? error.message : String(error)}\n${info.componentStack || ""}`);
    if (isChunkLoadError(error) && navigator.onLine !== false) {
      let reloaded = false;
      try { reloaded = sessionStorage.getItem(RELOAD_FLAG) === window.location.pathname; } catch { /* ignore */ }
      if (!reloaded) {
        try { sessionStorage.setItem(RELOAD_FLAG, window.location.pathname); } catch { /* ignore */ }
        window.location.reload();
      }
    }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isChunkLoadError(error)) {
      const offline = navigator.onLine === false;
      return (
        <ErrorState
          code={offline ? 503 : 500}
          fullScreen={this.props.fullScreen}
          title={offline ? "This page isn't saved for offline use yet" : "A new version of DailyKart is ready"}
          description={offline
            ? "Open it once with internet and it will work offline next time. Billing still works offline."
            : "Reload to get the latest version."}
          onRetry={() => window.location.reload()}
        />
      );
    }
    return (
      <ErrorState
        code={500}
        fullScreen={this.props.fullScreen}
        title="This screen ran into a problem"
        description="Bills and payments that were already saved are safe. Try again, or go back to the dashboard."
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}
