import {
  DidDocument,
  JsonTransformer,
  type AgentContext,
  type DidResolutionOptions,
  type DidResolutionResult,
  type DidResolver,
  type ParsedDid,
} from '@credo-ts/core';

/**
 * Credo DidResolver backed by a DIF Universal Resolver instance
 * (https://github.com/decentralized-identity/universal-resolver).
 *
 * Which methods it handles is decided by the instance, not by this app: the
 * list is read from GET {endpoint}/1.0/methods. Credo looks a resolver up by
 * reading `supportedMethods` on every resolution
 * (DidResolverService.findResolver), so the list can be refreshed after the
 * agent is built. Until the refresh lands — or if the instance is unreachable —
 * the configured fallback list is used, so app startup never waits on it.
 *
 * Register it AFTER the on-device resolvers: Credo picks the first resolver
 * whose supportedMethods contains the method, and `localMethods` are removed
 * from this resolver's list anyway, so did:key / did:jwk / did:peer / did:web
 * never leave the device.
 */
export class UniversalDidResolver implements DidResolver {
  readonly allowsCaching = true;
  readonly allowsLocalDidRecord = false;

  private _supportedMethods: string[];
  private readonly excluded: Set<string>;
  private readonly timeoutMs: number;

  constructor(
    private readonly endpoint: string,
    options: { fallbackMethods?: string[]; localMethods?: string[]; timeoutMs?: number } = {},
  ) {
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.excluded = new Set(options.localMethods ?? []);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this._supportedMethods = this.withoutLocal(options.fallbackMethods ?? []);
  }

  get supportedMethods(): string[] {
    return this._supportedMethods;
  }

  /**
   * Replace the method list with what the instance reports. Keeps the current
   * list on any failure. Returns the list in effect afterwards.
   */
  async refreshMethods(): Promise<string[]> {
    try {
      const res = await this.fetchWithTimeout(`${this.endpoint}/1.0/methods`, {}, 5_000);
      if (res.ok) {
        const body: unknown = await res.json();
        if (Array.isArray(body) && body.every((m) => typeof m === 'string')) {
          this._supportedMethods = this.withoutLocal(body);
        }
      }
    } catch {
      // Unreachable / offline: keep the fallback list.
    }
    return this._supportedMethods;
  }

  async resolve(
    _agentContext: AgentContext,
    _did: string,
    parsed: ParsedDid,
    _options: DidResolutionOptions,
  ): Promise<DidResolutionResult> {
    // parsed.did is the bare DID — no path, query or fragment from a DID URL.
    const url = `${this.endpoint}/1.0/identifiers/${parsed.did}`;
    let status = 0;
    try {
      const res = await this.fetchWithTimeout(url, {
        headers: { Accept: 'application/ld+json;profile="https://w3id.org/did-resolution"' },
      });
      status = res.status;
      const body = (await res.json().catch(() => null)) as Record<string, any> | null;

      // A resolution result carries `didDocument`; some drivers answer with a bare document.
      const isResolutionResult = !!body && 'didDocument' in body;
      const rawDocument = isResolutionResult ? body!.didDocument : body?.id ? body : null;
      const didDocumentMetadata = (isResolutionResult && body!.didDocumentMetadata) || {};

      if (!res.ok || !rawDocument) {
        const meta = (isResolutionResult && body!.didResolutionMetadata) || {};
        return {
          didDocument: null,
          didDocumentMetadata,
          didResolutionMetadata: {
            error: normalizeError(meta.error, res.status),
            // Gateway errors (e.g. dev.uniresolver.io's 403 rate limit) put the
            // explanation in a top-level `message` rather than in resolution metadata.
            message:
              errorMessage(meta) ??
              (typeof body?.message === 'string' ? `HTTP ${res.status}: ${body.message}` : undefined) ??
              `Universal resolver returned HTTP ${res.status} for ${parsed.did}`,
          },
        };
      }

      return {
        didDocument: JsonTransformer.fromJSON(rawDocument, DidDocument),
        didDocumentMetadata,
        didResolutionMetadata: { contentType: 'application/did+ld+json' },
      };
    } catch (error) {
      return {
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: 'internalError',
          message: `Universal resolver request for ${parsed.did} failed${status ? ` (HTTP ${status})` : ''}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      };
    }
  }

  private withoutLocal(methods: string[]): string[] {
    return Array.from(new Set(methods)).filter((m) => !this.excluded.has(m));
  }

  // AbortController + setTimeout rather than AbortSignal.timeout(), which
  // Hermes does not reliably provide.
  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Credo expects DID Core error codes as strings ('notFound', 'invalidDid', …).
 * Newer Universal Resolver versions return an object such as
 * { type: 'INVALID_DID', title, detail } instead.
 */
function normalizeError(error: unknown, httpStatus: number): string {
  const raw =
    typeof error === 'string' ? error : typeof (error as any)?.type === 'string' ? (error as any).type : undefined;
  if (raw) {
    // INVALID_DID -> invalidDid, METHOD_NOT_SUPPORTED -> methodNotSupported; camelCase passes through.
    return raw.includes('_') ? raw.toLowerCase().replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase()) : raw;
  }
  if (httpStatus === 404) return 'notFound';
  if (httpStatus === 400) return 'invalidDid';
  if (httpStatus === 501) return 'methodNotSupported';
  return 'internalError';
}

function errorMessage(meta: Record<string, any>): string | undefined {
  if (typeof meta.message === 'string') return meta.message;
  if (typeof meta.error?.detail === 'string') return meta.error.detail;
  if (typeof meta.error?.title === 'string') return meta.error.title;
  return undefined;
}
