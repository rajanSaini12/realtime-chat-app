/**
 * An error that is safe to show to the client. Anything thrown that is NOT an
 * HttpError is treated as a bug and reported as a generic 500.
 */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);

// PostgreSQL error code for a unique constraint violation.
export const PG_UNIQUE_VIOLATION = '23505';
