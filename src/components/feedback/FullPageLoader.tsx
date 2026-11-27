/** Shown only while the app first starts (checking sign-in). */
export function FullPageLoader({ label = "Loading DailyKart" }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-secondary/30" role="status" aria-label={label}>
      <img src="/lovable-uploads/8339ecb2-3c19-468f-b433-6b7bcb690cf2.png" alt="" className="h-12 w-12 animate-pulse" />
      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 rounded-full bg-primary animate-[dk-progress_1.2s_ease-in-out_infinite]" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Thin bar at the top of the content area while a page loads. */
export function TopProgressBar() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-0.5 overflow-hidden bg-transparent" role="progressbar" aria-label="Loading page">
      <div className="h-full w-1/3 bg-primary animate-[dk-progress_1.2s_ease-in-out_infinite]" />
    </div>
  );
}
