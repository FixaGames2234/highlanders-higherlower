import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Highlanders server is running ✅");
});
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // tighten after Netlify URL is known
    methods: ["GET", "POST"]
  }
});

/**
 * Room state:
 * room = {
 *  code, hostId,
 *  players: [{id,name,score,streak,lastGuessCorrect}],
 *  round, statKey, statLabel,
 *  dataset: [games...],
 *  current: {player,date,opponent,label,value,raw},
 *  previous: { ... },
 *  guesses: { [socketId]: "higher"|"lower" },
 *  revealAt: number (ms)
 * }
 */
const rooms = new Map();

function makeRoomCode() {
  // 6 char readable
  return nanoid(6).toUpperCase().replace(/[-_]/g, "A");
}

function safeName(s) {
  const t = String(s || "PLAYER").trim().slice(0, 16);
  return t || "PLAYER";
}

function z(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return 0.5;
  return v;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickNextGame(room) {
  // Avoid exact same player 2x in a row if possible
  const ds = room.dataset;
  if (!ds?.length) return null;

  const lastPlayer = room.current?.player;
  for (let tries = 0; tries < 10; tries++) {
    const g = pickRandom(ds);
    if (!lastPlayer || g.player !== lastPlayer) return g;
  }
  return pickRandom(ds);
}

function startRound(room, roundTimeSec = 15) {
  room.round += 1;
  room.guesses = {};
  room.previous = room.current || null;

  const game = pickNextGame(room);
  if (!game) return;

  const rawVal = z(game[room.statKey]);
  room.current = {
    player: game.player,
    date: game.date,
    opponent: game.opponent,
    label: room.statLabel,
    value: rawVal,
    raw: game
  };

  room.revealAt = Date.now() + roundTimeSec * 1000;

  io.to(room.code).emit("roundStart", {
    room: publicRoom(room),
    roundTime: roundTimeSec
  });

  // Auto reveal when time ends
  setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r) return;
    // if already revealed/advanced, ignore
    if (Date.now() < r.revealAt - 5) return;
    revealRound(r);
  }, roundTimeSec * 1000 + 50);
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    round: room.round,
    statKey: room.statKey,
    statLabel: room.statLabel,
    current: room.current,
    previous: room.previous,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      streak: p.streak
    }))
  };
}

function revealRound(room) {
  // Must have both previous and current to judge higher/lower.
  // For round 1, we reveal but no scoring (or compare against itself).
  const prev = room.previous;
  const cur = room.current;
  if (!cur) return;

  let correctDir = null;
  if (prev) correctDir = Number(cur.value) >= Number(prev.value) ? "higher" : "lower";

  const results = room.players.map(p => {
    const guess = room.guesses[p.id] || null;
    let correct = false;

    if (correctDir && guess) correct = guess === correctDir;

    if (correct) {
      p.score += 1;
      p.streak += 1;
    } else {
      // if they guessed wrong or didn't guess
      p.streak = 0;
    }

    return {
      id: p.id,
      name: p.name,
      guess,
      correct,
      score: p.score,
      streak: p.streak
    };
  });

  io.to(room.code).emit("roundReveal", {
    previous: prev,
    revealed: cur,
    correctDir,
    results
  });

  io.to(room.code).emit("roomUpdate", publicRoom(room));
}

// Socket events
io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }) => {
    const code = makeRoomCode();
    const room = {
      code,
      hostId: socket.id,
      round: 0,
      statKey: null,
      statLabel: null,
      dataset: null,
      current: null,
      previous: null,
      guesses: {},
      revealAt: 0,
      players: [{
        id: socket.id,
        name: safeName(name),
        score: 0,
        streak: 0
      }]
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit("roomJoined", publicRoom(room));
    io.to(code).emit("roomUpdate", publicRoom(room));
  });

  socket.on("joinRoom", ({ code, name }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return socket.emit("roomError", { message: "Room not found." });

    // prevent duplicates
    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({
        id: socket.id,
        name: safeName(name),
        score: 0,
        streak: 0
      });
    }
    socket.join(room.code);
    socket.emit("roomJoined", publicRoom(room));
    io.to(room.code).emit("roomUpdate", publicRoom(room));
  });

  socket.on("startMatch", ({ code, dataset, stat }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    if (room.hostId !== socket.id) return;

    // dataset comes from client; ok for your friend game.
    // if you want more secure, store dataset server-side.
    room.dataset = Array.isArray(dataset) ? dataset : [];
    room.statKey = stat?.key;
    room.statLabel = stat?.label;

    // reset scores
    room.players.forEach(p => { p.score = 0; p.streak = 0; });
    room.round = 0;
    room.current = null;
    room.previous = null;

    io.to(room.code).emit("matchStarted", publicRoom(room));
    startRound(room, 15);
  });

  socket.on("guess", ({ code, dir }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    if (!["higher", "lower"].includes(dir)) return;

    // record guess once
    room.guesses[socket.id] = dir;

    const guessed = Object.keys(room.guesses).length;
    const total = room.players.length;

    io.to(room.code).emit("guessCount", { guessed, total });

    // If everyone guessed, reveal early
    if (guessed >= total) {
      room.revealAt = Date.now();
      revealRound(room);
    }
  });

  socket.on("hostNextRound", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    if (room.hostId !== socket.id) return;

    startRound(room, 15);
  });

  socket.on("disconnect", () => {
    // remove from rooms; if host leaves, promote next player
    for (const [code, room] of rooms) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);

        if (room.players.length === 0) {
          rooms.delete(code);
          continue;
        }

        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
        }

        io.to(room.code).emit("roomUpdate", publicRoom(room));
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Server listening on", PORT);
});
