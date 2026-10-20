import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateConfig, extractProjectRef, BLOCKED_STAGING_PROJECT_REF } from './config';

describe('Configuration & Staging Isolation Validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('extractProjectRef', () => {
    it('correctly extracts project subdomain from standard supabase URL', () => {
      expect(extractProjectRef('https://jiicnqgafzvkgfcienpm.supabase.co')).toBe('jiicnqgafzvkgfcienpm');
      expect(extractProjectRef('https://staging-isolated-ref.supabase.co/')).toBe('staging-isolated-ref');
    });

    it('returns null for null, empty or invalid URLs', () => {
      expect(extractProjectRef(null)).toBeNull();
      expect(extractProjectRef('')).toBeNull();
      expect(extractProjectRef('https://example.com')).toBeNull();
    });
  });

  describe('validateConfig in non-staging mode', () => {
    it('returns true when valid url and key are provided', () => {
      const result = validateConfig({
        url: 'https://any-project.supabase.co',
        key: 'some-key',
        mode: 'development',
      });
      expect(result).toBe(true);
    });

    it('returns false without throwing when variables are missing', () => {
      const result = validateConfig({
        url: '',
        key: '',
        mode: 'development',
      });
      expect(result).toBe(false);
    });
  });

  describe('validateConfig in staging mode (isolation guards)', () => {
    it('throws when staging variables are missing', () => {
      expect(() =>
        validateConfig({
          url: '',
          key: '',
          mode: 'staging',
        }),
      ).toThrowError(/\[STAGING CONFIG ERROR\]/);
    });

    it('throws when staging variables contain placeholder values', () => {
      expect(() =>
        validateConfig({
          url: 'https://YOUR_STAGING_PROJECT_REF.supabase.co',
          key: 'YOUR_STAGING_ANON_KEY',
          mode: 'staging',
        }),
      ).toThrowError(/using placeholder values/);
    });

    it('strictly refuses to start if staging points to production project ref', () => {
      expect(() =>
        validateConfig({
          url: `https://${BLOCKED_STAGING_PROJECT_REF}.supabase.co`,
          key: 'some-staging-key-sample',
          mode: 'staging',
        }),
      ).toThrowError(/\[STAGING ISOLATION VIOLATION\].*jiicnqgafzvkgfcienpm/);
    });

    it('succeeds when a valid dedicated staging project ref is configured', () => {
      const result = validateConfig({
        url: 'https://workpulse-staging-abc123.supabase.co',
        key: 'valid-staging-anon-key',
        mode: 'staging',
      });
      expect(result).toBe(true);
    });
  });

  describe('validateConfig in local mode (isolation guards)', () => {
    it('strictly refuses to start if local mode points to production project ref', () => {
      expect(() =>
        validateConfig({
          url: `https://${BLOCKED_STAGING_PROJECT_REF}.supabase.co`,
          key: 'some-key',
          mode: 'local',
        }),
      ).toThrowError(/\[LOCAL ISOLATION VIOLATION\].*jiicnqgafzvkgfcienpm/);

      expect(() =>
        validateConfig({
          url: `https://${BLOCKED_STAGING_PROJECT_REF}.supabase.co`,
          key: 'some-key',
          mode: 'localdev',
        }),
      ).toThrowError(/\[LOCAL ISOLATION VIOLATION\].*jiicnqgafzvkgfcienpm/);
    });

    it('succeeds when configured with local Supabase stack URL', () => {
      const result = validateConfig({
        url: 'http://127.0.0.1:54321',
        key: 'some-local-anon-key',
        mode: 'localdev',
      });
      expect(result).toBe(true);
    });
  });
});
