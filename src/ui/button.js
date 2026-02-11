import { SFX } from "../audio/sfx.js";

export function makeButton(scene, x, y, w, h, label, onClick, opts = {}) {
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
