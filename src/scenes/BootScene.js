import Phaser from "phaser";
import { Session } from "../state/session.js";
import { parseStats } from "../utils/stats.js";

export class BootScene extends Phaser.Scene {
  constructor() { super("boot"); }

  preload() {
    this.load.text("rawStats", "data/raw_stats.txt");
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2, h/2, w, h, 0x070A12);
    const t = this.add.text(w/2, h/2, "Loading Highlanders data...", {
      fontFamily:"Arial",
      fontSize:"28px",
      color:"#F5F7FF"
    }).setOrigin(0.5);

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
