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

export const SFX = {
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
