export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** Error the handler is allowed to render verbatim to the client. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.details = details;
  }
}

export const badRequest = (m: string, d?: unknown): ApiError =>
  new ApiError('BAD_REQUEST', m, d);
export const notFound = (m: string): ApiError => new ApiError('NOT_FOUND', m);
export const conflict = (m: string): ApiError => new ApiError('CONFLICT', m);
