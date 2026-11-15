// Parses typed coordinates for the top-bar search: decimal ("39.45, 73.55"), hemisphere
// letters ("39.45N 73.55E", "N39.45 E73.55") and degrees-minutes-seconds ("39°27′N 73°33′E").

export type ParsedCoords = { lat: number; lon: number } | { error: string };

type Group = { nums: number[]; hemi?: string; neg: boolean };

export function parseCoords(text: string): ParsedCoords {
  const s = text
    .trim()
    .toUpperCase()
    .replace(/[′’‘]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/[º˚]/g, '°')
    .replace(/[−–]/g, '-');
  if (!s) return { error: 'Type a latitude and longitude' };
  const tokens = s.match(/-?(?:\d+(?:\.\d*)?|\.\d+)|[NSEW]|[,;]|[^\s\d°'",;NSEW.-]+/g) ?? [];
  if (tokens.some((t) => /^[^\d,;NSEW.-]/.test(t))) return { error: 'Use numbers, optionally with N, S, E or W' };

  const leading = /^[NSEW]$/.test(tokens[0] ?? '');
  const groups: Group[] = [];
  let g: Group = { nums: [], neg: false };
  const close = () => {
    if (g.nums.length || g.hemi) groups.push(g);
    g = { nums: [], neg: false };
  };
  for (const t of tokens) {
    if (t === ',' || t === ';') close();
    else if (/^[NSEW]$/.test(t)) {
      if (leading) {
        close();
        g.hemi = t;
      } else {
        if (g.hemi) return { error: `Unexpected "${t}"` };
        g.hemi = t;
        close();
      }
    } else {
      const v = Number(t);
      const neg = t.startsWith('-'); // not v < 0: "-0" (as in -0° 30′) must keep its sign
      if (g.nums.length && neg) close();
      if (neg) g.neg = true;
      g.nums.push(Math.abs(v));
    }
  }
  close();

  // No separators or letters: split the bare numbers evenly (2, 4 or 6 of them).
  if (groups.length === 1 && !groups[0].hemi) {
    const { nums } = groups[0];
    if (nums.length === 2 || nums.length === 4 || nums.length === 6) {
      const h = nums.length / 2;
      const neg = groups[0].neg;
      groups.splice(0, 1, { nums: nums.slice(0, h), neg }, { nums: nums.slice(h), neg: false });
    }
  }
  if (groups.length !== 2) return { error: 'Type two values: latitude, longitude' };

  const vals: number[] = [];
  for (const gr of groups) {
    if (gr.nums.length < 1 || gr.nums.length > 3) return { error: 'Use degrees, minutes and seconds at most' };
    const [d, m = 0, sec = 0] = gr.nums;
    if (gr.nums.length > 1 && (m >= 60 || sec >= 60 || !Number.isInteger(d))) return { error: 'Minutes and seconds must be under 60' };
    let v = d + m / 60 + sec / 3600;
    if (gr.neg || gr.hemi === 'S' || gr.hemi === 'W') v = -v;
    vals.push(v);
  }
  let [lat, lon] = vals;
  const [h0, h1] = [groups[0].hemi, groups[1].hemi];
  const isLon = (h?: string) => h === 'E' || h === 'W';
  const isLat = (h?: string) => h === 'N' || h === 'S';
  if ((isLat(h0) && isLat(h1)) || (isLon(h0) && isLon(h1))) return { error: 'Give one latitude (N/S) and one longitude (E/W)' };
  if (isLon(h0) || isLat(h1)) [lat, lon] = [lon, lat];
  if (Math.abs(lat) > 90) return { error: 'Latitude must be between −90 and 90' };
  if (lon > 180 && lon <= 360) lon -= 360;
  if (Math.abs(lon) > 180) return { error: 'Longitude must be between −180 and 180' };
  return { lat, lon };
}
