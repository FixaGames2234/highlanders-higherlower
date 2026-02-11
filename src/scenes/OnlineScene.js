import Phaser from "phaser";
import { Session } from "../state/session.js";
import { Events } from "../state/events.js";
import { makeButton } from "../ui/button.js";
import { cardFlip, burstConfetti } from "../ui/fx.js";
import { SFX } from "../audio/sfx.js";

export class OnlineScene extends Phaser.Scene {
  constructor(){ super("online"); }

  create() {
    this.baselineLabel = this.add.text(20, 72, "Baseline: —", {
  fontFamily: "Arial Black",
  fontSize: "18px",
  color: "#F5F7FF"
});

// Round history (last 3)
this.historyText = this.add.text(20, 100, "", {
  fontFamily: "Arial",
  fontSize: "14px",
  color: "#B9C2D3",
  lineSpacing: 6
});
this.history = [];	
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2,h/2,w,h,0x070A12);

    this.header = this.add.text(20, 14, "", { fontFamily:"Arial Black", fontSize:"22px", color:"#D7B56D" });
    this.sub = this.add.text(20, 42, "", { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" });

    this.guessTxt = this.add.text(w-20, 14, "", { fontFamily:"Arial", fontSize:"16px", color:"#B9C2D3" }).setOrigin(1,0);

    this.card = this.add.container(w/2, h*0.42);
    this.cardBg = this.add.rectangle(0, 0, Math.min(860,w-60), 220, 0x0E1629).setStrokeStyle(2,0x2A3756);
    this.cardTitle = this.add.text(0, -78, "", { fontFamily:"Arial Black", fontSize:"26px", color:"#F5F7FF" }).setOrigin(0.5);
    this.cardStat = this.add.text(0, -32, "", { fontFamily:"Arial", fontSize:"18px", color:"#B9C2D3" }).setOrigin(0.5);
    this.cardVal = this.add.text(0, 26, "—", { fontFamily:"Arial Black", fontSize:"52px", color:"#D7B56D" }).setOrigin(0.5);
    this.cardHint = this.add.text(0, 78, "", { fontFamily:"Arial", fontSize:"16px", color:"#6E7A93" }).setOrigin(0.5);
    this.card.add([this.cardBg, this.cardTitle, this.cardStat, this.cardVal, this.cardHint]);

    this.btnHigher = makeButton(this, w/2 - 170, h*0.78, 320, 74, "HIGHER", () => this.guess("higher"), { stroke: 0x39D98A, fillHover: 0x102A22 });
    this.btnLower  = makeButton(this, w/2 + 170, h*0.78, 320, 74, "LOWER", () => this.guess("lower"),  { stroke: 0xFF4D6D, fillHover: 0x2A0F1A });

    this.boardBg = this.add.rectangle(w/2, h*0.92, Math.min(980,w-40), 92, 0x0B1221).setStrokeStyle(2,0x2A3756);
    this.board = this.add.text(w/2, h*0.92, "", { fontFamily:"Arial", fontSize:"18px", color:"#F5F7FF", align:"center" }).setOrigin(0.5);

    this.toast = this.add.text(w/2, h*0.60, "", { fontFamily:"Arial Black", fontSize:"20px", color:"#D7B56D" }).setOrigin(0.5);
    this.toast.setAlpha(0);
    // Timer bar
const barW = 260;
this.timerBarBg = this.add.rectangle(this.scale.width - 20 - barW/2, 74, barW, 10, 0x2A3756).setOrigin(0.5);
this.timerBarFill = this.add.rectangle(this.scale.width - 20 - barW, 74, barW, 10, 0xD7B56D).setOrigin(0, 0.5);
this.timerBarWidth = barW;

    this.roundTime = 15;
    this.timeLeft = 15;
    this.timerText = this.add.text(w-20, 42, "", { fontFamily:"Arial Black", fontSize:"18px", color:"#F5F7FF" }).setOrigin(1,0);

    // ---- subscribe to Events bus
    this.onRoundStart = (x) => this.handleRoundStart(x);
    this.onGuessCount = (x) => this.guessTxt.setText(`Guessed: ${x.guessed}/${x.total}`);
    this.onReveal = (x) => this.handleReveal(x);
    this.onEnd = (x) => this.handleEnd(x);
    this.onToast = (x) => this.showToast(x?.text || "Update");
    this.onPing = (x) => this.showToast(`${x.from}: ${x.kind}`);

    Events.on("roundStart", this.onRoundStart);
    Events.on("guessCount", this.onGuessCount);
    Events.on("roundReveal", this.onReveal);
    Events.on("matchEnded", this.onEnd);
    Events.on("toast", this.onToast);
    Events.on("ping", this.onPing);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      Events.off("roundStart", this.onRoundStart);
      Events.off("guessCount", this.onGuessCount);
      Events.off("roundReveal", this.onReveal);
      Events.off("matchEnded", this.onEnd);
      Events.off("toast", this.onToast);
      Events.off("ping", this.onPing);
    });

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

  handleRoundStart({ room, roundTime }) {
    Session.room = room;
    this.roundTime = roundTime || 15;
    this.timeLeft = this.roundTime;

    SFX.reveal();

    this.btnHigher.setEnabled(true);
    this.btnLower.setEnabled(true);
    this.guessTxt.setText("");

    const cur = room.current;
    const prev = room.previous;
    // Persistent baseline text
if (prev) {
  this.baselineLabel.setText(`Baseline: ${Number(prev.value).toFixed(1)}`);
  // Update history (keep last 3 baselines)
  this.history.unshift(`${prev.player} • ${prev.label}: ${Number(prev.value).toFixed(1)}`);
  this.history = this.history.slice(0, 3);
  this.historyText.setText("Recent baselines:\n" + this.history.map((x,i)=>`${i+1}) ${x}`).join("\n"));
} else {
  this.baselineLabel.setText("Baseline: —");
}


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

  guess(dir) {
    const room = Session.room;
    if (!room) return;
    Session.socket.emit("guess", { code: room.code, dir });
    this.btnHigher.setEnabled(false);
    this.btnLower.setEnabled(false);
    this.guessTxt.setText(`You locked: ${dir.toUpperCase()}`);
    SFX.click();
  }

  handleReveal({ previous, revealed, correctDir, results, meta }) {
    const cur = revealed;

    cardFlip(this, this.card, () => {
      this.cardVal.setText(`${Number(cur.value).toFixed(1)}`);
      this.cardHint.setText(
        correctDir ? `Correct: ${correctDir.toUpperCase()} • close≤${meta?.closeThresh ?? 2}` : `No previous value`
      );
    });

    const me = results.find(r => r.id === Session.myId);
    if (me?.correct) SFX.correct();
    else SFX.wrong();

    if (me) {
      const bonus = me.bonuses?.length ? ` (+${me.bonuses.join(", ")})` : "";
      this.showToast(me.correct ? `✅ Correct! +${me.gain}${bonus}` : `❌ Wrong!`);
    } else {
      this.showToast("Round revealed!");
    }

    Session.room.players = results.map(r => ({
      id: r.id,
      name: r.name,
      score: r.score,
      streak: r.streak,
      bestStreak: r.bestStreak
    }));

    this.renderBoard();

    if (Session.isHost) {
      this.time.delayedCall(950, () => {
        Session.socket.emit("hostNextRound", { code: Session.room.code });
      });
    }
  }

  handleEnd({ winner, leaderboard }) {
    SFX.win();

    const w = this.scale.width, h = this.scale.height;
    burstConfetti(this, w/2, h*0.30);

    this.add.rectangle(w/2, h/2, w, h, 0x000000, 0.65);
    this.add.rectangle(w/2, h/2, Math.min(860,w-60), 420, 0x0E1629).setStrokeStyle(2,0xD7B56D);

    this.add.text(w/2, h/2-160, `🏆 ${winner.name} WINS!`, {
      fontFamily:"Arial Black", fontSize:"36px", color:"#F5F7FF"
    }).setOrigin(0.5);

    this.add.text(w/2, h/2-120, `Final score: ${winner.score}`, {
      fontFamily:"Arial", fontSize:"20px", color:"#D7B56D"
    }).setOrigin(0.5);

    const lb = (leaderboard || []).slice(0, 10);
    this.add.text(w/2, h/2-40,
      "GLOBAL LEADERBOARD\n\n" + (lb.map((e,i)=>`${i+1}. ${e.name}  score:${e.bestScore}  streak:${e.bestStreak}`).join("\n") || "No entries yet"),
      { fontFamily:"Arial", fontSize:"18px", color:"#B9C2D3", align:"center", lineSpacing: 6 }
    ).setOrigin(0.5);

    makeButton(this, w/2, h/2+160, 420, 64, "BACK TO MENU", () => {
      this.scene.start("menu");
    }, { stroke: 0x8AA7FF });

    this.btnHigher.setEnabled(false);
    this.btnLower.setEnabled(false);
  }

  update() {
  this.timerText.setText(`Time: ${Math.max(0, this.timeLeft)}s`);

  const ratio = this.roundTime > 0 ? Math.max(0, this.timeLeft) / this.roundTime : 0;
  this.timerBarFill.width = this.timerBarWidth * ratio;
}

}
