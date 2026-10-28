import { ZodError } from 'zod';
import { ProductApiError } from './product-api';

// Only exact, application-owned codes may cross into visible diagnostics.
const nativeCodes = new Set([
  'authorization_binding_changed',
  'authorization_unavailable',
  'authorization_denied',
  'authorization_invalid',
  'authorization_state_failed',
  'authorization_busy',
  'authorization_cancelled',
  'sharing_already_active',
  'sharing_not_active',
  'invalid_room',
  'invalid_grant',
  'invalid_key',
  'invalid_profile',
  'invalid_audio_process',
  'invalid_transition',
  'engine_missing',
  'engine_start_failed',
  'engine_pipe_failed',
  'engine_state_failed',
  'engine_cleanup_failed',
  'engine_isolation_failed',
  'engine_busy',
  'unsupported_platform',
  'update_busy',
]);

export function publisherFailureCode(failure: unknown): string {
  if (failure instanceof ProductApiError) {
    return [400, 401, 403, 404, 409, 429, 500, 502, 503, 504].includes(failure.status)
      ? `control_http_${failure.status}`
      : 'control_http_error';
  }
  if (failure instanceof ZodError) return 'invalid_response';
  if (failure instanceof DOMException && failure.name === 'AbortError') return 'request_aborted';
  if (typeof failure === 'string' && nativeCodes.has(failure)) return failure;
  return 'unexpected_failure';
}
