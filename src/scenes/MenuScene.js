import Phaser from "phaser";
import { SERVER_URL } from "../env.js";
import { ensureSocket } from "../net/socket.js";
import { Session } from "../state/session.js";
import { Events } from "../state/events.js";
import { SFX } from "../audio/sfx.js";
import { makeButton } from "../ui/button.js";

export class MenuScene extends Phaser.Scene {
  constructor() { super("menu"); }

  create() {
    const w = this.scale.width, h = this.scale.height;

    this.add.rectangle(w/2, h/2, w, h, 0x070A12);
    for (let i=0;i<44;i++){
      const star = this.add.circle(Math.random()*w, Math.random()*h, Math.random()*2+1, 0xFFFFFF, 0.08);
      this.tweens.add({ targets: star, alpha: 0.02 + Math.random()*0.12, duration: 800+Math.random()*1200, yoyo:true, repeat:-1 });
    }

    this.add.text(w/2, h*0.16, "HIGHLANDERS", {
      fontFamily:"Arial Black", fontSize:"62px", color:"#F5F7FF"
    }).setOrigin(0.5);

    this.add.text(w/2, h*0.24, "Higher / Lower", {
      fontFamily:"Arial", fontSize:"30px", color:"#D7B56D"
    }).setOrigin(0.5);

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

    makeButton(this, w/2, h*0.62, 520, 74, "PRACTICE (OFFLINE)", () => this.scene.start("offline"), {
      stroke: 0x39D98A, fillHover: 0x102A22
    });

    makeButton(this, w/2, h*0.74, 520, 74, "CREATE LOBBY", () => this.createLobby());
    makeButton(this, w/2, h*0.86, 520, 74, "JOIN LOBBY", () => this.joinLobby(), { stroke: 0x8AA7FF });

    this.lbTitle = this.add.text(w-20, 20, "Global Top 5", {
      fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3"
    }).setOrigin(1,0);

    this.lbText = this.add.text(w-20, 44, "…", {
      fontFamily:"Arial", fontSize:"16px", color:"#F5F7FF", align:"right", lineSpacing: 6
    }).setOrigin(1,0);

    // ---- socket init ONCE
    ensureSocket();
    Session.socket.emit("getLeaderboard");

    // ---- event bus subscriptions (cleaned up on shutdown)
    this.onLB = (lb) => {
      const top5 = (lb || []).slice(0,5);
      this.lbText.setText(top5.map((e,i)=>`${i+1}. ${e.name}  (${e.bestScore})`).join("\n") || "No entries yet");
    };

    this.onRoomJoined = () => {
      this.scene.start("lobby");
    };

    Events.on("leaderboard", this.onLB);
    Events.on("roomJoined", this.onRoomJoined);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      Events.off("leaderboard", this.onLB);
      Events.off("roomJoined", this.onRoomJoined);
    });

    this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.sockTxt.setText("Socket: " + (Session.socket?.connected ? "CONNECTED ✅" : "NOT CONNECTED ❌"))
    });
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
