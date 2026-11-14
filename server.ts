import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { buildNflSlate, buildNflGrades, downloadNflverseFiles, NflverseFiles } from './src/lib/nfl_slate';
import { nflSeasonFor } from './src/lib/nflverse';
import { normalizeNhlTeam, nhlSeasonFor, selectTopSkaters } from './src/lib/nhl_data';
import { parseNbaBox, buildNbaState, boxLinesFor, nbaSeasonFor, NbaBoxRow } from './src/lib/nba_data';
import { NbaBoxLine } from './src/types/nba';

dotenv.config();

function parsePort(): number {
  const argIdx = process.argv.indexOf('--port');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    const val = parseInt(process.argv[argIdx + 1], 10);
    if (!isNaN(val)) return val;
  }
  return 3000;
}

const app = express();
const port = parsePort();

app.use(express.json({ limit: '50mb' }));

// A thrown error in a background promise must not take the whole dev server down (a restart reloads your page).
process.on('unhandledRejection', (reason) => { console.error('[server] unhandledRejection (kept running):', reason); });
process.on('uncaughtException', (err) => { console.error('[server] uncaughtException (kept running):', err); });

const SERVER_STARTED_AT = Date.now();
app.get('/health', (_req, res) => res.status(200).send('OK'));
// The page asks this on load: if startedAt changed since the last visit, the server restarted (that is what reloads the page).
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, startedAt: SERVER_STARTED_AT, uptimeSec: Math.round((Date.now() - SERVER_STARTED_AT) / 1000), hmr: process.env.GATEKEEP_ENABLE_HMR === 'true' });
});

// Sportsbook OCR parsing endpoint via Gemini 3.8 Flash Vision
app.post('/api/ocr-lines', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', sport = 'any' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing imageBase64 in request body' });
    }

    // Clean base64 header if included
    const cleanedBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `You are an expert sports betting odds reader and optical character recognition parser.
Analyze this sportsbook screenshot (from Bet365, Bet99, DraftKings, FanDuel, Bovada, Pinnacle, or similar).
Extract all player proposition betting lines shown in the image.
The user is interested in props for ${sport} (NFL receptions, MLB hits, NHL shots on goal / points, or NBA points / rebounds / assists / three-pointers made / points+rebounds+assists / steals / blocks).

Respond with a strictly valid JSON object matching this schema:
{
  "book": "detected sportsbook name (e.g. Bet99, Bet365, DraftKings, etc.)",
  "detectedSport": "NFL" | "MLB" | "NHL" | "NBA",
  "propType": "receptions" | "hits" | "shots" | "points" | "rebounds" | "assists" | "threes" | "pra" | "steals" | "blocks",
  "lines": [
    {
      "player": "Full Player Name",
      "team": "Team code if visible, otherwise empty string",
      "prop": "receptions" | "hits" | "shots" | "points" | "rebounds" | "assists" | "threes" | "pra" | "steals" | "blocks",
      "line": 6.5,
      "overOdds": "-110",
      "underOdds": "-120"
    }
  ]
}

Formatting rules:
- Format American odds with minus or plus (e.g. "-110", "+120", "-165").
- If only one side odds is visible, set the other to empty string.
- Normalize player names accurately (e.g. "Jaxon Smith-Njigba", "AJ Barner", "Aaron Judge", "Auston Matthews").
- Only report lines that are actually visible. Never guess or fill in a player, line or price you cannot read.
- Return JSON only. No markdown formatting or extra text.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: cleanedBase64 } },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const raw = response.text || '{}';
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned || '{}');
    return res.json(parsed);
  } catch (err: any) {
    console.error('OCR Line parsing error:', err);
    return res.status(500).json({
      error: 'Failed to process screenshot with AI vision',
      details: err.message
    });
  }
});

// Proxy endpoints for today's live sports games (avoids browser CORS issues)
app.get('/api/games/nfl', async (_req, res) => {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`ESPN API returned ${response.status}`);
    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    console.error('ESPN NFL fetch failed:', err);
    return res.status(500).json({ error: 'Failed to fetch NFL live games', details: err.message });
  }
});

app.get('/api/games/mlb', async (_req, res) => {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`ESPN API returned ${response.status}`);
    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    console.error('ESPN MLB fetch failed:', err);
    return res.status(500).json({ error: 'Failed to fetch MLB live games', details: err.message });
  }
});

app.get('/api/games/nhl', async (req, res) => {
  try {
    const date = req.query.date as string;
    const url = date
      ? `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${date.replace(/-/g, '')}`
      : 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard';
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`ESPN API returned ${response.status}`);
    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    console.error('ESPN NHL fetch failed:', err);
    return res.status(500).json({ error: 'Failed to fetch NHL live games', details: err.message });
  }
});

// ---- NHL live data (official api-web.nhle.com / api.nhle.com, ESPN for injuries) ----
// The server only RELAYS raw JSON (with caching). Parsing is in src/lib/nhl_data.ts so it is unit-tested.
const NHL_HEADERS = { Accept: 'application/json', 'User-Agent': 'GatekeepSportsDesk/1.0' };
const nhlCache = new Map<string, { at: number; v: any }>();
async function nhlJson(url: string, ttlMs: number): Promise<any | null> {
  const hit = nhlCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  try {
    const r = await fetch(url, { headers: NHL_HEADERS });
    if (!r.ok) return null;
    const v = await r.json();
    nhlCache.set(url, { at: Date.now(), v });
    return v;
  } catch {
    return null;
  }
}

app.get('/api/nhl/schedule', async (req, res) => {
  try {
    const date = (req.query.date as string) || isoDate();
    const data = await nhlJson(`https://api-web.nhle.com/v1/schedule/${date}`, 5 * 60 * 1000);
    if (!data) throw new Error('NHL schedule unavailable');
    const games: any[] = [];
    for (const day of data.gameWeek || []) {
      if (day.date !== date) continue;
      for (const g of day.games || []) {
        games.push({
          gameId: g.id,
          startTimeUtc: g.startTimeUTC || g.startTimeUtc,
          awayTeam: g.awayTeam?.abbrev,
          homeTeam: g.homeTeam?.abbrev,
          venue: g.venue?.default || ''
        });
      }
    }
    return res.json({ date, games });
  } catch (err: any) {
    console.error('NHL schedule failed:', err);
    return res.status(500).json({ error: 'Failed to fetch NHL schedule', details: err.message });
  }
});

// Roster + current + prior season club stats + real game logs for the top-TOI skaters.
app.get('/api/nhl/team/:team', async (req, res) => {
  try {
    const team = normalizeNhlTeam(req.params.team);
    const date = (req.query.date as string) || isoDate();
    const { season, prev } = nhlSeasonFor(date);
    const [roster, stats, prior] = await Promise.all([
      nhlJson(`https://api-web.nhle.com/v1/roster/${team}/${season}`, 6 * 60 * 60 * 1000),
      nhlJson(`https://api-web.nhle.com/v1/club-stats/${team}/${season}/2`, 20 * 60 * 1000),
      nhlJson(`https://api-web.nhle.com/v1/club-stats/${team}/${prev}/2`, 24 * 60 * 60 * 1000)
    ]);
    if (!roster) throw new Error(`roster unavailable for ${team}`);
    const ids = selectTopSkaters({ roster, stats, prior }, 16);
    const logs: Record<string, any> = {};
    await pool(ids, 6, async id => {
      const g = await nhlJson(`https://api-web.nhle.com/v1/player/${id}/game-log/${season}/2`, 20 * 60 * 1000);
      if (g) logs[String(id)] = g;
    });
    return res.json({ team, season, prevSeason: prev, roster, stats, prior, logs });
  } catch (err: any) {
    console.error('NHL team failed:', err);
    return res.status(500).json({ error: 'Failed to fetch NHL team', details: err.message });
  }
});

// Team shots-against / goals-against for the opponent factors.
app.get('/api/nhl/teams', async (req, res) => {
  try {
    const date = (req.query.date as string) || isoDate();
    const { season } = nhlSeasonFor(date);
    const [standings, summary] = await Promise.all([
      nhlJson('https://api-web.nhle.com/v1/standings/now', 30 * 60 * 1000),
      nhlJson(
        `https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=${encodeURIComponent(`seasonId=${season} and gameTypeId=2`)}`,
        30 * 60 * 1000
      )
    ]);
    if (!standings) throw new Error('standings unavailable');
    return res.json({ season, standings, summary });
  } catch (err: any) {
    console.error('NHL teams failed:', err);
    return res.status(500).json({ error: 'Failed to fetch NHL team table', details: err.message });
  }
});

app.get('/api/nhl/injuries', async (_req, res) => {
  try {
    const data = await nhlJson('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries', 10 * 60 * 1000);
    if (!data) throw new Error('injuries unavailable');
    return res.json(data);
  } catch (err: any) {
    console.error('NHL injuries failed:', err);
    return res.status(500).json({ error: 'Failed to fetch NHL injuries', details: err.message });
  }
});

// Official box scores for grading (parsed client-side).
app.get('/api/nhl/boxscores', async (req, res) => {
  try {
    const ids = String(req.query.gameIds || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)).slice(0, 40);
    const rows = await pool(ids, 6, async id => [id, await nhlJson(`https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`, 60 * 1000)] as const);
    return res.json({ games: Object.fromEntries(rows) });
  } catch (err: any) {
    console.error('NHL boxscores failed:', err);
    return res.status(500).json({ error: 'Failed to fetch NHL boxscores', details: err.message });
  }
});

// ---- NBA: sportsdataverse ESPN box scores (the SAME source the model was fitted on) + ESPN schedule/injuries ----
// The server downloads and aggregates the CSVs (the prior-season file is ~17MB; the browser never parses it).
const NBA_BOX_URL = (y: number) => `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_player_boxscores/player_box_${y}.csv`;
const nbaBoxCache = new Map<number, { at: number; rows: NbaBoxRow[] }>();
async function getNbaBox(season: number, ttlMs: number): Promise<NbaBoxRow[]> {
  const hit = nbaBoxCache.get(season);
  if (hit && Date.now() - hit.at < ttlMs) return hit.rows;
  const r = await fetch(NBA_BOX_URL(season), { headers: { 'User-Agent': 'GatekeepSportsDesk/1.0' } });
  if (!r.ok) throw new Error(`NBA box ${season} -> HTTP ${r.status}`);
  const rows = parseNbaBox(await r.text());
  nbaBoxCache.set(season, { at: Date.now(), rows });
  return rows;
}

app.get('/api/nba/state', async (req, res) => {
  try {
    const season = nbaSeasonFor((req.query.date as string) || isoDate());
    const [cur, prior] = await Promise.all([getNbaBox(season, 30 * 60 * 1000), getNbaBox(season - 1, 24 * 60 * 60 * 1000).catch(() => [] as NbaBoxRow[])]);
    const st = buildNbaState(cur, prior);
    return res.json({ season, priorLoaded: prior.length > 0, ...st });
  } catch (err: any) {
    console.error('NBA state failed:', err);
    return res.status(500).json({ error: 'Failed to load NBA game logs', details: err.message });
  }
});

app.get('/api/nba/schedule', async (req, res) => {
  try {
    const date = (req.query.date as string) || isoDate();
    const data = await nhlJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replace(/-/g, '')}`, 5 * 60 * 1000);
    if (!data) throw new Error('schedule unavailable');
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch NBA schedule', details: err.message });
  }
});

app.get('/api/nba/injuries', async (_req, res) => {
  try {
    const data = await nhlJson('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries', 10 * 60 * 1000);
    if (!data) throw new Error('injuries unavailable');
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch NBA injuries', details: err.message });
  }
});

// Live ESPN game summary box scores for grading finished NBA games in real-time
const espnBoxCache = new Map<string, { at: number; lines: NbaBoxLine[] }>();

async function getEspnNbaBoxLinesForDate(date: string): Promise<NbaBoxLine[]> {
  try {
    const compactDate = date.replace(/-/g, '');
    const schedUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${compactDate}`;
    const schedData = await nhlJson(schedUrl, 2 * 60 * 1000);
    if (!schedData || !Array.isArray(schedData.events)) return [];

    const finishedEvents = schedData.events.filter((ev: any) =>
      ev.status?.type?.completed === true || ev.status?.type?.state === 'post' || /final/i.test(ev.status?.type?.name || '') || /final/i.test(ev.status?.type?.description || '')
    );
    if (!finishedEvents.length) return [];

    const gameLines: NbaBoxLine[] = [];
    await pool(finishedEvents, 6, async (ev: any) => {
      const gameId = String(ev.id);
      const cacheHit = espnBoxCache.get(gameId);
      if (cacheHit && Date.now() - cacheHit.at < 24 * 60 * 60 * 1000) {
        gameLines.push(...cacheHit.lines);
        return;
      }

      const sumUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`;
      const sum = await nhlJson(sumUrl, 60 * 60 * 1000);
      if (!sum || !Array.isArray(sum.boxscore?.players)) return;

      const thisGameLines: NbaBoxLine[] = [];
      for (const team of sum.boxscore.players) {
        const statGroup = team.statistics?.[0];
        const names = statGroup?.names || [];
        const minIdx = names.indexOf('MIN');
        const ptsIdx = names.indexOf('PTS');
        const rebIdx = names.indexOf('REB');
        const astIdx = names.indexOf('AST');
        const stlIdx = names.indexOf('STL');
        const blkIdx = names.indexOf('BLK');
        const tpmIdx = names.indexOf('3PT');

        for (const a of statGroup?.athletes || []) {
          const playerId = Number(a.athlete?.id);
          if (!playerId) continue;
          const dnp = a.didNotPlay === true || !a.stats || a.stats.length === 0;
          const min = dnp ? 0 : Number(a.stats[minIdx]) || 0;
          const pts = dnp ? 0 : Number(a.stats[ptsIdx]) || 0;
          const reb = dnp ? 0 : Number(a.stats[rebIdx]) || 0;
          const ast = dnp ? 0 : Number(a.stats[astIdx]) || 0;
          const stl = dnp ? 0 : Number(a.stats[stlIdx]) || 0;
          const blk = dnp ? 0 : Number(a.stats[blkIdx]) || 0;
          const tpm = dnp ? 0 : Number(String(a.stats[tpmIdx] || '0').split('-')[0]) || 0;

          thisGameLines.push({
            gameId,
            date,
            playerId,
            name: String(a.athlete?.displayName || a.athlete?.name || ''),
            minutes: min,
            dnp: dnp || min === 0,
            actual: { pts, reb, ast, tpm, pra: pts + reb + ast, stl, blk }
          });
        }
      }
      espnBoxCache.set(gameId, { at: Date.now(), lines: thisGameLines });
      gameLines.push(...thisGameLines);
    });

    return gameLines;
  } catch (err) {
    console.error(`[nba live box] error fetching ESPN box for ${date}:`, err);
    return [];
  }
}

// Real box lines for grading: ?dates=2026-10-24,2026-10-25 or ?gameIds=401909877
app.get('/api/nba/actuals', async (req, res) => {
  try {
    const dates = String(req.query.dates || '').split(',').map(x => x.trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 30);
    const gameIds = String(req.query.gameIds || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)).slice(0, 50);
    if (!dates.length && !gameIds.length) return res.json({ lines: [] });

    const allLines: NbaBoxLine[] = [];
    const missingDates: string[] = [];
    let espnCount = 0;
    let fallbackCount = 0;

    // 1. Direct gameIds if passed
    if (gameIds.length > 0) {
      await pool(gameIds, 6, async (gameId: string) => {
        const cacheHit = espnBoxCache.get(gameId);
        if (cacheHit && Date.now() - cacheHit.at < 24 * 60 * 60 * 1000) {
          allLines.push(...cacheHit.lines);
          espnCount += cacheHit.lines.length;
          return;
        }
        const sumUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`;
        const sum = await nhlJson(sumUrl, 60 * 60 * 1000);
        if (!sum || !Array.isArray(sum.boxscore?.players)) return;
        const thisGameLines: NbaBoxLine[] = [];
        const dateStr = sum.header?.competitions?.[0]?.date?.slice(0, 10) || isoDate();
        for (const team of sum.boxscore.players) {
          const statGroup = team.statistics?.[0];
          const names = statGroup?.names || [];
          const minIdx = names.indexOf('MIN');
          const ptsIdx = names.indexOf('PTS');
          const rebIdx = names.indexOf('REB');
          const astIdx = names.indexOf('AST');
          const stlIdx = names.indexOf('STL');
          const blkIdx = names.indexOf('BLK');
          const tpmIdx = names.indexOf('3PT');
          for (const a of statGroup?.athletes || []) {
            const playerId = Number(a.athlete?.id);
            if (!playerId) continue;
            const dnp = a.didNotPlay === true || !a.stats || a.stats.length === 0;
            const min = dnp ? 0 : Number(a.stats[minIdx]) || 0;
            const pts = dnp ? 0 : Number(a.stats[ptsIdx]) || 0;
            const reb = dnp ? 0 : Number(a.stats[rebIdx]) || 0;
            const ast = dnp ? 0 : Number(a.stats[astIdx]) || 0;
            const stl = dnp ? 0 : Number(a.stats[stlIdx]) || 0;
            const blk = dnp ? 0 : Number(a.stats[blkIdx]) || 0;
            const tpm = dnp ? 0 : Number(String(a.stats[tpmIdx] || '0').split('-')[0]) || 0;
            thisGameLines.push({
              gameId,
              date: dateStr,
              playerId,
              name: String(a.athlete?.displayName || a.athlete?.name || ''),
              minutes: min,
              dnp: dnp || min === 0,
              actual: { pts, reb, ast, tpm, pra: pts + reb + ast, stl, blk }
            });
          }
        }
        espnBoxCache.set(gameId, { at: Date.now(), lines: thisGameLines });
        allLines.push(...thisGameLines);
        espnCount += thisGameLines.length;
      });
    }

    // 2. Primary: Live ESPN game summary box scores (real-time right after game finishes)
    for (const d of dates) {
      const espnLines = await getEspnNbaBoxLinesForDate(d);
      if (espnLines.length > 0) {
        allLines.push(...espnLines);
        espnCount += espnLines.length;
      } else {
        missingDates.push(d);
      }
    }

    // 3. Fallback: sportsdataverse season CSV for any date where ESPN live box had 0 lines
    if (missingDates.length > 0) {
      const seasons = Array.from(new Set(missingDates.map(nbaSeasonFor)));
      for (const sn of seasons) {
        try {
          const csvRows = await getNbaBox(sn, 10 * 60 * 1000);
          const fallbackLines = boxLinesFor(csvRows, missingDates);
          if (fallbackLines.length > 0) {
            allLines.push(...fallbackLines);
            fallbackCount += fallbackLines.length;
          }
        } catch (csvErr) {
          console.warn(`[nba actuals] CSV fallback for season ${sn} failed:`, csvErr);
        }
      }
    }

    console.log(`[nba actuals] dates: [${dates.join(', ')}] gameIds: [${gameIds.join(', ')}] -> returned ${allLines.length} lines (${espnCount} live ESPN, ${fallbackCount} CSV fallback)`);
    return res.json({ lines: allLines });
  } catch (err: any) {
    console.error('[nba actuals] error:', err);
    return res.status(500).json({ error: 'Failed to fetch NBA actuals', details: err.message });
  }
});

// ---- NFL: nflverse slate (games+lines, receivers, injuries, ratios) and real grades ----
const nflFileCache = new Map<number, { at: number; files: NflverseFiles }>();
const NFL_CACHE_MS = 30 * 60 * 1000;

async function getNflFiles(season: number): Promise<NflverseFiles> {
  const hit = nflFileCache.get(season);
  if (hit && Date.now() - hit.at < NFL_CACHE_MS) return hit.files;
  const files = await downloadNflverseFiles(season, async url => {
    const r = await fetch(url, { headers: { 'User-Agent': 'GatekeepSportsDesk/1.0' } });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return await r.text();
  });
  nflFileCache.set(season, { at: Date.now(), files });
  return files;
}

app.get('/api/nfl/slate', async (req, res) => {
  try {
    const season = req.query.season ? Number(req.query.season) : nflSeasonFor();
    const week = req.query.week ? Number(req.query.week) : undefined;
    const files = await getNflFiles(season);
    return res.json(buildNflSlate(files, { season, week }));
  } catch (err: any) {
    console.error('NFL slate failed:', err);
    return res.status(502).json({ error: 'Failed to build NFL slate from nflverse', details: err.message });
  }
});

app.get('/api/nfl/grades', async (req, res) => {
  try {
    const season = Number(req.query.season) || nflSeasonFor();
    const week = Number(req.query.week);
    if (!week) return res.status(400).json({ error: 'week required' });
    const files = await getNflFiles(season);
    return res.json({ season, week, ...buildNflGrades(files, season, week) });
  } catch (err: any) {
    console.error('NFL grades failed:', err);
    return res.status(502).json({ error: 'Failed to build NFL grades', details: err.message });
  }
});

// ---- NFL live WR/TE (ESPN) ----
const ESPN_NFL_TEAM_ID: Record<string, string> = {
  ARI:'22', ATL:'1', BAL:'33', BUF:'2', CAR:'29', CHI:'3', CIN:'4', CLE:'5',
  DAL:'6', DEN:'7', DET:'8', GB:'9', HOU:'34', IND:'11', JAX:'30', KC:'12',
  LAC:'24', LAR:'14', LV:'13', MIA:'15', MIN:'16', NE:'17', NO:'18', NYG:'19',
  NYJ:'20', PHI:'21', PIT:'23', SEA:'26', SF:'25', TB:'27', TEN:'10', WSH:'28', WAS:'28',
};

app.get('/api/nfl/receivers/:team', async (req, res) => {
  try {
    const team = (req.params.team || '').toUpperCase();
    const tid = ESPN_NFL_TEAM_ID[team];
    if (!tid) return res.status(404).json({ error: `Unknown team ${team}` });
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${tid}/roster`,
      { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) throw new Error(`ESPN roster ${response.status}`);
    const data = await response.json();
    const receivers: any[] = [];
    for (const grp of data.athletes || []) {
      for (const a of grp.items || []) {
        const pos = a.position?.abbreviation;
        if (pos !== 'WR' && pos !== 'TE') continue;
        const name = a.displayName || a.fullName;
        if (!name || /WR\d|TE\d|Top Center|Top Winger/i.test(name)) continue;
        receivers.push({ id: String(a.id), name, pos, team, jersey: a.jersey || '' });
      }
    }
    return res.json({ team, receivers });
  } catch (err: any) {
    console.error('NFL receivers failed:', err);
    return res.status(500).json({ error: 'Failed to fetch NFL receivers', details: err.message });
  }
});

// Local calendar date in the user's timezone (set TZ_DATE_OFFSET via query), never UTC midnight.
function isoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

app.get('/api/mlb/schedule', async (req, res) => {
  try {
    const date = (req.query.date as string) || isoDate();
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=lineups,probablePitcher,team,linescore`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`MLB schedule ${response.status}`);
    const data = await response.json();
    const gamesRaw = data.dates?.[0]?.games || [];
    return res.json({ date, count: gamesRaw.length, games: gamesRaw });
  } catch (err: any) {
    console.error('MLB schedule failed:', err);
    return res.status(500).json({ error: 'Failed to fetch MLB schedule', details: err.message });
  }
});

// Real stats for the lineup (batters) and probable starters (pitchers). Raw statsapi JSON is
// returned and parsed client-side (src/lib/mlb_stats.ts) so the parsing is unit-tested.
const mlbStatsCache = new Map<string, { at: number; v: any }>();
async function cachedJson(url: string, ttlMs: number): Promise<any | null> {
  const hit = mlbStatsCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const v = await r.json();
    mlbStatsCache.set(url, { at: Date.now(), v });
    return v;
  } catch {
    return null;
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

app.get('/api/mlb/stats', async (req, res) => {
  try {
    const ids = (q: any) => String(q || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)).slice(0, 80);
    const batters = ids(req.query.batters);
    const pitchers = ids(req.query.pitchers);
    const season = Number(req.query.season) || new Date().getFullYear();
    const base = 'https://statsapi.mlb.com/api/v1/people';
    const TTL = 20 * 60 * 1000;
    const one = (group: 'hitting' | 'pitching') => async (id: string) => {
      const [person, stats] = await Promise.all([
        cachedJson(`${base}/${id}`, 6 * 60 * 60 * 1000),
        cachedJson(`${base}/${id}/stats?stats=season,gameLog${group === 'hitting' ? ',statSplits&sitCodes=vl,vr' : ''}&group=${group}&season=${season}`, TTL)
      ]);
      return [id, { person, stats }] as const;
    };
    const [b, p] = await Promise.all([pool(batters, 8, one('hitting')), pool(pitchers, 8, one('pitching'))]);
    return res.json({ season, batters: Object.fromEntries(b), pitchers: Object.fromEntries(p) });
  } catch (err: any) {
    console.error('MLB stats failed:', err);
    return res.status(500).json({ error: 'Failed to fetch MLB stats', details: err.message });
  }
});

// Final-game box scores for grading (hits / AB / PA per player). Parsed client-side.
app.get('/api/mlb/boxscores', async (req, res) => {
  try {
    const pks = String(req.query.gamePks || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)).slice(0, 40);
    const rows = await pool(pks, 6, async pk => {
      const [box, sched] = await Promise.all([
        cachedJson(`https://statsapi.mlb.com/api/v1/game/${pk}/boxscore`, 60 * 1000),
        cachedJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${pk}`, 60 * 1000)
      ]);
      return [pk, { box, sched }] as const;
    });
    return res.json({ games: Object.fromEntries(rows) });
  } catch (err: any) {
    console.error('MLB boxscores failed:', err);
    return res.status(500).json({ error: 'Failed to fetch MLB boxscores', details: err.message });
  }
});

// External line movements & market variance from TheOddsAPI (with fallback to card shift)
app.get('/api/odds/movement', async (req, res) => {
  try {
    const sport = String(req.query.sport || 'nba').toLowerCase();
    const apiKey = String(req.query.apiKey || process.env.THE_ODDS_API_KEY || '').trim();

    if (!apiKey) {
      return res.json({
        ok: true,
        source: 'daily_card_fallback',
        message: 'No THE_ODDS_API_KEY provided; using daily-card historical baseline & model discrepancy engine.',
        movements: {}
      });
    }

    const sportKeys: Record<string, string> = {
      nba: 'basketball_nba',
      nhl: 'icehockey_nhl',
      nfl: 'americanfootball_nfl'
    };
    const sportKey = sportKeys[sport] || 'basketball_nba';

    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=player_points,player_assists,player_rebounds,player_threes,player_shots_on_goal,player_receptions&oddsFormat=american`;

    const r = await fetch(url);
    if (!r.ok) {
      const errText = await r.text();
      return res.json({
        ok: false,
        source: 'the_odds_api',
        error: `TheOddsAPI returned ${r.status}`,
        details: errText,
        fallback: 'daily_card_shifts',
        movements: {}
      });
    }

    const data = await r.json();
    const movements: Record<string, any> = {};
    if (Array.isArray(data)) {
      data.forEach((evt: any) => {
        (evt.bookmakers || []).forEach((bk: any) => {
          (bk.markets || []).forEach((m: any) => {
            (m.outcomes || []).forEach((out: any) => {
              const playerName = out.description || out.name;
              if (!playerName || out.point == null) return;
              const key = `${sport}:${m.key}:${playerName.toLowerCase().trim()}`;
              if (!movements[key]) {
                movements[key] = {
                  player: playerName,
                  sport,
                  market: m.key,
                  lines: [],
                  books: []
                };
              }
              movements[key].lines.push(out.point);
              movements[key].books.push({ book: bk.title || bk.key, line: out.point, price: out.price, side: out.name });
            });
          });
        });
      });

      Object.keys(movements).forEach(k => {
        const item = movements[k];
        const minL = Math.min(...item.lines);
        const maxL = Math.max(...item.lines);
        const spread = maxL - minL;
        const avg = item.lines.reduce((s: number, x: number) => s + x, 0) / item.lines.length;
        movements[k] = {
          player: item.player,
          sport: item.sport,
          market: item.market,
          minLine: minL,
          maxLine: maxL,
          lineSpread: spread,
          consensusLine: avg,
          bookCount: item.books.length,
          steamDirection: spread >= 1.0 ? (avg > minL ? 'OVER' : 'UNDER') : 'NEUTRAL'
        };
      });
    }

    return res.json({
      ok: true,
      source: 'the_odds_api',
      movements
    });
  } catch (err: any) {
    console.error('Odds movement fetch failed:', err);
    return res.json({
      ok: false,
      source: 'error',
      error: err.message,
      fallback: 'daily_card_shifts',
      movements: {}
    });
  }
});

const httpServer = http.createServer(app);

// Stricter now: HMR / file watching are OFF unless you explicitly opt in with GATEKEEP_ENABLE_HMR=true, whether or not the host
// remembered to set DISABLE_HMR. A full reload while you analyze costs more than a manual refresh after an edit.
const hmrOff = process.env.GATEKEEP_ENABLE_HMR !== 'true';
const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: hmrOff ? false : { server: httpServer },
    watch: hmrOff ? null : undefined,
    allowedHosts: [
      'gatekeep-sports-desk-multi-sport-props-terminal.ai.studio',
      '.ai.studio',
      'localhost',
      '127.0.0.1'
    ]
  },
  appType: 'spa'
});
app.use(vite.middlewares);

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Gatekeep Sports Desk full-stack server running on http://0.0.0.0:${port}`);
  console.log(`[gatekeep] HMR/file-watching is ${hmrOff ? 'OFF (default; set GATEKEEP_ENABLE_HMR=true to turn it on)' : 'ON'}; /api/health reports it too.`);
});
