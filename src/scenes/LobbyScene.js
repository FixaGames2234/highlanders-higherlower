import Phaser from "phaser";
import { Session } from "../state/session.js";
import { Events } from "../state/events.js";
import { makeButton } from "../ui/button.js";
import { SFX } from "../audio/sfx.js";
import { STAT_POOL } from "../utils/statPool.js";

export class LobbyScene extends Phaser.Scene {
  constructor() { super("lobby"); }

  create() {
    const w = this.scale.width, h = this.scale.height;

    this.add.rectangle(w/2,h/2,w,h,0x070A12);

    this.title = this.add.text(w/2, 18, "", {
      fontFamily:"Arial Black", fontSize:"28px", color:"#D7B56D"
    }).setOrigin(0.5,0);

    this.sub = this.add.text(w/2, 54,
      "Invite friends → they press JOIN and enter your room code.",
      { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" }
    ).setOrigin(0.5,0);

    this.panel = this.add.rectangle(w/2, h*0.28, Math.min(960,w-40), 190, 0x0E1629)
      .setStrokeStyle(2,0x2A3756);

    this.rulesTxt = this.add.text(w/2, h*0.20, "", {
      fontFamily:"Arial", fontSize:"18px", color:"#F5F7FF", align:"center", lineSpacing: 6
    }).setOrigin(0.5);

    this.playersTxt = this.add.text(60, h*0.42, "", {
      fontFamily:"Arial", fontSize:"20px", color:"#F5F7FF", lineSpacing: 10
    });

    this.btnStart = makeButton(this, w/2, h*0.83, 560, 74, "START MATCH", () => this.startMatch(), {
      stroke: 0x39D98A, fillHover: 0x102A22
    });

    makeButton(this, w/2, h*0.92, 420, 56, "BACK TO MENU", () => this.scene.start("menu"), {
      stroke: 0xFF4D6D, fillHover: 0x2A0F1A
    });

    // Host settings DOM
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

    this.toastText = this.add.text(w/2, h*0.72, "", {
      fontFamily:"Arial Black", fontSize:"18px", color:"#D7B56D"
    }).setOrigin(0.5);

    // DOM button hook
    this.time.delayedCall(120, () => {
      const btn = this.dom.getChildByID("apply");
      if (btn) btn.onclick = () => this.applySettings();
      this.refresh();
    });

    // Subscribe to updates
    this.onRoomUpdate = () => this.refresh();
    this.onMatchStarted = () => this.scene.start("online");
    this.onToast = (x) => this.toast(x?.text || "Updated");
    this.onPing = (x) => this.toast(`${x.from}: ${x.kind}`);

    Events.on("roomUpdate", this.onRoomUpdate);
    Events.on("matchStarted", this.onMatchStarted);
    Events.on("toast", this.onToast);
    Events.on("ping", this.onPing);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      Events.off("roomUpdate", this.onRoomUpdate);
      Events.off("matchStarted", this.onMatchStarted);
      Events.off("toast", this.onToast);
      Events.off("ping", this.onPing);
    });

    this.time.addEvent({ delay: 250, loop: true, callback: () => this.refresh() });
  }

  toast(text) {
    if (this.toastTimer) this.toastTimer.remove(false);
    this.toastText.setText(text);
    this.toastText.setAlpha(0);
    this.tweens.add({ targets: this.toastText, alpha: 1, duration: 120 });
    this.toastTimer = this.time.delayedCall(1400, () =>
      this.tweens.add({ targets: this.toastText, alpha: 0, duration: 250 })
    );
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
      `Rules: Close ≤ ${(mods.closeCallThreshold ?? 2)} (+1) • Streak 3+ (+1) • Perfect round: ${mods.perfectRoundBonus ? "ON" : "OFF"}\n` +
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
