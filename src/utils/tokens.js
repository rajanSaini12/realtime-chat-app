import jwt from 'jsonwebtoken';

// The JWT payload is deliberately small: `sub` (user id) and the username for display.
export function signToken(user, { secret, expiresIn }) {
  return jwt.sign({ sub: String(user.id), username: user.username }, secret, {
    expiresIn,
    algorithm: 'HS256',
  });
}

/** Returns `{ id, username }` or throws if the token is invalid or expired. */
export function verifyToken(token, { secret }) {
  // Pinning the algorithm prevents "alg confusion" attacks (e.g. alg: none).
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  return { id: Number(payload.sub), username: payload.username };
}
