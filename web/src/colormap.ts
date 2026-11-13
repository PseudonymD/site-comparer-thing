// Perceptually uniform "inferno" colormap (matplotlib, CC0) sampled at 17 anchors and interpolated.
const INFERNO: [number, number, number][] = [
  [0, 0, 4], [12, 8, 38], [36, 12, 79], [66, 10, 104], [93, 18, 110], [120, 28, 109], [147, 38, 103],
  [174, 48, 92], [199, 62, 76], [221, 81, 58], [237, 105, 37], [248, 133, 15], [252, 165, 10],
  [250, 198, 45], [242, 230, 97], [245, 249, 160], [252, 255, 164],
];

export function infernoRgb(t: number): [number, number, number] {
  const x = Math.min(Math.max(t, 0), 1) * (INFERNO.length - 1);
  const i = Math.min(Math.floor(x), INFERNO.length - 2);
  const f = x - i;
  const a = INFERNO[i];
  const b = INFERNO[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f].map(Math.round) as [number, number, number];
}

/** 256-entry little-endian RGBA lookup. Index 0 = transparent; 1..255 = low..high score. */
export function buildColormap(): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 1; i < 256; i++) {
    const t = (i - 1) / 254;
    const [r, g, b] = infernoRgb(0.08 + 0.92 * t);
    const alpha = Math.round(255 * (0.35 + 0.65 * Math.pow(t, 0.6)));
    lut[i] = (alpha << 24) | (b << 16) | (g << 8) | r;
  }
  return lut;
}

export function cssGradient(): string {
  const stops: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const [r, g, b] = infernoRgb(0.08 + 0.92 * (i / 10));
    stops.push(`rgb(${r},${g},${b}) ${i * 10}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
