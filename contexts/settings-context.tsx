"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type TranscriptDisplayMode = 'original' | 'sideBySide' | 'overlay';

interface SettingsContextType {
  transcriptDisplayMode: TranscriptDisplayMode;
  setTranscriptDisplayMode: (mode: TranscriptDisplayMode) => void;
  autoTranslate: boolean;
  setAutoTranslate: (value: boolean) => void;
  translationCache: Map<string, string>;
  addToTranslationCache: (key: string, translation: string) => void;
  getFromTranslationCache: (key: string) => string | undefined;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState<TranscriptDisplayMode>('original');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translationCache] = useState(() => new Map<string, string>());

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem('transcriptDisplayMode') as TranscriptDisplayMode;
    const savedAutoTranslate = localStorage.getItem('autoTranslate') === 'true';
    
    if (savedMode && ['original', 'sideBySide', 'overlay'].includes(savedMode)) {
      setTranscriptDisplayMode(savedMode);
    }
    setAutoTranslate(savedAutoTranslate);
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem('transcriptDisplayMode', transcriptDisplayMode);
  }, [transcriptDisplayMode]);

  useEffect(() => {
    localStorage.setItem('autoTranslate', String(autoTranslate));
  }, [autoTranslate]);

  const addToTranslationCache = (key: string, translation: string) => {
    translationCache.set(key, translation);
    // Optionally persist to localStorage or IndexedDB for longer-term caching
  };

  const getFromTranslationCache = (key: string) => {
    return translationCache.get(key);
  };

  return (
    <SettingsContext.Provider
      value={{
        transcriptDisplayMode,
        setTranscriptDisplayMode,
        autoTranslate,
        setAutoTranslate,
        translationCache,
        addToTranslationCache,
        getFromTranslationCache,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}