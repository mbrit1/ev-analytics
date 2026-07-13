import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createSecurityHeaders } from './security-headers.mjs'

/** Verifies the deployment-time Cloudflare Workers Static Assets header policy. */
describe('security headers', () => {
  it('creates a restrictive policy for all static and SPA-fallback responses', () => {
    // Arrange
    const headers = createSecurityHeaders('https://project.supabase.co/rest/v1')
    const policy = getHeader(headers, 'Content-Security-Policy')

    // Act
    const directives = new Map(policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(/\s+/)
      return [name, sources.join(' ')]
    }))

    // Assert
    expect(headers).toMatch(/^\/\*\n/m)
    expect(directives).toMatchObject(new Map([
      ['default-src', "'self'"],
      ['script-src', "'self'"],
      ['style-src', "'self'"],
      ['img-src', "'self'"],
      ['connect-src', "'self' https://project.supabase.co"],
      ['object-src', "'none'"],
      ['base-uri', "'self'"],
      ['form-action', "'self'"],
      ['frame-ancestors', "'none'"],
      ['manifest-src', "'self'"],
      ['worker-src', "'self'"],
    ]))
    expect(policy).not.toMatch(/\*|unsafe-inline|unsafe-eval/)
    expect(getHeader(headers, 'X-Content-Type-Options')).toBe('nosniff')
    expect(getHeader(headers, 'X-Frame-Options')).toBe('DENY')
    expect(getHeader(headers, 'Referrer-Policy')).toBe('no-referrer')
    expect(getHeader(headers, 'Permissions-Policy')).toBe(
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    )
  })

  it('rejects missing, non-HTTPS, and malformed Supabase URLs', () => {
    // Arrange
    const invalidUrls = [undefined, 'http://project.supabase.co', 'not a URL']

    // Act / Assert
    for (const url of invalidUrls) {
      expect(() => createSecurityHeaders(url)).toThrow(/VITE_SUPABASE_URL/)
    }
  })

  it('emits the policy and PWA assets in the production build output', () => {
    // Arrange
    const repositoryRoot = process.cwd()
    const env = {
      ...process.env,
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'placeholder',
    }

    // Act
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], {
      cwd: repositoryRoot,
      env,
      stdio: 'pipe',
    })
    const headers = readFileSync(`${repositoryRoot}/dist/_headers`, 'utf8')

    // Assert
    expect(headers).toMatch(/^\/\*\n/)
    expect(headers).toContain("connect-src 'self' https://project.supabase.co")
    expect(headers).toContain("manifest-src 'self'")
    expect(headers).toContain("worker-src 'self'")
    expect(existsSync(`${repositoryRoot}/dist/manifest.webmanifest`)).toBe(true)
    expect(existsSync(`${repositoryRoot}/dist/sw.js`)).toBe(true)
  }, 15_000)
})

function getHeader(headers: string, name: string) {
  const match = headers.match(new RegExp(`^  ${name}: (.+)$`, 'm'))
  expect(match, `${name} must be present`).not.toBeNull()
  return match![1]
}
