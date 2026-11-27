import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface BarcodeScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once per scanned code. The dialog stays open for the next item. */
  onDetected: (code: string) => void;
}

// Scans barcodes with the phone or laptop camera.
// The scanning library is loaded only when the camera is opened.
export function BarcodeScannerDialog({ open, onOpenChange, onDetected }: BarcodeScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    let last = { code: "", at: 0 };
    setError(null);
    setLastCode(null);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser can't use the camera. Use a USB scanner or type the code.");
        }
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (stopped || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            if (!result) return;
            const code = result.getText();
            const now = Date.now();
            // Ignore the same code seen again within 2 seconds
            if (code === last.code && now - last.at < 2000) return;
            last = { code, at: now };
            setLastCode(code);
            try { navigator.vibrate?.(80); } catch { /* not supported */ }
            onDetectedRef.current(code);
          }
        );
        if (stopped) controls.stop();
      } catch (e: any) {
        const denied = e?.name === "NotAllowedError";
        setError(denied ? "Camera permission was blocked. Allow the camera for this site and try again." : e?.message || "Could not start the camera");
      }
    })();

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan barcode</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-2">
            <video ref={videoRef} className="w-full rounded-md bg-black aspect-video object-cover" muted playsInline />
            <p className="text-sm text-muted-foreground text-center">
              {lastCode ? `Added ${lastCode}. Scan the next item or close.` : "Point the camera at the barcode"}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
