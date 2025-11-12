"use client";

import { Download, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TranscriptExportFormat } from "@/lib/transcript-export";

interface TranscriptExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: TranscriptExportFormat;
  onFormatChange: (format: TranscriptExportFormat) => void;
  includeSpeakers: boolean;
  onIncludeSpeakersChange: (value: boolean) => void;
  includeTimestamps: boolean;
  onIncludeTimestampsChange: (value: boolean) => void;
  disableTimestampToggle?: boolean;
  onConfirm: () => void;
  isExporting: boolean;
  error?: string | null;
  disableDownloadMessage?: string | null;
  hasSpeakerData?: boolean;
  willConsumeTopup?: boolean;
  videoTitle?: string;
}

const formatOptions: Array<{
  value: TranscriptExportFormat;
  title: string;
  description: string;
}> = [
  {
    value: "txt",
    title: "Full transcript (.txt)",
    description: "Plain text with timestamps for easy reading and note apps.",
  },
  {
    value: "srt",
    title: "Timecoded captions (.srt)",
    description: "Standard caption format for video players and editors.",
  },
  {
    value: "csv",
    title: "Segmented spreadsheet (.csv)",
    description: "Structured rows for filtering by timestamp or topic.",
  },
];

export function TranscriptExportDialog({
  open,
  onOpenChange,
  format,
  onFormatChange,
  includeSpeakers,
  onIncludeSpeakersChange,
  includeTimestamps,
  onIncludeTimestampsChange,
  disableTimestampToggle = false,
  onConfirm,
  isExporting,
  error,
  disableDownloadMessage,
  hasSpeakerData = false,
  willConsumeTopup = false,
  videoTitle,
}: TranscriptExportDialogProps) {
  const title = videoTitle ? `Export ${videoTitle}` : "Export transcript";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription className="pt-1 text-sm text-muted-foreground">
            Choose a format that fits your workflow. We’ll prep the file instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <RadioGroup value={format} onValueChange={(value) => onFormatChange(value as TranscriptExportFormat)} className="space-y-3">
            {formatOptions.map((option) => (
              <div
                key={option.value}
                className="flex items-start gap-3 rounded-2xl border border-muted bg-card/60 p-4 transition hover:border-muted-foreground/20"
              >
                <RadioGroupItem id={`export-format-${option.value}`} value={option.value} className="mt-1" />
                <Label htmlFor={`export-format-${option.value}`} className="grow cursor-pointer">
                  <div className="text-sm font-semibold text-foreground">{option.title}</div>
                  <p className="text-xs text-muted-foreground pt-1">{option.description}</p>
                </Label>
              </div>
            ))}
          </RadioGroup>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-dashed border-muted/70 bg-muted/40 px-4 py-3">
              <div className="space-y-1 pr-3">
                <p className="text-sm font-medium">Include timestamps</p>
                <p className="text-xs text-muted-foreground">
                  Adds start and end markers so you can jump back to each moment.
                  {disableTimestampToggle && " Required for caption exports."}
                </p>
              </div>
              <Switch
                checked={includeTimestamps}
                onCheckedChange={onIncludeTimestampsChange}
                disabled={disableTimestampToggle}
                aria-label="Include timestamps"
              />
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-dashed border-muted/70 bg-muted/40 px-4 py-3">
              <div className="space-y-1 pr-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Include speaker labels</p>
                  {!hasSpeakerData && <Badge variant="outline">Unavailable</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Prefaces each line with the detected speaker. Disabled when captions lack labels.
                </p>
              </div>
              <Switch
                checked={includeSpeakers && hasSpeakerData}
                onCheckedChange={onIncludeSpeakersChange}
                disabled={!hasSpeakerData}
                aria-label="Include speaker labels"
              />
            </div>
          </div>

          {willConsumeTopup && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <Sparkles className="mt-0.5 h-4 w-4" />
              <p>
                This export will use one of your Pro top-up credits. You can grab more anytime in{" "}
                <span className="font-medium">Settings → Billing</span>.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
          {disableDownloadMessage && (
            <p className="text-xs text-muted-foreground sm:max-w-[60%]">{disableDownloadMessage}</p>
          )}
          <Button
            className="w-full sm:w-auto"
            onClick={onConfirm}
            disabled={Boolean(disableDownloadMessage) || isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing export…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

