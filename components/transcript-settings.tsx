"use client";

import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettings, TranscriptDisplayMode } from "@/contexts/settings-context";
import { useTranslations } from "next-intl";

export function TranscriptSettings() {
  const t = useTranslations('transcript');
  const { transcriptDisplayMode, setTranscriptDisplayMode, autoTranslate, setAutoTranslate } = useSettings();

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('settings')}</p>
        </TooltipContent>
      </Tooltip>
      
      <Select 
        value={transcriptDisplayMode} 
        onValueChange={(value) => setTranscriptDisplayMode(value as TranscriptDisplayMode)}
      >
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="original">{t('displayMode.original')}</SelectItem>
          <SelectItem value="sideBySide">{t('displayMode.sideBySide')}</SelectItem>
          <SelectItem value="overlay">{t('displayMode.overlay')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}