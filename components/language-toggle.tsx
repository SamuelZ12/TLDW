"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/app/i18n/routing";
import { Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { locales, localeNames, type Locale } from "@/lib/i18n";
import { useTransition } from "react";

export function LanguageToggle() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleLanguageChange = (newLocale: string) => {
    startTransition(() => {
      // Store preference in localStorage
      localStorage.setItem('preferredLocale', newLocale);
      
      // Use the localized router which handles locale switching
      router.replace(pathname, { locale: newLocale as Locale });
    });
  };

  return (
    <Select value={locale} onValueChange={handleLanguageChange} disabled={isPending}>
      <SelectTrigger className="w-[140px] h-9">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {locales.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {localeNames[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}