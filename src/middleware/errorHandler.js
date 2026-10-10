import { HttpError } from '../utils/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

/**
 * Central error handler. Express 5 forwards errors thrown in async route
 * handlers here automatically, so routes don't need try/catch.
 * Known errors (HttpError) are returned as-is; anything else is logged and
 * hidden behind a generic 500 so internals never leak to clients.
 */
// Express recognises an error handler by its 4 parameters, so `_next` must stay.
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  console.error('[http] unexpected error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
