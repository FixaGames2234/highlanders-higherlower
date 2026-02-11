import Phaser from "phaser";
import { Session } from "../state/session.js";
import { makeButton } from "../ui/button.js";
import { cardFlip } from "../ui/fx.js";
import { SFX } from "../audio/sfx.js";
import { STAT_POOL } from "../utils/statPool.js";

export class OfflineScene extends Phaser.Scene {
  constructor(){ super("offline"); }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2,h/2,w,h,0x070A12);

    this.add.text(w/2, 30, "Practice Mode", { fontFamily:"Arial Black", fontSize:"32px", color:"#D7B56D" }).setOrigin(0.5);
    this.add.text(w/2, 66, "Plays locally. Great for testing stats & pacing.", { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" }).setOrigin(0.5);

    makeButton(this, w/2, h-60, 420, 56, "BACK TO MENU", () => this.scene.start("menu"), { stroke: 0x8AA7FF });

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

    this.btnHigher.setEnabled(true);
    this.btnLower.setEnabled(true);
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
      if (Math.random() < 0.20) this.stat = STAT_POOL[Math.floor(Math.random()*STAT_POOL.length)];
      this.nextLocalRound();
    });
  }
}
