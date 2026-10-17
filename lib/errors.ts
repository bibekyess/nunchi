// Errors from any engine (server routes today; endpoints and on-device models later), in a
// form the pipeline can act on without knowing the transport. Client- and server-safe.

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

  constructor(
    public readonly kind: EngineErrorKind,
    message: string,
    retryable?: boolean,
  ) {
    super(message);
    this.name = 'EngineError';
    this.retryable = retryable ?? RETRYABLE.has(kind);
  }
}
