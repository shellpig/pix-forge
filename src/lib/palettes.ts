export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface OKLabColor {
  L: number;
  a: number;
  b: number;
}

export interface PresetPalette {
  id: string;
  name: string;
  colors: string[];
}

export const PRESET_PALETTES: PresetPalette[] = [
  {
    id: 'endesga32',
    name: 'Endesga 32',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
      '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
      '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
    ],
  },
  {
    id: 'pico8',
    name: 'PICO-8 (16)',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
  },
  {
    id: 'sweetie16',
    name: 'Sweetie 16',
    colors: [
      '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
      '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
    ],
  },
  {
    id: 'resurrect64',
    name: 'Resurrect 64',
    colors: [
      '#2e222f', '#3e3546', '#625565', '#966c6c', '#ab947a', '#694f62', '#7f708a', '#9babb2',
      '#c7dcd0', '#ffffff', '#6e2727', '#b33831', '#ea4f36', '#f57d4a', '#ae2334', '#e83b3b',
      '#fb6b1d', '#f79617', '#f9c22b', '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#fbb954',
      '#4c3e24', '#676633', '#a2a947', '#d5e04b', '#fbff86', '#165a4c', '#239063', '#1ebc73',
      '#91db69', '#cddf6c', '#313638', '#374e4a', '#547e64', '#92a984', '#b2ba90', '#0b5e65',
      '#0b8a8f', '#0eaf9b', '#30e1b9', '#8ff8e2', '#323353', '#484a77', '#4d65b4', '#4d9be6',
      '#8fd3ff', '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded', '#753c54', '#a24b6f',
      '#cf657f', '#ed8099', '#831c5d', '#c32454', '#f04f78', '#f68181', '#fca790', '#fdcbb0',
    ],
  },
  {
    id: 'apollo48',
    name: 'Apollo (48)',
    colors: [
      '#172038', '#253a5e', '#3c5e8b', '#4f8fba', '#73bed3', '#a4dddb', '#19332d', '#25562e',
      '#468232', '#75a743', '#a8ca58', '#d0da91', '#4d2b32', '#7a4841', '#ad7757', '#c09473',
      '#d7b594', '#e7d5b3', '#341c27', '#602c2c', '#884b2b', '#be772b', '#de9e41', '#e8c170',
      '#241527', '#411d31', '#752438', '#a53030', '#cf573c', '#da863e', '#1e1d39', '#402751',
      '#7a367b', '#a23e8c', '#c65197', '#df84a5', '#090a14', '#10141f', '#151d28', '#202e37',
      '#394a50', '#577277', '#819796', '#a8b5b2', '#c7cfcc', '#ebede9', '#ffffff', '#000000',
    ],
  },
  {
    id: 'slso8',
    name: 'SLSO8 (8)',
    colors: ['#0d2b45', '#203c56', '#544e68', '#8d697a', '#d08159', '#ffaa5e', '#ffd4a3', '#ffecd6'],
  },
  {
    id: 'gameboy',
    name: 'Game Boy (4)',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  { id: 'black-white', name: 'Black & White (2)', colors: ['#000000', '#ffffff'] },
];

export function hexToRgb(hex: string): RGBColor {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    ((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b))
      .toString(16)
      .slice(1)
      .toLowerCase()
  );
}

// Fast lookup table for sRGB [0..255] -> linear [0..1]
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  const v = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/**
 * Perceptually uniform sRGB -> OKLab conversion (Björn Ottosson)
 */
export function rgbToOklab(r: number, g: number, b: number): OKLabColor {
  const lr = SRGB_TO_LINEAR[r < 0 ? 0 : r > 255 ? 255 : r | 0];
  const lg = SRGB_TO_LINEAR[g < 0 ? 0 : g > 255 ? 255 : g | 0];
  const lb = SRGB_TO_LINEAR[b < 0 ? 0 : b > 255 ? 255 : b | 0];

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb(L: number, a: number, b: number): RGBColor {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  };
}

export function oklabDistSq(c1: OKLabColor, c2: OKLabColor): number {
  const dL = c1.L - c2.L;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return dL * dL + da * da + db * db;
}
