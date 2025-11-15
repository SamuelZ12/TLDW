"use client";

import { ArrowRight, Crown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface TranscriptExportUpsellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpgradeClick: () => void;
  onDismiss?: () => void;
}

const PERKS = [
  "Unlimited transcript exports",
  "100 AI video analyses every month",
  "Highlight reels, saved notes, and top-up credits",
];

export function TranscriptExportUpsell({
  open,
  onOpenChange,
  onUpgradeClick,
  onDismiss,
}: TranscriptExportUpsellProps) {
  return (
    <Dialog open={open} onOpenChange={(value) => {
      onOpenChange(value);
      if (!value) {
        onDismiss?.();
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-1.5">
          <Badge className="w-fit gap-1 bg-amber-500/15 text-amber-700">
            <Crown className="h-3.5 w-3.5" />
            Pro perk
          </Badge>
          <DialogTitle className="text-xl font-semibold">
            Transcript exports are a Pro perk
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Upgrade to unlock downloading transcripts, boost your analysis limits, and get more done in less time.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-muted bg-muted/50 p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            What&apos;s included with Pro
          </p>
          <Separator className="my-3" />
          <ul className="space-y-2 text-sm text-foreground">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
          <Button className="w-full sm:w-auto" onClick={onUpgradeClick}>
            Upgrade to Pro
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

