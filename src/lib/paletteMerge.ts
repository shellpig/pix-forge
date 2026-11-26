import { normalizeDocumentHex, type DocumentColor } from './documentPalette';
import { hexToRgb, rgbToOklab, oklabDistSq } from './palettes';

// Exact complete-link hierarchy is cubic in color count. Never silently omit
// rare colors: oversized palettes must first be reduced or merged manually.
export const MAX_AUTO_MERGE_COLORS = 256;

export interface PaletteMergeGroup {
  colors: DocumentColor[];
  representative: string;
  count: number;
}

interface MergeStep { left: number; right: number; distanceSq: number }
export interface PaletteMergePlan {
  colors: DocumentColor[];
  steps: MergeStep[];
}

/** Construct a deterministic complete-link hierarchy once per committed palette. */
export function buildPaletteMergePlan(input: readonly DocumentColor[]): PaletteMergePlan | null {
  if (input.length > MAX_AUTO_MERGE_COLORS) return null;
  const colors = [...input].sort((a,b) => a.hex.localeCompare(b.hex));
  const n = colors.length;
  const labs = colors.map(c => {
    const rgb = hexToRgb(c.hex);
    return rgbToOklab(rgb.r, rgb.g, rgb.b);
  });
  const distances = new Float64Array(n*n);
  const active = new Uint8Array(n).fill(1);
  for (let i=0; i<n; i++) for (let j=i+1; j<n; j++) {
    distances[i*n+j] = distances[j*n+i] = oklabDistSq(labs[i], labs[j]);
  }
  const steps: MergeStep[] = [];
  for (let step=1; step<n; step++) {
    let left=-1, right=-1, best=Infinity;
    for (let i=0; i<n; i++) {
      if (!active[i]) continue;
      for (let j=i+1; j<n; j++) {
        if (!active[j]) continue;
        const d=distances[i*n+j];
        if (d<best) { best=d; left=i; right=j; }
      }
    }
    if (left<0 || right<0) break;
    steps.push({left, right, distanceSq:best});
    for (let k=0; k<n; k++) {
      if (!active[k] || k===left || k===right) continue;
      const d=Math.max(distances[left*n+k], distances[right*n+k]);
      distances[left*n+k]=distances[k*n+left]=d;
    }
    active[right]=0;
  }
  return { colors, steps };
}

/** Cut the hierarchy by Euclidean OKLab distance; no group can span farther
 * than the tolerance, unlike single-link chains. Preserve existing colors. */
export function getPaletteMergeGroups(plan: PaletteMergePlan, tolerance: number): PaletteMergeGroup[] {
  const groups = plan.colors.map(c => [c]);
  const t = Number.isFinite(tolerance) ? Math.max(0,tolerance) : 0;
  for (const step of plan.steps) {
    if (step.distanceSq > t*t) break;
    groups[step.left].push(...groups[step.right]);
    groups[step.right] = [];
  }
  return groups.filter(g => g.length > 0).map(colors => {
    colors.sort((a,b) => b.count-a.count || a.hex.localeCompare(b.hex));
    return { colors, representative: colors[0].hex, count: colors.reduce((sum,c)=>sum+c.count,0) };
  }).sort((a,b)=>b.count-a.count || a.representative.localeCompare(b.representative));
}

export function paletteMergeGroupId(group: PaletteMergeGroup): string {
  return group.colors.map(c=>c.hex).sort().join(',');
}

/** Representatives may be overridden only with an existing member color. */
export function createAutoMergeMapping(
  groups: readonly PaletteMergeGroup[],
  overrides: ReadonlyMap<string,string> = new Map()
): Map<string,string> {
  const mapping = new Map<string,string>();
  for (const group of groups) {
    const requested = overrides.get(paletteMergeGroupId(group));
    const target = requested && group.colors.some(c=>c.hex===requested) ? requested : group.representative;
    for (const c of group.colors) if (c.hex!==target) mapping.set(c.hex,target);
  }
  return mapping;
}

export function createManualMergeMapping(sources: readonly string[], target: string): Map<string,string> {
  const normalizedTarget=normalizeDocumentHex(target);
  const mapping=new Map<string,string>();
  if (!normalizedTarget) return mapping;
  for (const source of sources) {
    const hex=normalizeDocumentHex(source);
    if (!hex) return new Map();
    if (hex!==normalizedTarget) mapping.set(hex,normalizedTarget);
  }
  return mapping;
}
