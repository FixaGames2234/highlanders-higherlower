import Phaser from "phaser";

export function cardFlip(scene, target, onHalf, onDone) {
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

export function burstConfetti(scene, x, y) {
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
