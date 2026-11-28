import { ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { KpiDef } from "./kpis";

interface Props {
  cards: KpiDef[];          // in the current order, only those this role can see
  hidden: string[];
  onChange: (order: string[], hidden: string[]) => void;
  onReset: () => void;
  /** Overview panels that can be switched on and off. */
  sections?: { id: string; label: string }[];
  hiddenSections?: string[];
  onSectionsChange?: (hidden: string[]) => void;
}

/** Show, hide and reorder the number cards. Saved on this device for this user. */
export function CustomizeDialog({ cards, hidden, onChange, onReset, sections = [], hiddenSections = [], onSectionsChange }: Props) {
  const ids = cards.map((c) => c.id);
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next, hidden);
  };
  const toggle = (id: string) => onChange(ids, hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" /> <span className="hidden sm:inline">Customise</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Customise dashboard</DialogTitle>
          <DialogDescription>Choose the panels and number cards to show, and use the arrows to order the cards. Saved on this device.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
        {sections.length > 0 && onSectionsChange && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Panels</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 border rounded-md p-2">
              {sections.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-1">
                  <Checkbox id={`section-${s.id}`} checked={!hiddenSections.includes(s.id)}
                    onCheckedChange={() => onSectionsChange(hiddenSections.includes(s.id) ? hiddenSections.filter((h) => h !== s.id) : [...hiddenSections, s.id])} />
                  <label htmlFor={`section-${s.id}`} className="text-sm cursor-pointer">{s.label}</label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
        <p className="mb-1.5 text-sm font-medium">Number cards</p>
        <ul className="divide-y border rounded-md">
          {cards.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <Checkbox id={`kpi-${c.id}`} checked={!hidden.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
              <label htmlFor={`kpi-${c.id}`} className="flex-1 text-sm cursor-pointer">{c.label}</label>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.label} up`}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === cards.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${c.label} down`}>
                <ArrowDown className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="gap-2" onClick={onReset}>
            <RotateCcw className="h-4 w-4" /> Reset to default
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
