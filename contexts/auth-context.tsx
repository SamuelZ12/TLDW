'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'
import { clearCSRFToken } from '@/lib/csrf-client'

interface AuthContextType {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = useMemo(() => createClient(), [])
  const lastVisibleRef = useRef<number>(Date.now())

  // Memoize visibility handler to avoid recreating on every render
  const handleVisibilityChange = useCallback(async () => {
    if (document.visibilityState === 'visible') {
      const timeSinceHidden = Date.now() - lastVisibleRef.current;

      // Only refresh session if tab was hidden for more than 30 seconds
      // This avoids unnecessary refreshes for quick tab switches
      if (timeSinceHidden > 30_000) {
        try {
          // Clear CSRF token cache - it may be stale after long background
          clearCSRFToken();

          // Refresh the session from Supabase
          const { data: { session }, error } = await supabase.auth.getSession();

          if (error) {
            console.warn('Session refresh failed on tab return:', error.message);
            setUser(null);
          } else {
            setUser(session?.user ?? null);
          }
        } catch (err) {
          console.error('Unexpected error refreshing session:', err);
        }
      }
    } else if (document.visibilityState === 'hidden') {
      // Track when tab was hidden
      lastVisibleRef.current = Date.now();
    }
  }, [supabase.auth]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    // Listen for tab visibility changes to refresh session
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  }, [supabase.auth, handleVisibilityChange])

  const signOut = async () => {
    try {
      // Call server-side signout to clear HTTP-only cookies
      await fetch('/api/auth/signout', { method: 'POST' })
      
      // Also sign out on client to clear any local state
      await supabase.auth.signOut()
    } catch (error) {
      console.error('Sign out error:', error)
    }
    
    setUser(null)
    window.location.href = '/'
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}