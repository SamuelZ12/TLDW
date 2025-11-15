import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

export interface UsageIndicatorProps {
  counted: number;
  baseLimit: number;
  baseRemaining: number;
  topupRemaining: number;
  resetAt?: string | Date | null;
  compact?: boolean;
  className?: string;
  warning?: 'PAST_DUE' | null;
}

function normalizeDate(input?: string | Date | null): Date | null {
  if (!input) return null;
  return input instanceof Date ? input : new Date(input);
}

function formatResetCopy(resetAt: Date | null): string {
  if (!resetAt || Number.isNaN(resetAt.getTime())) {
    return 'Rolling 30-day window';
  }

  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return 'Resets soon';
  }

  if (diffDays === 1) {
    return 'Resets in 1 day';
  }

  if (diffDays < 7) {
    return `Resets in ${diffDays} days`;
  }

  return `Resets ${resetAt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`;
}

export function UsageIndicator({
  counted,
  baseLimit,
  baseRemaining,
  topupRemaining,
  resetAt,
  compact = false,
  className,
  warning = null,
}: UsageIndicatorProps) {
  const { usedBase, progress, resetCopy, totalRemaining } = useMemo(() => {
    const normalizedReset = normalizeDate(resetAt);
    const used = Math.max(0, baseLimit - baseRemaining);
    const denominator = baseLimit > 0 ? baseLimit : 1;
    const pct = Math.min(100, Math.max(0, (used / denominator) * 100));
    const total = baseRemaining + Math.max(0, topupRemaining);

    return {
      usedBase: used,
      progress: pct,
      resetCopy: formatResetCopy(normalizedReset),
      totalRemaining: total,
    };
  }, [baseLimit, baseRemaining, resetAt, topupRemaining]);

  const baseUsageCopy = baseLimit
    ? `${usedBase}/${baseLimit} videos`
    : `${counted} videos`;

  if (compact) {
    return (
      <div className={cn('flex items-center gap-3 text-sm', className)}>
        <div className="flex flex-col">
          <span className="font-medium">Usage</span>
          <span className="text-muted-foreground text-xs">{resetCopy}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{totalRemaining}</span>
          {topupRemaining > 0 && (
            <Badge variant="secondary" className="text-xs">
              +{topupRemaining} top-up
            </Badge>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Monthly usage</span>
          {warning === 'PAST_DUE' && (
            <Badge variant="destructive" className="text-xs">
              Payment past due
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{baseUsageCopy}</span>
          {topupRemaining > 0 && (
            <Badge variant="outline" className="text-xs">
              +{topupRemaining} credits
            </Badge>
          )}
        </div>
      </div>

      <Progress value={progress} className="h-2" />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{resetCopy}</span>
        <span>{totalRemaining} total remaining</span>
      </div>
    </div>
  );
}

UsageIndicator.displayName = 'UsageIndicator';
