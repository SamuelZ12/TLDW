"use client";

import { Download, Loader2, Sparkles, Check, ChevronDown } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TranscriptExportFormat, TranscriptExportMode } from "@/lib/transcript-export";
import { SUPPORTED_LANGUAGES } from "@/lib/language-utils";

interface TranscriptExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: TranscriptExportFormat;
  onFormatChange: (format: TranscriptExportFormat) => void;
  exportMode: TranscriptExportMode;
  onExportModeChange: (mode: TranscriptExportMode) => void;
  targetLanguage: string;
  onTargetLanguageChange: (language: string) => void;
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

const modeOptions: Array<{
  value: TranscriptExportMode;
  title: string;
  description: string;
}> = [
  {
    value: "original",
    title: "Original",
    description: "Export the transcript in its original language.",
  },
  {
    value: "translated",
    title: "Translated",
    description: "Export only the translated text.",
  },
  {
    value: "bilingual",
    title: "Bilingual",
    description: "Export both original and translated text together.",
  },
];

export function TranscriptExportDialog({
  open,
  onOpenChange,
  format,
  onFormatChange,
  exportMode,
  onExportModeChange,
  targetLanguage,
  onTargetLanguageChange,
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
          {/* Format Selection */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Format
            </h4>
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
          </div>

          <Separator />

          {/* Content Selection */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium leading-none">Content Language</h4>
            <RadioGroup value={exportMode} onValueChange={(value) => onExportModeChange(value as TranscriptExportMode)} className="grid grid-cols-3 gap-2">
              {modeOptions.map((option) => (
                <Label
                  key={option.value}
                  htmlFor={`export-mode-${option.value}`}
                  className={`flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-transparent p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer ${exportMode === option.value ? 'border-primary bg-primary/5' : ''}`}
                >
                  <RadioGroupItem
                    value={option.value}
                    id={`export-mode-${option.value}`}
                    className="sr-only"
                  />
                  <span className="text-sm font-semibold">{option.title}</span>
                  <span className="text-[10px] text-muted-foreground text-center mt-1 leading-tight">{option.description}</span>
                </Label>
              ))}
            </RadioGroup>

            {exportMode !== 'original' && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200 pt-1">
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Target Language
                </Label>
                <Select value={targetLanguage} onValueChange={onTargetLanguageChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.filter(l => l.code !== 'en').map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name} ({lang.nativeName})
                      </SelectItem>
                    ))}
                    {/* Fallback if target is English (though usually original is English) */}
                     <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Separator />

          {/* Settings */}
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
                {exportMode !== 'original' ? 'Translating & exporting...' : 'Preparing export…'}
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
