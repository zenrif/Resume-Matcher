import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, apiFetch, apiPost, getUploadUrl, sanitizeNextUrl } from '@/lib/api/client';

/**
 * The single backend client. Tests cover URL resolution, JSON POST shape, and
 * the timeout → friendly-message behavior (240s matches the backend wait_for).
 * `fetch` is stubbed so nothing hits the network.
 */

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('API_BASE / getUploadUrl', () => {
    it('defaults to /api/v1 in the browser env', () => {
      expect(API_BASE).toBe('/api/v1');
      expect(getUploadUrl()).toBe('/api/v1/resumes/upload');
    });
  });

  describe('apiFetch URL resolution', () => {
    it('prefixes a relative endpoint with API_BASE and passes an abort signal', async () => {
      await apiFetch('/health');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/health',
        expect.objectContaining({ signal: expect.anything() })
      );
    });

    it('adds a leading slash to a bare endpoint', async () => {
      await apiFetch('health');
      expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/health');
    });

    it('passes absolute URLs through untouched', async () => {
      await apiFetch('https://example.com/x');
      expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/x');
    });
  });

  it('preserves response origin metadata through body buffering', async () => {
    const original = new Response('done');
    Object.defineProperties(original, {
      url: { value: 'https://example.com/final' },
      redirected: { value: true },
      type: { value: 'cors' },
    });
    fetchMock.mockResolvedValueOnce(original);
    const response = await apiFetch('/redirect');
    expect(response.url).toBe('https://example.com/final');
    expect(response.redirected).toBe(true);
    expect(response.type).toBe('cors');
    expect(await response.text()).toBe('done');
  });

  it.each(['user left', new Error('user left')])(
    'normalizes custom caller cancellation: %s',
    async (reason) => {
      fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));
      const controller = new AbortController();
      const request = apiFetch('/cancel', { signal: controller.signal });
      controller.abort(reason);
      await expect(request).rejects.toMatchObject({ name: 'AbortError', cause: reason });
    }
  );
  describe('apiPost', () => {
    it('sends a JSON body with POST + Content-Type', async () => {
      await apiPost('/jobs/upload', { job_descriptions: ['x'] });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/v1/jobs/upload');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(init.body).toBe(JSON.stringify({ job_descriptions: ['x'] }));
    });
  });

  describe('timeout / error handling', () => {
    it('maps an AbortError to a friendly timeout message', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortErr);
      await expect(apiFetch('/slow')).rejects.toThrow(/timed out/i);
    });

    it('rethrows non-abort errors unchanged', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network boom'));
      await expect(apiFetch('/x')).rejects.toThrow('network boom');
    });

    it('aborts after the timeout and reports a timeout error', async () => {
      vi.useFakeTimers();
      try {
        fetchMock.mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                const e = new Error('The operation was aborted');
                e.name = 'AbortError';
                reject(e);
              });
            })
        );
        const promise = apiFetch('/slow', undefined, 5000);
        const expectation = expect(promise).rejects.toThrow(/timed out/i);
        await vi.advanceTimersByTimeAsync(5000);
        await expectation;
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the deadline active while the response body is pending', async () => {
      vi.useFakeTimers();
      let requestSignal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
        requestSignal = init.signal ?? undefined;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start() {
                // Keep the body open past the request deadline.
              },
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        );
      });

      const request = apiFetch('/slow-body', undefined, 20);
      const expectation = expect(request).rejects.toThrow(/timed out/i);

      await vi.advanceTimersByTimeAsync(20);

      await expectation;
      expect(requestSignal?.aborted).toBe(true);
    });

    it('propagates caller cancellation while a response body is pending', async () => {
      let requestSignal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
        requestSignal = init.signal ?? undefined;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start() {
                // The controlled stream deliberately ignores the fetch signal.
              },
            })
          )
        );
      });
      const caller = new AbortController();
      const request = apiFetch('/cancel-body', { signal: caller.signal }, 5000);
      const expectation = expect(request).rejects.toMatchObject({ name: 'AbortError' });

      caller.abort();

      await expectation;
      expect(requestSignal?.aborted).toBe(true);
    });

    it.each([
      ['json', new Response('{"ready":true}', { headers: { 'content-type': 'application/json' } })],
      ['blob', new Response('pdf-bytes', { headers: { 'content-type': 'application/pdf' } })],
    ] as const)(
      'cleans up the deadline after normal %s body completion',
      async (reader, fixture) => {
        vi.useFakeTimers();
        let requestSignal: AbortSignal | undefined;
        fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
          requestSignal = init.signal ?? undefined;
          return Promise.resolve(fixture);
        });
        const caller = new AbortController();
        const response = await apiFetch('/finite-body', { signal: caller.signal }, 20);

        if (reader === 'json') {
          await expect(response.json()).resolves.toEqual({ ready: true });
        } else {
          await expect(response.blob()).resolves.toMatchObject({
            size: 9,
            type: 'application/pdf',
          });
        }

        caller.abort();
        await vi.advanceTimersByTimeAsync(1000);
        expect(requestSignal?.aborted).toBe(false);
      }
    );
  });

  describe('sanitizeNextUrl', () => {
    it('allows valid relative URLs', () => {
      expect(sanitizeNextUrl('/tracker')).toBe('/tracker');
      expect(sanitizeNextUrl('/resumes/123?tab=cover')).toBe('/resumes/123?tab=cover');
    });

    it('rejects protocol-relative and malformed slashes', () => {
      expect(sanitizeNextUrl('//evil.com')).toBe('/dashboard');
      expect(sanitizeNextUrl('/\\evil.com')).toBe('/dashboard');
    });

    it('rejects absolute URLs', () => {
      expect(sanitizeNextUrl('https://evil.com')).toBe('/dashboard');
      expect(sanitizeNextUrl('javascript:alert(1)')).toBe('/dashboard');
    });

    it('defaults empty or null to /dashboard', () => {
      expect(sanitizeNextUrl('')).toBe('/dashboard');
      expect(sanitizeNextUrl(null)).toBe('/dashboard');
      expect(sanitizeNextUrl(undefined)).toBe('/dashboard');
    });
  });

  describe('apiFetch 401 redirect', () => {
    it('redirects to /login when receiving 401 on non-auth endpoint in browser', async () => {
      const originalLocation = window.location;
      delete (window as unknown as { location?: unknown }).location;
      (
        window as unknown as { location: { href: string; pathname: string; search: string } }
      ).location = {
        href: 'http://localhost:3000/tracker',
        pathname: '/tracker',
        search: '?filter=active',
      };

      try {
        fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
        await apiFetch('/resumes');
        expect(window.location.href).toBe('/login?next=%2Ftracker%3Ffilter%3Dactive');
      } finally {
        (window as unknown as { location: unknown }).location = originalLocation;
      }
    });

    it('does NOT redirect on 401 for /auth/ endpoints', async () => {
      const originalLocation = window.location;
      delete (window as unknown as { location?: unknown }).location;
      (
        window as unknown as { location: { href: string; pathname: string; search: string } }
      ).location = {
        href: 'http://localhost:3000/login',
        pathname: '/login',
        search: '',
      };

      try {
        fetchMock.mockResolvedValueOnce(
          new Response('{"detail":"Invalid password"}', { status: 401 })
        );
        const res = await apiFetch('/auth/login');
        expect(res.status).toBe(401);
        expect(window.location.href).toBe('http://localhost:3000/login');
      } finally {
        (window as unknown as { location: unknown }).location = originalLocation;
      }
    });
  });
});
