"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowUp, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { TranslationRequestHandler } from "@/lib/types";

interface ThemeSelectorProps {
  themes: string[];
  selectedTheme: string | null;
  onSelect: (theme: string | null) => void;
  isLoading?: boolean;
  error?: string | null;
  selectedLanguage?: string | null;
  onRequestTranslation?: TranslationRequestHandler;
}

export function ThemeSelector({
  themes,
  selectedTheme,
  onSelect,
  isLoading = false,
  error = null,
  selectedLanguage = null,
  onRequestTranslation,
}: ThemeSelectorProps) {
  const [customThemes, setCustomThemes] = useState<string[]>([]);
  const baseThemes = useMemo(() => themes.slice(0, 3), [themes]);
  const displayThemes = useMemo(() => {
    const additionalThemes = customThemes.filter((theme) => !baseThemes.includes(theme));
    const result = [...baseThemes, ...additionalThemes];
    console.log('[ThemeSelector] displayThemes computed:', result);
    return result;
  }, [baseThemes, customThemes]);
  const hasThemes = displayThemes.length > 0;
  const isOverallSelected = selectedTheme === null;
  const [customThemeInput, setCustomThemeInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [loadingTranslations, setLoadingTranslations] = useState<Set<string>>(new Set());
  const [translatedThemes, setTranslatedThemes] = useState<Map<string, string>>(new Map());
  const [yourTopicLabel, setYourTopicLabel] = useState("Your Topic");
  const [overallHighlightsLabel, setOverallHighlightsLabel] = useState("Overall highlights");

  const trimmedValue = customThemeInput.trim();
  const isSubmitDisabled = trimmedValue.length === 0 || isLoading;

  const isCustomThemeSelected = useMemo(() => {
    return selectedTheme !== null && customThemes.includes(selectedTheme);
  }, [customThemes, selectedTheme]);

  useEffect(() => {
    if (selectedTheme && !baseThemes.includes(selectedTheme)) {
      setCustomThemes((prev) => {
        if (prev.includes(selectedTheme)) {
          return prev;
        }
        return [...prev, selectedTheme];
      });
    }
  }, [baseThemes, selectedTheme]);

  useEffect(() => {
    setLoadingTranslations(new Set());
    setTranslatedThemes(new Map());

    setYourTopicLabel("Your Topic");
    setOverallHighlightsLabel("Overall highlights");
  }, [selectedLanguage]);

  // Translate static labels
  useEffect(() => {
    const translationEnabled = selectedLanguage !== null;
    if (!translationEnabled || !onRequestTranslation) {
      console.log('[ThemeSelector] Static labels: translation disabled or no handler');
      return;
    }

    console.log('[ThemeSelector] Requesting static label translations for language:', selectedLanguage);

    // Translate "Your Topic"
    onRequestTranslation("Your Topic", `ui_label:your_topic:${selectedLanguage}`, 'topic')
      .then(translation => {
        console.log('[ThemeSelector] "Your Topic" translated to:', translation);
        setYourTopicLabel(translation);
      })
      .catch((error) => {
        console.error('[ThemeSelector] Failed to translate "Your Topic":', error);
        setYourTopicLabel("Your Topic");
      });

    // Translate "Overall highlights"
    onRequestTranslation("Overall highlights", `ui_label:overall_highlights:${selectedLanguage}`, 'topic')
      .then(translation => {
        console.log('[ThemeSelector] "Overall highlights" translated to:', translation);
        setOverallHighlightsLabel(translation);
      })
      .catch((error) => {
        console.error('[ThemeSelector] Failed to translate "Overall highlights":', error);
        setOverallHighlightsLabel("Overall highlights");
      });
  }, [selectedLanguage, onRequestTranslation]);

  // Request translation for a theme (TranslationBatcher handles caching)
  const requestTranslation = async (theme: string) => {
    const translationEnabled = selectedLanguage !== null;

    if (!onRequestTranslation || !translationEnabled) {
      return;
    }

    if (loadingTranslations.has(theme)) {
      return;
    }

    setLoadingTranslations((prev) => new Set(prev).add(theme));

    try {
      const cacheKey = `theme:${theme}:${selectedLanguage}`;
      const translation = await onRequestTranslation(theme, cacheKey, 'topic');
      setTranslatedThemes((prev) => new Map(prev).set(theme, translation));
    } catch (error) {
      console.error(`[ThemeSelector] Translation failed for theme "${theme}":`, error);
    } finally {
      setLoadingTranslations((prev) => {
        const newSet = new Set(prev);
        newSet.delete(theme);
        return newSet;
      });
    }
  };

  // Get display text for a theme (translated or original)
  const getThemeDisplayText = (theme: string): string => {
    const translationEnabled = selectedLanguage !== null;
    if (!translationEnabled) {
      return theme;
    }

    const isLoading = loadingTranslations.has(theme);
    if (isLoading) {
      return "Translating...";
    }

    const translation = translatedThemes.get(theme);
    const result = translation || theme;

    return result;
  };

  // Request translations for visible themes
  useEffect(() => {
    const translationEnabled = selectedLanguage !== null;

    if (translationEnabled && onRequestTranslation) {
      displayThemes.forEach((theme) => {
        requestTranslation(theme);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayThemes, selectedLanguage, onRequestTranslation]);

  const buttonClasses = (isActive: boolean, forceInactive = false) =>
    cn(
      "rounded-full px-3 py-1 text-sm transition-colors",
      isActive && !forceInactive
        ? "bg-primary text-primary-foreground shadow-sm"
        : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
    );

  const openCustomInput = () => {
    if (isLoading) return;
    setShowCustomInput(true);
    setValidationError(null);
    if (isCustomThemeSelected && selectedTheme) {
      setCustomThemeInput(selectedTheme);
    } else {
      setCustomThemeInput("");
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  const closeCustomInput = () => {
    setShowCustomInput(false);
    setCustomThemeInput("");
    setValidationError(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    if (!trimmedValue) {
      setValidationError("Enter a theme to focus on.");
      return;
    }

    if (trimmedValue.length > 60) {
      setValidationError("Keep themes under 60 characters.");
      return;
    }

    setCustomThemes((prev) => {
      if (baseThemes.includes(trimmedValue) || prev.includes(trimmedValue)) {
        return prev;
      }
      return [...prev, trimmedValue];
    });
    setShowCustomInput(false);
    setCustomThemeInput("");
    setValidationError(null);
    onSelect(trimmedValue);
  };

  // Check if scroll is needed
  const checkScrollNeeded = () => {
    if (scrollContainerRef.current) {
      const { scrollWidth, clientWidth, scrollLeft } = scrollContainerRef.current;
      const canScrollLeft = scrollLeft > 0;
      const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1; // -1 for rounding

      setShowLeftScroll(canScrollLeft);
      setShowRightScroll(canScrollRight);
    }
  };

  // Scroll handlers
  const handleScrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({
        left: -200,
        behavior: "smooth",
      });
      // Recheck after scroll completes
      setTimeout(checkScrollNeeded, 300);
    }
  };

  const handleScrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({
        left: 200,
        behavior: "smooth",
      });
      // Recheck after scroll completes
      setTimeout(checkScrollNeeded, 300);
    }
  };

  // Check scroll on mount and when themes change
  useEffect(() => {
    checkScrollNeeded();
    window.addEventListener("resize", checkScrollNeeded);

    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", checkScrollNeeded);
    }

    return () => {
      window.removeEventListener("resize", checkScrollNeeded);
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", checkScrollNeeded);
      }
    };
  }, [displayThemes, isCustomThemeSelected, selectedTheme, showCustomInput]);

  return (
    <div className="flex w-full flex-col items-stretch gap-3">
      <div className="relative flex items-center gap-2 pe-[72px]">
        {/* Your Topic button - invisible when custom input is shown */}
        <Button
          type="button"
          size="sm"
          className={cn(
            buttonClasses(showCustomInput || isCustomThemeSelected),
            "flex items-center gap-1.5 transition-all duration-200 flex-shrink-0",
            showCustomInput && "opacity-0 pointer-events-none"
          )}
          onClick={openCustomInput}
          disabled={isLoading}
        >
          <Plus className="h-3.5 w-3.5" />
          {yourTopicLabel}
        </Button>

        {/* Scrollable container for theme buttons - always rendered */}
        <div
          ref={scrollContainerRef}
          className={cn(
            "flex items-center gap-2 overflow-x-auto overflow-y-visible scrollbar-hide flex-1 transition-all duration-200 bg-transparent py-6 my-[-24px]",
            showCustomInput && "blur-[2px] opacity-50 pointer-events-none"
          )}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <Button
            type="button"
            size="sm"
            className={cn(buttonClasses(isOverallSelected, showCustomInput), "transition-all duration-200 flex-shrink-0")}
            onClick={() => onSelect(null)}
            tabIndex={showCustomInput ? -1 : 0}
          >
            {overallHighlightsLabel}
          </Button>
          {hasThemes && displayThemes.map((theme) => (
            <Button
              key={theme}
              type="button"
              size="sm"
              className={cn(buttonClasses(selectedTheme === theme, showCustomInput), "transition-all duration-200 flex-shrink-0")}
              onClick={() => onSelect(selectedTheme === theme ? null : theme)}
              tabIndex={showCustomInput ? -1 : 0}
            >
              {getThemeDisplayText(theme)}
            </Button>
          ))}
        </div>

        {/* Combined scroll button - absolutely positioned on right edge */}
        {(showLeftScroll || showRightScroll) && !showCustomInput && (
          <div className="absolute right-0 top-0 flex items-center z-[5]">
            {/* Gradient fade overlay */}
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-r from-transparent via-background/50 to-background pointer-events-none" />

            {/* Combined scroll button */}
            <div className="relative flex items-center justify-center flex-shrink-0 backdrop-blur-sm bg-white rounded-full p-0.5 shadow-[-1px_4px_21.8px_0_rgba(0,0,0,0.25)]">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={handleScrollLeft}
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={handleScrollRight}
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Overlay for custom input - absolute positioned */}
        {showCustomInput && (
          <div className="absolute left-0 top-0 z-10">
            <div className="flex items-center gap-2 rounded-full bg-transparent">
              {/* X button - external on the left */}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full bg-muted text-muted-foreground transition-all duration-200"
                onClick={closeCustomInput}
              >
                <X className="h-4 w-4" />
              </Button>

              {/* Form with expanded textbox and inline arrow button */}
              <form className="relative" onSubmit={handleSubmit}>
                <Input
                  ref={inputRef}
                  value={customThemeInput}
                  onChange={(event) => {
                    if (validationError) {
                      setValidationError(null);
                    }
                    setCustomThemeInput(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeCustomInput();
                    }
                  }}
                  placeholder="Input your topics"
                  disabled={isLoading}
                  className="h-8 w-[300px] rounded-full bg-muted border-0 px-3 pr-10 text-sm transition-all duration-300 ease-in-out"
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="ghost"
                  disabled={isSubmitDisabled}
                  className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-destructive text-center">{error}</p>
      )}
      {validationError && !error && (
        <p className="text-xs text-destructive text-center">{validationError}</p>
      )}
    </div>
  );
}
