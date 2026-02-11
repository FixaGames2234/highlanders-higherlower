// Parse pasted stats file. 0 -> 0.5 rule applied.
export function parseStats(raw) {
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
