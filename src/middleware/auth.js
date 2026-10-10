import { verifyToken } from '../utils/tokens.js';
import { unauthorized } from '../utils/errors.js';

/**
 * Express middleware: requires `Authorization: Bearer <jwt>`.
 * On success the authenticated user is available as `req.user = { id, username }`.
 */
export function requireAuth(jwtConfig) {
  return (req, _res, next) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized('Missing bearer token'));
    try {
      req.user = verifyToken(token, jwtConfig);
      next();
    } catch {
      next(unauthorized('Invalid or expired token'));
    }
  };
}
