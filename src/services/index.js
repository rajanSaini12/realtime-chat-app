import { createAuthService } from './authService.js';
import { createUserService } from './userService.js';
import { createChatService } from './chatService.js';

/**
 * Wires the services together. `realtime` (optional) is the small bridge to
 * Socket.io used for presence and for subscribing sockets to new rooms.
 */
export function createServices({ repos, config, realtime }) {
  return {
    authService: createAuthService({ repos, config }),
    userService: createUserService({ repos, presence: realtime }),
    chatService: createChatService({ repos, realtime }),
  };
}
