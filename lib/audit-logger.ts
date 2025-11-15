import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';

export enum AuditAction {
  // Authentication
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  SIGNUP = 'SIGNUP',
  PASSWORD_RESET = 'PASSWORD_RESET',

  // Video operations
  VIDEO_ANALYSIS_CREATE = 'VIDEO_ANALYSIS_CREATE',
  VIDEO_ANALYSIS_UPDATE = 'VIDEO_ANALYSIS_UPDATE',
  VIDEO_FAVORITE_TOGGLE = 'VIDEO_FAVORITE_TOGGLE',

  // AI operations
  AI_GENERATION = 'AI_GENERATION',
  AI_CHAT = 'AI_CHAT',

  // Security events
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY'
}

export interface AuditLogEntry {
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, any>;
  userId?: string;
}

export class AuditLogger {
  /**
   * Logs an audit event to the database
   */
  static async log(entry: AuditLogEntry): Promise<void> {
    try {
      const supabase = await createClient();
      const headersList = await headers();

      // Get user info
      let userId = entry.userId;
      if (!userId) {
        const { data: { user } } = await supabase.auth.getUser();
        userId = user?.id;
      }

      // Get request metadata
      const ipAddress = headersList.get('x-forwarded-for')?.split(',')[0] ||
                       headersList.get('x-real-ip') ||
                       'unknown';
      const userAgent = headersList.get('user-agent') || 'unknown';

      // Sanitize details to prevent log injection
      const sanitizedDetails = this.sanitizeDetails(entry.details);

      // Insert audit log entry
      await supabase
        .from('audit_logs')
        .insert({
          user_id: userId,
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId,
          details: sanitizedDetails,
          ip_address: ipAddress,
          user_agent: userAgent,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      // Don't throw errors from audit logging to avoid disrupting operations
      console.error('Audit logging failed:', error);
    }
  }

  /**
   * Logs a security event
   */
  static async logSecurityEvent(
    action: AuditAction,
    details: Record<string, any>
  ): Promise<void> {
    await this.log({
      action,
      resourceType: 'SECURITY',
      details: {
        ...details,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Logs a failed authentication attempt
   */
  static async logFailedAuth(
    email: string,
    reason: string
  ): Promise<void> {
    await this.log({
      action: AuditAction.UNAUTHORIZED_ACCESS,
      resourceType: 'AUTH',
      details: {
        email: this.sanitizeEmail(email),
        reason,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Logs rate limit exceeded events
   */
  static async logRateLimitExceeded(
    endpoint: string,
    identifier: string
  ): Promise<void> {
    await this.log({
      action: AuditAction.RATE_LIMIT_EXCEEDED,
      resourceType: 'API',
      details: {
        endpoint,
        identifier: this.sanitizeIdentifier(identifier),
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Logs validation failures that might indicate attack attempts
   */
  static async logValidationFailure(
    endpoint: string,
    errors: any
  ): Promise<void> {
    await this.log({
      action: AuditAction.VALIDATION_FAILED,
      resourceType: 'API',
      details: {
        endpoint,
        errors: this.sanitizeDetails(errors),
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Sanitizes log details to prevent log injection
   */
  private static sanitizeDetails(details: any): any {
    if (!details) return null;

    // Remove sensitive information
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'apiKey'];

    const sanitized = JSON.parse(JSON.stringify(details));

    const removeSensitive = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) return obj;

      for (const key in obj) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          obj[key] = removeSensitive(obj[key]);
        } else if (typeof obj[key] === 'string') {
          // Truncate very long strings
          if (obj[key].length > 1000) {
            obj[key] = obj[key].substring(0, 1000) + '... [TRUNCATED]';
          }
        }
      }
      return obj;
    };

    return removeSensitive(sanitized);
  }

  /**
   * Sanitizes email for logging
   */
  private static sanitizeEmail(email: string): string {
    if (!email || typeof email !== 'string') return 'invalid';

    // Partially mask email for privacy
    const parts = email.split('@');
    if (parts.length !== 2) return 'invalid';

    const [localPart, domain] = parts;
    if (localPart.length <= 2) {
      return `**@${domain}`;
    }

    return `${localPart[0]}${'*'.repeat(Math.min(localPart.length - 2, 5))}${localPart[localPart.length - 1]}@${domain}`;
  }

  /**
   * Sanitizes identifier for logging
   */
  private static sanitizeIdentifier(identifier: string): string {
    if (!identifier || typeof identifier !== 'string') return 'unknown';

    // If it looks like an ID, partially mask it
    if (identifier.includes(':')) {
      const [type, id] = identifier.split(':');
      if (id && id.length > 8) {
        return `${type}:${id.substring(0, 4)}...${id.substring(id.length - 4)}`;
      }
    }

    // For other identifiers, truncate if too long
    if (identifier.length > 50) {
      return identifier.substring(0, 50) + '...';
    }

    return identifier;
  }
}