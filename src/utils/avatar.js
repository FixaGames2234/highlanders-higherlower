import Phaser from "phaser";
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

export function avatarColors(name) {
  const h = hashStr((name || "").toLowerCase());
  const hue = h % 360;
  const hue2 = (hue + 210) % 360;
  return { hue, hue2 };
}

export function drawAvatar(scene, x, y, name, size = 44) {
  const { hue, hue2 } = avatarColors(name);
  const c1 = hslToRgb(hue, 0.62, 0.52);
  const c2 = hslToRgb(hue2, 0.66, 0.46);

  const bg = scene.add.circle(x, y, size/2, Phaser.Display.Color.GetColor(c1.r,c1.g,c1.b));
  const ring = scene.add.circle(x, y, size/2 + 3, 0x000000, 0)
    .setStrokeStyle(3, Phaser.Display.Color.GetColor(c2.r,c2.g,c2.b));
  const initials = (name || "P").trim().split(/\s+/).slice(0,2)
    .map(s=>s[0]?.toUpperCase()||"").join("") || "P";
  const txt = scene.add.text(x, y, initials, {
    fontFamily:"Arial Black",
    fontSize: `${Math.floor(size*0.42)}px`,
    color:"#071019"
  }).setOrigin(0.5);

  return scene.add.container(0,0,[ring,bg,txt]);
}
