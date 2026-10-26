import { GM_FAMILIES, GM_DRUM_NAMES } from './sf2.js';

/** Instrument / drum kit catalogue derived from the loaded SoundFont. */
export function buildCatalog(sf) {
  const families = GM_FAMILIES.map((name) => ({ name, presets: [] }));
  for (const p of sf.presets) {
    if (p.bank >= 120) continue; // 128 = drum kits, 120 = GS kit aliases
    families[p.program >> 3].presets.push({
      name: p.bank ? `${p.name} (variation ${p.bank})` : p.name,
      bank: p.bank,
      program: p.program,
    });
  }
  for (const f of families) f.presets.sort((a, b) => a.program - b.program || a.bank - b.bank);

  const kits = sf.presets
    .filter((p) => p.bank === 128)
    .map((kit) => {
      const pieces = [];
      for (let key = 24; key <= 96; key++) {
        const hit = sf.match(kit, key, 100)[0];
        if (!hit) continue;
        const sample = sf.shdr[hit.sampleIdx].name;
        pieces.push({ key, name: GM_DRUM_NAMES[key] || sample });
      }
      return { name: kit.name, bank: 128, program: kit.program, pieces };
    });

  return { families, kits };
}

/** Piece names for one kit as a Map(key -> name) — used for piano-roll key labels. */
export function kitKeyNames(catalog, program) {
  const kit = catalog.kits.find((k) => k.program === program);
  return new Map((kit?.pieces ?? []).map((p) => [p.key, p.name]));
}

export const isKitChannel = (ch) => ch.type === 'sf' && ch.bank === 128 && ch.fixedKey == null;
