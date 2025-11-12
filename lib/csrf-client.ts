/**
 * Client-side CSRF token management
 */

let csrfToken: string | null = null;

/**
 * Get CSRF token from meta tag or response header
 */
export async function getCSRFToken(): Promise<string | null> {
  // Check if we already have a token cached
  if (csrfToken) {
    return csrfToken;
  }

  // Try to get token from cookie (will be set after first authenticated request)
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrf-token') {
      csrfToken = value;
      return csrfToken;
    }
  }

  // Make a request to get a new token if needed
  try {
    const response = await fetch('/api/csrf-token', {
      method: 'GET',
      credentials: 'include'
    });

    if (response.ok) {
      const token = response.headers.get('X-CSRF-Token');
      if (token) {
        csrfToken = token;
        return token;
      }
    }
  } catch (error) {
    console.error('Failed to fetch CSRF token:', error);
  }

  return null;
}

/**
 * Clear cached CSRF token
 */
export function clearCSRFToken(): void {
  csrfToken = null;
}

/**
 * Make a fetch request with CSRF token included
 */
export async function fetchWithCSRF(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Only add CSRF token for state-changing methods
  const method = options.method?.toUpperCase() || 'GET';

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = await getCSRFToken();

    if (token) {
      options.headers = {
        ...options.headers,
        'X-CSRF-Token': token
      };
    }
  }

  // Always include credentials to send cookies
  options.credentials = options.credentials || 'include';

  const response = await fetch(url, options);

  // Update token if a new one is provided
  const newToken = response.headers.get('X-CSRF-Token');
  if (newToken) {
    csrfToken = newToken;
  }

  // If we get a 403 with CSRF error, try to refresh token and retry once
  if (response.status === 403) {
    // Clone response before consuming body to preserve it for caller
    const clonedResponse = response.clone();
    const data = await clonedResponse.json().catch(() => null);

    if (data?.error?.includes('CSRF')) {
      // Check if we've already retried (prevent infinite loops)
      const retryCount = (options as any).__csrfRetryCount || 0;

      if (retryCount < 1) {
        clearCSRFToken();
        const newToken = await getCSRFToken();

        if (newToken) {
          // Update options with new token and increment retry counter
          options.headers = {
            ...options.headers,
            'X-CSRF-Token': newToken
          };
          (options as any).__csrfRetryCount = retryCount + 1;

          // Retry with recursive call to maintain proper token handling
          return fetchWithCSRF(url, options);
        }
      }
    }
  }

  return response;
}

/**
 * Wrapper for common HTTP methods with CSRF protection
 */
export const csrfFetch = {
  get: (url: string, options?: RequestInit) =>
    fetchWithCSRF(url, { ...options, method: 'GET' }),

  post: (url: string, body?: any, options?: RequestInit) =>
    fetchWithCSRF(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),

  put: (url: string, body?: any, options?: RequestInit) =>
    fetchWithCSRF(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),

  delete: (url: string, options?: RequestInit) =>
    fetchWithCSRF(url, { ...options, method: 'DELETE' })
};