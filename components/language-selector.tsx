"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Languages, ChevronDown, CheckCircle2, Circle, Search } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/lib/language-utils";
import { cn } from "@/lib/utils";

interface LanguageSelectorProps {
  activeTab: "transcript" | "chat" | "notes";
  selectedLanguage: string | null;
  isAuthenticated?: boolean;
  onTabSwitch: (tab: "transcript" | "chat" | "notes") => void;
  onLanguageChange?: (languageCode: string | null) => void;
  onRequestSignIn?: () => void;
}

interface LanguageSelectorMenuProps {
  chevronRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  filteredLanguages: Array<typeof SUPPORTED_LANGUAGES[number]>;
  currentLanguageCode: string;
  selectedLanguage: string | null;
  isAuthenticated: boolean;
  languageSearch: string;
  onLanguageSearchChange: (value: string) => void;
  onLanguageSelect: (langCode: string) => void;
  onRequestSignIn?: () => void;
  onMenuMouseEnter: () => void;
  onMenuMouseLeave: () => void;
}

export function LanguageSelector({
  activeTab,
  selectedLanguage,
  isAuthenticated = false,
  onTabSwitch,
  onLanguageChange,
  onRequestSignIn,
}: LanguageSelectorProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Get current language - null or 'en' means English
  const currentLanguageCode = selectedLanguage || 'en';

  // Filter languages based on search
  const filteredLanguages = SUPPORTED_LANGUAGES.filter(lang =>
    lang.name.toLowerCase().includes(languageSearch.toLowerCase()) ||
    lang.nativeName.toLowerCase().includes(languageSearch.toLowerCase())
  );

  // Track mount state for portal rendering
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  // Handle chevron hover - start delay timer
  const handleChevronMouseEnter = useCallback(() => {
    if (!isMenuOpen && !hoverTimeoutRef.current) {
      hoverTimeoutRef.current = setTimeout(() => {
        setIsMenuOpen(true);
        setLanguageSearch("");
        hoverTimeoutRef.current = null;
      }, 175); // 150-200ms range midpoint
    }
  }, [isMenuOpen]);

  // Handle chevron hover leave - cancel timer before it fires
  const handleChevronMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  // Handle container mouse leave - start close timer
  const handleContainerMouseLeave = useCallback((e: React.MouseEvent) => {
    if (!isMenuOpen) return;

    // Cancel any existing close timeout
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }

    // Start a new close timeout
    closeTimeoutRef.current = setTimeout(() => {
      // Check if mouse is not over menu before closing
      if (menuRef.current && !menuRef.current.contains(document.elementFromPoint(e.clientX, e.clientY))) {
        setIsMenuOpen(false);
        setLanguageSearch("");
      }
      closeTimeoutRef.current = null;
    }, 100);
  }, [isMenuOpen]);

  // Handle menu mouse enter - cancel close timer
  const handleMenuMouseEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  // Handle menu mouse leave - close menu after delay
  const handleMenuMouseLeave = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = setTimeout(() => {
      setIsMenuOpen(false);
      setLanguageSearch("");
      closeTimeoutRef.current = null;
    }, 100);
  }, []);

  // Handle language selection
  const handleLanguageSelect = useCallback((langCode: string) => {
    // Handle auth check
    if (!isAuthenticated && langCode !== 'en') {
      onRequestSignIn?.();
      return;
    }

    // Clear any pending close timeout
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    // Toggle selection if clicking current language
    const newLanguage = langCode === currentLanguageCode && selectedLanguage !== null
      ? null
      : langCode;

    onLanguageChange?.(newLanguage);

    // Only switch to Transcript tab if NOT already on it
    if (activeTab !== 'transcript') {
      onTabSwitch('transcript');
    }

    setIsMenuOpen(false);
    setLanguageSearch("");
  }, [isAuthenticated, currentLanguageCode, selectedLanguage, activeTab, onLanguageChange, onTabSwitch, onRequestSignIn]);

  // Handle outside click - close menu without tab switch
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is outside both container and menu
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsMenuOpen(false);
        setLanguageSearch("");
        // NOTE: Explicitly NOT calling onTabSwitch here
      }
    };

    // Use mousedown for faster response, but add a small delay to ensure
    // the language selection handler fires first
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isMenuOpen]);

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "flex items-center gap-0 rounded-2xl w-full",
          activeTab === "transcript"
            ? "bg-neutral-100"
            : "hover:bg-white/50"
        )}
        onMouseLeave={handleContainerMouseLeave}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onTabSwitch("transcript")}
          className={cn(
            "flex-1 justify-center gap-2 rounded-l-2xl rounded-r-none border-0",
            activeTab === "transcript"
              ? "text-foreground hover:bg-neutral-100"
              : "text-muted-foreground hover:text-foreground hover:bg-transparent"
          )}
        >
          <Languages className="h-4 w-4" />
          Transcript
        </Button>
        <Button
          ref={chevronRef}
          variant="ghost"
          size="sm"
          onMouseEnter={handleChevronMouseEnter}
          onMouseLeave={handleChevronMouseLeave}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className={cn(
            "rounded-r-2xl rounded-l-none border-0 !pl-0",
            activeTab === "transcript"
              ? "text-foreground hover:bg-neutral-100"
              : "text-muted-foreground hover:text-foreground hover:bg-transparent"
          )}
        >
          <ChevronDown
            className="h-3 w-3 opacity-50"
            style={{
              transform: isMenuOpen ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 200ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        </Button>
      </div>

      {isMounted && isMenuOpen && (
        <LanguageSelectorMenu
          chevronRef={chevronRef}
          menuRef={menuRef}
          filteredLanguages={filteredLanguages}
          currentLanguageCode={currentLanguageCode}
          selectedLanguage={selectedLanguage}
          isAuthenticated={isAuthenticated}
          languageSearch={languageSearch}
          onLanguageSearchChange={setLanguageSearch}
          onLanguageSelect={handleLanguageSelect}
          onRequestSignIn={onRequestSignIn}
          onMenuMouseEnter={handleMenuMouseEnter}
          onMenuMouseLeave={handleMenuMouseLeave}
        />
      )}
    </>
  );
}

function LanguageSelectorMenu({
  chevronRef,
  menuRef,
  filteredLanguages,
  currentLanguageCode,
  selectedLanguage,
  isAuthenticated,
  languageSearch,
  onLanguageSearchChange,
  onLanguageSelect,
  onRequestSignIn,
  onMenuMouseEnter,
  onMenuMouseLeave,
}: LanguageSelectorMenuProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Calculate and update menu position
  useEffect(() => {
    if (!chevronRef?.current) return;

    const updatePosition = () => {
      const rect = chevronRef.current!.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left - 200, // Align with existing alignOffset
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [chevronRef]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 w-[260px] rounded-2xl border bg-popover p-0 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onMouseEnter={onMenuMouseEnter}
      onMouseLeave={onMenuMouseLeave}
    >
      {!isAuthenticated && (
        <div className="px-3 py-2 border-b">
          <div className="text-xs font-medium">Sign in to translate</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Translate transcript and topics into 4 languages.
          </div>
          <Button
            size="sm"
            className="mt-2 h-7 text-xs w-full"
            onClick={(e) => {
              e.preventDefault();
              onRequestSignIn?.();
            }}
          >
            Sign in
          </Button>
        </div>
      )}
      <div className="px-2 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search"
            value={languageSearch}
            onChange={(e) => onLanguageSearchChange(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {filteredLanguages.map((lang) => {
          const isOriginalLanguage = lang.code === 'en';
          const isTargetLanguage = lang.code === currentLanguageCode && selectedLanguage !== null;

          return (
            <div
              key={lang.code}
              className={cn(
                "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                isOriginalLanguage && "cursor-default",
                !isAuthenticated && !isOriginalLanguage && "opacity-50"
              )}
              onClick={(e) => {
                if (isOriginalLanguage || (!isAuthenticated && !isOriginalLanguage)) {
                  if (!isAuthenticated && !isOriginalLanguage) {
                    e.preventDefault();
                    onRequestSignIn?.();
                  }
                  return;
                }
                onLanguageSelect(lang.code);
              }}
            >
              <div className="flex items-center justify-between w-full">
                <div>
                  <div className="font-medium">{lang.nativeName}</div>
                  <div className="text-[10px] text-muted-foreground">{lang.name}</div>
                </div>
                {isOriginalLanguage ? (
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground/50" />
                ) : isTargetLanguage ? (
                  <CheckCircle2 className="w-4 h-4 text-foreground fill-background" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground/30" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
