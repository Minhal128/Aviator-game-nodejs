/**
 * Realtime broadcaster for pool-crash rounds.
 * Clients emit watch{game_id}; this polls Laravel /game/server/tick and broadcasts.
 *
 * Run: node game-server.js
 * Env: LARAVEL_URL=http://127.0.0.1:8000 GAME_SERVER_SECRET=change-me PORT=3001
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;
const LARAVEL_URL = (process.env.LARAVEL_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const SECRET = process.env.GAME_SERVER_SECRET || 'change-me';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/** @type {Map<string, number>} gameId -> watcher count */
const watching = new Map();

io.on('connection', (socket) => {
  let joined = null;

  socket.on('watch', (payload) => {
    const gameId = String(payload && payload.game_id ? payload.game_id : '');
    if (!gameId) return;
    if (joined) {
      socket.leave('round:' + joined);
      watching.set(joined, Math.max(0, (watching.get(joined) || 1) - 1));
      if ((watching.get(joined) || 0) === 0) watching.delete(joined);
    }
    joined = gameId;
    socket.join('round:' + gameId);
    watching.set(gameId, (watching.get(gameId) || 0) + 1);
  });

  socket.on('disconnect', () => {
    if (!joined) return;
    watching.set(joined, Math.max(0, (watching.get(joined) || 1) - 1));
    if ((watching.get(joined) || 0) === 0) watching.delete(joined);
  });
});

async function pollGame(gameId) {
  const res = await fetch(LARAVEL_URL + '/game/server/tick', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Game-Secret': SECRET,
    },
    body: JSON.stringify({ game_id: Number(gameId) }),
  });
  if (!res.ok) return null;
  return res.json();
}

setInterval(async () => {
  for (const gameId of [...watching.keys()]) {
    try {
      const tick = await pollGame(gameId);
      if (!tick) continue;
      io.to('round:' + gameId).emit('tick', tick);
      if (tick.crashed) {
        watching.delete(gameId);
      }
    } catch (e) {
      // ponytail: swallow — Laravel may be down mid-deploy
    }
  }
}, 100);

app.get('/health', (_req, res) => res.json({ ok: true, watching: watching.size }));

server.listen(PORT, () => {
  console.log('game-server on :' + PORT + ' -> ' + LARAVEL_URL);
});
