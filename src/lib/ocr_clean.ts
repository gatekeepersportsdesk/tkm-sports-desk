/**
 * Turns the raw OCR JSON into reviewable lines. Pure and tested: it only ever
 * DROPS or normalises what the scanner returned. It never adds a player, line
 * or price that was not in the response.
 */
export interface ExtractedPropLine {
  player: string;
  line: number;
  overOdds: string;
  underOdds: string;
  team?: string;
  prop?: string;
}

export function cleanOcrLines(json: any): ExtractedPropLine[] {
  const raw: any[] = Array.isArray(json?.lines) ? json.lines : [];
  return raw
    .filter(l => l && typeof l.player === 'string' && l.player.trim() && l.line !== null && l.line !== '' && Number.isFinite(Number(l.line)))
    .map(l => ({
      player: String(l.player).trim(),
      line: Number(l.line),
      overOdds: l.overOdds ? String(l.overOdds).trim() : '',
      underOdds: l.underOdds ? String(l.underOdds).trim() : '',
      team: l.team ? String(l.team).trim() : '',
      prop: l.prop ? String(l.prop) : json?.propType ? String(json.propType) : ''
    }));
}

/** The model's guess at the sport is a hint only; it is never allowed to change the user's target. */
export function sportHint(json: any): 'NFL' | 'MLB' | 'NHL' | null {
  const g = String(json?.detectedSport || '').toUpperCase();
  return g === 'NFL' || g === 'MLB' || g === 'NHL' ? g : null;
}

/** Parses raw pasted text (CSV, tab-delimited, or space-separated) into ExtractedPropLine array */
export function parsePastedLinesText(text: string, defaultProp?: string): ExtractedPropLine[] {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out: ExtractedPropLine[] = [];

  for (const line of lines) {
    let parts: string[];
    if (line.includes('\t')) {
      parts = line.split('\t').map(s => s.trim());
    } else if (line.includes(',')) {
      parts = line.split(',').map(s => s.trim());
    } else if (line.includes('|')) {
      parts = line.split('|').map(s => s.trim());
    } else {
      const match = line.match(/^([A-Za-z\s.'-]+?)\s+([0-9.]+)\s+([+-]?\d+)\s+([+-]?\d+)$/);
      if (match) {
        parts = [match[1], match[2], match[3], match[4]];
      } else {
        continue;
      }
    }

    if (parts.length < 2) continue;
    const player = parts[0];
    if (!player || /^(player|name|skater|receiver|batter)$/i.test(player)) continue;

    let lineIdx = -1;
    for (let i = 1; i < parts.length; i++) {
      const num = parseFloat(parts[i]);
      if (!isNaN(num) && Number.isFinite(num) && /^[0-9]+(\.[0-9]+)?$/.test(parts[i])) {
        lineIdx = i;
        break;
      }
    }

    if (lineIdx === -1) continue;
    const propLine = parseFloat(parts[lineIdx]);

    let team = '';
    let prop = defaultProp || '';
    if (lineIdx === 2) {
      const token = parts[1];
      if (/^(sog|shots|pts|points|goals|assists|rec|receptions|hits)$/i.test(token)) {
        prop = token.toLowerCase();
      } else {
        team = token.toUpperCase();
      }
    } else if (lineIdx === 3) {
      team = parts[1].toUpperCase();
      prop = parts[2].toLowerCase();
    }

    const overOdds = parts[lineIdx + 1] || '';
    const underOdds = parts[lineIdx + 2] || '';

    out.push({
      player,
      line: propLine,
      overOdds,
      underOdds,
      team,
      prop
    });
  }

  return out;
}

