import { createUserRepository } from './userRepository.js';
import { createConversationRepository } from './conversationRepository.js';
import { createMessageRepository } from './messageRepository.js';

/** Builds every repository on top of one database handle (pg.Pool or pg-mem). */
export function createRepositories(db) {
  return {
    users: createUserRepository(db),
    conversations: createConversationRepository(db),
    messages: createMessageRepository(db),
  };
}
