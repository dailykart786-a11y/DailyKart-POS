import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Flashlight, FlashlightOff, SwitchCamera, Volume2, VolumeX } from "lucide-react";

/**
 * What the page did with a scanned code:
 * - a text: shown under the camera (for example "Added Maggi · ₹14")
 * - true: it worked, show the code
 * - false: not found (shown in red, error beep)
 */
export type ScanResult = string | boolean | void;

interface BarcodeScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once per scanned code. */
  onDetected: (code: string) => ScanResult;
  /** Close after the first good scan (used to fill one barcode field). */
  single?: boolean;
  /** Short line at the bottom, for example "3 items · ₹245". */
  summary?: string;
  title?: string;
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
const SOUND_KEY = "dailykart-scan-sound";

// Short beep made in the browser, so no sound file is needed
let audio: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    audio ||= new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = ok ? 1800 : 320;
    osc.type = ok ? "sine" : "square";
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.09 : 0.25));
  } catch { /* no sound on this device */ }
}

// Scans barcodes with the phone or laptop camera.
// Uses the phone's built-in barcode reader when there is one (fast on Android);
// otherwise loads a scanning library only when the camera is opened.
export function BarcodeScannerDialog({ open, onOpenChange, onDetected, single, summary, title }: BarcodeScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null); // null = phone has no flash control
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIdx, setCameraIdx] = useState<number>(-1); // -1 = back camera chosen by the phone
  const [sound, setSound] = useState(() => { try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; } });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const singleRef = useRef(single);
  singleRef.current = single;
  const closeRef = useRef(onOpenChange);
  closeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let zxingControls: { stop: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = { code: "", seen: 0 };
    setError(null);
    setStatus(null);
    setTorch(null);

    const handle = (code: string) => {
      const now = Date.now();
      // While the same item stays in front of the camera, count it once.
      // To add one more, take it out of view for a moment and show it again.
      if (code === last.code && now - last.seen < 1200) { last.seen = now; return; }
      last = { code, seen: now };
      let res: ScanResult;
      try { res = onDetectedRef.current(code); } catch { res = false; }
      const ok = res !== false;
      setStatus({ ok, text: typeof res === "string" ? res : ok ? `Scanned ${code}` : `No product with barcode ${code}` });
      if (soundRef.current) beep(ok);
      try { if ((navigator as any).userActivation?.hasBeenActive !== false) navigator.vibrate?.(ok ? 60 : [60, 60, 60]); } catch { /* not supported */ }
      if (ok && singleRef.current) {
        stopped = true;
        setTimeout(() => closeRef.current(false), 250);
      }
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser can't use the camera. Use a USB scanner or type the code.");
        }
        const chosen = cameraIdx >= 0 ? cameras[cameraIdx] : undefined;
        const video: MediaTrackConstraints = chosen
          ? { deviceId: { exact: chosen.deviceId } }
          : { facingMode: { ideal: "environment" } };
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...video, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped || !videoRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        try {
          const caps: any = track.getCapabilities?.() || {};
          if (caps.torch) setTorch(false);
          // Light zoom helps the camera focus on small barcodes
          if (caps.zoom?.max >= 1.5) await track.applyConstraints({ advanced: [{ zoom: Math.min(1.5, caps.zoom.max) } as any] }).catch(() => undefined);
        } catch { /* optional */ }

        // List cameras once permission is given, for the switch button
        navigator.mediaDevices.enumerateDevices()
          .then((d) => { if (!stopped) setCameras(d.filter((x) => x.kind === "videoinput")); })
          .catch(() => undefined);

        const el = videoRef.current;
        el.srcObject = stream;
        await el.play().catch(() => undefined);

        // 1) Built-in barcode reader (Chrome on Android, some desktops)
        const Native = (window as any).BarcodeDetector;
        let native: any = null;
        if (Native) {
          try {
            const supported: string[] = (await Native.getSupportedFormats?.()) || [];
            const use = FORMATS.filter((f) => supported.includes(f));
            if (use.length) native = new Native({ formats: use });
          } catch { native = null; }
        }
        if (native) {
          const loop = async () => {
            if (stopped) return;
            try {
              if (el.readyState >= 2) {
                const found = await native.detect(el);
                if (found?.[0]?.rawValue) handle(String(found[0].rawValue));
              }
            } catch { /* try again on the next frame */ }
            if (!stopped) timer = setTimeout(loop, 120);
          };
          loop();
          return;
        }

        // 2) Scanning library for other phones (iPhone, Firefox)
        const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        if (stopped) return;
        const hints = new Map();
        hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [
          lib.BarcodeFormat.EAN_13, lib.BarcodeFormat.EAN_8, lib.BarcodeFormat.UPC_A, lib.BarcodeFormat.UPC_E,
          lib.BarcodeFormat.CODE_128, lib.BarcodeFormat.CODE_39, lib.BarcodeFormat.ITF, lib.BarcodeFormat.QR_CODE,
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
        zxingControls = await reader.decodeFromStream(stream, el, (result) => {
          if (result && !stopped) handle(result.getText());
        });
        if (stopped) zxingControls.stop();
      } catch (e: any) {
        if (stopped) return;
        const denied = e?.name === "NotAllowedError";
        const busy = e?.name === "NotReadableError";
        setError(
          denied ? "Camera permission was blocked. Allow the camera for this site in your browser settings and try again."
          : busy ? "The camera is being used by another app. Close it and try again."
          : e?.message || "Could not start the camera"
        );
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try { zxingControls?.stop(); } catch { /* ignore */ }
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cameraIdx]);

  const toggleTorch = async () => {
    const t = trackRef.current;
    if (!t || torch === null) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch } as any] });
      setTorch(!torch);
    } catch { setTorch(null); }
  };
  const switchCamera = () => {
    if (cameras.length < 2) return;
    setCameraIdx((i) => (i + 1) % cameras.length);
  };
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title || "Scan barcode"}</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-md bg-black">
              <video ref={videoRef} className="w-full aspect-[4/3] object-cover" muted playsInline autoPlay />
              {/* Aim box */}
              <div className="pointer-events-none absolute inset-x-[10%] top-[30%] bottom-[30%] rounded-md border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              <div className="absolute right-2 top-2 flex flex-col gap-2">
                {torch !== null && (
                  <Button type="button" size="icon" variant="secondary" className="h-10 w-10 rounded-full opacity-90" onClick={toggleTorch} aria-label={torch ? "Flash off" : "Flash on"}>
                    {torch ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
                  </Button>
                )}
                {cameras.length > 1 && (
                  <Button type="button" size="icon" variant="secondary" className="h-10 w-10 rounded-full opacity-90" onClick={switchCamera} aria-label="Switch camera">
                    <SwitchCamera className="h-5 w-5" />
                  </Button>
                )}
                <Button type="button" size="icon" variant="secondary" className="h-10 w-10 rounded-full opacity-90" onClick={toggleSound} aria-label={sound ? "Sound off" : "Sound on"}>
                  {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                </Button>
              </div>
            </div>
            <p className={`min-h-[1.25rem] text-sm text-center font-medium ${status ? (status.ok ? "text-green-700 dark:text-green-400" : "text-destructive") : "text-muted-foreground"}`} aria-live="polite">
              {status ? status.text : "Hold the barcode inside the box. Show it again to add one more."}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-muted-foreground">{summary || ""}</span>
          <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
