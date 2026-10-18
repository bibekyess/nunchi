// Errors from any engine (server routes today; endpoints and on-device models later), in a
// form the pipeline can act on without knowing the transport. Client- and server-safe.
import type { EngineId } from './engines/ids';

/** Header carrying the shared passcode (APP_ACCESS_TOKEN) from the browser to /api/*. */
export const ACCESS_TOKEN_HEADER = 'x-nunchi-token';

export type EngineErrorKind =
  | 'network' // no connection, or the stream broke off
  | 'timeout'
  | 'auth' // passcode or key missing or wrong
  | 'bad_request'
  | 'upstream' // the model server failed
  | 'unavailable'; // the engine can't run here (not configured, unsupported device)

const RETRYABLE: ReadonlySet<EngineErrorKind> = new Set(['network', 'timeout', 'upstream']);

export class EngineError extends Error {
  readonly retryable: boolean;
  /** Which engine failed, when known. A server `auth` error means the passcode is missing. */
  readonly engine?: EngineId;

  constructor(
    public readonly kind: EngineErrorKind,
    message: string,
    opts: { retryable?: boolean; engine?: EngineId } = {},
  ) {
    super(message);
    this.name = 'EngineError';
    this.retryable = opts.retryable ?? RETRYABLE.has(kind);
    this.engine = opts.engine;
  }

  /** The app server wants the shared passcode (APP_ACCESS_TOKEN). */
  get needsPasscode(): boolean {
    return this.kind === 'auth' && this.engine === 'server';
  }
}
