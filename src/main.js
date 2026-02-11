import Phaser from "phaser";
import { io } from "socket.io-client";
import "./style.css";
console.log("FRONTEND VERSION: v2.0-ui-overhaul");
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

/* =========================
   Avatar generator (stable)
========================= */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}
function hslToRgb(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) r = g = b = l;
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
function avatarColors(name) {
  const h = hashStr(name.toLowerCase());
  const hue = h % 360;
  const hue2 = (hue + 210) % 360;
  return { hue, hue2 };
}

/* =========================
   Tiny WebAudio SFX
========================= */
function tone(freq = 440, ms = 80, type = "sine", vol = 0.03) {
  try {
    const AC = window.__AC || (window.__AC = new (window.AudioContext || window.webkitAudioContext)());
    if (AC.state === "suspended") AC.resume();
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g);
    g.connect(AC.destination);
    o.start();
    o.stop(AC.currentTime + ms / 1000);
  } catch {}
}
const SFX = {
  click: () => tone(420, 60, "square", 0.025),
  hover: () => tone(520, 35, "triangle", 0.015),
  start: () => {
    tone(220, 90, "sine", 0.03);
    setTimeout(() => tone(330, 90, "sine", 0.03), 80);
    setTimeout(() => tone(440, 120, "sine", 0.03), 160);
  },
  correct: () => {
    tone(784, 70, "triangle", 0.04);
    setTimeout(() => tone(1046, 90, "triangle", 0.035), 70);
  },
  wrong: () => {
    tone(180, 120, "sawtooth", 0.04);
    setTimeout(() => tone(130, 140, "sawtooth", 0.03), 80);
  },
  reveal: () => {
    tone(300, 50, "square", 0.02);
    setTimeout(() => tone(260, 90, "square", 0.02), 50);
  },
  countdown: () => tone(600, 40, "square", 0.018),
  win: () => {
    tone(523, 120, "triangle", 0.04);
    setTimeout(() => tone(659, 120, "triangle", 0.04), 120);
    setTimeout(() => tone(784, 180, "triangle", 0.04), 240);
  }
};

/* =========================
   Parse pasted stats file
   0 -> 0.5 rule applied
========================= */
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
        date: (date || "").trim(),
        opponent: (opponent || "").trim(),
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

const STAT_POOL = [
  ["PTS","pts"],["REB","reb"],["AST","ast"],["STL","stl"],["BLK","blk"],["TO","to"],
  ["FGM","fgm"],["FGA","fga"],["3PM","tpm"],["3PA","tpa"],["FTM","ftm"],["FTA","fta"],
  ["MIN","min"],["PF","pf"]
];

/* =========================
   Session
========================= */
const Session = {
  socket: null,
  myId: null,
  room: null,
  dataset: [],
  name: "PLAYER",
  globalLB: [],
  get isHost() { return Session.room?.hostId === Session.myId; }
};

/* =========================
   UI helpers
========================= */
function makeButton(scene, x, y, w, h, label, onClick, opts = {}) {
  const {
    stroke = 0xD7B56D,
    fill = 0x0E1629,
    fillHover = 0x142244,
    textColor = "#F5F7FF",
    fontSize = 22
  } = opts;

  const bg = scene.add.rectangle(x, y, w, h, fill, 1).setStrokeStyle(2, stroke);
  bg.setOrigin(0.5);
  bg.setInteractive({ useHandCursor: true });

  const txt = scene.add.text(x, y, label, {
    fontFamily: "Arial",
    fontSize: `${fontSize}px`,
    color: textColor
  }).setOrigin(0.5);

  const group = scene.add.container(0, 0, [bg, txt]);

  bg.on("pointerover", () => {
    bg.setFillStyle(fillHover);
    SFX.hover();
    scene.tweens.add({ targets: group, scaleX: 1.02, scaleY: 1.02, duration: 90 });
  });
  bg.on("pointerout", () => {
    bg.setFillStyle(fill);
    scene.tweens.add({ targets: group, scaleX: 1, scaleY: 1, duration: 90 });
  });
  bg.on("pointerdown", () => {
    SFX.click();
    scene.tweens.add({ targets: group, scaleX: 0.98, scaleY: 0.98, duration: 70, yoyo: true });
    onClick?.();
  });

  return {
    group,
    setEnabled(enabled) {
      bg.disableInteractive();
      if (enabled) bg.setInteractive({ useHandCursor: true });
      group.setAlpha(enabled ? 1 : 0.35);
    }
  };
}

function cardFlip(scene, target, onHalf, onDone) {
  scene.tweens.add({
    targets: target,
    scaleX: 0.02,
    duration: 150,
    ease: "Cubic.easeIn",
    onComplete: () => {
      onHalf?.();
      scene.tweens.add({
        targets: target,
        scaleX: 1,
        duration: 170,
        ease: "Back.easeOut",
        onComplete: () => onDone?.()
      });
    }
  });
}

function burstConfetti(scene, x, y) {
  for (let i = 0; i < 34; i++) {
    const col = Phaser.Display.Color.RandomRGB().color;
    const r = scene.add.rectangle(x, y, 10, 6, col);
    r.setRotation(Math.random() * Math.PI);

    scene.tweens.add({
      targets: r,
      x: x + (Math.random() * 2 - 1) * 420,
      y: y + (Math.random() * 2 - 1) * 260,
      alpha: 0,
      angle: r.angle + (Math.random() * 2 - 1) * 240,
      duration: 900 + Math.random() * 300,
      ease: "Cubic.easeOut",
      onComplete: () => r.destroy()
    });
  }
}

function drawAvatar(scene, x, y, name, size = 44) {
  const { hue, hue2 } = avatarColors(name);
  const c1 = hslToRgb(hue, 0.62, 0.52);
  const c2 = hslToRgb(hue2, 0.66, 0.46);

  const bg = scene.add.circle(x, y, size/2, Phaser.Display.Color.GetColor(c1.r,c1.g,c1.b));
  const ring = scene.add.circle(x, y, size/2 + 3, 0x000000, 0).setStrokeStyle(3, Phaser.Display.Color.GetColor(c2.r,c2.g,c2.b));
  const initials = (name || "P").trim().split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||"").join("") || "P";
  const txt = scene.add.text(x, y, initials, { fontFamily:"Arial Black", fontSize: `${Math.floor(size*0.42)}px`, color:"#071019" }).setOrigin(0.5);

  return scene.add.container(0,0,[ring,bg,txt]);
}

/* =========================
   Scenes
========================= */
class Boot extends Phaser.Scene {
  constructor(){ super("boot"); }
  preload() {
    this.load.text("rawStats", "data/raw_stats.txt");
  }
  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2, h/2, w, h, 0x070A12);
    const t = this.add.text(w/2, h/2, "Loading Highlanders data...", { fontFamily:"Arial", fontSize:"28px", color:"#F5F7FF" }).setOrigin(0.5);

    try {
      const raw = this.cache.text.get("rawStats");
      Session.dataset = parseStats(raw);
      this.scene.start("menu");
    } catch (e) {
      console.error(e);
      t.setText("Failed to load /public/data/raw_stats.txt");
      t.setColor("#FF4D6D");
    }
  }
}

class Menu extends Phaser.Scene {
  constructor(){ super("menu"); }
  create() {
    const w = this.scale.width, h = this.scale.height;

    // background vibe
    this.add.rectangle(w/2, h/2, w, h, 0x070A12);
    for (let i=0;i<44;i++){
      const star = this.add.circle(Math.random()*w, Math.random()*h, Math.random()*2+1, 0xFFFFFF, 0.08);
      this.tweens.add({ targets: star, alpha: 0.02 + Math.random()*0.12, duration: 800+Math.random()*1200, yoyo:true, repeat:-1 });
    }

    this.add.text(w/2, h*0.16, "HIGHLANDERS", { fontFamily:"Arial Black", fontSize:"62px", color:"#F5F7FF" }).setOrigin(0.5);
    this.add.text(w/2, h*0.24, "Higher / Lower", { fontFamily:"Arial", fontSize:"30px", color:"#D7B56D" }).setOrigin(0.5);

    this.dom = this.add.dom(w/2, h*0.44).createFromHTML(`
      <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
        <input id="nm" placeholder="Name" maxlength="16"
          style="width:340px; padding:12px; font-size:18px; border-radius:12px;
          border:2px solid #D7B56D; background:#0E1629; color:#F5F7FF; outline:none;" />
        <input id="cd" placeholder="Room Code (join)" maxlength="6"
          style="width:340px; padding:12px; font-size:18px; border-radius:12px;
          border:2px solid #2A3756; background:#0B1221; color:#F5F7FF; outline:none; text-transform:uppercase;" />
      </div>
    `);

    this.sockTxt = this.add.text(20, h-28, "Socket: ...", { fontFamily:"Arial", fontSize:"18px", color:"#B9C2D3" });
    this.add.text(20, h-50, `Server: ${SERVER_URL}`, { fontFamily:"Arial", fontSize:"14px", color:"#6E7A93" });

    const bPractice = makeButton(this, w/2, h*0.62, 520, 74, "PRACTICE (OFFLINE)", () => this.scene.start("offline"), { stroke: 0x39D98A, fillHover: 0x102A22 });
    const bCreate = makeButton(this, w/2, h*0.74, 520, 74, "CREATE LOBBY", () => this.createLobby());
    const bJoin   = makeButton(this, w/2, h*0.86, 520, 74, "JOIN LOBBY", () => this.joinLobby(), { stroke: 0x8AA7FF });

    this.lbTitle = this.add.text(w-20, 20, "Global Top 5", { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" }).setOrigin(1,0);
    this.lbText = this.add.text(w-20, 44, "…", { fontFamily:"Arial", fontSize:"16px", color:"#F5F7FF", align:"right", lineSpacing: 6 }).setOrigin(1,0);

    [bPractice.group, bCreate.group, bJoin.group].forEach((g, i) => {
      g.setAlpha(0); g.y += 16;
      this.tweens.add({ targets: g, alpha: 1, y: g.y-16, duration: 260, delay: 120*i, ease: "Cubic.easeOut" });
    });

    this.ensureSocket();
    Session.socket.emit("getLeaderboard");

    Session.socket.on("leaderboard", (lb) => {
      Session.globalLB = lb || [];
      const top5 = Session.globalLB.slice(0,5);
      this.lbText.setText(top5.map((e,i)=>`${i+1}. ${e.name}  (${e.bestScore})`).join("\n") || "No entries yet");
    });

    this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.sockTxt.setText("Socket: " + (Session.socket?.connected ? "CONNECTED ✅" : "NOT CONNECTED ❌"))
    });
  }

  ensureSocket() {
    if (Session.socket) return;

    Session.socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
      timeout: 20000
    });

    Session.socket.on("connect", () => { Session.myId = Session.socket.id; });
    Session.socket.on("roomError", (e) => alert(e?.message || "Room error"));

    Session.socket.on("roomJoined", (room) => { Session.room = room; this.scene.start("lobby"); });
    Session.socket.on("roomUpdate", (room) => { Session.room = room; });

    Session.socket.on("matchStarted", (room) => {Session.children.removeall();Session.cameras.main.setBackgroundColor("#0B0F1A"); Session.room = room; this.scene.start("online"); });

    Session.socket.on("roundStart", ({ room, roundTime }) => {
      Session.room = room;
      this.game.events.emit("roundStart", { room, roundTime }); this.playerText.setText(current.player);
  this.statText.setText(current.label);

  // THIS is the starting number
  this.lineText.setText(current.value);

  this.resultText.setText("?");
    });

    Session.socket.on("guessCount", (x) => this.game.events.emit("guessCount", x));
    Session.socket.on("roundReveal", (x) => this.game.events.emit("roundReveal", x));
    Session.socket.on("matchEnded", (x) => this.game.events.emit("matchEnded", x));
    Session.socket.on("toast", (x) => this.game.events.emit("toast", x));
    Session.socket.on("ping", (x) => this.game.events.emit("ping", x));
  }

  readInputs() {
    const nm = this.dom.getChildByID("nm")?.value?.trim() || "PLAYER";
    const cd = (this.dom.getChildByID("cd")?.value || "").trim().toUpperCase();
    Session.name = nm.slice(0,16);
    return { nm: Session.name, cd };
  }

  createLobby() {
    const { nm } = this.readInputs();
    Session.socket.emit("createRoom", { name: nm });
    SFX.start();
  }

  joinLobby() {
    const { nm, cd } = this.readInputs();
    if (!cd) return alert("Enter a room code first.");
    Session.socket.emit("joinRoom", { code: cd, name: nm });
    SFX.start();
  }
}

class Lobby extends Phaser.Scene {
  constructor(){ super("lobby"); }
  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2,h/2,w,h,0x070A12);
    this.lineText = this.add.text(400, 260, "", {
  fontSize: "48px",
  color: "#ffffff"
}).setOrigin(0.5);

    this.title = this.add.text(w/2, 18, "", { fontFamily:"Arial Black", fontSize:"28px", color:"#D7B56D" }).setOrigin(0.5,0);
    this.sub = this.add.text(w/2, 54, "Invite friends → they press JOIN and enter your room code.", { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" }).setOrigin(0.5,0);

    this.panel = this.add.rectangle(w/2, h*0.28, Math.min(960,w-40), 190, 0x0E1629).setStrokeStyle(2,0x2A3756);
    this.rulesTxt = this.add.text(w/2, h*0.20, "", { fontFamily:"Arial", fontSize:"18px", color:"#F5F7FF", align:"center", lineSpacing: 6 }).setOrigin(0.5);

    this.playersTxt = this.add.text(60, h*0.42, "", { fontFamily:"Arial", fontSize:"20px", color:"#F5F7FF", lineSpacing: 10 });

    this.btnStart = makeButton(this, w/2, h*0.83, 560, 74, "START MATCH", () => this.startMatch(), { stroke: 0x39D98A, fillHover: 0x102A22 });
    this.btnBack = makeButton(this, w/2, h*0.92, 420, 56, "BACK TO MENU", () => this.scene.start("menu"), { stroke: 0xFF4D6D, fillHover: 0x2A0F1A });

    // Quick pings
    this.add.text(w-20, h-180, "Quick Pings", { fontFamily:"Arial", fontSize:"14px", color:"#B9C2D3" }).setOrigin(1,0);
    const pings = ["🔥","😤","😂","😮","GG","LOCK IN"];
    this.emoteBtns = pings.map((k, i) =>
      makeButton(this, w-110, h-145 + i*42, 180, 34, k, () => Session.socket.emit("ping", { code: Session.room.code, kind: k }), {
        stroke: 0x2A3756, fill: 0x0B1221, fillHover: 0x13213F, fontSize: 16
      })
    );

    // Host settings
    this.dom = this.add.dom(w/2, h*0.31).createFromHTML(`
      <div style="display:flex; gap:10px; justify-content:center; align-items:center; flex-wrap:wrap;">
        <label style="color:#B9C2D3; font-family:Arial; font-size:14px;">Target</label>
        <input id="target" value="12" type="number" min="3" max="30"
          style="width:90px; padding:8px; border-radius:10px; border:2px solid #2A3756; background:#0B1221; color:#F5F7FF;" />
        <label style="color:#B9C2D3; font-family:Arial; font-size:14px;">Time</label>
        <input id="time" value="15" type="number" min="8" max="30"
          style="width:90px; padding:8px; border-radius:10px; border:2px solid #2A3756; background:#0B1221; color:#F5F7FF;" />
        <label style="color:#B9C2D3; font-family:Arial; font-size:14px;">Rotate Stat</label>
        <input id="rot" value="4" type="number" min="0" max="10"
          style="width:90px; padding:8px; border-radius:10px; border:2px solid #2A3756; background:#0B1221; color:#F5F7FF;" />
        <label style="color:#B9C2D3; font-family:Arial; font-size:14px;">Close</label>
        <input id="close" value="2" type="number" min="0.5" max="10" step="0.5"
          style="width:90px; padding:8px; border-radius:10px; border:2px solid #2A3756; background:#0B1221; color:#F5F7FF;" />
        <label style="color:#B9C2D3; font-family:Arial; font-size:14px;">Perfect</label>
        <input id="perfect" checked type="checkbox" />
        <button id="apply"
          style="padding:10px 14px; border-radius:12px; border:2px solid #D7B56D; background:#0E1629; color:#F5F7FF; cursor:pointer;">
          Apply
        </button>
      </div>
    `);

    this.toastText = this.add.text(w/2, h*0.72, "", { fontFamily:"Arial Black", fontSize:"18px", color:"#D7B56D" }).setOrigin(0.5);
    this.toastTimer = null;

    this.game.events.on("toast", (x) => this.toast(x?.text || "Updated", x?.type || "info"), this);
    this.game.events.on("ping", (x) => this.toast(`${x.from}: ${x.kind}`, "info"), this);

    this.time.delayedCall(120, () => {
      const btn = this.dom.getChildByID("apply");
      if (btn) btn.onclick = () => this.applySettings();
      this.refresh();
    });

    this.time.addEvent({ delay: 250, loop: true, callback: () => this.refresh() });
  }

  toast(text) {
    if (this.toastTimer) this.toastTimer.remove(false);
    this.toastText.setText(text);
    this.toastText.setAlpha(0);
    this.tweens.add({ targets: this.toastText, alpha: 1, duration: 120 });
    this.toastTimer = this.time.delayedCall(1400, () => this.tweens.add({ targets: this.toastText, alpha: 0, duration: 250 }));
  }

  applySettings() {
    if (!Session.isHost) return;
    const target = Number(this.dom.getChildByID("target")?.value ?? 12);
    const time = Number(this.dom.getChildByID("time")?.value ?? 15);
    const rot = Number(this.dom.getChildByID("rot")?.value ?? 4);
    const close = Number(this.dom.getChildByID("close")?.value ?? 2);
    const perfect = !!this.dom.getChildByID("perfect")?.checked;

    Session.socket.emit("updateSettings", {
      code: Session.room.code,
      targetScore: target,
      roundTimeSec: time,
      rotateStatEvery: rot,
      closeCallThreshold: close,
      perfectRoundBonus: perfect
    });
    SFX.click();
  }

  refresh() {
    const room = Session.room;
    if (!room) return;

    this.title.setText(`LOBBY — CODE: ${room.code} ${Session.isHost ? "(HOST)" : ""}`);

    const mods = room.modifiers || {};
    this.rulesTxt.setText(
      `First stat: ${room.statLabel} • Target: ${room.targetScore} • Time: ${(mods.roundTimeSec || 15)}s\n` +
      `Rules: Close ≤ ${(mods.closeCallThreshold ?? 2)} (+1) • Streak bonus at 3+ (+1) • Perfect round: ${mods.perfectRoundBonus ? "ON" : "OFF"}\n` +
      `Surprise: Stat rotates every ${(mods.rotateStatEvery ?? 4)} rounds`
    );

    const players = room.players.slice().sort((a,b)=>b.score-a.score);
    this.playersTxt.setText(players.map(p => {
      const host = p.id === room.hostId ? " ⭐" : "";
      return `${p.name}${host}   score:${p.score}  streak:${p.streak}  best:${p.bestStreak}`;
    }).join("\n"));

    this.btnStart.setEnabled(Session.isHost);
    this.dom.node.style.opacity = Session.isHost ? "1" : "0.25";
    this.dom.node.style.pointerEvents = Session.isHost ? "auto" : "none";
  }

  startMatch() {
    if (!Session.isHost) return;

    const [label, key] = STAT_POOL[Math.floor(Math.random() * STAT_POOL.length)];
    const target = Number(this.dom.getChildByID("target")?.value ?? 12);

    Session.socket.emit("startMatch", {
      code: Session.room.code,
      dataset: Session.dataset,
      stat: { label, key },
      targetScore: target
    });

    SFX.start();
  }
}

class Online extends Phaser.Scene {
  constructor(){ super("online"); }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2,h/2,w,h,0x070A12);

    this.header = this.add.text(20, 14, "", { fontFamily:"Arial Black", fontSize:"22px", color:"#D7B56D" });
    this.sub = this.add.text(20, 42, "", { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" });

    this.guessTxt = this.add.text(w-20, 14, "", { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" }).setOrigin(1,0);

    // Card
    this.card = this.add.container(w/2, h*0.42);
    this.cardBg = this.add.rectangle(0, 0, Math.min(860,w-60), 220, 0x0E1629).setStrokeStyle(2,0x2A3756);
    this.cardTitle = this.add.text(0, -78, "", { fontFamily:"Arial Black", fontSize:"26px", color:"#F5F7FF" }).setOrigin(0.5);
    this.cardStat = this.add.text(0, -32, "", { fontFamily:"Arial", fontSize:"18px", color:"#B9C2D3" }).setOrigin(0.5);
    this.cardVal = this.add.text(0, 26, "—", { fontFamily:"Arial Black", fontSize:"52px", color:"#D7B56D" }).setOrigin(0.5);
    this.cardHint = this.add.text(0, 78, "", { fontFamily:"Arial", fontSize:"16px", color:"#6E7A93" }).setOrigin(0.5);

    this.card.add([this.cardBg, this.cardTitle, this.cardStat, this.cardVal, this.cardHint]);

    // Buttons
    this.btnHigher = makeButton(this, w/2 - 170, h*0.78, 320, 74, "HIGHER", () => this.guess("higher"), { stroke: 0x39D98A, fillHover: 0x102A22 });
    this.btnLower  = makeButton(this, w/2 + 170, h*0.78, 320, 74, "LOWER", () => this.guess("lower"),  { stroke: 0xFF4D6D, fillHover: 0x2A0F1A });

    // Scoreboard panel
    this.boardBg = this.add.rectangle(w/2, h*0.92, Math.min(980,w-40), 92, 0x0B1221).setStrokeStyle(2,0x2A3756);
    this.board = this.add.text(w/2, h*0.92, "", { fontFamily:"Arial", fontSize:"18px", color:"#F5F7FF", align:"center" }).setOrigin(0.5);

    // toast
    this.toast = this.add.text(w/2, h*0.60, "", { fontFamily:"Arial Black", fontSize:"20px", color:"#D7B56D" }).setOrigin(0.5);
    this.toast.setAlpha(0);

    // emote bar
    const pings = ["🔥","😤","😂","😮","GG","LOCK IN"];
    this.emoteBtns = pings.map((k, i) =>
      makeButton(this, 90 + i*110, h-150, 100, 34, k, () => Session.socket.emit("ping", { code: Session.room.code, kind: k }), {
        stroke: 0x2A3756, fill: 0x0B1221, fillHover: 0x13213F, fontSize: 14
      })
    );

    this.roundTime = 15;
    this.timeLeft = 15;
    this.timerText = this.add.text(w-20, 42, "", { fontFamily:"Arial Black", fontSize:"18px", color:"#F5F7FF" }).setOrigin(1,0);

    this.game.events.on("roundStart", (x) => this.onRoundStart(x), this);
    this.game.events.on("guessCount", (x) => this.onGuessCount(x), this);
    this.game.events.on("roundReveal", (x) => this.onReveal(x), this);
    this.game.events.on("matchEnded", (x) => this.onEnd(x), this);
    this.game.events.on("toast", (x) => this.showToast(x?.text || "Update"), this);
    this.game.events.on("ping", (x) => this.showToast(`${x.from}: ${x.kind}`), this);

    // boot into current state if already have room
    this.refreshUI();
  }

  showToast(text) {
    this.toast.setText(text);
    this.toast.setAlpha(0);
    this.tweens.add({ targets: this.toast, alpha: 1, duration: 120 });
    this.time.delayedCall(1400, () => this.tweens.add({ targets: this.toast, alpha: 0, duration: 250 }));
  }

  refreshUI() {
    const room = Session.room;
    if (!room) return;

    this.header.setText(`ROOM ${room.code} • Round ${room.round} • First to ${room.targetScore}`);
    this.sub.setText(`Stat: ${room.statLabel} • Bonuses: Close-call (+1), Streak 3+ (+1), Perfect Round (+1)`);
    this.renderBoard();

    // show previous/current (until roundStart arrives)
    if (room.current) {
      this.cardTitle.setText(`${room.current.player}`);
      this.cardStat.setText(`${room.current.label} vs ${room.current.opponent}`);
      this.cardVal.setText("?");
      this.cardHint.setText(`Date: ${room.current.date}`);
    }
  }

  renderBoard() {
    const room = Session.room;
    if (!room) return;
    const players = room.players.slice().sort((a,b)=>b.score-a.score || b.streak-a.streak);
    this.board.setText(players.map(p => `${p.name}  ${p.score}  (streak ${p.streak})`).join("   •   "));
  }

  onRoundStart({ room, roundTime }) {
    Session.room = room;
    this.roundTime = roundTime || 15;
    this.timeLeft = this.roundTime;

    SFX.reveal();

    this.btnHigher.setEnabled(true);
    this.btnLower.setEnabled(true);
    this.guessTxt.setText("");

    const cur = room.current;
    const prev = room.previous;

    // card flip animation
    cardFlip(this, this.card, () => {
      if (prev) {
        this.cardTitle.setText(`${prev.player}`);
        this.cardStat.setText(`${prev.label} vs ${prev.opponent}`);
        this.cardVal.setText(`${Number(prev.value).toFixed(1)}`);
        this.cardHint.setText(`Previous • ${prev.date}`);
      } else {
        this.cardTitle.setText(`GET READY`);
        this.cardStat.setText(`First card`);
        this.cardVal.setText(`—`);
        this.cardHint.setText(`Round 1`);
      }
    }, () => {
      this.time.delayedCall(140, () => {
        cardFlip(this, this.card, () => {
          this.cardTitle.setText(`${cur.player}`);
          this.cardStat.setText(`${cur.label} vs ${cur.opponent}`);
          this.cardVal.setText(`?`);
          this.cardHint.setText(`Date: ${cur.date}`);
        });
      });
    });

    // timer tick
    if (this.timerEvent) this.timerEvent.remove(false);
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.timeLeft--;
        if (this.timeLeft <= 3 && this.timeLeft > 0) SFX.countdown();
        if (this.timeLeft <= 0) this.timerEvent.remove(false);
      }
    });

    this.refreshUI();
  }

  onGuessCount({ guessed, total }) {
    this.guessTxt.setText(`Guessed: ${guessed}/${total}`);
  }

  guess(dir) {
    const room = Session.room;
    if (!room) return;
    Session.socket.emit("guess", { code: room.code, dir });
    this.btnHigher.setEnabled(false);
    this.btnLower.setEnabled(false);
    this.guessTxt.setText(`You locked: ${dir.toUpperCase()}`);
    SFX.click();
  }

  onReveal({ previous, revealed, correctDir, results, meta }) {
    const cur = revealed;
    const prev = previous;

    // flip to reveal value
    cardFlip(this, this.card, () => {
      this.cardVal.setText(`${Number(cur.value).toFixed(1)}`);
      this.cardHint.setText(
        correctDir
          ? `Correct: ${correctDir.toUpperCase()} • close≤${meta?.closeThresh ?? 2}`
          : `No previous value`
      );
    });

    // play sounds + toast
    const me = results.find(r => r.id === Session.myId);
    if (me?.correct) SFX.correct();
    else SFX.wrong();

    if (me) {
      const bonus = me.bonuses?.length ? ` (+${me.bonuses.join(", ")})` : "";
      this.showToast(me.correct ? `✅ Correct! +${me.gain}${bonus}` : `❌ Wrong!`);
    } else {
      this.showToast("Round revealed!");
    }

    // update room players
    Session.room.players = results.map(r => ({
      id: r.id,
      name: r.name,
      score: r.score,
      streak: r.streak,
      bestStreak: r.bestStreak
    }));

    this.renderBoard();

    // host can advance next round
    if (Session.isHost) {
      this.time.delayedCall(950, () => {
        Session.socket.emit("hostNextRound", { code: Session.room.code });
      });
    }
  }

  onEnd({ winner, leaderboard }) {
    SFX.win();

    const w = this.scale.width, h = this.scale.height;
    burstConfetti(this, w/2, h*0.30);

    const overlay = this.add.rectangle(w/2, h/2, w, h, 0x000000, 0.65);
    const panel = this.add.rectangle(w/2, h/2, Math.min(860,w-60), 420, 0x0E1629).setStrokeStyle(2,0xD7B56D);

    const title = this.add.text(w/2, h/2-160, `🏆 ${winner.name} WINS!`, { fontFamily:"Arial Black", fontSize:"36px", color:"#F5F7FF" }).setOrigin(0.5);
    const sub = this.add.text(w/2, h/2-120, `Final score: ${winner.score}`, { fontFamily:"Arial", fontSize:"20px", color:"#D7B56D" }).setOrigin(0.5);

    const lb = (leaderboard || []).slice(0, 10);
    const lbText = this.add.text(w/2, h/2-40,
      "GLOBAL LEADERBOARD\n\n" + (lb.map((e,i)=>`${i+1}. ${e.name}  score:${e.bestScore}  streak:${e.bestStreak}`).join("\n") || "No entries yet"),
      { fontFamily:"Arial", fontSize:"18px", color:"#B9C2D3", align:"center", lineSpacing: 6 }
    ).setOrigin(0.5);

    const btn = makeButton(this, w/2, h/2+160, 420, 64, "BACK TO MENU", () => {
      this.scene.start("menu");
    }, { stroke: 0x8AA7FF });

    this.btnHigher.setEnabled(false);
    this.btnLower.setEnabled(false);
  }

  update() {
    this.timerText.setText(`Time: ${Math.max(0, this.timeLeft)}s`);
  }
}

class Offline extends Phaser.Scene {
  constructor(){ super("offline"); }
  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2,h/2,w,h,0x070A12);

    this.add.text(w/2, 30, "Practice Mode", { fontFamily:"Arial Black", fontSize:"32px", color:"#D7B56D" }).setOrigin(0.5);
    this.add.text(w/2, 66, "Plays locally. Great for testing stats & pacing.", { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" }).setOrigin(0.5);

    this.btnBack = makeButton(this, w/2, h-60, 420, 56, "BACK TO MENU", () => this.scene.start("menu"), { stroke: 0x8AA7FF });

    // simple local loop: show two cards and guess
    this.stat = STAT_POOL[Math.floor(Math.random()*STAT_POOL.length)];
    this.prev = null;
    this.cur = null;

    this.card = this.add.container(w/2, h*0.42);
    this.bg = this.add.rectangle(0, 0, Math.min(860,w-60), 220, 0x0E1629).setStrokeStyle(2,0x2A3756);
    this.tt = this.add.text(0, -78, "", { fontFamily:"Arial Black", fontSize:"26px", color:"#F5F7FF" }).setOrigin(0.5);
    this.st = this.add.text(0, -32, "", { fontFamily:"Arial", fontSize:"18px", color:"#B9C2D3" }).setOrigin(0.5);
    this.vv = this.add.text(0, 26, "—", { fontFamily:"Arial Black", fontSize:"52px", color:"#D7B56D" }).setOrigin(0.5);
    this.hh = this.add.text(0, 78, "", { fontFamily:"Arial", fontSize:"16px", color:"#6E7A93" }).setOrigin(0.5);
    this.card.add([this.bg,this.tt,this.st,this.vv,this.hh]);

    this.btnHigher = makeButton(this, w/2 - 170, h*0.78, 320, 74, "HIGHER", () => this.guess("higher"), { stroke: 0x39D98A, fillHover: 0x102A22 });
    this.btnLower  = makeButton(this, w/2 + 170, h*0.78, 320, 74, "LOWER", () => this.guess("lower"),  { stroke: 0xFF4D6D, fillHover: 0x2A0F1A });

    this.msg = this.add.text(w/2, h*0.62, "", { fontFamily:"Arial Black", fontSize:"20px", color:"#D7B56D" }).setOrigin(0.5).setAlpha(0);

    this.nextLocalRound(true);
  }

  nextLocalRound(first=false) {
    this.prev = this.cur;
    this.cur = Session.dataset[Math.floor(Math.random()*Session.dataset.length)];

    const [label, key] = this.stat;
    const prevVal = this.prev ? Number(this.prev[key]) : null;

    cardFlip(this, this.card, () => {
      if (this.prev) {
        this.tt.setText(this.prev.player);
        this.st.setText(`${label} vs ${this.prev.opponent}`);
        this.vv.setText(prevVal.toFixed(1));
        this.hh.setText(`Previous • ${this.prev.date}`);
      } else {
        this.tt.setText("FIRST CARD");
        this.st.setText(label);
        this.vv.setText("—");
        this.hh.setText("Pick a direction");
      }
    }, () => {
      this.time.delayedCall(160, () => {
        cardFlip(this, this.card, () => {
          this.tt.setText(this.cur.player);
          this.st.setText(`${label} vs ${this.cur.opponent}`);
          this.vv.setText("?");
          this.hh.setText(`Date: ${this.cur.date}`);
        });
      });
    });

    this.btnHigher.setEnabled(!first || true);
    this.btnLower.setEnabled(!first || true);
  }

  guess(dir) {
    const [label, key] = this.stat;
    const prevVal = this.prev ? Number(this.prev[key]) : null;
    const curVal = Number(this.cur[key]);

    let correct = true;
    if (this.prev) {
      const cd = curVal >= prevVal ? "higher" : "lower";
      correct = (dir === cd);
    }

    this.btnHigher.setEnabled(false);
    this.btnLower.setEnabled(false);

    cardFlip(this, this.card, () => {
      this.vv.setText(curVal.toFixed(1));
      this.hh.setText(`${label} revealed`);
    });

    if (correct) SFX.correct(); else SFX.wrong();

    this.msg.setText(correct ? "✅ Correct!" : "❌ Wrong!");
    this.msg.setAlpha(0);
    this.tweens.add({ targets: this.msg, alpha: 1, duration: 140 });
    this.time.delayedCall(800, () => this.tweens.add({ targets: this.msg, alpha: 0, duration: 200 }));

    this.time.delayedCall(900, () => {
      // surprise: occasionally rotate stat
      if (Math.random() < 0.20) this.stat = STAT_POOL[Math.floor(Math.random()*STAT_POOL.length)];
      this.nextLocalRound();
    });
  }
}

/* =========================
   Game config
========================= */
const config = {
  type: Phaser.AUTO,
  parent: "app",
  width: 1100,
  height: 680,
  backgroundColor: "#070A12",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  dom: { createContainer: true },
  scene: [Boot, Menu, Lobby, Online, Offline]
};

new Phaser.Game(config);
