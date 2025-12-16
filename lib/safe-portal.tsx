'use client';

import { useEffect, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A hydration-safe portal component that only renders after client-side mount.
 * This prevents React hydration errors when creating portals to document.body.
 *
 * Usage:
 * ```tsx
 * <SafePortal>
 *   <MyDropdownMenu />
 * </SafePortal>
 * ```
 */
export function SafePortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render anything during SSR or before hydration
  if (!mounted) return null;

  return createPortal(children, document.body);
}
