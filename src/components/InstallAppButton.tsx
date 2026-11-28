import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Share, PlusSquare } from "lucide-react";
import { canPrompt, isInstalled, isIos, onInstallChange, promptInstall } from "@/lib/installApp";
import { toast } from "@/hooks/use-toast";

/** "Install app" button for the header. Hidden when the app is already installed or the browser can't install it. */
export function InstallAppButton() {
  const [, setTick] = useState(0);
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => onInstallChange(() => setTick((t) => t + 1)), []);

  if (isInstalled()) return null;
  const ios = isIos();
  if (!canPrompt() && !ios) return null;

  const click = async () => {
    if (ios && !canPrompt()) { setIosHelp(true); return; }
    const ok = await promptInstall();
    if (ok) toast({ title: "DailyKart is installed", description: "Open it from your home screen." });
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1" onClick={click} aria-label="Install app">
        <Download className="h-4 w-4" />
        <span className="hidden md:inline">Install app</span>
      </Button>
      <Dialog open={iosHelp} onOpenChange={setIosHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add DailyKart to your home screen</DialogTitle>
            <DialogDescription>On iPhone and iPad this is done from Safari.</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex items-center gap-2"><span className="font-semibold">1.</span> Tap <Share className="h-4 w-4 inline" /> <b>Share</b> at the bottom of Safari.</li>
            <li className="flex items-center gap-2"><span className="font-semibold">2.</span> Tap <PlusSquare className="h-4 w-4 inline" /> <b>Add to Home Screen</b>.</li>
            <li className="flex items-center gap-2"><span className="font-semibold">3.</span> Tap <b>Add</b>. Open DailyKart from its new icon.</li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
