import React, { useState, useEffect, useRef } from 'react';
import { Header, ActiveSport } from './components/Header';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// NFL components & data
import { NflDesk } from './components/nfl/NflDesk';
import { NflScoreboard } from './components/nfl/NflScoreboard';
import { NflImportModal } from './components/nfl/NflImportModal';
import { NflGradeModal } from './components/nfl/NflGradeModal';
import { generateInitialNflSnapshots, NFL_PLAYERS, NFL_GAMES } from './data/nfl_seed';
import { parseOdds, applyGameCap } from './model/nfl_engine';
import { importNflLines, NflImportContext } from './lib/nfl_import';
import { normalizePlayerName } from './lib/nflverse';
import { NflPropSnapshot, NflActualRecord, NflBetRecord, NflGameContext, NflPlayerStats } from './types/nfl';

// MLB components & data
import { MlbDesk } from './components/mlb/MlbDesk';
import { MlbParlayPicker } from './components/mlb/MlbParlayPicker';
import { MlbLedger } from './components/mlb/MlbLedger';
import { MlbSettings } from './components/mlb/MlbSettings';
import { fetchBoxResults, gradeLedger } from './lib/mlb_grade';
import { loadDated, saveDated } from './lib/dated_store';
import { fuzzyMatchName } from './lib/availability';
import { MLB_DEFAULT_TUNE, devigMlb } from './model/mlb_engine';
import { MlbLedgerRow, MlbBatterInput, MlbGateResult, MlbGameMatchup } from './types/mlb';

// NHL components & data
import { NhlDesk } from './components/nhl/NhlDesk';
import { NhlScoreboard } from './components/nhl/NhlScoreboard';
import { NhlSettingsModal } from './components/nhl/NhlSettingsModal';
// NBA components & data
import { NbaDesk } from './components/nba/NbaDesk';
import { NbaScoreboard } from './components/nba/NbaScoreboard';
import { NbaSettingsModal } from './components/nba/NbaSettingsModal';
import { NBA_CONFIG, applyNbaTuning, NbaTuning, NBA_TUNING_DEFAULTS } from './model/nba_engine';
import { NbaLedgerRow, NbaMarket, NbaSettings, nbaOddsKey, NbaPrediction, NBA_MARKETS, NBA_MARKET_UNIT } from './types/nba';
import { buildNbaSlate, collectNbaLedgerRows, mergeNbaLedger, inferNbaMarket, withOddsLines, NbaOddsMap } from './lib/nba_board';
import { fetchNbaState, fetchNbaSchedule, fetchNbaInjuries, fetchNbaActuals, gradeNbaLedger, NbaGame, NbaInjury, NbaState } from './lib/nba_data';
import { captureDailyCard, mergePredictions, gradePredictions, summarizePredictions } from './lib/nba_card';
import { buildEstimatedNhlSkater } from './data/nhl_seed';
import { projectNhlSkater, NHL_CONFIG, applyNhlTuning, NhlTuning, NHL_TUNING_DEFAULTS } from './model/nhl_engine';
import { NhlLedgerRow, NhlGameMatchup, NhlMarket, NhlOddsMap, NhlPlayerSnapshot, NhlSettings, NhlTeamFactors, nhlOddsKey } from './types/nhl';
import { collectLedgerRows, collectAllNhlPredictions, mergeLedger, inferNhlMarket, marketOf } from './lib/nhl_board';

// Live schedules & Screenshot Scanner
import { fetchLiveMlbGames } from './lib/live_schedule';
import { fetchNflSlate, gamesById, fetchNflGrades } from './lib/live_nfl';
import {
  fetchNhlSchedule, fetchNhlTeam, fetchNhlFactors, fetchNhlInjuries, fetchNhlBoxes,
  normalizeNhlTeam, applyInjuries, gradeNhlLedger, NhlInjury
} from './lib/nhl_data';
import { parseOdds as parseOddsShared } from './lib/odds';
import { ScreenshotUploadModal, ExtractedPropLine } from './components/common/ScreenshotUploadModal';
import { getTodayIsoDate } from './lib/dates';
import { CardBoard } from './components/common/CardBoard';
import { useDailyCard, useAutoGrade } from './lib/use_daily_card';
import { captureNhlCard, gradeNhlCard, nhlEdgeKeys, summarizeNhlCard, NhlPrediction, NHL_MARKET_LABEL } from './lib/nhl_card';
import { captureNflCard, gradeNflCard, nflEdgeKeys, nflPendingWeeks, summarizeNflCard, NflPrediction, NFL_MARKET_LABEL } from './lib/nfl_card';
import { captureMlbCard, gradeMlbCard, mlbEdgeKeys, mlbNotStarted, summarizeMlbCard, MlbPrediction, MLB_MARKET_LABEL } from './lib/mlb_card';
import { ParlayLab } from './components/common/ParlayLab';
import { recordOddsImport } from './lib/pick_of_the_day';
import { getStoredDates, getDailyPickerSnapshot, gradePickerWithCardRows, gradeNbaPickerWithBoxLines, sweepPendingPickerGrades, loadPickerSeedClient } from './lib/picker_grading';
import { BettableSettings } from './components/common/BettableSettings';
import { DisplaySettingsProvider } from './components/common/DisplaySettingsContext';
import { loadDisplayConfig } from './lib/display_settings';
import { OddsImportPanel } from './components/common/OddsImportPanel';
import { BettableConfig, DEFAULT_BETTABLE } from './lib/bettable';
import { planApply, mergeOddsMap, Plan, PostedLine } from './lib/odds_ingest';
import { parseOdds as parseOddsFn } from './lib/odds';
import { priceLine } from './model/nhl_engine';
import { BaselineStrip } from './components/common/BaselineStrip';
import { ParlayLeg, PaperTicket, PSport, legFromCard, legsFromPricedLedger, legsFromNflSnapshots, paperTicketsFor, gradePaperTickets, LegState, buildPool } from './lib/parlay_core';
import type { CardRow } from './lib/card_core';
import type { NflGradesPayload } from './lib/live_nfl';
import { installSessionDiagnostics, LoadDiagnosis, installScrollRestore } from './lib/session_diag';
import { PersonalBet, loadPersonalBets, savePersonalBets } from './lib/personal_bets';
import { MyBetsTab } from './components/common/MyBetsTab';
import { LogBetModal } from './components/common/LogBetModal';
import { persistWithAutoArchive, clearOldGradedHistory } from './lib/storage_archive';
import { loadPlayerPriorsClient } from './lib/player_priors';
import { loadNhlContextPriorsClient } from './lib/nhl_context_priors';
import { loadNhl2026PriorsClient, enrichNhlSkaterWith2026Priors } from './lib/nhl_2026_priors';

export default function App() {
  // The selected sport / tab survive reloads, hot reloads and remounts (they used to reset to NFL).
  const NAV_KEY = 'gatekeep_nav_v1';
  const VALID_TABS: Record<ActiveSport, string[]> = {
    nfl: ['desk', 'my-bets', 'scoreboard', 'parlays', 'settings'],
    mlb: ['desk', 'my-bets', 'ledger', 'parlays', 'settings'],
    nhl: ['desk', 'my-bets', 'scoreboard', 'parlays', 'settings'],
    nba: ['desk', 'my-bets', 'scoreboard', 'parlays', 'settings']
  };
  const readNav = (): { sport: ActiveSport; tab: string } => {
    try {
      const v = JSON.parse(localStorage.getItem(NAV_KEY) || 'null');
      if (v && (v.sport === 'nfl' || v.sport === 'mlb' || v.sport === 'nhl' || v.sport === 'nba')) {
        return { sport: v.sport, tab: VALID_TABS[v.sport as ActiveSport].includes(v.tab) ? v.tab : 'desk' };
      }
    } catch { /* ignore */ }
    return { sport: 'nfl', tab: 'desk' };
  };
  const [activeSport, setActiveSport] = useState<ActiveSport>(() => readNav().sport);
  const [activeSubTab, setActiveSubTab] = useState<string>(() => readNav().tab);
  useEffect(() => {
    try { localStorage.setItem(NAV_KEY, JSON.stringify({ sport: activeSport, tab: activeSubTab })); } catch { /* ignore */ }
  }, [activeSport, activeSubTab]);

  const [priorsVersion, setPriorsVersion] = useState(0);

  // Load external player rate priors (NFL, NBA, NHL 2026) and picker seed history on mount
  useEffect(() => {
    loadPlayerPriorsClient();
    Promise.all([loadNhlContextPriorsClient(), loadNhl2026PriorsClient()])
      .then(() => setPriorsVersion(v => v + 1))
      .catch(() => {});
    loadPickerSeedClient();
  }, []);

  // Personal Bet Log state (separate from automated daily cards)
  const [personalBets, setPersonalBets] = useState<PersonalBet[]>(() => loadPersonalBets());
  const [deskBetDraft, setDeskBetDraft] = useState<Partial<PersonalBet> | null>(null);
  const [isDeskBetModalOpen, setIsDeskBetModalOpen] = useState<boolean>(false);

  const handleSavePersonalBet = (bet: PersonalBet) => {
    setPersonalBets(prev => {
      const idx = prev.findIndex(b => b.id === bet.id);
      const next = idx >= 0 ? prev.map((b, i) => (i === idx ? bet : b)) : [bet, ...prev];
      savePersonalBets(next);
      return next;
    });
  };

  const handleDeletePersonalBet = (id: string) => {
    setPersonalBets(prev => {
      const next = prev.filter(b => b.id !== id);
      savePersonalBets(next);
      return next;
    });
  };

  const handleImportPersonalBets = (newBets: PersonalBet[]) => {
    setPersonalBets(prev => {
      const next = [...newBets, ...prev];
      savePersonalBets(next);
      return next;
    });
  };

  const handleBulkUpdatePersonalBets = (updatedList: PersonalBet[]) => {
    setPersonalBets(updatedList);
    savePersonalBets(updatedList);
  };

  const handleDeskLogBet = (draft: Partial<PersonalBet>) => {
    setDeskBetDraft(draft);
    setIsDeskBetModalOpen(true);
  };

  // Why did the page just (re)load? Only a full reload can reset the app; this records the cause (see lib/session_diag.ts).
  const [loadDiag, setLoadDiag] = useState<LoadDiagnosis | null>(null);
  const [loadDiagDismissed, setLoadDiagDismissed] = useState(false);
  useEffect(() => {
    // Visible remount trace: if the whole App component remounts without a page reload, this counter jumps.
    try {
      const n = Number(sessionStorage.getItem('gk_app_mounts') || '0') + 1;
      sessionStorage.setItem('gk_app_mounts', String(n));
      console.info(`[gatekeep] App mounted (#${n} in this tab session). Navigation restored from storage: ${activeSport}/${activeSubTab}`);
    } catch { /* ignore */ }
    installSessionDiagnostics().then(setLoadDiag).catch(() => { /* diagnostics must never affect the app */ });
  }, []);

  // scroll-position restore per sport/tab if the page reloads
  const activeSportRef = useRef(activeSport);
  const activeSubTabRef = useRef(activeSubTab);
  useEffect(() => { activeSportRef.current = activeSport; activeSubTabRef.current = activeSubTab; }, [activeSport, activeSubTab]);
  useEffect(() => installScrollRestore(() => `${activeSportRef.current}/${activeSubTabRef.current}`), []);

  // Universal Screenshot Modal state
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);

  /* =========================================================================
     LIVE AUTO-PULLED SCHEDULES STATE
     ========================================================================= */
  const [nflLiveGames, setNflLiveGames] = useState<Record<string, NflGameContext>>(NFL_GAMES);
  const [nflLiveRosters, setNflLiveRosters] = useState<Record<string, NflPlayerStats[]>>({});
  const [nflInjuries, setNflInjuries] = useState<NflImportContext['injuries']>({});
  const [nflInjuriesAvailable, setNflInjuriesAvailable] = useState(false);
  const [nflMeta, setNflMeta] = useState<{ season: number; week: number } | null>(null);
  const [nflRosterStatus, setNflRosterStatus] = useState('loading NFL slate from nflverse…');
  const [mlbSlateNote, setMlbSlateNote] = useState('');
  const [mlbLiveGames, setMlbLiveGames] = useState<MlbGameMatchup[]>([]); // only official schedule
  const [nhlLiveGames, setNhlLiveGames] = useState<NhlGameMatchup[]>([]); // official NHL schedule only
  const [nhlSkatersByTeam, setNhlSkatersByTeam] = useState<Record<string, NhlPlayerSnapshot[]>>({});
  const [nhlFactors, setNhlFactors] = useState<Record<string, NhlTeamFactors> | null>(null);
  const [nhlInjuries, setNhlInjuries] = useState<NhlInjury[] | null>(null);
  const [nhlStatusLines, setNhlStatusLines] = useState<string[]>(['loading NHL slate…']);

  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
  const [scheduleStatusText, setScheduleStatusText] = useState("Auto-synced today's games");

  /** nflverse slate: games + lines, receivers with walk-forward inputs, injury report. */
  const loadNflSlate = async (): Promise<number> => {
    setNflRosterStatus('loading NFL slate from nflverse…');
    const slate = await fetchNflSlate();
    if (!slate) {
      setNflRosterStatus('nflverse slate unavailable — nothing is priced from guesses; rows stay model-only/ESTIMATED');
      return 0;
    }
    const players = slate.receivers || {};
    setNflLiveGames(gamesById(slate.games));
    setNflLiveRosters(players);
    setNflInjuries(slate.injuries || {});
    setNflInjuriesAvailable(Boolean(slate.injuriesAvailable));
    setNflMeta({ season: slate.season, week: slate.week });
    const n = Object.values(players).reduce((a, b) => a + (b?.length || 0), 0);
    setNflRosterStatus(
      `week ${slate.week} · inputs through week ${slate.asOfWeek} · ${n} receivers · ratios WR ${slate.ratios.WR.ratio.toFixed(3)} / TE ${slate.ratios.TE.ratio.toFixed(3)}` +
      (slate.injuriesAvailable ? '' : ' · NO injury report (availability UNKNOWN)') +
      (slate.warnings?.length ? ` · ${slate.warnings.join(' ')}` : '')
    );
    return slate.games.length;
  };

  const refreshAllSchedules = async () => {
    setIsLoadingSchedule(true);
    setScheduleStatusText("Auto-pulling today's games from sports feeds...");
    try {
      const [nflN, mlb] = await Promise.all([
        loadNflSlate(),
        fetchLiveMlbGames()
      ]);
      setMlbLiveGames(mlb || []); // empty official day → empty board, not seed
      setMlbSlateNote((mlb || []).length === 0
        ? 'No MLB games on the official schedule for today (or the schedule feed is unreachable) — nothing is shown or priced.'
        : `MLB slate: ${mlb.length} game(s) · ${mlb.filter(g => g.confirmed).length} with posted lineups`);
      setScheduleStatusText(`Live games updated: ${nflN} NFL, ${mlb?.length || 0} MLB (NHL loads from its own tab date)`);
    } catch (e: any) {
      console.warn('Schedule sync warning:', e);
      setScheduleStatusText("Active game slate ready");
    } finally {
      setIsLoadingSchedule(false);
    }
  };

  // Auto-pull live games on load
  useEffect(() => {
    refreshAllSchedules();
  }, []);

  /* =========================================================================
     NFL STATE & HANDLERS
     ========================================================================= */
  const [nflSnapshots, setNflSnapshots] = useState<NflPropSnapshot[]>(() => {
    try {
      const saved = localStorage.getItem('gatekeep_nfl_snapshots_v15');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return generateInitialNflSnapshots();
  });

  const [nflBets, setNflBets] = useState<Record<string, NflBetRecord>>(() => {
    try {
      const saved = localStorage.getItem('gatekeep_nfl_bets_v15');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return {};
  });

  // keyed `${season}-${week}-${normalized name}`; starts empty (no demo grades)
  const [nflActuals, setNflActuals] = useState<Record<string, NflActualRecord>>(() => {
    try {
      const saved = localStorage.getItem('gatekeep_nfl_actuals_v15');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return {};
  });

  const [showNflImportModal, setShowNflImportModal] = useState(false);
  const [showNflGradeModal, setShowNflGradeModal] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('gatekeep_nfl_snapshots_v15', JSON.stringify(nflSnapshots));
      localStorage.setItem('gatekeep_nfl_bets_v15', JSON.stringify(nflBets));
      localStorage.setItem('gatekeep_nfl_actuals_v15', JSON.stringify(nflActuals));
    } catch (e) {
      console.error(e);
    }
  }, [nflSnapshots, nflBets, nflActuals]);

  const nflImportCtx = (): NflImportContext => ({
    games: nflLiveGames,
    players: [...Object.values(nflLiveRosters).flat(), ...Object.values(NFL_PLAYERS)],
    injuries: nflInjuries,
    injuriesAvailable: nflInjuriesAvailable
  });

  const handleNflImport = (season: number, week: number, book: string, kind: 'pre' | 'open' | 'close', text: string) => {
    const res = importNflLines(text, season, week, book, kind, nflImportCtx(), nflSnapshots);
    setNflSnapshots(res.snapshots);
    if (res.imported > 0) {
      recordOddsImport('nfl', getTodayIsoDate(), res.imported);
    }
    const skipNote = res.skipped.length
      ? `\n\nSkipped ${res.skipped.length}:\n` + res.skipped.slice(0, 8).map(x => `• ${x.text} — ${x.reason}`).join('\n')
      : '';
    alert(`Priced ${res.imported} NFL prop(s).${skipNote}`);
  };

  const handleNflUpsertSnapshot = (snap: NflPropSnapshot) => {
    setNflSnapshots(prev => {
      const next = [...prev];
      const idx = next.findIndex(s => s.id === snap.id);
      if (idx >= 0) next[idx] = snap; else next.push(snap);
      return importNflLinesCap(next);
    });
  };

  const importNflLinesCap = (snaps: NflPropSnapshot[]) => applyGameCap(snaps);

  const setActual = (acc: Record<string, NflActualRecord>, season: number, week: number, player: string, rec: NflActualRecord) => {
    acc[`${season}-${week}-${normalizePlayerName(player)}`] = rec;
  };

  const handleNflCommitGrades = (season: number, week: number, text: string) => {
    const updated = { ...nflActuals };
    let graded = 0;
    text.split('\n').forEach(l => {
      const parts = l.split(/[\t|,]/).map(x => x.trim());
      if (parts.length < 2 || !parts[0]) return;
      const valStr = parts[1].toUpperCase();
      if (valStr === 'DNP' || valStr === 'VOID') {
        setActual(updated, season, week, parts[0], { played: false, actual: 0 });
        graded++;
      } else {
        const valNum = parseFloat(valStr);
        if (Number.isFinite(valNum) && valNum >= 0) {
          setActual(updated, season, week, parts[0], { played: true, actual: valNum });
          graded++;
        }
      }
    });
    setNflActuals(updated);
    alert(`Committed realized receptions for ${graded} players.`);
  };

  /** Real grading from nflverse final box data (no simulation). */
  const handleNflAutoGrade = async () => {
    const weeks = Array.from(new Set(nflSnapshots.filter(s => s.hasMarket !== false).map(s => `${s.season}-${s.week}`)));
    if (!weeks.length) { alert('No priced NFL lines to grade yet.'); return; }
    const updated = { ...nflActuals };
    let graded = 0, pending = 0, unavailable = 0;
    for (const sw of weeks) {
      const [season, week] = sw.split('-').map(Number);
      const g = await fetchNflGrades(season, week);
      if (!g) { unavailable++; continue; }
      const finals = new Set(g.finalTeams);
      nflSnapshots.filter(s => s.season === season && s.week === week && s.hasMarket !== false).forEach(s => {
        if (!finals.has(s.team)) { pending++; return; }
        const hit = g.actuals[normalizePlayerName(s.player)];
        setActual(updated, season, week, s.player, hit ? { played: true, actual: hit.actual } : { played: false, actual: 0 });
        graded++;
      });
    }
    setNflActuals(updated);
    alert(`Auto-graded ${graded} line(s) from nflverse; ${pending} still pending (game not final)` + (unavailable ? `; ${unavailable} week(s) could not be fetched.` : '.'));
  };

  const handleNflRecordBet = (snap: NflPropSnapshot) => {
    if (snap.hasMarket === false) { alert('Enter the book line and odds first.'); return; }
    const disp = loadDisplayConfig();
    const defaultVal = disp.mode === 'currency' ? String(disp.unitValue) : "1.0";
    const label = disp.mode === 'currency' ? `$${disp.unitValue}` : "1.0u";
    const stakeStr = prompt(`Confirm ${label} stake for ${snap.player} ${snap.lean} ${snap.line} (${snap.oddsOffered > 0 ? '+' : ''}${snap.oddsOffered}):`, defaultVal);
    if (stakeStr === null) return;
    const stakeNum = parseFloat(stakeStr);
    if (isNaN(stakeNum) || stakeNum <= 0) return;
    const units = disp.mode === 'currency' ? stakeNum / (disp.unitValue || 1) : stakeNum;

    setNflBets(prev => ({
      ...prev,
      [snap.id]: {
        snapshot_id: snap.id,
        side: snap.lean.toLowerCase() as 'over' | 'under',
        stake: units,
        odds_taken: snap.oddsOffered,
        placed_at: new Date().toISOString()
      }
    }));
  };

  const handleNflExportJson = () => {
    const blob = new Blob([JSON.stringify({ snapshots: nflSnapshots, bets: nflBets, actuals: nflActuals }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nfl_receptions_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleNflImportJson = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.snapshots) setNflSnapshots(data.snapshots);
      if (data.bets) setNflBets(data.bets);
      if (data.actuals) setNflActuals(data.actuals);
      alert("NFL database synchronized successfully.");
    } catch (e: any) {
      alert("Invalid JSON format: " + e.message);
    }
  };

  const handleNflReset = () => {
    if (confirm("Clear the NFL desk (lines, bets and grades)?")) {
      setNflSnapshots([]);
      setNflBets({});
      setNflActuals({});
    }
  };

  /* =========================================================================
     MLB STATE & HANDLERS
     ========================================================================= */
  // Odds are per-day: yesterday's prices are never applied to today's board.
  const mlbToday = getTodayIsoDate();
  const [mlbOddsMap, setMlbOddsMap] = useState<Record<number, { over: string; under: string; line?: number }>>(
    () => loadDated('gatekeep_mlb_odds_v59', mlbToday, {})
  );

  const [mlbParlayLegs, setMlbParlayLegs] = useState<{
    id: number;
    name: string;
    team: string;
    calP: number;
    overPrice: string;
    gamePk: number;
    line: number;
    call: 'PLAY' | 'PASS';
    quality: string;
  }[]>([]);

  // Starts empty. (The old build shipped two hand-typed "graded" rows that flattered every metric.)
  const [mlbLedger, setMlbLedger] = useState<MlbLedgerRow[]>(() => {
    try {
      const saved = localStorage.getItem('gatekeep_mlb_ledger_v59');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [mlbTune, setMlbTune] = useState(MLB_DEFAULT_TUNE);

  useEffect(() => {
    saveDated('gatekeep_mlb_odds_v59', mlbToday, mlbOddsMap);
    try {
      localStorage.setItem('gatekeep_mlb_ledger_v59', JSON.stringify(mlbLedger));
    } catch (e) {
      console.error(e);
    }
  }, [mlbOddsMap, mlbLedger]);

  const handleMlbOddsChange = (id: number, side: 'over' | 'under', val: string) => {
    setMlbOddsMap(prev => ({
      ...prev,
      [id]: {
        over: side === 'over' ? val : prev[id]?.over || '',
        under: side === 'under' ? val : prev[id]?.under || '',
        line: prev[id]?.line !== undefined ? prev[id].line : 0.5
      }
    }));
  };

  const handleMlbUpdateLine = (id: number, line: number) => {
    setMlbOddsMap(prev => ({
      ...prev,
      [id]: {
        over: prev[id]?.over || '',
        under: prev[id]?.under || '',
        line
      }
    }));
  };

  const handleMlbToggleParlay = (batter: MlbBatterInput, gate: MlbGateResult, price: { over: string; under: string; line?: number }) => {
    setMlbParlayLegs(prev => {
      const exists = prev.some(l => l.id === batter.id);
      if (exists) return prev.filter(l => l.id !== batter.id);
      if (prev.length >= 4) {
        alert("Maximum 4 legs on a custom parlay ticket.");
        return prev;
      }
      return [
        ...prev,
        {
          id: batter.id,
          name: batter.name,
          team: batter.team,
          calP: gate.calP,
          overPrice: price.over,
          gamePk: batter.gamePk,
          line: price.line ?? 0.5,
          call: gate.call,
          quality: gate.quality
        }
      ];
    });
  };

  const handleMlbLogAllPriced = (pricedRows: any[], quiet = false) => {
    const today = getTodayIsoDate();
    const newRows: MlbLedgerRow[] = [...mlbLedger];
    let added = 0;
    let skipped = 0;

    pricedRows.forEach(r => {
      const line = r.price.line ?? 0.5;
      const exists = newRows.some(x => x.id === r.batter.id && x.date === today && (x.line ?? 0.5) === line);
      const devig = devigMlb(r.price.over, r.price.under);
      if (exists || !devig) { if (!exists) skipped++; return; }
      newRows.unshift({
        date: today,
        gamePk: r.game.gamePk,
        id: r.batter.id,
        name: r.batter.name,
        team: r.batter.team,
        slot: r.batter.slot,
        call: r.gate.call,
        over: r.price.over,
        under: r.price.under || '',
        hold: 1.07,
        dec: devig.dec,
        modelP: r.gate.modelP,          // P(over THIS line), pre-market-blend
        fairP: r.gate.fair,
        blendedP: r.gate.calP,
        edge: r.gate.edge,
        quality: r.gate.quality,
        hit: null,
        result: '',
        void: false,
        line,
        ev: r.gate.ev ?? null
      });
      added++;
    });

    if (quiet && !added) return;
    setMlbLedger(newRows);
    if (!quiet) alert(`Logged ${added} priced hitter row(s).` + (skipped ? ` ${skipped} skipped (unreadable odds).` : ''));
  };

  /** Real grading from official box scores. A row is graded only when its game is Final. */
  const handleMlbGradeOpenPlays = async () => {
    const open = mlbLedger.filter(r => r.hit === null && !r.void && !r.demo);
    if (!open.length) { alert('Nothing open to grade.'); return; }
    const results = await fetchBoxResults(Array.from(new Set(open.map(r => r.gamePk))));
    if (!results) { alert('Could not reach the MLB box-score feed — nothing was graded.'); return; }
    const g = gradeLedger(mlbLedger, results);
    setMlbLedger(g.rows);
    alert(`Graded ${g.graded} from final box scores; ${g.pending} still pending (game not final); ${g.voided} void (DNP/postponed).`);
  };

  const handleMlbExportCsv = () => {
    const header = "date,game_pk,id,name,team,slot,call,line,over,under,hold,dec,model_p,fair_p,blended_p,edge,ev,quality,hit,result,void,demo";
    const csvRows = mlbLedger.map(r => [
      r.date, r.gamePk, r.id, `"${r.name}"`, r.team, r.slot, r.call, r.line ?? 0.5, r.over, r.under, r.hold, r.dec,
      r.modelP, r.fairP, r.blendedP, r.edge, r.ev ?? '', r.quality, r.hit ?? '', r.result, r.void ? 1 : 0, r.demo ? 1 : 0
    ].join(','));
    const blob = new Blob([[header, ...csvRows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mlb_hits_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  /* =========================================================================
     NHL STATE & HANDLERS (sog_v2: shots + points)
     ========================================================================= */
  const NHL_ODDS_KEY = 'gatekeep_nhl_odds_v2';
  const NHL_LEDGER_KEY = 'gatekeep_nhl_ledger_v2';
  // The date you were looking at and the SOG/PTS toggle survive a page reload (per tab, so a new day still opens on today).
  const [nhlDate, setNhlDate] = useState<string>(() => {
    try { const v = sessionStorage.getItem('gk_nhl_date'); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v; } catch { /* ignore */ }
    return getTodayIsoDate();
  });
  const [nhlMarket, setNhlMarket] = useState<NhlMarket>(() => {
    try { const v = sessionStorage.getItem('gk_nhl_market'); if (v === 'sog' || v === 'pts') return v; } catch { /* ignore */ }
    return 'sog';
  });
  useEffect(() => {
    try { sessionStorage.setItem('gk_nhl_date', nhlDate); sessionStorage.setItem('gk_nhl_market', nhlMarket); } catch { /* ignore */ }
  }, [nhlDate, nhlMarket]);
  // odds are stamped with the date they were entered for; another day's prices are discarded
  const [nhlOdds, setNhlOdds] = useState<{ date: string; map: NhlOddsMap }>(() => {
    const d = getTodayIsoDate();
    try { localStorage.removeItem('gatekeep_nhl_odds_map'); localStorage.removeItem('gatekeep_nhl_results'); } catch { /* ignore */ }
    return { date: d, map: loadDated<NhlOddsMap>(`${NHL_ODDS_KEY}_${d}`, d, {}) };
  });
  const [nhlLedger, setNhlLedger] = useState<NhlLedgerRow[]>(() => {
    try {
      const saved = localStorage.getItem(NHL_LEDGER_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) { console.error(e); }
    return [];
  });
  const [nhlGradeStatus, setNhlGradeStatus] = useState('');
  const [nhlExtraSkaters, setNhlExtraSkaters] = useState<NhlPlayerSnapshot[]>([]);
  // v2 stores ONLY the values you changed. v1 stored every default, which would pin old priors over newly fitted ones.
  const NHL_TUNING_KEY = 'gatekeep_nhl_tuning_v2';
  const [nhlTuning, setNhlTuning] = useState<NhlTuning>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(NHL_TUNING_KEY) || 'null');
      if (saved && typeof saved === 'object') return { ...NHL_TUNING_DEFAULTS, ...saved };
    } catch { /* ignore */ }
    return { ...NHL_TUNING_DEFAULTS };
  });
  useEffect(() => {
    try {
      const overrides: Partial<NhlTuning> = {};
      (Object.keys(nhlTuning) as (keyof NhlTuning)[]).forEach(k => { if (nhlTuning[k] !== NHL_TUNING_DEFAULTS[k]) overrides[k] = nhlTuning[k]; });
      localStorage.setItem(NHL_TUNING_KEY, JSON.stringify(overrides));
    } catch { /* ignore */ }
  }, [nhlTuning]);
  const [nhlSettings, setNhlSettings] = useState<NhlSettings>({
    edgeThreshold: NHL_CONFIG.edgeMinPts,
    maxJuice: NHL_CONFIG.maxChalk,
    showStabsOnly: false
  });

  useEffect(() => {
    setNhlOdds({ date: nhlDate, map: loadDated<NhlOddsMap>(`${NHL_ODDS_KEY}_${nhlDate}`, nhlDate, {}) });
  }, [nhlDate]);

  useEffect(() => {
    saveDated(`${NHL_ODDS_KEY}_${nhlOdds.date}`, nhlOdds.date, nhlOdds.map);
  }, [nhlOdds]);

  useEffect(() => {
    try { localStorage.setItem(NHL_LEDGER_KEY, JSON.stringify(nhlLedger)); } catch (e) { console.error(e); }
  }, [nhlLedger]);

  // Official schedule + live rosters/game logs + team table + injury report for the selected date.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNhlStatusLines(['loading NHL slate…']);
      const games = await fetchNhlSchedule(nhlDate);
      if (cancelled) return;
      setNhlLiveGames(games);
      if (!games.length) {
        setNhlSkatersByTeam({});
        setNhlStatusLines(['no NHL games from the official schedule for this date (or the feed is unreachable)']);
        return;
      }
      const teams = Array.from(new Set(games.flatMap(g => [g.awayTeam, g.homeTeam])));
      const [factors, injuries, rosters] = await Promise.all([
        fetchNhlFactors(),
        fetchNhlInjuries(),
        Promise.all(teams.map(async t => [t, await fetchNhlTeam(t, nhlDate)] as const))
      ]);
      if (cancelled) return;
      const map = Object.fromEntries(rosters) as Record<string, NhlPlayerSnapshot[]>;
      setNhlSkatersByTeam(map);
      setNhlFactors(factors);
      setNhlInjuries(injuries);
      const n = Object.values(map).reduce((a, b) => a + b.length, 0);
      const missing = Object.entries(map).filter(([, v]) => !v.length).map(([k]) => k);
      setNhlStatusLines([
        n ? `${n} skaters from the NHL API${missing.length ? ` · missing ${missing.join(',')}` : ''}` : 'roster fetch failed — board is empty (no offline roster is invented)',
        factors ? 'opponent factors: live shots/goals-against' : 'opponent factors: stale static table at half weight (live team table not loaded)',
        injuries ? `ESPN injury report loaded (${injuries.length} listed)` : 'NO injury report — availability UNKNOWN, rows cannot qualify'
      ]);
    })().catch(err => {
      console.error(err);
      if (!cancelled) setNhlStatusLines(['NHL load failed']);
    });
    return () => { cancelled = true; };
  }, [nhlDate]);

  const nhlProjections = React.useMemo(() => {
    applyNhlTuning(nhlTuning); // the engine reads the live config; priors are user-overridable
    const list: ReturnType<typeof projectNhlSkater>[] = [];
    nhlLiveGames.forEach(g => {
      const away = normalizeNhlTeam(g.awayTeam);
      const home = normalizeNhlTeam(g.homeTeam);
      const withExtras = (team: string) => {
        const base = nhlSkatersByTeam[team] || [];
        const extras = nhlExtraSkaters.filter(x => x.team === team && !base.some(b => fuzzyMatchName(b.name, x.name)));
        return applyInjuries([...base, ...extras], nhlInjuries).map(enrichNhlSkaterWith2026Priors);
      };
      withExtras(away).forEach(p => list.push({ ...projectNhlSkater(p, home, nhlFactors ?? undefined), gameId: g.gameId }));
      withExtras(home).forEach(p => list.push({ ...projectNhlSkater(p, away, nhlFactors ?? undefined), gameId: g.gameId }));
    });
    return list;
  }, [nhlLiveGames, nhlSkatersByTeam, nhlExtraSkaters, nhlInjuries, nhlFactors, nhlTuning, priorsVersion]);

  const handleNhlOddsChange = (market: NhlMarket, playerId: number, line: number, side: 'over' | 'under', val: number | null) => {
    setNhlOdds(prev => {
      const key = nhlOddsKey(market, playerId, line);
      const entry = { ...(prev.map[key] || {}), [side]: val };
      const next = { ...prev.map };
      if (entry.over == null && entry.under == null) delete next[key];
      else next[key] = entry;
      return { ...prev, map: next };
    });
  };

  const handleNhlLogRows = () => {
    const rows = collectLedgerRows(nhlProjections, nhlOdds.map, nhlSettings, nhlDate);
    if (!rows.length) { alert('No priced rows to log.'); return; }
    setNhlLedger(prev => mergeLedger(prev, rows));
    alert(`Logged ${rows.length} priced row(s) (${rows.filter(r => r.tag !== 'PASS').length} qualifying). Grade them from the Scoreboard after the games are final.`);
  };

  const handleNhlSnapshotAllPredictions = () => {
    const rows = collectAllNhlPredictions(nhlProjections, nhlOdds.map, nhlSettings, nhlDate);
    if (!rows.length) { alert('No predictions on the board to snapshot.'); return; }
    setNhlLedger(prev => mergeLedger(prev, rows));
    alert(`Snapshotted ${rows.length} NHL predictions across all skaters for self-grading analysis.`);
  };

  const handleNhlGrade = async () => {
    const pendingIds = Array.from(new Set(nhlLedger.filter(r => r.result === null && !r.demo).map(r => r.gameId)));
    if (!pendingIds.length) { setNhlGradeStatus('Nothing pending.'); return; }
    setNhlGradeStatus('Fetching official box scores…');
    const boxes = await fetchNhlBoxes(pendingIds);
    if (!boxes) { setNhlGradeStatus('Box score feed unreachable — nothing graded, nothing simulated.'); return; }
    const out = gradeNhlLedger(nhlLedger, boxes);
    setNhlLedger(out.rows);
    setNhlGradeStatus(`Graded ${out.graded} · void ${out.voided} · still pending ${out.pending} (games not final yet).`);
  };

  const handleNhlImportLedger = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      const arr: any[] = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : Array.isArray(data.rows) ? data.rows : [];
      const rows: NhlLedgerRow[] = arr.map((r, i) =>
        r && r.id && r.market
          ? (r as NhlLedgerRow)
          : ({
              id: `legacy:${i}:${r?.date ?? ''}:${r?.playerId ?? ''}`,
              date: r?.date ?? '', gameId: 0, market: 'sog' as const, playerId: r?.playerId ?? 0,
              playerName: r?.playerName ?? '?', team: r?.team ?? '', opp: r?.opp ?? '', line: r?.line ?? 0,
              modelMu: r?.modelMu ?? 0, r: NHL_CONFIG.sog.r, probOver: r?.probOver ?? 0.5,
              overOdds: r?.oddsTaken ?? null, underOdds: null, pMarketOver: null, tag: 'PASS' as const, side: null,
              edge: 0, ev: null, inputsSource: 'ESTIMATED' as const, availability: 'UNKNOWN' as const,
              actual: r?.actualSog ?? null, result: null, demo: true
            })
      );
      setNhlLedger(prev => mergeLedger(prev, rows));
      alert(`Imported ${rows.length} row(s). Rows from older versions (no ids) are kept but marked DEMO and excluded from all metrics.`);
    } catch (e: any) {
      alert('Invalid JSON: ' + e.message);
    }
  };

  /* =========================================================================
     AUTOMATIC DAILY CARD + SELF-GRADING: NHL / NFL / MLB (same pattern as NBA)
     Capture every priced player-market before the game starts, grade from the official result afterwards. No clicking.
     ========================================================================= */
  const downloadJson = (name: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const stamp = () => new Date().toLocaleTimeString();

  // ---- NHL ----
  const nhlCard = useDailyCard<NhlPrediction>('gatekeep_nhl_card_v1', getTodayIsoDate);
  const [nhlAutoStatus, setNhlAutoStatus] = useState('');
  const [nhlCardGrade, setNhlCardGrade] = useState('');
  const nhlLedgerRef = useRef<NhlLedgerRow[]>(nhlLedger);
  nhlLedgerRef.current = nhlLedger;
  useEffect(() => {
    if (!nhlProjections.length || nhlDate < getTodayIsoDate()) return; // a past slate would be captured with hindsight
    const rows = captureNhlCard(nhlProjections, nhlLiveGames, new Set(nhlCard.ref.current.map(r => r.id)), nhlDate);
    if (!rows.length) return;
    nhlCard.add(rows);
    setNhlAutoStatus(`Auto-logged ${rows.length} skater-market projection(s) for ${nhlDate} at ${stamp()} (pre-game only; nothing to click).`);
  }, [nhlProjections, nhlLiveGames, nhlDate]);
  const nhlGo = useAutoGrade(async () => {
    const today = getTodayIsoDate();
    const pendC = nhlCard.ref.current.filter(r => r.result === null && r.date <= today);
    const pendL = nhlLedgerRef.current.filter(r => r.result === null && !r.demo);
    if (!pendC.length && !pendL.length) return;
    const ids = Array.from(new Set([...pendC.map(r => Number(r.gameId)), ...pendL.map(r => r.gameId)])).filter(n => n > 0);
    const boxes = await fetchNhlBoxes(ids);
    if (!boxes) { setNhlCardGrade('NHL box-score feed unreachable — nothing graded, nothing simulated.'); return; }
    const gc = gradeNhlCard(nhlCard.ref.current, boxes, today);
    const gl = gradeNhlLedger(nhlLedgerRef.current, boxes);
    if (gc.graded + gc.voided) nhlCard.setRows(gc.rows);
    if (gl.graded + gl.voided) setNhlLedger(gl.rows);
    gradePickerWithCardRows('nhl', gc.rows);
    setNhlCardGrade(`Daily card: graded ${gc.graded} · void ${gc.voided} · pending ${gc.pending}. Priced plays: graded ${gl.graded} · void ${gl.voided} · pending ${gl.pending}. Checked ${stamp()}.`);
  }, nhlLiveGames.length, activeSport === 'nhl' && activeSubTab === 'scoreboard');
  // priced rows are logged automatically too (debounced while you type), only for games that have not started
  useEffect(() => {
    if (!Object.keys(nhlOdds.map).length || nhlOdds.date < getTodayIsoDate()) return;
    const t = setTimeout(() => {
      const open = new Set(nhlLiveGames.filter(g => Date.now() < Date.parse(g.startTimeUtc)).map(g => g.gameId));
      const rows = collectLedgerRows(nhlProjections.filter(p => p.gameId !== undefined && open.has(p.gameId)), nhlOdds.map, nhlSettings, nhlOdds.date);
      if (!rows.length) return;
      setNhlLedger(prev => {
        const byId = new Map(prev.map(r => [r.id, r]));
        const changed = rows.some(r => { const o = byId.get(r.id); return !o || (o.result === null && (o.overOdds !== r.overOdds || o.underOdds !== r.underOdds || o.tag !== r.tag || o.modelMu !== r.modelMu)); });
        return changed ? mergeLedger(prev, rows) : prev;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [nhlOdds, nhlProjections, nhlLiveGames, nhlSettings]);
  const nhlEdge = React.useMemo(() => nhlEdgeKeys(nhlLedger), [nhlLedger]);

  // ---- NFL ----
  const nflCard = useDailyCard<NflPrediction>('gatekeep_nfl_card_v1', getTodayIsoDate);
  const [nflAutoStatus, setNflAutoStatus] = useState('');
  const [nflCardGrade, setNflCardGrade] = useState('');
  const nflSnapsRef = useRef(nflSnapshots); nflSnapsRef.current = nflSnapshots;
  const nflActualsRef = useRef(nflActuals); nflActualsRef.current = nflActuals;
  useEffect(() => {
    if (!nflMeta) return;
    const rows = captureNflCard(nflLiveGames, nflLiveRosters, { injuries: nflInjuries, injuriesAvailable: nflInjuriesAvailable }, new Set(nflCard.ref.current.map(r => r.id)), getTodayIsoDate());
    if (!rows.length) return;
    nflCard.add(rows);
    setNflAutoStatus(`Auto-logged ${rows.length} receiver reception projection(s) for week ${nflMeta.week} at ${stamp()} (games not yet kicked off; nflverse inputs only).`);
  }, [nflLiveGames, nflLiveRosters, nflInjuries, nflInjuriesAvailable, nflMeta]);
  const nflGo = useAutoGrade(async () => {
    const today = getTodayIsoDate();
    const pricedWeeks = nflSnapsRef.current.filter(s => s.hasMarket !== false && !nflActualsRef.current[`${s.season}-${s.week}-${normalizePlayerName(s.player)}`]).map(s => `${s.season}-${s.week}`);
    const weeks = Array.from(new Set([...nflPendingWeeks(nflCard.ref.current), ...pricedWeeks]));
    if (!weeks.length) return;
    const payloads: Record<string, NflGradesPayload | null> = {};
    for (const w of weeks) { const [se, wk] = w.split('-').map(Number); payloads[w] = await fetchNflGrades(se, wk); }
    if (Object.values(payloads).every(v => v === null)) { setNflCardGrade('nflverse results unreachable — nothing graded, nothing simulated.'); return; }
    const gc = gradeNflCard(nflCard.ref.current, payloads, today);
    if (gc.graded + gc.voided) nflCard.setRows(gc.rows);
    gradePickerWithCardRows('nfl', gc.rows);
    // priced lines: record the real final in the same actuals store the manual grader uses
    const updated = { ...nflActualsRef.current };
    let gl = 0;
    for (const s of nflSnapsRef.current) {
      if (s.hasMarket === false) continue;
      const g = payloads[`${s.season}-${s.week}`];
      if (!g || !g.finalTeams.includes(s.team)) continue;
      const k = `${s.season}-${s.week}-${normalizePlayerName(s.player)}`;
      if (updated[k]) continue;
      const hit = g.actuals[normalizePlayerName(s.player)];
      updated[k] = hit ? { played: true, actual: hit.actual } : { played: false, actual: 0 };
      gl++;
    }
    if (gl) setNflActuals(updated);
    setNflCardGrade(`Daily card: graded ${gc.graded} · void ${gc.voided} · pending ${gc.pending}. Priced lines newly graded: ${gl}. Checked ${stamp()}.`);
  }, nflMeta ? `${nflMeta.season}-${nflMeta.week}` : 'none', activeSport === 'nfl' && activeSubTab === 'scoreboard');
  const nflEdge = React.useMemo(() => nflEdgeKeys(nflSnapshots), [nflSnapshots]);

  // ---- MLB ----
  const mlbCard = useDailyCard<MlbPrediction>('gatekeep_mlb_card_v1', getTodayIsoDate);
  const [mlbAutoStatus, setMlbAutoStatus] = useState('');
  const [mlbCardGrade, setMlbCardGrade] = useState('');
  const mlbLedgerRef = useRef<MlbLedgerRow[]>(mlbLedger); mlbLedgerRef.current = mlbLedger;
  useEffect(() => {
    const today = getTodayIsoDate();
    const todays = mlbLiveGames.filter(g => !g.date || g.date === today);
    if (!todays.length) return;
    const rows = captureMlbCard(todays, new Set(mlbCard.ref.current.map(r => r.id)), today, mlbTune);
    if (!rows.length) return;
    mlbCard.add(rows);
    setMlbAutoStatus(`Auto-logged ${rows.length} confirmed-lineup batter projection(s) at ${stamp()} (games not yet started; nothing to click).`);
  }, [mlbLiveGames, mlbTune]);
  const mlbGo = useAutoGrade(async () => {
    const today = getTodayIsoDate();
    const pendC = mlbCard.ref.current.filter(r => r.result === null && r.date <= today);
    const pendL = mlbLedgerRef.current.filter(r => r.hit === null && !r.void && !r.demo);
    if (!pendC.length && !pendL.length) return;
    const results = await fetchBoxResults(Array.from(new Set([...pendC.map(r => Number(r.gameId)), ...pendL.map(r => r.gamePk)])));
    if (!results) { setMlbCardGrade('MLB box-score feed unreachable — nothing graded, nothing simulated.'); return; }
    const gc = gradeMlbCard(mlbCard.ref.current, results, today);
    const gl = gradeLedger(mlbLedgerRef.current, results);
    if (gc.graded + gc.voided) mlbCard.setRows(gc.rows);
    if (gl.graded + gl.voided) setMlbLedger(gl.rows);
    gradePickerWithCardRows('mlb', gc.rows);
    setMlbCardGrade(`Daily card: graded ${gc.graded} · void ${gc.voided} · pending ${gc.pending}. Priced plays: graded ${gl.graded} · void ${gl.voided} · pending ${gl.pending}. Checked ${stamp()}.`);
  }, mlbLiveGames.length, activeSport === 'mlb' && activeSubTab === 'ledger');
  const mlbEdge = React.useMemo(() => mlbEdgeKeys(mlbLedger), [mlbLedger]);

  const NHL_CARD_MARKETS = [{ id: 'sog', label: NHL_MARKET_LABEL.sog }, { id: 'pts', label: NHL_MARKET_LABEL.pts }];
  const NFL_CARD_MARKETS = [{ id: 'rec', label: NFL_MARKET_LABEL.rec }];
  const MLB_CARD_MARKETS = [{ id: 'hit', label: MLB_MARKET_LABEL.hit }];

  const handleClearNhlHistory = () => {
    const res = clearOldGradedHistory('NHL', nhlCard.rows, getTodayIsoDate(), 'gatekeep_nhl_card_v1');
    if (res.archivedCount > 0) {
      nhlCard.setRows(res.remainingRows);
    }
    setNhlAutoStatus(res.message);
  };

  const handleClearNflHistory = () => {
    const res = clearOldGradedHistory('NFL', nflCard.rows, getTodayIsoDate(), 'gatekeep_nfl_card_v1');
    if (res.archivedCount > 0) {
      nflCard.setRows(res.remainingRows);
    }
    setNflAutoStatus(res.message);
  };

  const handleClearMlbHistory = () => {
    const res = clearOldGradedHistory('MLB', mlbCard.rows, getTodayIsoDate(), 'gatekeep_mlb_card_v1');
    if (res.archivedCount > 0) {
      mlbCard.setRows(res.remainingRows);
    }
    setMlbAutoStatus(res.message);
  };

  /* =========================================================================
     NBA STATE & HANDLERS (nba_v2: seven markets)
     ========================================================================= */
  const NBA_ODDS_KEY = 'gatekeep_nba_odds_v1';
  const NBA_LEDGER_KEY = 'gatekeep_nba_ledger_v1';
  const NBA_TUNING_KEY = 'gatekeep_nba_tuning_v1';
  const [nbaDate, setNbaDate] = useState<string>(() => {
    try { const v = sessionStorage.getItem('gk_nba_date'); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v; } catch { /* ignore */ }
    return getTodayIsoDate();
  });
  const [nbaMarket, setNbaMarket] = useState<NbaMarket>(() => {
    try { const v = sessionStorage.getItem('gk_nba_market'); if (v === 'pts' || v === 'reb' || v === 'ast' || v === 'tpm') return v; } catch { /* ignore */ }
    return 'pts';
  });
  useEffect(() => {
    try { sessionStorage.setItem('gk_nba_date', nbaDate); sessionStorage.setItem('gk_nba_market', nbaMarket); } catch { /* ignore */ }
  }, [nbaDate, nbaMarket]);
  const [nbaOdds, setNbaOdds] = useState<{ date: string; map: NbaOddsMap }>(() => {
    const d = nbaDate;
    return { date: d, map: loadDated<NbaOddsMap>(`${NBA_ODDS_KEY}_${d}`, d, {}) };
  });
  const [nbaLedger, setNbaLedger] = useState<NbaLedgerRow[]>(() => {
    try { const saved = localStorage.getItem(NBA_LEDGER_KEY); if (saved) return JSON.parse(saved); } catch { /* ignore */ }
    return [];
  });
  const [nbaGradeStatus, setNbaGradeStatus] = useState('');
  const [nbaGames, setNbaGames] = useState<NbaGame[]>([]);
  const [nbaState, setNbaState] = useState<NbaState | null>(null);
  const [nbaInjuries, setNbaInjuries] = useState<NbaInjury[] | null>(null);
  const [nbaStatusLines, setNbaStatusLines] = useState<string[]>(['loading NBA slate…']);
  const [nbaTuning, setNbaTuning] = useState<NbaTuning>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(NBA_TUNING_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        const known = Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in NBA_TUNING_DEFAULTS && typeof v === 'number')); // drops retired keys (minGamesReal)
        return { ...NBA_TUNING_DEFAULTS, ...known };
      }
    } catch { /* ignore */ }
    return { ...NBA_TUNING_DEFAULTS };
  });
  useEffect(() => {
    try {
      const overrides: Partial<NbaTuning> = {};
      (Object.keys(nbaTuning) as (keyof NbaTuning)[]).forEach(k => { if (nbaTuning[k] !== NBA_TUNING_DEFAULTS[k]) overrides[k] = nbaTuning[k]; });
      localStorage.setItem(NBA_TUNING_KEY, JSON.stringify(overrides));
    } catch { /* ignore */ }
  }, [nbaTuning]);
  const [nbaSettings, setNbaSettings] = useState<NbaSettings>({ edgeThreshold: NBA_CONFIG.edgeMinPts, maxJuice: NBA_CONFIG.maxChalk, showStabsOnly: false });

  useEffect(() => {
    setNbaOdds({ date: nbaDate, map: loadDated<NbaOddsMap>(`${NBA_ODDS_KEY}_${nbaDate}`, nbaDate, {}) });
  }, [nbaDate]);
  useEffect(() => { saveDated(`${NBA_ODDS_KEY}_${nbaOdds.date}`, nbaOdds.date, nbaOdds.map); }, [nbaOdds]);
  useEffect(() => {
    try { localStorage.setItem(NBA_LEDGER_KEY, JSON.stringify(nbaLedger)); } catch (e) { console.error(e); }
  }, [nbaLedger]);

  // Schedule + game logs (server-side aggregated) + injury report for the selected date. Only loads while the NBA tab is open.
  const nbaLoadedRef = useRef<{ date: string; at: number } | null>(null);
  useEffect(() => {
    // loads once per date (and again only after 10 minutes), whichever tab you are on, so the daily card is captured
    // even if you only open the NBA tab later; switching tabs never refetches or wipes the board
    const seen = nbaLoadedRef.current;
    if (seen && seen.date === nbaDate && Date.now() - seen.at < 10 * 60 * 1000) return;
    let cancelled = false;
    (async () => {
      setNbaStatusLines(prev => (prev.length > 1 ? prev : ['loading NBA slate…']));
      const [games, state, injuries] = await Promise.all([fetchNbaSchedule(nbaDate), fetchNbaState(nbaDate), fetchNbaInjuries()]);
      if (cancelled) return;
      setNbaGames(games ?? []);
      setNbaState(state);
      setNbaInjuries(injuries);
      const lines: string[] = [];
      lines.push(games === null ? 'schedule feed unreachable' : `${games.length} game(s) on the schedule`);
      lines.push(state ? `${state.players.length} players from ${state.gamesPlayed} played games${state.priorLoaded ? ' + last season' : ' (last season NOT loaded: priors are thin)'}` : 'game logs unreachable — board is empty (nothing is invented)');
      lines.push(injuries === null ? 'injury feed unreachable: every player is AVAILABILITY UNKNOWN and cannot qualify' : `${injuries.length} injury report entries`);
      setNbaStatusLines(lines);
      if (games !== null && state) nbaLoadedRef.current = { date: nbaDate, at: Date.now() };
    })().catch(() => { if (!cancelled) setNbaStatusLines(['NBA load failed']); });
    return () => { cancelled = true; };
  }, [nbaDate, activeSport]);

  // the board without any typed prices: this is what the automatic daily card captures
  const nbaBase = React.useMemo(() => {
    applyNbaTuning(nbaTuning);
    if (!nbaState) return [];
    return buildNbaSlate(nbaState, nbaGames, nbaInjuries);
  }, [nbaState, nbaGames, nbaInjuries, nbaTuning]);
  const nbaProjections = React.useMemo(() => withOddsLines(nbaBase, nbaOdds.map), [nbaBase, nbaOdds]);

  /* ---- automatic daily card: capture before tip-off, grade from real box scores, no clicking ---- */
  const NBA_CARD_KEY = 'gatekeep_nba_card_v1';
  const [nbaPreds, setNbaPreds] = useState<NbaPrediction[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(NBA_CARD_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  });
  const [nbaAutoStatus, setNbaAutoStatus] = useState('');
  const [nbaInMemoryOnly, setNbaInMemoryOnly] = useState(false);
  const nbaPredsRef = useRef<NbaPrediction[]>(nbaPreds);
  useEffect(() => {
    nbaPredsRef.current = nbaPreds;
    const res = persistWithAutoArchive(NBA_CARD_KEY, nbaPreds, getTodayIsoDate());
    setNbaInMemoryOnly(res.inMemoryOnly);
    if (res.status) {
      setNbaAutoStatus(res.status);
    }
    if (res.trimmed && res.remainingRows.length < nbaPreds.length) {
      setNbaPreds(res.remainingRows);
    }
  }, [nbaPreds]);

  const handleClearNbaHistory = () => {
    const res = clearOldGradedHistory('NBA', nbaPreds, getTodayIsoDate(), NBA_CARD_KEY);
    if (res.archivedCount > 0) {
      setNbaPreds(res.remainingRows);
    }
    setNbaAutoStatus(res.message);
  };

  const handleExportCurrentNbaCard = () => {
    downloadJson(`nba_card_${getTodayIsoDate()}`, { dailyCard: nbaPreds });
  };

  useEffect(() => {
    if (!nbaBase.length || !nbaState) return;
    const today = getTodayIsoDate();
    if (nbaDate < today) return; // never capture a past slate: its games are over and inputs would be hindsight
    const rows = captureDailyCard(nbaBase, nbaGames, nbaState.players, new Set(nbaPredsRef.current.map(r => r.id)), nbaDate);
    if (!rows.length) return;
    setNbaPreds(prev => mergePredictions(prev, rows));
    setNbaAutoStatus(`Auto-logged ${rows.length} player-market projection(s) for ${nbaDate} at ${new Date().toLocaleTimeString()} (pre-game only; nothing to click).`);
  }, [nbaBase, nbaGames, nbaState, nbaDate]);

  const nbaGradeBusy = useRef(false);
  const nbaLastAuto = useRef(0);
  const nbaLedgerRef = useRef<NbaLedgerRow[]>(nbaLedger);
  useEffect(() => { nbaLedgerRef.current = nbaLedger; }, [nbaLedger]);
  /** grades every pending daily-card row, priced row, and picker snapshot whose date has come, from the real box-score feed */
  const nbaAutoGrade = async (manual: boolean, targetDate?: string) => {
    if (nbaGradeBusy.current) return;
    if (!manual && Date.now() - nbaLastAuto.current < 5 * 60 * 1000) return;
    const today = getTodayIsoDate();
    const pendP = nbaPredsRef.current.filter(r => r.result === null && (targetDate ? r.date === targetDate : r.date <= today));
    const pendL = nbaLedgerRef.current.filter(r => r.result === null && (targetDate ? r.date === targetDate : r.date <= today));
    const pickerDates = getStoredDates('nba').filter(d => targetDate ? d === targetDate : d <= today);
    const pendPickerDates = pickerDates.filter(d => {
      const snap = getDailyPickerSnapshot('nba', d);
      return snap && snap.plays.some(p => p.result === null);
    });
    if (!pendP.length && !pendL.length && !pendPickerDates.length && !targetDate) {
      if (manual) setNbaGradeStatus('Nothing pending.');
      return;
    }
    nbaGradeBusy.current = true; nbaLastAuto.current = Date.now();
    try {
      const datesToGrade = targetDate ? [targetDate] : Array.from(new Set([...pendP, ...pendL].map(r => r.date).concat(pendPickerDates)));
      if (manual) setNbaGradeStatus(`Fetching real box scores for ${datesToGrade.join(', ')}…`);
      const lines = await fetchNbaActuals(datesToGrade);
      if (!lines) {
        const msg = 'Box score feed unreachable — nothing graded, nothing simulated.';
        setNbaGradeStatus(msg);
        setNbaAutoStatus(msg);
        return;
      }

      const linesByDate = new Set(lines.map(l => l.date));
      const datesWithZero = datesToGrade.filter(d => !linesByDate.has(d));

      const gp = gradePredictions(nbaPredsRef.current, lines, today);
      const gl = gradeNbaLedger(nbaLedgerRef.current, lines, today);
      if (gp.graded + gp.voided) setNbaPreds(gp.rows);
      if (gl.graded + gl.voided) setNbaLedger(gl.rows);

      // Grade Today's Plays picker snapshot directly with box scores and card rows
      const playerNameMap = nbaState?.players ? new Map(nbaState.players.map(p => [p.playerId, p.name])) : undefined;
      const gradedPickerPlays = gradeNbaPickerWithBoxLines(lines, playerNameMap);
      gradePickerWithCardRows('nba', gp.rows);
      if (gradedPickerPlays > 0) {
        window.dispatchEvent(new CustomEvent('gatekeep_picker_graded', { detail: { sport: 'nba', count: gradedPickerPlays } }));
      }

      console.info(`[nba grade] dates requested: ${datesToGrade.join(', ')} | lines returned: ${lines.length} | daily card: ${gp.graded} graded, ${gp.voided} voided, ${gp.pending} pending | priced plays: ${gl.graded} graded, ${gl.voided} voided, ${gl.pending} pending | picker plays: ${gradedPickerPlays} graded`);

      let statusMsg = '';
      if (lines.length === 0 && datesWithZero.length > 0) {
        statusMsg = `Box scores unavailable for ${datesWithZero.join(', ')} (0 lines returned)`;
      } else if (datesWithZero.length > 0) {
        statusMsg = `Daily card: graded ${gp.graded} · void ${gp.voided} · pending ${gp.pending}. Box scores unavailable for ${datesWithZero.join(', ')} (0 lines returned).`;
      } else {
        statusMsg = `Daily card: graded ${gp.graded} · void ${gp.voided} · pending ${gp.pending}. Priced plays: graded ${gl.graded} · void ${gl.voided} · pending ${gl.pending}.${gradedPickerPlays > 0 ? ` Picker: ${gradedPickerPlays} play(s) graded.` : ''} (${lines.length} box score lines parsed)`;
      }
      setNbaGradeStatus(statusMsg);
      setNbaAutoStatus(statusMsg);
    } finally { nbaGradeBusy.current = false; }
  };

  const handleNbaRefreshSlate = async () => {
    nbaLoadedRef.current = null;
    setNbaStatusLines(['Refreshing NBA slate…']);
    try {
      const [games, state, injuries] = await Promise.all([
        fetchNbaSchedule(nbaDate),
        fetchNbaState(nbaDate),
        fetchNbaInjuries()
      ]);
      setNbaGames(games ?? []);
      setNbaState(state);
      setNbaInjuries(injuries);
      const lines: string[] = [];
      lines.push(games === null ? 'schedule feed unreachable' : `${games.length} game(s) on the schedule`);
      lines.push(state ? `${state.players.length} players from ${state.gamesPlayed} played games${state.priorLoaded ? ' + last season' : ' (last season NOT loaded: priors are thin)'}` : 'game logs unreachable — board is empty (nothing is invented)');
      lines.push(injuries === null ? 'injury feed unreachable: every player is AVAILABILITY UNKNOWN and cannot qualify' : `${injuries.length} injury report entries`);
      setNbaStatusLines(lines);
      if (games !== null && state) nbaLoadedRef.current = { date: nbaDate, at: Date.now() };
      await nbaAutoGrade(true);
    } catch (err) {
      setNbaStatusLines(['Failed to refresh NBA slate: ' + String(err)]);
    }
  };

  // automatic: after the slate loads, when History & Calibration opens, and when you come back to the tab
  useEffect(() => { if (nbaState) void nbaAutoGrade(false); }, [nbaState]);
  useEffect(() => { if (activeSport === 'nba' && activeSubTab === 'scoreboard') void nbaAutoGrade(false); }, [activeSport, activeSubTab]);
  // Cross-sport overnight & morning-safe auto-grading sweep
  useEffect(() => {
    // 1. Initial sweep on app mount (morning after 05:00 auto-forces last 7 days)
    void sweepPendingPickerGrades();

    // 2. Respond to sweep requests dispatched across components
    const handleSweepRequested = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const force = detail?.force ?? false;
      const manual = detail?.manual ?? false;
      void nbaAutoGrade(manual || force);
      void nhlGo(manual || force);
      void nflGo(manual || force);
      void mlbGo(manual || force);
    };
    window.addEventListener('gatekeep_sweep_requested', handleSweepRequested);

    // 3. Tab visibility change: sweep when returning to the tab
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void sweepPendingPickerGrades();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // 4. Polling timer: 4 minutes during game hours (12:00 PM – 01:00 AM), 15 minutes off-hours
    let timer: any;
    const scheduleNext = () => {
      const h = new Date().getHours();
      const isGameHours = h >= 12 || h < 1;
      const intervalMs = isGameHours ? 4 * 60 * 1000 : 15 * 60 * 1000;
      timer = setTimeout(async () => {
        await sweepPendingPickerGrades();
        scheduleNext();
      }, intervalMs);
    };
    scheduleNext();

    return () => {
      window.removeEventListener('gatekeep_sweep_requested', handleSweepRequested);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimeout(timer);
    };
  }, []);


  // priced rows are logged automatically too (debounced while you type prices), only for games that have not started
  useEffect(() => {
    if (!Object.keys(nbaOdds.map).length || nbaOdds.date < getTodayIsoDate()) return;
    const t = setTimeout(() => {
      const open = new Set(nbaGames.filter(g => g.state === 'pre' && !g.completed && !g.postponed).map(g => g.gameId));
      const rows = collectNbaLedgerRows(nbaProjections.filter(p => p.gameId && open.has(p.gameId)), nbaOdds.map, nbaSettings, nbaOdds.date);
      if (!rows.length) return;
      setNbaLedger(prev => {
        const byId = new Map(prev.map(r => [r.id, r]));
        const changed = rows.some(r => { const o = byId.get(r.id); return !o || (o.result === null && (o.overOdds !== r.overOdds || o.underOdds !== r.underOdds || o.tag !== r.tag || o.modelMu !== r.modelMu)); });
        return changed ? mergeNbaLedger(prev, rows) : prev;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [nbaOdds, nbaProjections, nbaGames, nbaSettings]);

  const handleNbaOddsChange = (market: NbaMarket, playerId: number, line: number, side: 'over' | 'under', val: number | null) => {
    setNbaOdds(prev => {
      const key = nbaOddsKey(market, playerId, line);
      const entry = { ...(prev.map[key] || {}), [side]: val };
      const next = { ...prev.map };
      if (entry.over == null && entry.under == null) delete next[key];
      else next[key] = entry;
      return { ...prev, map: next };
    });
  };

  const handleNbaLogRows = () => {
    const rows = collectNbaLedgerRows(nbaProjections, nbaOdds.map, nbaSettings, nbaDate);
    if (!rows.length) { alert('No priced rows to log.'); return; }
    setNbaLedger(prev => mergeNbaLedger(prev, rows));
    alert(`Logged ${rows.length} priced row(s) (${rows.filter(r => r.tag !== 'PASS').length} qualifying). Grade them from the Scoreboard after the games are final.`);
  };

  const handleNbaSnapshotAllPredictions = () => {
    if (!nbaBase.length || !nbaState) { alert('No predictions on the board to snapshot.'); return; }
    const rows = captureDailyCard(nbaBase, nbaGames, nbaState.players, new Set(nbaPredsRef.current.map(r => r.id)), nbaDate, Date.now(), true);
    if (!rows.length) { alert('No missing projections to add for this date.'); return; }
    setNbaPreds(prev => {
      const merged = mergePredictions(prev, rows);
      const added = merged.length - prev.length;
      alert(`Snapshot: captured ${rows.length} predictions (${added} new row(s) added, existing rows untouched).`);
      return merged;
    });
  };

  const handleNbaGrade = (targetDate?: string) => nbaAutoGrade(true, targetDate);

  /* =========================================================================
     PARLAY LAB: paper tickets (built from pre-game information, graded from the daily cards) + baseline strip
     ========================================================================= */
  const paper = useDailyCard<PaperTicket>('gatekeep_parlay_paper_v1', getTodayIsoDate);
  const [paperStatus, setPaperStatus] = useState('');
  const pricedNbaLegs = React.useMemo(() => legsFromPricedLedger(nbaLedger, 'nba', getTodayIsoDate(), (id, m) => nbaPreds.find(r => r.playerId === id && r.market === m && r.date === getTodayIsoDate())?.pm ?? null), [nbaLedger, nbaPreds]);
  const pricedNhlLegs = React.useMemo(() => legsFromPricedLedger(nhlLedger, 'nhl', getTodayIsoDate()), [nhlLedger]);
  const pricedNflLegs = React.useMemo(() => legsFromNflSnapshots(nflSnapshots, getTodayIsoDate()), [nflSnapshots]);
  const cardBySport: Record<PSport, CardRow[]> = { nba: nbaPreds, nhl: nhlCard.rows, nfl: nflCard.rows, mlb: mlbCard.rows };
  const allSlateCardRows = React.useMemo<CardRow[]>(() => {
    return [...nbaPreds, ...nhlCard.rows, ...nflCard.rows, ...mlbCard.rows];
  }, [nbaPreds, nhlCard.rows, nflCard.rows, mlbCard.rows]);
  const poolFor = (sp: PSport, priced: ParlayLeg[]): ParlayLeg[] => {
    const today = getTodayIsoDate();
    return buildPool(cardBySport[sp].filter(r => r.result === null && r.date === today).map(r => legFromCard(r, sp)), priced);
  };
  // build the day's fixed menu a few seconds after the board changes (so a half-loaded slate is not frozen into tickets)
  useEffect(() => {
    const t = setTimeout(() => {
      const today = getTodayIsoDate();
      const made: PaperTicket[] = [];
      (['nba', 'nhl', 'nfl', 'mlb'] as PSport[]).forEach(sp => {
        const pool = poolFor(sp, sp === 'nba' ? pricedNbaLegs : sp === 'nhl' ? pricedNhlLegs : sp === 'nfl' ? pricedNflLegs : []);
        if (pool.length < 2) return;
        made.push(...paperTicketsFor(sp, pool, [...paper.ref.current, ...made], today));
      });
      if (!made.length) return;
      paper.add(made);
      setPaperStatus(`Auto-built ${made.length} paper ticket(s) at ${stamp()} from pre-game probabilities (fixed menu, nothing hand-picked, nothing bet).`);
    }, 4000);
    return () => clearTimeout(t);
  }, [nbaPreds.length, nhlCard.rows.length, nflCard.rows.length, mlbCard.rows.length, pricedNbaLegs, pricedNhlLegs, pricedNflLegs]);
  // grade them from the already-graded daily-card / priced rows (no new feed)
  useEffect(() => {
    if (!paper.ref.current.some(t => t.result === null)) return;
    const today = getTodayIsoDate();
    const cardMaps = Object.fromEntries((['nba', 'nhl', 'nfl', 'mlb'] as PSport[]).map(sp => [sp, new Map(cardBySport[sp].map(r => [r.id, r]))])) as Record<PSport, Map<string, CardRow>>;
    const ledgerMaps: Partial<Record<PSport, Map<string, { result: string | null }>>> = { nba: new Map(nbaLedger.map(r => [r.id, r])), nhl: new Map(nhlLedger.map(r => [r.id, r])) };
    const stateFor = (sp: PSport) => (l: { id: string; src: 'card' | 'ledger'; side: 'OVER' | 'UNDER' }): LegState => {
      if (l.src === 'card') return cardMaps[sp].get(l.id)?.result ?? null;
      const r = ledgerMaps[sp]?.get(l.id);
      if (!r || r.result === null) return null;
      if (r.result === 'VOID' || r.result === 'PUSH') return r.result;
      return r.result === l.side ? 'HIT' : 'MISS';
    };
    const changed = new Map<string, PaperTicket>();
    let g = 0, v = 0;
    (['nba', 'nhl', 'nfl', 'mlb'] as PSport[]).forEach(sp => {
      const res = gradePaperTickets(paper.ref.current.filter(t => t.sport === sp), stateFor(sp), Date.now(), { today, days: 10 });
      res.tickets.forEach(t => { const old = paper.ref.current.find(o => o.id === t.id); if (old && old.result === null && t.result !== null) changed.set(t.id, t); });
      g += res.graded; v += res.voided;
    });
    if (!changed.size) return;
    paper.setRows(prev => prev.map(t => changed.get(t.id) ?? t));
    setPaperStatus(`Paper tickets graded ${g} · void ${v} (from the daily cards) at ${stamp()}.`);
  }, [nbaPreds, nhlCard.rows, nflCard.rows, mlbCard.rows, nbaLedger, nhlLedger, paper.rows.length]);
  const baselineRows = React.useMemo(() => [
    { sport: 'NBA', summary: summarizePredictions(nbaPreds, false), hurdle: 'UNDER' as const },
    { sport: 'NHL', summary: summarizeNhlCard(nhlCard.rows), hurdle: 'UNDER' as const },
    { sport: 'NFL', summary: summarizeNflCard(nflCard.rows), hurdle: 'UNDER' as const },
    { sport: 'MLB', summary: summarizeMlbCard(mlbCard.rows), hurdle: 'OVER' as const }
  ], [nbaPreds, nhlCard.rows, nflCard.rows, mlbCard.rows]);

  /* =========================================================================
     BETTABLE FILTER + STRUCTURED ODDS IMPORT (shared config, per-sport adapters)
     ========================================================================= */
  const BET_KEY = 'gatekeep_bettable_v1';
  const [bet, setBetRaw] = useState<BettableConfig>(() => {
    try { const v = JSON.parse(localStorage.getItem(BET_KEY) || 'null'); if (v && typeof v === 'object') return { ...DEFAULT_BETTABLE, ...v, floors: { ...DEFAULT_BETTABLE.floors, ...(v.floors || {}) } }; } catch { /* ignore */ }
    return DEFAULT_BETTABLE;
  });
  const setBet = (c: BettableConfig) => { setBetRaw(c); try { localStorage.setItem(BET_KEY, JSON.stringify(c)); } catch { /* ignore */ } };
  const americanStr = (us: number | null) => (us === null ? '' : us > 0 ? `+${us}` : `${us}`);
  const countMsg = (n: number, un: number) => `Applied ${n} posted line(s)${un ? `; ${un} player name(s) not on the board were skipped` : ''}. Existing model and results untouched.`;

  const nbaOddsPanel = (
    <OddsImportPanel sport="nba" label="NBA" date={nbaDate} existing={Object.keys(nbaOdds.map).length}
      buildPlan={(posted: PostedLine[], book: string): Plan => planApply(posted, {
        book, candidates: nbaProjections.map(p => ({ id: p.playerId, name: p.name })),
        addMissing: true,
        keyFor: (m, id, l) => nbaOddsKey(m as NbaMarket, id as number, l),
        model: (m, id, l) => { const p = nbaProjections.find(x => x.playerId === id); if (!p) return null; const mp = p.markets[m as NbaMarket]; const pr = mp.probs[l] ?? priceLine(mp.mu, mp.r, l); return { pOver: pr.p_over, pUnder: pr.p_under }; }
      })}
      onApply={(plan, replace) => { setNbaOdds(prev => ({ ...prev, map: mergeOddsMap(prev.map, plan, replace) })); return countMsg(plan.matched, plan.unmatched.length); }} />
  );
  const nhlOddsPanel = (
    <OddsImportPanel sport="nhl" label="NHL" date={nhlDate} existing={Object.keys(nhlOdds.map).length}
      buildPlan={(posted: PostedLine[], book: string): Plan => planApply(posted, {
        book, candidates: nhlProjections.map(p => ({ id: p.playerId, name: p.name })),
        addMissing: true,
        keyFor: (m, id, l) => nhlOddsKey(m as NhlMarket, id as number, l),
        model: (m, id, l) => { const p = nhlProjections.find(x => x.playerId === id); const mp = p ? marketOf(p, m as NhlMarket) : null; if (!mp) return null; const pr = mp.probs[l] ?? priceLine(mp.mu, mp.r, l); return { pOver: pr.p_over, pUnder: pr.p_under }; }
      })}
      onApply={(plan, replace) => { setNhlOdds(prev => ({ ...prev, map: mergeOddsMap(prev.map, plan, replace) })); return countMsg(plan.matched, plan.unmatched.length); }} />
  );
  const mlbOddsPanel = (
    <OddsImportPanel sport="mlb" label="MLB (0.5 hits only)" date={mlbToday} existing={Object.keys(mlbOddsMap).length}
      buildPlan={(posted: PostedLine[], book: string): Plan => planApply(posted.filter(l => l.line === 0.5), {
        book, candidates: mlbLiveGames.flatMap(g => g.batters.map(b => ({ id: b.id, name: b.name }))),
        addMissing: true,
        keyFor: (_m, id) => String(id),
        model: (_m, id) => { const r = mlbCard.ref.current.find(x => x.playerId === id && x.date === getTodayIsoDate()); return r ? { pOver: r.pOver, pUnder: 1 - r.pOver } : null; }
      })}
      onApply={(plan, replace) => {
        setMlbOddsMap(prev => { const out: Record<number, { over: string; under: string; line?: number }> = replace ? {} : { ...prev }; Object.values(plan.entries).forEach(e => { out[e.id as number] = { over: americanStr(e.over), under: americanStr(e.under), line: 0.5 }; }); return out; });
        return countMsg(plan.matched, plan.unmatched.length) + ' Only the 0.5 line is used for hits.';
      }} />
  );
  const nflOddsPanel = (
    <OddsImportPanel sport="nfl" label="NFL receptions" date={getTodayIsoDate()} existing={nflSnapshots.filter(s => s.hasMarket !== false).length}
      buildPlan={(posted: PostedLine[], book: string): Plan => planApply(posted, {
        book, candidates: Object.values(nflLiveRosters).flat().map(p => ({ id: normalizePlayerName(p.name), name: p.name })),
        addMissing: true,
        keyFor: (_m, id, l) => `${id}|${l}`,
        model: (_m, id) => { const r = nflCard.ref.current.find(x => x.playerId === id && x.result === null); return r ? { pOver: r.pOver, pUnder: 1 - r.pOver } : null; }
      })}
      onApply={(plan, replace) => {
        if (!nflMeta) return 'The NFL slate is not loaded yet; nothing applied.';
        // NFL keeps one priced line per player-week: use each player's main line (the two-way price closest to even)
        const mainOf = new Map<string, (typeof plan.entries)[string]>();
        Object.values(plan.entries).forEach(e => {
          const d = (x: typeof e) => (x.over != null && x.under != null ? Math.abs((parseOddsFn(x.over)?.imp ?? 0) - (parseOddsFn(x.under)?.imp ?? 0)) : 9);
          const cur = mainOf.get(String(e.id)); if (!cur || d(e) < d(cur)) mainOf.set(String(e.id), e);
        });
        const names = new Map(Object.values(nflLiveRosters).flat().map(p => [normalizePlayerName(p.name), p.name]));
        const byBook = new Map<string, string[]>();
        mainOf.forEach(e => { const nm = names.get(String(e.id)); if (!nm) return; (byBook.get(e.book) ?? byBook.set(e.book, []).get(e.book)!).push(`${nm}, ${e.line}, ${americanStr(e.over)}, ${americanStr(e.under)}`); });
        let snaps = nflSnapshots, done = 0;
        byBook.forEach((lines, b) => { const r = importNflLines(lines.join('\n'), nflMeta.season, nflMeta.week, b, 'pre', nflImportCtx(), snaps); snaps = r.snapshots; done += r.imported; });
        setNflSnapshots(snaps);
        return `Priced ${done} NFL receiver line(s) (main line per player).` + (replace ? ' "Replace" is not applied to NFL: existing priced lines are kept.' : '') + (plan.unmatched.length ? ` ${plan.unmatched.length} name(s) not on the board were skipped.` : '');
      }} />
  );

  const NBA_PARLAY_MARKETS = NBA_MARKETS.map(m => ({ id: m as string, label: NBA_MARKET_UNIT[m] }));
  const parlayLab = (sp: PSport, label: string, priced: ParlayLeg[], markets: { id: string; label: string }[]) => (
    <ParlayLab sport={sp} sportLabel={label} today={getTodayIsoDate()} cardRows={cardBySport[sp]} pricedLegs={priced} markets={markets}
      bettable={bet} paper={paper.rows} paperStatus={[paperStatus, paper.status].filter(Boolean).join(' · ')} onExport={() => downloadJson('parlay_paper_tickets', { tickets: paper.rows })} />
  );

  const handleNbaImportLedger = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      const arr: any[] = Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : [];
      const rows = arr.filter(r => r && r.id && r.market && r.gameId !== undefined) as NbaLedgerRow[];
      setNbaLedger(prev => mergeNbaLedger(prev, rows));
      const card = Array.isArray(data?.dailyCard) ? (data.dailyCard as NbaPrediction[]).filter(r => r && r.id && r.market && r.gameId !== undefined) : [];
      if (card.length) setNbaPreds(prev => mergePredictions(prev, card));
      alert(`Imported ${rows.length} priced row(s)${card.length ? ` and ${card.length} daily-card row(s)` : ''}${rows.length < arr.length ? ` (${arr.length - rows.length} without ids were skipped)` : ''}.`);
    } catch (e: any) {
      alert('Invalid JSON: ' + e.message);
    }
  };

  /* =========================================================================
     UNIVERSAL SCREENSHOT APPLICATION HANDLER
     ========================================================================= */
  const handleApplyScreenshotLines = (lines: ExtractedPropLine[], targetSport?: 'NFL' | 'MLB' | 'NHL' | 'NBA') => {
    const chosenSport = (targetSport ? targetSport.toLowerCase() : activeSport) as ActiveSport;
    if (chosenSport !== activeSport) {
      setActiveSport(chosenSport);
      setActiveSubTab('desk');
    }

    if (chosenSport === 'nfl') {
      const formattedText = lines.map(l => `${l.player}, ${l.line}, ${l.overOdds || ''}, ${l.underOdds || ''}`).join('\n');
      handleNflImport(nflMeta?.season ?? 2026, nflMeta?.week ?? 0, 'Sportsbook OCR', 'pre', formattedText);
    } else if (chosenSport === 'mlb') {
      let matched = 0;
      const unmatched: string[] = [];
      const updatedOdds = { ...mlbOddsMap };
      const allBatters = mlbLiveGames.flatMap(g => g.batters);

      lines.forEach(lineItem => {
        const hits = allBatters.filter(b => fuzzyMatchName(lineItem.player, b.name));
        const ids = new Set(hits.map(h => h.id));
        if (ids.size !== 1) { unmatched.push(`${lineItem.player}${ids.size > 1 ? ' (ambiguous)' : ''}`); return; }
        const found = hits[0];
        updatedOdds[found.id] = {
          over: lineItem.overOdds || '',
          under: lineItem.underOdds || '',
          line: lineItem.line || 0.5
        };
        matched++;
      });

      setMlbOddsMap(updatedOdds);
      if (matched > 0) recordOddsImport('mlb', mlbToday, matched);
      alert(`Applied ${matched} line(s) to the MLB board.` + (unmatched.length ? `\nNot in a posted lineup (skipped): ${unmatched.slice(0, 8).join(', ')}` : ''));
    } else if (chosenSport === 'nba') {
      let matched = 0;
      const unmatched: string[] = [];
      const entries: Array<[string, { over?: number | null; under?: number | null }]> = [];
      lines.forEach(li => {
        const market = inferNbaMarket(li.prop);
        if (!market) { unmatched.push(`${li.player} (market "${li.prop || '?'}" is not priced here)`); return; }
        const hits = nbaProjections.filter(p => fuzzyMatchName(li.player, p.name));
        const ids = new Set(hits.map(h => h.playerId));
        if (ids.size !== 1) { unmatched.push(`${li.player}${ids.size > 1 ? ' (ambiguous)' : ' (not on a loaded team today)'}`); return; }
        const over = parseOddsShared(li.overOdds)?.us ?? null;
        const under = parseOddsShared(li.underOdds)?.us ?? null;
        if (over == null && under == null) { unmatched.push(`${li.player} (no readable price)`); return; }
        entries.push([nbaOddsKey(market, hits[0].playerId, li.line), { over, under }]);
        matched++;
      });
      if (entries.length) setNbaMarket(entries[0][0].split('|')[0] as NbaMarket);
      setNbaOdds(prev => ({ ...prev, map: { ...prev.map, ...Object.fromEntries(entries) } }));
      if (matched > 0) recordOddsImport('nba', nbaDate, matched);
      alert(`Applied ${matched} line(s) to the NBA board.` + (unmatched.length ? `\nSkipped: ${unmatched.slice(0, 8).join(', ')}` : ''));
    } else if (chosenSport === 'nhl') {
      let matched = 0;
      const unmatched: string[] = [];
      const newExtras: NhlPlayerSnapshot[] = [];
      const slateTeams = new Set(nhlLiveGames.flatMap(g => [normalizeNhlTeam(g.awayTeam), normalizeNhlTeam(g.homeTeam)]));
      const loaded = [...Object.values(nhlSkatersByTeam).flat(), ...nhlExtraSkaters];
      const entries: Array<[string, { over?: number | null; under?: number | null }]> = [];

      lines.forEach(li => {
        const market = inferNhlMarket(li.prop, li.line);
        const supported = NHL_CONFIG[market].lines as number[];
        if (!supported.includes(li.line)) { unmatched.push(`${li.player} (${market.toUpperCase()} ${li.line} not a supported line)`); return; }
        const hits = loaded.filter(p => fuzzyMatchName(li.player, p.name));
        const ids = new Set(hits.map(h => h.playerId));
        let target: NhlPlayerSnapshot | undefined;
        if (ids.size > 1) { unmatched.push(`${li.player} (ambiguous)`); return; }
        if (ids.size === 1) target = hits[0];
        else {
          // not on a loaded roster: add an ESTIMATED skater (position prior only, never BET) if we know the team
          const team = normalizeNhlTeam(li.team || '');
          if (!slateTeams.has(team)) { unmatched.push(`${li.player} (team unknown / not on this slate)`); return; }
          target = buildEstimatedNhlSkater(li.player, team);
          newExtras.push(target);
        }
        const over = parseOddsShared(li.overOdds)?.us ?? null;
        const under = parseOddsShared(li.underOdds)?.us ?? null;
        if (over === null && under === null) { unmatched.push(`${li.player} (no odds)`); return; }
        entries.push([nhlOddsKey(market, target.playerId, li.line), { over, under }]);
        matched++;
      });

      if (newExtras.length) setNhlExtraSkaters(prev => [...prev, ...newExtras]);
      setNhlOdds(prev => ({ ...prev, map: { ...prev.map, ...Object.fromEntries(entries) } }));
      if (matched > 0) recordOddsImport('nhl', nhlDate, matched);
      alert(`Applied ${matched} line(s) to the NHL board.` + (newExtras.length ? `\n${newExtras.length} player(s) were not on a loaded roster and are ESTIMATED (priced from the position prior; cannot qualify).` : '') + (unmatched.length ? `\nSkipped: ${unmatched.slice(0, 8).join(', ')}` : ''));
    }
  };

  return (
    <DisplaySettingsProvider>
      <div className="min-h-screen bg-[#0b0f14] text-[#e6edf5] flex flex-col font-sans">
      <Header
        activeSport={activeSport}
        setActiveSport={setActiveSport}
        activeSubTab={activeSubTab}
        setActiveSubTab={setActiveSubTab}
        onOpenScreenshotUpload={() => setShowScreenshotModal(true)}
        onRefreshLiveSchedule={refreshAllSchedules}
        isLoadingSchedule={isLoadingSchedule}
        myBetsCount={{
          total: personalBets.length,
          pending: personalBets.filter(b => b.result === 'PENDING').length
        }}
      />

      {/* Live Games Today Status Ribbon */}
      <div className="bg-[#121824]/90 border-b border-[#222d3e] px-4 py-2 text-xs font-mono">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[#8b97ac]">Today's Live Slate:</span>
            <span className="text-white font-semibold">
              {activeSport === 'nba'
                ? (nbaStatusLines[0] || "")
                : activeSport === 'nhl'
                ? (nhlStatusLines[0] || "")
                : activeSport === 'nfl'
                ? nflRosterStatus
                : (mlbSlateNote || scheduleStatusText)}
            </span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto text-[11px]">
            {activeSport === 'nfl' && Object.values(nflLiveGames).slice(0, 4).map(g => (
              <span key={g.id} className="px-2 py-0.5 rounded bg-[#182232] border border-[#222d3e] text-sky-300 whitespace-nowrap">
                🏈 {g.away} @ {g.home}
              </span>
            ))}
            {activeSport === 'mlb' && mlbLiveGames.slice(0, 4).map(g => (
              <span key={g.gamePk} className="px-2 py-0.5 rounded bg-[#182232] border border-[#222d3e] text-amber-300 whitespace-nowrap">
                ⚾ {g.away} @ {g.home}
              </span>
            ))}
            {activeSport === 'nba' && nbaGames.slice(0, 4).map(g => (
              <span key={g.gameId} className="px-2 py-0.5 rounded bg-[#182232] border border-[#222d3e] text-orange-300 whitespace-nowrap">
                🏀 {g.away} @ {g.home}
              </span>
            ))}
            {activeSport === 'nhl' && nhlLiveGames.slice(0, 4).map(g => (
              <span key={g.gameId} className="px-2 py-0.5 rounded bg-[#182232] border border-[#222d3e] text-cyan-300 whitespace-nowrap">
                🏒 {normalizeNhlTeam(g.awayTeam)} @ {normalizeNhlTeam(g.homeTeam)}
              </span>
            ))}
            <button
              onClick={refreshAllSchedules}
              disabled={isLoadingSchedule}
              className="text-sky-400 hover:text-white flex items-center gap-1 text-[11px] underline ml-1 cursor-pointer"
            >
              🔄 Refresh Games
            </button>
          </div>
        </div>
      </div>

      {loadDiag && !loadDiag.benign && !loadDiagDismissed && (
        <div className="max-w-6xl w-full mx-auto px-4 mt-3">
          <div className="flex items-start justify-between gap-3 p-3 rounded-xl border border-amber-800 bg-amber-950/40 text-amber-200 text-xs font-mono">
            <span><b>Page was reloaded:</b> {loadDiag.message}</span>
            <button onClick={() => setLoadDiagDismissed(true)} className="px-2 py-0.5 rounded bg-[#182232] border border-[#222d3e] text-white">dismiss</button>
          </div>
        </div>
      )}
      <main className="max-w-6xl w-full mx-auto px-4 py-5 flex-1">
        <ErrorBoundary resetKey={`${activeSport}:${activeSubTab}`} label={`${activeSport.toUpperCase()} ${activeSubTab}`}>
        {/* =========================================================================
            SPORT 1: NFL RECEPTIONS PROPS (v1.6)
            ========================================================================= */}
        {activeSport === 'nfl' && (
          <div>
            {activeSubTab === 'desk' && <div className="mb-3">{nflOddsPanel}</div>}
            {activeSubTab === 'desk' && (
              <NflDesk
                liveRosters={nflLiveRosters}
                rosterStatus={nflRosterStatus}
                injuries={nflInjuries}
                injuriesAvailable={nflInjuriesAvailable}
                onUpsertSnapshot={handleNflUpsertSnapshot}
                snapshots={nflSnapshots}
                bets={nflBets}
                games={nflLiveGames}
                onRecordBet={handleNflRecordBet}
                onOpenImport={() => setShowNflImportModal(true)}
                onOpenScreenshotUpload={() => setShowScreenshotModal(true)}
                onLogBet={handleDeskLogBet}
                cardRows={nflCard.rows}
                onAddToTicket={() => setActiveSubTab('parlays')}
                onTriggerGrade={() => void nflGo(true)}
              />
            )}
            {activeSubTab === 'my-bets' && (
              <MyBetsTab
                bets={personalBets}
                onSaveBet={handleSavePersonalBet}
                onDeleteBet={handleDeletePersonalBet}
                onImportBets={handleImportPersonalBets}
                onBulkUpdateBets={handleBulkUpdatePersonalBets}
                cardRows={allSlateCardRows}
                currentSport="nfl"
              />
            )}
            {activeSubTab === 'scoreboard' && (<>
              <div className="bg-[#121824] p-4 rounded-2xl border border-[#222d3e] flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-bold font-display uppercase tracking-wide text-white">
                    Grade NFL Results
                  </h3>
                  <p className="text-xs text-[#8b97ac]">
                    Settle pending proposition bets against final nflverse box scores or enter actual stats manually.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleNflAutoGrade}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-display uppercase tracking-wider text-xs rounded-xl cursor-pointer"
                  >
                    Auto-grade from nflverse
                  </button>
                  <button
                    onClick={() => setShowNflGradeModal(true)}
                    className="px-4 py-2 bg-[#182232] hover:bg-[#222d3e] text-sky-400 border border-sky-500/40 font-bold font-display uppercase tracking-wider text-xs rounded-xl cursor-pointer"
                  >
                    Enter manually
                  </button>
                </div>
              </div>
              <BaselineStrip rows={baselineRows} current="NFL" />
              <CardBoard
                rows={nflCard.rows}
                edge={nflEdge}
                autoStatus={[nflAutoStatus, nflCard.status].filter(Boolean).join(' · ')}
                gradeStatus={nflCardGrade}
                onGrade={() => void nflGo(true)}
                onExport={() => downloadJson('nfl_daily_card', { dailyCard: nflCard.rows })}
                sport="NFL"
                markets={NFL_CARD_MARKETS}
                exposureUnit=""
                startWord="kickoff"
                sourceWord="the nflverse final box data"
                avgNote="this season's receptions per game before the game"
                inMemoryOnly={nflCard.inMemoryOnly}
                onExportCurrentCard={nflCard.exportCurrentCard}
                onClearHistory={handleClearNflHistory}
              />
              <NflScoreboard
                snapshots={nflSnapshots}
                actuals={nflActuals}
                bets={nflBets}
                cardRows={nflCard.rows}
                onExportJson={handleNflExportJson}
                onImportJson={handleNflImportJson}
                onReset={handleNflReset}
                onClearHistory={handleClearNflHistory}
              />
            </>)}
            {activeSubTab === 'parlays' && parlayLab('nfl', 'NFL', pricedNflLegs, NFL_CARD_MARKETS)}
            {activeSubTab === 'settings' && (
              <div className="space-y-4">
                <BettableSettings cfg={bet} onChange={setBet} />
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            SPORT 2: MLB 0.5-HIT PROPS (v5.8)
            ========================================================================= */}
        {activeSport === 'mlb' && (
          <div>
            {mlbSlateNote && (
              <div className="mb-3 text-[11px] font-mono text-amber-300/90 bg-amber-950/30 border border-amber-800/40 rounded-xl px-3 py-2">
                {mlbSlateNote}
              </div>
            )}
            {activeSubTab === 'desk' && <div className="mb-3">{mlbOddsPanel}</div>}
            {activeSubTab === 'desk' && (
              <MlbDesk
                games={mlbLiveGames}
                oddsMap={mlbOddsMap}
                parlayLegs={mlbParlayLegs.map(l => l.id)}
                tune={mlbTune}
                onUpdateOdds={handleMlbOddsChange}
                onUpdateLine={handleMlbUpdateLine}
                onToggleParlay={handleMlbToggleParlay}
                onLogAllPriced={rows => handleMlbLogAllPriced(rows)}
                onAutoLogPriced={rows => handleMlbLogAllPriced(rows, true)}
                onOpenScreenshotUpload={() => setShowScreenshotModal(true)}
                onLogBet={handleDeskLogBet}
                cardRows={mlbCard.rows}
                onAddToTicket={() => setActiveSubTab('parlays')}
                onTriggerGrade={() => void mlbGo(true)}
              />
            )}
            {activeSubTab === 'my-bets' && (
              <MyBetsTab
                bets={personalBets}
                onSaveBet={handleSavePersonalBet}
                onDeleteBet={handleDeletePersonalBet}
                onImportBets={handleImportPersonalBets}
                onBulkUpdateBets={handleBulkUpdatePersonalBets}
                cardRows={allSlateCardRows}
                currentSport="mlb"
              />
            )}
            {activeSubTab === 'parlays' && (
              <div className="space-y-4">
                <div className="bg-[#121824] p-4 rounded-2xl border border-[#222d3e]">
                  <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-cyan-400 mb-2">
                    Custom Ticket (Direct Bets)
                  </h3>
                  <MlbParlayPicker
                    legs={mlbParlayLegs}
                    onRemoveLeg={id => setMlbParlayLegs(prev => prev.filter(l => l.id !== id))}
                    onClear={() => setMlbParlayLegs([])}
                    sgpHaircut={mlbTune.sgpHaircut}
                  />
                </div>
                <div className="bg-[#121824] p-4 rounded-2xl border border-[#222d3e]">
                  <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-cyan-400 mb-2">
                    Model Ticket Builder (Correlation Playground)
                  </h3>
                  <div>{parlayLab('mlb', 'MLB', [], MLB_CARD_MARKETS)}</div>
                </div>
              </div>
            )}
            {activeSubTab === 'ledger' && (<>
              <BaselineStrip rows={baselineRows} current="MLB" />
              <CardBoard
                rows={mlbCard.rows}
                edge={mlbEdge}
                autoStatus={[mlbAutoStatus, mlbCard.status].filter(Boolean).join(' · ')}
                gradeStatus={mlbCardGrade}
                onGrade={() => void mlbGo(true)}
                onExport={() => downloadJson('mlb_daily_card', { ledger: mlbLedger, dailyCard: mlbCard.rows })}
                sport="MLB"
                markets={MLB_CARD_MARKETS}
                exposureUnit="AB"
                startWord="first pitch"
                sourceWord="the final box score"
                avgNote="season batting average × projected at-bats before the game"
                inMemoryOnly={mlbCard.inMemoryOnly}
                onExportCurrentCard={mlbCard.exportCurrentCard}
                onClearHistory={handleClearMlbHistory}
              />
              <MlbLedger
                ledger={mlbLedger}
                cardRows={mlbCard.rows}
                onGradeOpenPlays={handleMlbGradeOpenPlays}
                onExportCsv={handleMlbExportCsv}
                onDeleteRow={idx => setMlbLedger(prev => prev.filter((_, i) => i !== idx))}
              />
            </>)}
            {activeSubTab === 'settings' && (
              <div className="space-y-4">
                <BettableSettings cfg={bet} onChange={setBet} />
                <MlbSettings
                  tune={mlbTune}
                  onUpdateTune={setMlbTune}
                  onResetTune={() => setMlbTune(MLB_DEFAULT_TUNE)}
                />
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            SPORT 3: NHL SHOTS ON GOAL PROPS (sog_v1)
            ========================================================================= */}
        {activeSport === 'nhl' && (
          <div>
            {activeSubTab === 'desk' && (
              <NhlDesk
                date={nhlDate}
                setDate={setNhlDate}
                games={nhlLiveGames}
                projections={nhlProjections}
                market={nhlMarket}
                setMarket={setNhlMarket}
                oddsMap={nhlOdds.map}
                settings={nhlSettings}
                setShowStabsOnly={v => setNhlSettings(prev => ({ ...prev, showStabsOnly: v }))}
                onOddsChange={handleNhlOddsChange}
                onLogRows={handleNhlLogRows}
                onSnapshotAllPredictions={handleNhlSnapshotAllPredictions}
                onOpenScreenshotUpload={() => setShowScreenshotModal(true)}
                statusLines={nhlStatusLines}
                bet={bet}
                oddsPanel={nhlOddsPanel}
                onLogBet={handleDeskLogBet}
                cardRows={nhlCard.rows}
                onAddToTicket={() => setActiveSubTab('parlays')}
                onTriggerGrade={() => void nhlGo(true)}
              />
            )}
            {activeSubTab === 'my-bets' && (
              <MyBetsTab
                bets={personalBets}
                onSaveBet={handleSavePersonalBet}
                onDeleteBet={handleDeletePersonalBet}
                onImportBets={handleImportPersonalBets}
                onBulkUpdateBets={handleBulkUpdatePersonalBets}
                cardRows={allSlateCardRows}
                currentSport="nhl"
              />
            )}
            {activeSubTab === 'scoreboard' && (<>
              <BaselineStrip rows={baselineRows} current="NHL" />
              <CardBoard
                rows={nhlCard.rows}
                edge={nhlEdge}
                autoStatus={[nhlAutoStatus, nhlCard.status].filter(Boolean).join(' · ')}
                gradeStatus={nhlCardGrade}
                onGrade={() => void nhlGo(true)}
                onExport={() => downloadJson('nhl_daily_card', { rows: nhlLedger, dailyCard: nhlCard.rows })}
                sport="NHL"
                markets={NHL_CARD_MARKETS}
                exposureUnit="min"
                startWord="puck drop"
                sourceWord="the official box score"
                avgNote="mean of the player's recent games before the game"
                inMemoryOnly={nhlCard.inMemoryOnly}
                onExportCurrentCard={nhlCard.exportCurrentCard}
                onClearHistory={handleClearNhlHistory}
              />
              <NhlScoreboard
                rows={nhlLedger}
                gradeStatus={nhlGradeStatus}
                cardRows={nhlCard.rows}
                skaters={nhlSkatersByTeam}
                projections={nhlProjections}
                onGrade={handleNhlGrade}
                onClearResults={() => { if (confirm('Clear the entire NHL ledger?')) setNhlLedger([]); }}
                onExportJson={() => {
                  const blob = new Blob([JSON.stringify({ rows: nhlLedger, dailyCard: nhlCard.rows }, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `nhl_ledger_${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                }}
                onImportJson={handleNhlImportLedger}
                onClearHistory={handleClearNhlHistory}
              />
            </>)}
            {activeSubTab === 'parlays' && parlayLab('nhl', 'NHL', pricedNhlLegs, NHL_CARD_MARKETS)}
            {activeSubTab === 'settings' && (
              <div className="space-y-4">
                <BettableSettings cfg={bet} onChange={setBet} />
                <NhlSettingsModal
                  settings={nhlSettings}
                  tuning={nhlTuning}
                  onSettings={setNhlSettings}
                  onTuning={setNhlTuning}
                />
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            SPORT 4: NBA PLAYER PROPS (nba_v1)
            ========================================================================= */}
        {activeSport === 'nba' && (
          <div>
            {activeSubTab === 'desk' && (
              <NbaDesk
                date={nbaDate}
                setDate={setNbaDate}
                games={nbaGames}
                projections={nbaProjections}
                market={nbaMarket}
                setMarket={setNbaMarket}
                oddsMap={nbaOdds.map}
                settings={nbaSettings}
                setShowStabsOnly={v => setNbaSettings(prev => ({ ...prev, showStabsOnly: v }))}
                onOddsChange={handleNbaOddsChange}
                onLogRows={handleNbaLogRows}
                onSnapshotAllPredictions={handleNbaSnapshotAllPredictions}
                onOpenScreenshotUpload={() => setShowScreenshotModal(true)}
                statusLines={nbaStatusLines}
                bet={bet}
                oddsPanel={nbaOddsPanel}
                onLogBet={handleDeskLogBet}
                cardRows={nbaPreds}
                onAddToTicket={() => setActiveSubTab('parlays')}
                onTriggerGrade={() => nbaAutoGrade(true)}
                onRefreshSlate={handleNbaRefreshSlate}
              />
            )}
            {activeSubTab === 'my-bets' && (
              <MyBetsTab
                bets={personalBets}
                onSaveBet={handleSavePersonalBet}
                onDeleteBet={handleDeletePersonalBet}
                onImportBets={handleImportPersonalBets}
                onBulkUpdateBets={handleBulkUpdatePersonalBets}
                cardRows={allSlateCardRows}
                currentSport="nba"
              />
            )}
            {activeSubTab === 'scoreboard' && (<>
              <BaselineStrip rows={baselineRows} current="NBA" />
              <NbaScoreboard
                rows={nbaLedger}
                gradeStatus={nbaGradeStatus}
                onGrade={() => handleNbaGrade()}
                onGradeDate={handleNbaGrade}
                onClearResults={() => { if (confirm('Clear the entire NBA ledger?')) setNbaLedger([]); }}
                onExportJson={() => {
                  const blob = new Blob([JSON.stringify({ rows: nbaLedger, dailyCard: nbaPreds }, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `nba_ledger_${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                }}
                onImportJson={handleNbaImportLedger}
                predictions={nbaPreds}
                autoStatus={nbaAutoStatus}
                players={nbaState?.players}
                onClearHistory={handleClearNbaHistory}
                inMemoryOnly={nbaInMemoryOnly}
                onExportCurrentCard={handleExportCurrentNbaCard}
              />
            </>)}
            {activeSubTab === 'parlays' && parlayLab('nba', 'NBA', pricedNbaLegs, NBA_PARLAY_MARKETS)}
            {activeSubTab === 'settings' && (
              <div className="space-y-4">
                <BettableSettings cfg={bet} onChange={setBet} />
                <NbaSettingsModal settings={nbaSettings} tuning={nbaTuning} onSettings={setNbaSettings} onTuning={setNbaTuning} />
              </div>
            )}
          </div>
        )}
              </ErrorBoundary>
      </main>

      {/* Universal Screenshot Upload Modal */}
      {showScreenshotModal && (
        <ScreenshotUploadModal
          sport={activeSport.toUpperCase() as 'NFL' | 'MLB' | 'NHL' | 'NBA'}
          onApplyLines={handleApplyScreenshotLines}
          onClose={() => setShowScreenshotModal(false)}
        />
      )}

      {/* NFL Modals */}
      {showNflImportModal && (
        <NflImportModal
          defaultSeason={nflMeta?.season}
          defaultWeek={nflMeta?.week}
          onImport={handleNflImport}
          onOpenScreenshotUpload={() => setShowScreenshotModal(true)}
          onClose={() => setShowNflImportModal(false)}
        />
      )}
      {showNflGradeModal && (
        <NflGradeModal
          defaultSeason={nflMeta?.season}
          defaultWeek={nflMeta ? nflMeta.week - 1 : undefined}
          onCommitGrades={handleNflCommitGrades}
          onClose={() => setShowNflGradeModal(false)}
        />
      )}

      {/* Personal Bet Log Modal */}
      <LogBetModal
        isOpen={isDeskBetModalOpen}
        onClose={() => { setIsDeskBetModalOpen(false); setDeskBetDraft(null); }}
        onSave={handleSavePersonalBet}
        initialBet={deskBetDraft}
      />

      {/* Honest Footer */}
      <footer className="max-w-6xl w-full mx-auto px-4 py-4 border-t border-[#222d3e] text-xs text-[#8b97ac] flex flex-col sm:flex-row items-center justify-between gap-2 mt-8">
        <div>
          <b>Integrity &amp; Anti-Leakage Protocol:</b> Log lines every week. Edge is measured on the scoreboard after grades, not on the projection screen.
        </div>
        <div className="font-mono text-[11px] text-[#556277]">
          Live Auto-Synced Schedule &middot; Universal Screenshot Scanner &middot; Small Bankroll Strict Mode
        </div>
      </footer>
    </div>
    </DisplaySettingsProvider>
  );
}
