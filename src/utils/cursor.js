import { badRequest } from './errors.js';

/**
 * Pagination cursors are opaque to clients: base64url-encoded JSON holding the
 * (created_at, id) of the oldest message on the current page. Clients just send
 * back `nextCursor` to get the next (older) page.
 */
export function encodeCursor(message) {
  const payload = { t: new Date(message.createdAt).toISOString(), id: message.id };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor) {
  try {
    const { t, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const date = new Date(t);
    if (Number.isNaN(date.getTime()) || !Number.isSafeInteger(id) || id <= 0) throw new Error();
    return { createdAt: date.toISOString(), id };
  } catch {
    throw badRequest('Invalid cursor');
  }
}
