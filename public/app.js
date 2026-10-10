/* Realtime Chat browser client: plain JavaScript, no build step. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const TOKEN_KEY = 'chat.token';
  const PAGE_SIZE = 30;

  const state = {
    token: localStorage.getItem(TOKEN_KEY),
    me: null,
    socket: null,
    users: new Map(), // id -> { id, username, online }
    rooms: new Map(), // id -> { id, name, memberCount, isMember }
    directByUser: new Map(), // other user id -> direct conversation id
    unread: new Map(), // conversation id -> count
    active: null, // { kind: 'group'|'direct', conversationId, roomId?, userId? }
    nextCursor: null,
    renderedIds: new Set(),
    typingTimers: new Map(), // username -> timeout (for the active conversation)
  };

  // ---------------------------------------------------------------- REST ----
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token) logout();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ---------------------------------------------------------------- Auth ----
  let authMode = 'login';

  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      authMode = tab.dataset.mode;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#auth-submit').textContent = authMode === 'login' ? 'Log in' : 'Create account';
      $('#auth-error').textContent = '';
    }),
  );

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const submit = $('#auth-submit');
    submit.disabled = true;
    $('#auth-error').textContent = '';
    try {
      const { token } = await api(`/api/auth/${authMode}`, {
        method: 'POST',
        body: { username: form.get('username'), password: form.get('password') },
      });
      state.token = token;
      localStorage.setItem(TOKEN_KEY, token);
      await startChat();
    } catch (err) {
      $('#auth-error').textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    if (state.socket) state.socket.disconnect();
    location.reload();
  }
  $('#logout').addEventListener('click', logout);

  // ------------------------------------------------------------- Startup ----
  async function startChat() {
    const { user } = await api('/api/users/me');
    state.me = user;
    $('#me-name').textContent = user.username;
    $('#auth-view').hidden = true;
    $('#chat-view').hidden = false;
    await Promise.all([loadUsers(), loadRooms()]);
    connectSocket();
  }

  async function loadUsers() {
    const { users } = await api('/api/users');
    state.users = new Map(users.map((u) => [u.id, u]));
    renderUsers();
  }

  async function loadRooms() {
    const { rooms } = await api('/api/rooms');
    state.rooms = new Map(rooms.map((r) => [r.id, r]));
    renderRooms();
  }

  // -------------------------------------------------------------- Socket ----
  function connectSocket() {
    // The JWT is sent in the handshake; the server rejects the connection without it.
    const socket = io({ auth: { token: state.token } });
    state.socket = socket;

    socket.on('session', ({ instance }) => {
      $('#instance-label').textContent = `connected to ${instance}`;
    });
    socket.on('disconnect', () => {
      $('#instance-label').textContent = 'reconnecting…';
    });
    socket.on('connect_error', (err) => {
      if (/token|Authentication/i.test(err.message)) logout();
      $('#instance-label').textContent = 'connection error, retrying…';
    });

    socket.on('message:new', onMessage);

    socket.on('presence:update', ({ userId, online }) => {
      const user = state.users.get(userId);
      if (!user) return loadUsers(); // someone new registered
      user.online = online;
      renderUsers();
      if (state.active?.kind === 'direct' && state.active.userId === userId) renderChatHeader();
    });

    socket.on('room:created', (room) => {
      if (!state.rooms.has(room.id)) {
        state.rooms.set(room.id, { ...room, isMember: false });
        renderRooms();
      }
    });

    socket.on('typing', ({ conversationId, username, isTyping }) => {
      if (state.active?.conversationId !== conversationId) return;
      clearTimeout(state.typingTimers.get(username));
      if (isTyping) {
        // Auto-expire in case the "stopped typing" event is lost.
        state.typingTimers.set(
          username,
          setTimeout(() => {
            state.typingTimers.delete(username);
            renderTyping();
          }, 5000),
        );
      } else {
        state.typingTimers.delete(username);
      }
      renderTyping();
    });
  }

  /** Emits a socket event and turns the acknowledgement into a Promise. */
  function emit(event, payload) {
    return new Promise((resolve, reject) => {
      state.socket.timeout(10000).emit(event, payload, (err, res) => {
        if (err) return reject(new Error('Server did not respond'));
        if (!res.ok) return reject(new Error(res.error));
        resolve(res);
      });
    });
  }

  function onMessage(message) {
    if (message.type === 'direct') {
      const otherId = message.participants.find((id) => id !== state.me.id);
      state.directByUser.set(otherId, message.conversationId);
    }
    if (state.active?.conversationId === message.conversationId) {
      appendMessages([message], { scroll: true });
    } else if (message.senderId !== state.me.id) {
      state.unread.set(message.conversationId, (state.unread.get(message.conversationId) || 0) + 1);
      renderUsers();
      renderRooms();
    }
  }

  // ------------------------------------------------------------ Sidebar ----
  function listButton({ label, active, marker, unread, onClick }) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = active ? 'active' : '';
    btn.append(marker);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    btn.append(name);
    if (unread) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = unread;
      btn.append(badge);
    }
    btn.addEventListener('click', onClick);
    li.append(btn);
    return li;
  }

  function renderUsers() {
    const list = $('#user-list');
    list.replaceChildren();
    const others = [...state.users.values()].filter((u) => u.id !== state.me.id);
    // Online users first, then alphabetical.
    others.sort((a, b) => b.online - a.online || a.username.localeCompare(b.username));
    for (const user of others) {
      const dot = document.createElement('span');
      dot.className = `dot${user.online ? ' online' : ''}`;
      dot.title = user.online ? 'online' : 'offline';
      list.append(
        listButton({
          label: user.username,
          marker: dot,
          active: state.active?.kind === 'direct' && state.active.userId === user.id,
          unread: state.unread.get(state.directByUser.get(user.id)),
          onClick: () => openDirect(user.id),
        }),
      );
    }
    if (!others.length) list.innerHTML = '<li class="muted small">No other users yet.</li>';
  }

  function renderRooms() {
    const list = $('#room-list');
    list.replaceChildren();
    for (const room of state.rooms.values()) {
      const hash = document.createElement('span');
      hash.className = 'hash';
      hash.textContent = '#';
      list.append(
        listButton({
          label: room.name,
          marker: hash,
          active: state.active?.kind === 'group' && state.active.roomId === room.id,
          unread: state.unread.get(room.id),
          onClick: () => openRoom(room.id),
        }),
      );
    }
    if (!state.rooms.size) list.innerHTML = '<li class="muted small">No rooms yet.</li>';
  }

  $('#room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#room-name');
    const name = input.value.trim();
    if (!name) return;
    try {
      const { room } = await api('/api/rooms', { method: 'POST', body: { name } });
      state.rooms.set(room.id, room);
      input.value = '';
      renderRooms();
      openRoom(room.id);
    } catch (err) {
      alert(err.message);
    }
  });

  // --------------------------------------------------------- Chat pane ----
  async function openRoom(roomId) {
    await loadRooms(); // refresh member counts (other users may have joined)
    const room = state.rooms.get(roomId);
    await openConversation({ kind: 'group', conversationId: room.id, roomId: room.id });
  }

  async function openDirect(userId) {
    try {
      let conversationId = state.directByUser.get(userId);
      if (!conversationId) {
        const { conversation } = await api('/api/conversations/direct', {
          method: 'POST',
          body: { userId },
        });
        conversationId = conversation.id;
        state.directByUser.set(userId, conversationId);
      }
      await openConversation({ kind: 'direct', conversationId, userId });
    } catch (err) {
      alert(err.message);
    }
  }

  async function openConversation(active) {
    stopTyping();
    state.active = active;
    state.nextCursor = null;
    state.renderedIds.clear();
    state.typingTimers.forEach(clearTimeout);
    state.typingTimers.clear();
    state.unread.delete(active.conversationId);

    $('#message-list').replaceChildren();
    $('#empty-state').hidden = true;
    $('#chat-pane').hidden = false;
    $('#chat-view').classList.add('chat-open');
    renderChatHeader();
    renderTyping();
    renderUsers();
    renderRooms();

    const isMember = active.kind === 'direct' || state.rooms.get(active.roomId).isMember;
    $('#join-bar').hidden = isMember;
    $('#composer').hidden = !isMember;
    $('#load-older').hidden = true;
    if (isMember) {
      await loadHistory();
      $('#message-input').focus();
    }
  }

  function renderChatHeader() {
    const a = state.active;
    if (!a) return;
    if (a.kind === 'group') {
      const room = state.rooms.get(a.roomId);
      $('#chat-title').textContent = `# ${room.name}`;
      $('#chat-subtitle').textContent = `${room.memberCount} member(s)`;
    } else {
      const user = state.users.get(a.userId);
      $('#chat-title').textContent = user.username;
      $('#chat-subtitle').textContent = user.online ? 'online' : 'offline';
    }
  }

  $('#back').addEventListener('click', () => {
    stopTyping();
    state.active = null;
    $('#chat-view').classList.remove('chat-open');
    $('#chat-pane').hidden = true;
    $('#empty-state').hidden = false;
    renderUsers();
    renderRooms();
  });

  $('#join-room').addEventListener('click', async () => {
    const room = state.rooms.get(state.active.roomId);
    try {
      await api(`/api/rooms/${room.id}/join`, { method: 'POST' });
      await openRoom(room.id); // reloads rooms, so isMember/memberCount are fresh
    } catch (err) {
      alert(err.message);
    }
  });

  /** Loads the next page of older messages (cursor-based pagination). */
  async function loadHistory() {
    const conversationId = state.active.conversationId;
    const params = new URLSearchParams({ limit: PAGE_SIZE });
    if (state.nextCursor) params.set('cursor', state.nextCursor);
    const { messages, nextCursor } = await api(
      `/api/conversations/${conversationId}/messages?${params}`,
    );
    if (state.active?.conversationId !== conversationId) return; // user switched chats
    state.nextCursor = nextCursor;
    $('#load-older').hidden = !nextCursor;
    // The API returns newest first; the UI shows oldest at the top.
    prependMessages(messages.reverse());
  }

  $('#load-older').addEventListener('click', loadHistory);

  function messageElement(m) {
    const li = document.createElement('li');
    li.className = `message${m.senderId === state.me.id ? ' mine' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = new Date(m.createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    meta.textContent = `${m.senderUsername ?? 'deleted user'} · ${time}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.body; // textContent, never innerHTML: prevents XSS
    li.append(meta, bubble);
    return li;
  }

  function fresh(messages) {
    return messages.filter((m) => {
      if (state.renderedIds.has(m.id)) return false;
      state.renderedIds.add(m.id);
      return true;
    });
  }

  function prependMessages(messages) {
    const box = $('#messages');
    const isFirstPage = state.renderedIds.size === 0;
    const previousHeight = box.scrollHeight;
    $('#message-list').prepend(...fresh(messages).map(messageElement));
    // First page: jump to the newest message. Older pages: keep the view steady.
    box.scrollTop = isFirstPage ? box.scrollHeight : box.scrollHeight - previousHeight;
  }

  function appendMessages(messages, { scroll }) {
    const box = $('#messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    $('#message-list').append(...fresh(messages).map(messageElement));
    if (scroll && nearBottom) box.scrollTop = box.scrollHeight;
  }

  // ---------------------------------------------------------- Composer ----
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#message-input');
    const body = input.value.trim();
    if (!body || !state.active) return;
    stopTyping();
    const a = state.active;
    // Clear right away so the user can keep typing while this one is in flight.
    input.value = '';
    try {
      const { message } =
        a.kind === 'group'
          ? await emit('group:message', { roomId: a.roomId, body })
          : await emit('private:message', { toUserId: a.userId, body });
      // The server also broadcasts message:new to us; renderedIds prevents a duplicate.
      if (state.active?.conversationId === message.conversationId) {
        appendMessages([message], { scroll: true });
        $('#messages').scrollTop = $('#messages').scrollHeight;
      }
    } catch (err) {
      if (!input.value) input.value = body; // give the unsent text back
      alert(err.message);
    }
  });

  // Typing indicator: send "typing: true" once, then "false" after 2s of no input.
  let typingSent = false;
  let typingTimeout;

  function stopTyping() {
    clearTimeout(typingTimeout);
    if (typingSent && state.active) {
      state.socket.emit('typing', { conversationId: state.active.conversationId, isTyping: false });
    }
    typingSent = false;
  }

  $('#message-input').addEventListener('input', () => {
    if (!state.active || !state.socket) return;
    if (!typingSent) {
      state.socket.emit('typing', { conversationId: state.active.conversationId, isTyping: true });
      typingSent = true;
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 2000);
  });

  function renderTyping() {
    const names = [...state.typingTimers.keys()];
    $('#typing').textContent =
      names.length === 0
        ? ''
        : names.length === 1
          ? `${names[0]} is typing…`
          : `${names.join(', ')} are typing…`;
  }

  // ------------------------------------------------------------- Boot ----
  if (state.token) {
    startChat().catch(() => logout());
  } else {
    $('#auth-view').hidden = false;
  }
})();
