/**
 * Deterministic id for a private (1:1) chat between two users.
 *
 * Sorting the two ids means A->B and B->A produce the same key, so both users
 * always land in the same conversation row and the same Socket.io room.
 *   directKey(7, 3) === directKey(3, 7) === 'dm:3:7'
 */
export function directKey(userIdA, userIdB) {
  const [low, high] = [Number(userIdA), Number(userIdB)].sort((a, b) => a - b);
  return `dm:${low}:${high}`;
}
