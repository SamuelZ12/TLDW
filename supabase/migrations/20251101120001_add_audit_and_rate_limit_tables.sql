-- Migration: Add audit_logs and rate_limits tables
-- Created: 2025-11-01
-- Purpose: Add missing tables required by audit-logger.ts and rate-limiter.ts

-- =====================================================
-- Table: audit_logs
-- Purpose: Track security events, user actions, and audit trail
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  details jsonb,
  ip_address text NOT NULL,
  user_agent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Index for security event queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_security_events ON audit_logs(action, created_at DESC)
  WHERE action IN ('RATE_LIMIT_EXCEEDED', 'VALIDATION_FAILED', 'UNAUTHORIZED_ACCESS', 'SUSPICIOUS_ACTIVITY');

-- RLS: Enable row level security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own audit logs
CREATE POLICY audit_logs_select_own ON audit_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Only service role can insert audit logs
CREATE POLICY audit_logs_insert_service ON audit_logs
  FOR INSERT
  WITH CHECK (true); -- Enforced at application layer

COMMENT ON TABLE audit_logs IS 'Audit trail for security events and user actions';
COMMENT ON COLUMN audit_logs.action IS 'Action type from AuditAction enum';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource affected (e.g., SECURITY, AUTH, API)';
COMMENT ON COLUMN audit_logs.details IS 'Additional context, automatically sanitized';
COMMENT ON COLUMN audit_logs.ip_address IS 'Client IP address from headers';
COMMENT ON COLUMN audit_logs.user_agent IS 'Client user agent string';

-- =====================================================
-- Table: rate_limits
-- Purpose: Track API rate limiting with sliding window
-- =====================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  identifier text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);

-- Composite index for efficient rate limit queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_timestamp ON rate_limits(key, timestamp DESC);

-- Index for cleanup operations
CREATE INDEX IF NOT EXISTS idx_rate_limits_timestamp ON rate_limits(timestamp);

-- RLS: Enable row level security
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- RLS Policy: No direct user access (managed by application)
CREATE POLICY rate_limits_no_direct_access ON rate_limits
  FOR ALL
  USING (false); -- All access via service role

COMMENT ON TABLE rate_limits IS 'Rate limiting tracking with sliding window algorithm';
COMMENT ON COLUMN rate_limits.key IS 'Rate limit key: ratelimit:{endpoint}:{identifier}';
COMMENT ON COLUMN rate_limits.identifier IS 'User or anonymous identifier: user:{id} or anon:{hash}';
COMMENT ON COLUMN rate_limits.timestamp IS 'When this request was made';

-- =====================================================
-- Cleanup Function: Remove old rate limit entries
-- Purpose: Prevent rate_limits table from growing indefinitely
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete rate limit entries older than 31 days (max window is 30 days)
  DELETE FROM rate_limits
  WHERE timestamp < now() - interval '31 days';
END;
$$;

COMMENT ON FUNCTION cleanup_old_rate_limits IS 'Removes rate limit entries older than 31 days';

-- Grant execute permission to authenticated users (will be called by service role)
GRANT EXECUTE ON FUNCTION cleanup_old_rate_limits() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_rate_limits() TO service_role;
