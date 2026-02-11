import Phaser from "phaser";
import { io } from "socket.io-client";

// ✅ this is set by Netlify environment variables later
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

/* -------------------------
   Parse stats (0 -> 0.5)
------------------------- */
function parseStats(raw) {
  const lines = raw.split(/\r?\n/);
  const games = [];
  let currentPlayer = null;
  let reading = false;

  const z = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v === 0) return 0.5;
    return v;
  };

  for (let line of lines) {
    const t = line.trim();
    if (!t) continue;

    const playerMatch = t.match(/^(.+?)\s*-\s*Game Statistics$/i);
    if (playerMatch) {
      currentPlayer = playerMatch[1].trim();
      reading = false;
      continue;
    }

    if (t.startsWith("Date\tOpponent")) {
      reading = true;
      continue;
    }

    if (/^-{3,}$/.test(t)) {
      reading = false;
      continue;
    }

    if (reading && currentPlayer) {
      const parts = line.split("\t");
      if (parts.length < 13) continue;

      const [date, opponent, pts, min, fg, tp, ft, reb, ast, blk, stl, to, pf] = parts;
      const [fgm, fga] = (fg || "0-0").split("-").map(Number);
      const [tpm, tpa] = (tp || "0-0").split("-").map(Number);
      const [ftm, fta] = (ft || "0-0").split("-").map(Number);

      games.push({
        player: currentPlayer,
        date: date.trim(),
        opponent: opponent.trim(),
        pts: z(pts),
        min: z(min),
        reb: z(reb),
        ast: z(ast),
        blk: z(blk),
        stl: z(stl),
        to: z(to),
        pf: z(pf),
        fgm: z(fgm),
        fga: z(fga),
        tpm: z(tpm),
        tpa: z(tpa),
        ftm: z(ftm),
        fta: z(fta)
      });
    }
  }
  return games;
}

/* -------------------------
   Stat pool
------------------------- */
const STAT_POOL = [
  ["PTS", "pts"], ["REB", "reb"], ["AST", "ast"], ["STL", "stl"], ["BLK", "blk"], ["TO", "to"],
  ["MIN", "min"], ["FGM", "fgm"], ["FGA", "fga"], ["3PM", "tpm"], ["3PA", "tpa"], ["FTM", "ftm"], ["FTA", "fta"], ["PF", "pf"]
];

/* -------------------------
   App session state
------------------------- */
const Session = {
  socket: null,
  myId: null,
  room: null,
  dataset: [],
  name: "PLAYER",
  get isHost() { return Session.room?.hostId === Session.myId; }
};

function makeButton(scene, x, y, w, h, label, onClick, stroke=0xD7B56D) {
  const bg = scene.add.rectangle(x, y, w, h, 0x0E1629, 1).setStrokeStyle(2, stroke).setDepth(1);
  const txt = scene.add.text(x, y, label, {
    fontFamily: "Arial",
    fontSize: Math.floor(h * 0.35) + "px",
    color: "#F5F7FF"
  }).setOrigin(0.5).setDepth(2);

  bg.setInteractive({ useHandCursor: true });
  bg.on("pointerover", () => bg.setFillStyle(0x15213B));
  bg.on("pointerout",  () => bg.setFillStyle(0x0E1629));
  bg.on("pointerdown", onClick);

  return { bg, txt };
}

/* -------------------------
   BOOT
------------------------- */
class Boot extends Phaser.Scene {
  constructor(){ super("boot"); }
  preload() {
    this.load.text("rawStats", "data/raw_stats.txt");
  }
  create() {
    // Visual loading fallback (never black-screen silently)
    this.add.rectangle(512, 384, 1024, 768, 0x070A12);
    this.add.text(30, 30, "Loading dataset...", { fontFamily:"Arial", fontSize:"22px", color:"#F5F7FF" });

    try {
      const raw = this.cache.text.get("rawStats");
      Session.dataset = parseStats(raw);
      this.scene.start("menu");
    } catch (e) {
      console.error(e);
      this.add.text(30, 70, "Failed to load stats. Check /data/raw_stats.txt", { fontFamily:"Arial", fontSize:"18px", color:"#FF4D6D" });
    }
  }
}

/* -------------------------
   MENU
------------------------- */
class Menu extends Phaser.Scene {
  constructor(){ super("menu"); }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    // Background
    this.add.rectangle(w/2, h/2, w, h, 0x070A12);

    // Title
    this.add.text(w/2, h*0.20, "HIGHLANDERS\nHIGHER / LOWER", {
      fontFamily: "Arial",
      fontSize: "58px",
      color: "#F5F7FF",
      align: "center"
    }).setOrigin(0.5);

    this.add.text(w/2, h*0.30, "Party game: guess if the next stat is higher or lower.\nPlay online with a room code.", {
      fontFamily: "Arial",
      fontSize: "20px",
      color: "#B9C2D3",
      align: "center"
    }).setOrigin(0.5);

    // Inputs
    this.dom = this.add.dom(w/2, h*0.44).createFromHTML(`
      <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
        <input id="nm" placeholder="Name" maxlength="16"
          style="width:320px; padding:12px; font-size:18px; border-radius:12px;
          border:2px solid #D7B56D; background:#0E1629; color:#F5F7FF; outline:none;" />
        <input id="cd" placeholder="Room Code (to join)" maxlength="6"
          style="width:320px; padding:12px; font-size:18px; border-radius:12px;
          border:2px solid #2A3756; background:#0B1221; color:#F5F7FF; outline:none; text-transform:uppercase;" />
      </div>
    `);

    // Socket status
    this.sockTxt = this.add.text(20, h-30, "Socket: ...", {
      fontFamily:"Arial", fontSize:"18px", color:"#B9C2D3"
    });

    makeButton(this, w/2, h*0.60, 460, 72, "PRACTICE (OFFLINE)", () => this.scene.start("offline"), 0x39D98A);
    makeButton(this, w/2, h*0.72, 460, 72, "CREATE LOBBY", () => this.createLobby());
    makeButton(this, w/2, h*0.84, 460, 72, "JOIN LOBBY", () => this.joinLobby());

    this.ensureSocket();

    this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => {
        const s = Session.socket;
        this.sockTxt.setText("Socket: " + (s?.connected ? "CONNECTED ✅" : "NOT CONNECTED ❌"));
      }
    });
  }

  ensureSocket() {
    if (Session.socket) return;

    Session.socket = io(SERVER_URL, {
      transports: ["websocket", "polling"] // Safari-friendly
    });

    // Debug handle
    window.__sock = Session.socket;

    Session.socket.on("connect", () => {
      Session.myId = Session.socket.id;
    });

    Session.socket.on("roomError", (e) => alert(e?.message || "Room error"));

    Session.socket.on("roomJoined", (room) => {
      Session.room = room;
      this.scene.start("lobby");
    });

    Session.socket.on("roomUpdate", (room) => {
      Session.room = room;
    });

    Session.socket.on("matchStarted", (room) => {
      Session.room = room;
      this.scene.start("online");
    });

    Session.socket.on("roundStart", ({ room, roundTime }) => {
      Session.room = room;
      this.game.events.emit("roundStart", { room, roundTime });
    });

    Session.socket.on("guessCount", (x) => this.game.events.emit("guessCount", x));
    Session.socket.on("roundReveal", (x) => this.game.events.emit("roundReveal", x));
  }

  readInputs() {
    const nm = this.dom.getChildByID("nm")?.value?.trim() || "PLAYER";
    const cd = (this.dom.getChildByID("cd")?.value || "").trim().toUpperCase();
    Session.name = nm.slice(0, 16);
    return { nm: Session.name, cd };
  }

  createLobby() {
    const { nm } = this.readInputs();
    Session.socket.emit("createRoom", { name: nm });
  }

  joinLobby() {
    const { nm, cd } = this.readInputs();
    if (!cd) return alert("Enter a room code first.");
    Session.socket.emit("joinRoom", { code: cd, name: nm });
  }
}

/* -------------------------
   LOBBY
------------------------- */
class Lobby extends Phaser.Scene {
  constructor(){ super("lobby"); }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(w/2, h/2, w, h, 0x070A12);
    this.title = this.add.text(w/2, 24, "", { fontFamily:"Arial", fontSize:"34px", color:"#D7B56D" }).setOrigin(0.5,0);

    this.playersTxt = this.add.text(60, 110, "", { fontFamily:"Arial", fontSize:"22px", color:"#F5F7FF", lineSpacing: 10 });

    this.btnStart = makeButton(this, w/2, h*0.78, 520, 72, "START MATCH (HOST)", () => this.startMatch(), 0x39D98A);
    makeButton(this, w/2, h*0.90, 420, 56, "BACK TO MENU", () => this.scene.start("menu"), 0xFF4D6D);

    this.refresh();

    this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.refresh()
    });
  }

  refresh() {
    const room = Session.room;
    if (!room) return;

    this.title.setText(`LOBBY — CODE: ${room.code} ${Session.isHost ? "(HOST)" : ""}`);

    const players = room.players.slice().sort((a,b)=>b.score-a.score);
    this.playersTxt.setText(players.map(p => {
      const host = p.id === room.hostId ? " ⭐" : "";
      return `${p.name}${host}   score:${p.score}  streak:${p.streak}`;
    }).join("\n"));

    this.btnStart.bg.setAlpha(Session.isHost ? 1 : 0.25);
    this.btnStart.bg.disableInteractive();
    if (Session.isHost) this.btnStart.bg.setInteractive({ useHandCursor: true });
  }

  startMatch() {
    if (!Session.isHost) return;

    const [label, key] = STAT_POOL[Math.floor(Math.random() * STAT_POOL.length)];
    Session.socket.emit("startMatch", {
      code: Session.room.code,
      dataset: Session.dataset,
      stat: { label, key }
    });
  }
}

/* -------------------------
   OFFLINE PRACTICE
------------------------- */
class Offline extends Phaser.Scene {
  constructor(){ super("offline"); }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(w/2, h/2, w, h, 0x070A12);

    const games = Session.dataset;
    if (!games.length) {
      this.add.text(w/2, h/2, "Dataset failed to load.", { fontFamily:"Arial", fontSize:"28px", color:"#FF4D6D" }).setOrigin(0.5);
      return;
    }

    let score = 0;
    let streak = 0;

    const statLine = this.add.text(20, 20, "Score:0  Streak:0", { fontFamily:"Arial", fontSize:"22px", color:"#F5F7FF" });
    const [label, key] = STAT_POOL[Math.floor(Math.random() * STAT_POOL.length)];

    const pick = () => games[Math.floor(Math.random() * games.length)];
    let cur = pick();
    let nxt = pick();

    const card = this.add.rectangle(w/2, h*0.42, Math.min(900,w-30), 320, 0x0E1629).setStrokeStyle(2, 0xD7B56D);
    const txt = this.add.text(w/2, h*0.42, "", { fontFamily:"Arial", fontSize:"30px", color:"#F5F7FF", align:"center", lineSpacing: 10 }).setOrigin(0.5);

    const render = (msg="") => {
      txt.setText(
        `${msg}\n${cur.player}\n${cur.date} vs ${cur.opponent}\n\n${label}: ${cur[key]}\n\nHigher or Lower?`
      );
    };

    const guess = (dir) => {
      const correctDir = Number(nxt[key]) >= Number(cur[key]) ? "higher" : "lower";
      const ok = dir === correctDir;

      if (ok) { score++; streak++; card.setStrokeStyle(3, 0x39D98A); }
      else { streak = 0; card.setStrokeStyle(3, 0xFF4D6D); }

      statLine.setText(`Score:${score}  Streak:${streak}`);

      cur = nxt;
      nxt = pick();

      this.time.delayedCall(350, () => card.setStrokeStyle(2, 0xD7B56D));
      render(ok ? "✅ Correct!" : "❌ Wrong!");
    };

    makeButton(this, w/2 - 170, h*0.80, 300, 74, "LOWER", () => guess("lower"));
    makeButton(this, w/2 + 170, h*0.80, 300, 74, "HIGHER", () => guess("higher"));

    makeButton(this, w/2, h*0.92, 420, 56, "BACK TO MENU", () => this.scene.start("menu"), 0xFF4D6D);

    render("");
  }
}

/* -------------------------
   ONLINE MATCH
------------------------- */
class Online extends Phaser.Scene {
  constructor(){ super("online"); }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(w/2, h/2, w, h, 0x070A12);

    this.title = this.add.text(w/2, 16, "", { fontFamily:"Arial", fontSize:"24px", color:"#D7B56D" }).setOrigin(0.5,0);
    this.timerTxt = this.add.text(w/2, 48, "", { fontFamily:"Arial", fontSize:"20px", color:"#F5F7FF" }).setOrigin(0.5,0);
    this.guessTxt = this.add.text(w/2, 76, "", { fontFamily:"Arial", fontSize:"18px", color:"#B9C2D3" }).setOrigin(0.5,0);

    this.cardBox = this.add.rectangle(w/2, h*0.42, Math.min(940,w-30), 340, 0x0E1629).setStrokeStyle(2, 0xD7B56D);
    this.cardTxt = this.add.text(w/2, h*0.42, "", { fontFamily:"Arial", fontSize:"28px", color:"#F5F7FF", align:"center", lineSpacing: 10 }).setOrigin(0.5);

    this.resultsTxt = this.add.text(40, h*0.68, "", { fontFamily:"Arial", fontSize:"18px", color:"#F5F7FF", lineSpacing: 8 });

    this.btnLower = makeButton(this, w/2 - 170, h*0.82, 300, 74, "LOWER", () => this.sendGuess("lower"));
    this.btnHigher= makeButton(this, w/2 + 170, h*0.82, 300, 74, "HIGHER",() => this.sendGuess("higher"));

    this.btnHostNext = makeButton(this, w/2, h*0.92, 460, 56, "HOST: NEXT ROUND", () => this.hostNext(), 0x39D98A);

    this.roundTime = 15;
    this.timeLeft = 0;

    this.game.events.on("roundStart", this.onRoundStart, this);
    this.game.events.on("guessCount", this.onGuessCount, this);
    this.game.events.on("roundReveal", this.onRoundReveal, this);

    if (Session.room?.current) this.renderCard(Session.room);
  }

  renderCard(room, msg="") {
    this.title.setText(`ROOM ${room.code} • Round ${room.round} • Stat: ${room.statLabel}`);
    const c = room.current;
    const p = room.previous;

    if (!c) return;

    const prevLine = p ? `Previous: ${p.player} — ${p.label}: ${p.value}\n\n` : "";
    this.cardTxt.setText(
      `${msg}\n${prevLine}${c.player}\n${c.date} vs ${c.opponent}\n\n${c.label}: ${c.value}\n\nHigher or Lower?`
    );

    this.btnHostNext.bg.setAlpha(Session.isHost ? 1 : 0.25);
  }

  onRoundStart({ room, roundTime }) {
    Session.room = room;
    this.roundTime = roundTime || 15;
    this.timeLeft = this.roundTime;
    this.resultsTxt.setText("");

    this.enableGuess(true);

    this.guessTxt.setText(`Guessed: 0 / ${room.players.length}`);
    this.timerTxt.setText(`Time: ${this.timeLeft}s`);

    if (this._timer) this._timer.remove(false);
    this._timer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.timeLeft--;
        this.timerTxt.setText(`Time: ${Math.max(0,this.timeLeft)}s`);
        if (this.timeLeft <= 0) this._timer.remove(false);
      }
    });

    this.renderCard(room, "");
  }

  onGuessCount({ guessed, total }) {
    this.guessTxt.setText(`Guessed: ${guessed} / ${total}`);
  }

  sendGuess(dir) {
    if (!Session.room) return;
    this.enableGuess(false);
    Session.socket.emit("guess", { code: Session.room.code, dir });
  }

  enableGuess(on) {
    const alpha = on ? 1 : 0.35;
    [this.btnLower, this.btnHigher].forEach(b => {
      b.bg.setAlpha(alpha);
      b.bg.disableInteractive();
      if (on) b.bg.setInteractive({ useHandCursor: true });
    });
  }

  onRoundReveal(payload) {
    const r = payload.revealed;

    this.cardBox.setStrokeStyle(3, 0xD7B56D);
    this.cardTxt.setText(
      `${r.player}\n${r.date} vs ${r.opponent}\n\n${r.label}: ${r.value}\n\nCorrect: ${(payload.correctDir||"—").toUpperCase()}`
    );

    const lines = payload.results
      .slice()
      .sort((a,b)=>b.score-a.score)
      .map(p => `${p.correct ? "✅" : "❌"} ${p.name}  score:${p.score}  streak:${p.streak}`)
      .join("\n");

    this.resultsTxt.setText("Results:\n" + lines);

    this.enableGuess(false);
    this.guessTxt.setText(Session.isHost ? "Host: click NEXT ROUND" : "Waiting for host…");
  }

  hostNext() {
    if (!Session.isHost) return;
    Session.socket.emit("hostNextRound", { code: Session.room.code });
  }
}

/* -------------------------
   Phaser config
------------------------- */
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#070A12",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768
  },
  dom: { createContainer: true },
  scene: [Boot, Menu, Lobby, Offline, Online]
});

