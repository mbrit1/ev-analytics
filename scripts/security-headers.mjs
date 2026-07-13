/**
 * Builds the Cloudflare Workers Static Assets `_headers` policy for one deployment.
 *
 * The Supabase origin is deliberately injected at build time so production does not
 * need a broad hostname allowlist to support authentication and synchronization.
 */
export function createSecurityHeaders(supabaseUrl) {
  const supabaseOrigin = getSecureOrigin(supabaseUrl)
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    `connect-src 'self' ${supabaseOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; ')

  return `/*
  Content-Security-Policy: ${contentSecurityPolicy}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
`
}

function getSecureOrigin(supabaseUrl) {
  let url

  try {
    url = new URL(supabaseUrl)
  } catch {
    throw new Error('VITE_SUPABASE_URL must be an absolute HTTPS URL to generate security headers.')
  }

  if (url.protocol !== 'https:') {
    throw new Error('VITE_SUPABASE_URL must use HTTPS to generate security headers.')
  }

  return url.origin
}
