import { createClient } from '@supabase/supabase-js';

const globalForSupabase = globalThis as typeof globalThis & {
  __supabaseServiceClient?: ReturnType<typeof createClient>;
};

/**
 * Returns a singleton Supabase client authenticated with the service role key.
 * Used for trusted server-to-server actions (e.g., webhooks) that require bypassing RLS.
 */
export function createServiceRoleClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  if (!globalForSupabase.__supabaseServiceClient) {
    globalForSupabase.__supabaseServiceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
        },
        global: {
          headers: {
            'X-Client-Info': 'longcut-service-role',
          },
        },
      }
    );
  }

  return globalForSupabase.__supabaseServiceClient;
}
