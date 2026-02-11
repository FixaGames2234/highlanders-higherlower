import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * FEATURES:
 * - /health + /
 * - global leaderboard (best-effort persisted to server/leaderboard.json)
 * - room rules: targetScore, modifiers
 * - quick chat + emotes
 * - special scoring rules emitted to client
 */

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("Highlanders server running ✅"));
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ---------- leaderboard (best-effort persistence) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LB_FILE = path.join(__dirname, "leaderboard.json");

function safeName(s) {
  const t = String(s || "PLAYER").trim().slice(0, 16);
  return t || "PLAYER";
}
function loadLeaderboard() {
  try {
    const raw = fs.readFileSync(LB_FILE, "utf-8");
    const json = JSON.parse(raw);
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}
function saveLeaderboard(lb) {
  try {
    fs.writeFileSync(LB_FILE, JSON.stringify(lb.slice(0, 50), null, 2));
  } catch {
    // ignore (Render FS may reset)
  }
}
let leaderboard = loadLeaderboard(); // [{name, bestScore, bestStreak, updatedAt}]

function upsertLeaderboardEntry({ name, bestScore, bestStreak }) {
  name = safeName(name);
  const now = Date.now();
  const e = leaderboard.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!e) leaderboard.push({ name, bestScore, bestStreak, updatedAt: now });
  else {
    e.bestScore = Math.max(e.bestScore, bestScore);
    e.bestStreak = Math.max(e.bestStreak, bestStreak);
    e.updatedAt = now;
  }
  leaderboard.sort((a, b) =>
    (b.bestScore - a.bestScore) ||
    (b.bestStreak - a.bestStreak) ||
    (b.updatedAt - a.updatedAt)
  );
  leaderboard = leaderboard.slice(0, 50);
  saveLeaderboard(leaderboard);
}

app.get("/leaderboard", (req, res) => {
  res.json({ leaderboard: leaderboard.slice(0, 20) });
});

// ---------- room state ----------
const rooms = new Map();

function makeRoomCode() {
  return nanoid(6).toUpperCase().replace(/[-_]/g, "A");
}
function z(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return 0.5;
  return v;
}
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    round: room.round,
    targetScore: room.targetScore,
    statKey: room.statKey,
    statLabel: room.statLabel,
    current: room.current,
    previous: room.previous,
    modifiers: room.modifiers,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      streak: p.streak,
      bestStreak: p.bestStreak,
      ping: p.ping || null // transient UI
    }))
  };
}

function pickNextGame(room) {
  const ds = room.dataset;
  if (!ds?.length) return null;

  const lastPlayer = room.current?.player;
  for (let tries = 0; tries < 10; tries++) {
    const g = pickRandom(ds);
    if (!lastPlayer || g.player !== lastPlayer) return g;
  }
  return pickRandom(ds);
}

function computeCorrectDir(prev, cur) {
  if (!prev) return null;
  return Number(cur.value) >= Number(prev.value) ? "higher" : "lower";
}

/**
 * SPECIAL RULES (applied on reveal):
 * - base: correct = +1 score
 * - streak bonus: streak >=3 => +1 extra (so +2 total)
 * - close-call bonus: if |cur-prev| <= closeCallThreshold => +1 extra (correct only)
 * - perfect round bonus (modifier): if everyone guessed and all correct => +1 to all
 * - comeback bonus: if player was on 0 streak and gets correct => +0.5 (we store as +1 but show “bonus”, to keep integers)
 *
 * Notes: scores are integers for simplicity. Bonuses are additional +1.
 */
function scoreReveal(room) {
  const prev = room.previous;
  const cur = room.current;
  if (!cur) return { correctDir: null, results: [] };

  const correctDir = computeCorrectDir(prev, cur);
  const closeThresh = room.modifiers.closeCallThreshold; // numeric
  const diff = prev ? Math.abs(Number(cur.value) - Number(prev.value)) : null;
  const isClose = prev ? diff <= closeThresh : false;

  const totalPlayers = room.players.length;
  const guessedCount = Object.keys(room.guesses).length;
  const everyoneGuessed = guessedCount >= totalPlayers;

  let allCorrect = true;

  const results = room.players.map(p => {
    const guess = room.guesses[p.id] || null;
    let correct = false;

    if (correctDir && guess) correct = (guess === correctDir);
    if (!correct) allCorrect = false;

    // compute bonus
    let gain = 0;
    const bonuses = [];

    if (correctDir && guess) {
      if (correct) {
        gain += 1; // base
        // comeback bonus (only as a “tag”; keep integer scoring)
        if (p.streak === 0) bonuses.push("COMEBACK");
        // close-call
        if (isClose) { gain += 1; bonuses.push("CLOSE CALL"); }
        // streak bonus
        if (p.streak >= 2) { // because streak increments after correct
          gain += 1;
          bonuses.push("STREAK+");
        }

        p.streak += 1;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
      } else {
        p.streak = 0;
      }
    } else {
      // no prev round or no guess
      if (correctDir) p.streak = 0;
    }

    p.score += gain;

    return {
      id: p.id,
      name: p.name,
      guess,
      correct,
      gain,
      bonuses,
      score: p.score,
      streak: p.streak,
      bestStreak: p.bestStreak
    };
  });

  // perfect round bonus
  if (room.modifiers.perfectRoundBonus && correctDir && everyoneGuessed && allCorrect) {
    results.forEach(r => {
      const pl = room.players.find(p => p.id === r.id);
      if (pl) pl.score += 1;
      r.gain += 1;
      r.bonuses.push("PERFECT ROUND");
      r.score = pl.score;
    });
  }

  return { correctDir, results, isClose, diff, closeThresh };
}

function maybeEndMatch(room) {
  const winner = room.players.find(p => p.score >= room.targetScore);
  if (!winner) return false;

  room.players.forEach(p => {
    upsertLeaderboardEntry({
      name: p.name,
      bestScore: p.score,
      bestStreak: p.bestStreak
    });
  });

  io.to(room.code).emit("matchEnded", {
    winner: { id: winner.id, name: winner.name, score: winner.score },
    leaderboard: leaderboard.slice(0, 20)
  });

  return true;
}

function startRound(room, roundTimeSec = 15) {
  room.round += 1;
  room.guesses = {};
  room.previous = room.current || null;

  // rotating stat surprise (modifier)
  if (room.modifiers.rotateStatEvery && room.round > 1 && (room.round - 1) % room.modifiers.rotateStatEvery === 0) {
    const options = room.modifiers.statDraftPool;
    const pick = pickRandom(options);
    room.statKey = pick.key;
    room.statLabel = pick.label;
    io.to(room.code).emit("toast", { type: "info", text: `STAT SHIFT: now playing ${pick.label}` });
  }

  const game = pickNextGame(room);
  if (!game) return;

  room.current = {
    player: game.player,
    date: game.date,
    opponent: game.opponent,
    label: room.statLabel,
    value: z(game[room.statKey]),
    raw: game
  };

  room.revealAt = Date.now() + roundTimeSec * 1000;

  io.to(room.code).emit("roundStart", {
    room: publicRoom(room),
    roundTime: roundTimeSec
  });

  // auto reveal
  setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r) return;
    if (Date.now() < r.revealAt - 5) return;
    revealRound(r);
  }, roundTimeSec * 1000 + 80);
}

function revealRound(room) {
  const prev = room.previous;
  const cur = room.current;
  if (!cur) return;

  const scored = scoreReveal(room);

  io.to(room.code).emit("roundReveal", {
    previous: prev,
    revealed: cur,
    correctDir: scored.correctDir,
    results: scored.results,
    meta: {
      isClose: scored.isClose,
      diff: scored.diff,
      closeThresh: scored.closeThresh,
      modifiers: room.modifiers
    }
  });

  io.to(room.code).emit("roomUpdate", publicRoom(room));

  if (!maybeEndMatch(room)) {
    // host will advance (client UX)
  }
}

// ---------- socket handlers ----------
io.on("connection", (socket) => {
  socket.on("getLeaderboard", () => {
    socket.emit("leaderboard", leaderboard.slice(0, 20));
  });

  socket.on("createRoom", ({ name }) => {
    const code = makeRoomCode();

    const statDraftPool = [
      { label: "PTS", key: "pts" }, { label: "REB", key: "reb" }, { label: "AST", key: "ast" },
      { label: "STL", key: "stl" }, { label: "BLK", key: "blk" }, { label: "TO", key: "to" },
      { label: "FGM", key: "fgm" }, { label: "FGA", key: "fga" }, { label: "3PM", key: "tpm" },
      { label: "3PA", key: "tpa" }, { label: "FTM", key: "ftm" }, { label: "FTA", key: "fta" },
      { label: "MIN", key: "min" }, { label: "PF", key: "pf" }
    ];

    const room = {
      code,
      hostId: socket.id,
      round: 0,
      targetScore: 12,
      statKey: "pts",
      statLabel: "PTS",
      dataset: null,
      current: null,
      previous: null,
      guesses: {},
      revealAt: 0,
      modifiers: {
        // surprises / rules toggles
        closeCallThreshold: 2.0,     // <= 2 is "close call"
        perfectRoundBonus: true,
        rotateStatEvery: 4,          // every N rounds, stat changes automatically
        statDraftPool,
        roundTimeSec: 15
      },
      players: [{
        id: socket.id,
        name: safeName(name),
        score: 0,
        streak: 0,
        bestStreak: 0
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

    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({
        id: socket.id,
        name: safeName(name),
        score: 0,
        streak: 0,
        bestStreak: 0
      });
    }

    socket.join(room.code);
    socket.emit("roomJoined", publicRoom(room));
    io.to(room.code).emit("roomUpdate", publicRoom(room));
  });

  socket.on("updateSettings", ({ code, targetScore, roundTimeSec, rotateStatEvery, closeCallThreshold, perfectRoundBonus }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    if (room.hostId !== socket.id) return;

    if (Number.isFinite(Number(targetScore))) room.targetScore = Math.max(3, Math.min(30, Number(targetScore)));
    if (Number.isFinite(Number(roundTimeSec))) room.modifiers.roundTimeSec = Math.max(8, Math.min(30, Number(roundTimeSec)));
    if (Number.isFinite(Number(rotateStatEvery))) room.modifiers.rotateStatEvery = Math.max(0, Math.min(10, Number(rotateStatEvery)));
    if (Number.isFinite(Number(closeCallThreshold))) room.modifiers.closeCallThreshold = Math.max(0.5, Math.min(10, Number(closeCallThreshold)));
    if (typeof perfectRoundBonus === "boolean") room.modifiers.perfectRoundBonus = perfectRoundBonus;

    io.to(room.code).emit("roomUpdate", publicRoom(room));
    io.to(room.code).emit("toast", { type: "info", text: "Host updated match settings." });
  });

  socket.on("startMatch", ({ code, dataset, stat, targetScore }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    if (room.hostId !== socket.id) return;

    room.dataset = Array.isArray(dataset) ? dataset : [];

    // host-chosen starting stat (optional)
    if (stat?.key && stat?.label) {
      room.statKey = stat.key;
      room.statLabel = stat.label;
    }

    if (Number.isFinite(Number(targetScore))) room.targetScore = Math.max(3, Math.min(30, Number(targetScore)));

    room.players.forEach(p => { p.score = 0; p.streak = 0; p.bestStreak = 0; });
    room.round = 0;
    room.current = null;
    room.previous = null;

    io.to(room.code).emit("matchStarted", publicRoom(room));

    const rt = room.modifiers.roundTimeSec || 15;
    startRound(room, rt);
  });

  socket.on("guess", ({ code, dir }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    if (!["higher", "lower"].includes(dir)) return;

    room.guesses[socket.id] = dir;

    const guessed = Object.keys(room.guesses).length;
    const total = room.players.length;

    io.to(room.code).emit("guessCount", { guessed, total });

    // reveal early if all guessed
    if (guessed >= total) {
      room.revealAt = Date.now();
      revealRound(room);
    }
  });

  socket.on("hostNextRound", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    if (room.hostId !== socket.id) return;

    const rt = room.modifiers.roundTimeSec || 15;
    startRound(room, rt);
  });

  // quick chat + emotes surprises
  socket.on("ping", ({ code, kind }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;

    const p = room.players.find(x => x.id === socket.id);
    if (!p) return;

    const allowed = ["🔥", "😤", "😂", "😮", "GG", "LOCK IN"];
    const msg = allowed.includes(kind) ? kind : "🔥";

    io.to(room.code).emit("ping", { from: p.name, kind: msg, at: Date.now() });
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);

        if (room.players.length === 0) {
          rooms.delete(code);
          continue;
        }
        if (room.hostId === socket.id) room.hostId = room.players[0].id;

        io.to(room.code).emit("roomUpdate", publicRoom(room));
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => console.log("Server listening on", PORT));

