import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MlbLedgerRow } from '../types/mlb';
import { NbaLedgerRow } from '../types/nba';
import { NhlLedgerRow } from '../types/nhl';
import { NflPropSnapshot, NflBetRecord, NflActualRecord } from '../types/nfl';

export interface ReportBetRow {
  id: string;
  date: string;
  player: string;
  team: string;
  opp?: string;
  sport: 'MLB' | 'NBA' | 'NHL' | 'NFL';
  market: string;
  line: number;
  side: 'OVER' | 'UNDER';
  odds: string;
  modelP: number;
  ev?: number | null;
  actual?: string | number | null;
  result: 'HIT' | 'MISS' | 'PUSH' | 'VOID' | 'PENDING';
  units: number;
  qualifying: boolean;
}

export interface DailyPerformanceSummary {
  date: string;
  totalPlays: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  winRate: number; // 0 - 100
  netUnits: number;
  roi: number;     // percentage
}

import { ledgerUnits } from '../model/nhl_engine';

/** Converts MLB ledger rows to generic report rows */
export function mlbLedgerToReportRows(ledger: MlbLedgerRow[]): ReportBetRow[] {
  return ledger
    .filter(x => !x.demo)
    .map(r => {
      const isVoid = !!r.void;
      let result: ReportBetRow['result'] = 'PENDING';
      if (isVoid) result = 'VOID';
      else if (r.hit === 1) result = 'HIT';
      else if (r.hit === 0) result = 'MISS';

      const units = isVoid ? 0 : r.hit === 1 ? (r.dec - 1) : r.hit === 0 ? -1 : 0;
      const oddsStr = r.dec ? (r.dec >= 2.0 ? `+${Math.round((r.dec - 1) * 100)}` : `-${Math.round(100 / (r.dec - 1))}`) : '—';
      const actualStr = r.hit !== null ? (r.hit === 1 ? '1+ H' : '0 H') : '—';
      const side: 'OVER' | 'UNDER' = r.modelLean || 'OVER';

      return {
        id: String(r.id),
        date: r.date,
        player: r.name,
        team: r.team,
        opp: '',
        sport: 'MLB',
        market: 'HITS',
        line: r.line ?? 0.5,
        side,
        odds: oddsStr,
        modelP: r.modelP,
        ev: r.ev,
        actual: actualStr,
        result,
        units,
        qualifying: r.call === 'PLAY'
      };
    });
}

/** Converts NBA ledger rows to generic report rows */
export function nbaLedgerToReportRows(rows: NbaLedgerRow[]): ReportBetRow[] {
  return rows
    .filter(x => !(x as { demo?: boolean }).demo)
    .map(r => {
      let result: ReportBetRow['result'] = 'PENDING';
      if (r.result === 'VOID') result = 'VOID';
      else if (r.result === 'PUSH') result = 'PUSH';
      else if (r.result && r.side && r.result.toLowerCase() === r.side.toLowerCase()) result = 'HIT';
      else if (r.result) result = 'MISS';

      const side: 'OVER' | 'UNDER' = r.side === 'under' ? 'UNDER' : 'OVER';
      const oddsNum = r.side === 'under' ? r.underOdds : r.overOdds;
      const oddsStr = oddsNum != null ? (oddsNum > 0 ? `+${oddsNum}` : `${oddsNum}`) : '—';
      const p = r.side === 'under' ? (1 - r.probOver) : r.probOver;
      const u = ledgerUnits(r);

      return {
        id: r.id,
        date: r.date,
        player: r.playerName,
        team: r.team,
        opp: r.opp ? `@ ${r.opp}` : '',
        sport: 'NBA',
        market: r.market.toUpperCase(),
        line: r.line,
        side,
        odds: oddsStr,
        modelP: p,
        ev: r.ev,
        actual: r.actual != null ? String(r.actual) : '—',
        result,
        units: u ?? (result === 'HIT' ? 0.91 : result === 'MISS' ? -1 : 0),
        qualifying: r.tag !== 'PASS'
      };
    });
}

/** Converts NHL ledger rows to generic report rows */
export function nhlLedgerToReportRows(rows: NhlLedgerRow[]): ReportBetRow[] {
  return rows
    .filter(x => !x.demo)
    .map(r => {
      let result: ReportBetRow['result'] = 'PENDING';
      if (r.result === 'VOID') result = 'VOID';
      else if (r.result === 'PUSH') result = 'PUSH';
      else if (r.result && r.side && r.result.toLowerCase() === r.side.toLowerCase()) result = 'HIT';
      else if (r.result) result = 'MISS';

      const side: 'OVER' | 'UNDER' = r.side === 'under' ? 'UNDER' : 'OVER';
      const oddsNum = r.side === 'under' ? r.underOdds : r.overOdds;
      const oddsStr = oddsNum != null ? (oddsNum > 0 ? `+${oddsNum}` : `${oddsNum}`) : '—';
      const p = r.side === 'under' ? (1 - r.probOver) : r.probOver;
      const u = ledgerUnits(r);

      return {
        id: r.id,
        date: r.date,
        player: r.playerName,
        team: r.team,
        opp: r.opp ? `@ ${r.opp}` : '',
        sport: 'NHL',
        market: r.market.toUpperCase(),
        line: r.line,
        side,
        odds: oddsStr,
        modelP: p,
        ev: r.ev,
        actual: r.actual != null ? String(r.actual) : '—',
        result,
        units: u ?? (result === 'HIT' ? 0.91 : result === 'MISS' ? -1 : 0),
        qualifying: r.tag !== 'PASS'
      };
    });
}

/** Converts NFL snapshots to generic report rows */
export function nflSnapshotsToReportRows(
  snapshots: NflPropSnapshot[],
  actuals: Record<string, NflActualRecord> = {}
): ReportBetRow[] {
  return snapshots
    .filter(s => s.hasMarket !== false && s.cardStatus === 'BET')
    .map(s => {
      const gradeKey = `${s.season}-${s.week}-${s.player.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const act = actuals[gradeKey];
      let result: ReportBetRow['result'] = 'PENDING';
      let units = 0;
      if (act && act.played) {
        if (act.actual === s.line) result = 'PUSH';
        else if (s.lean === 'OVER' && act.actual > s.line) {
          result = 'HIT';
          units = s.oddsOffered > 0 ? s.oddsOffered / 100 : 100 / Math.abs(s.oddsOffered);
        } else if (s.lean === 'UNDER' && act.actual < s.line) {
          result = 'HIT';
          units = s.oddsOffered > 0 ? s.oddsOffered / 100 : 100 / Math.abs(s.oddsOffered);
        } else {
          result = 'MISS';
          units = -1;
        }
      } else if (act && !act.played) {
        result = 'VOID';
        units = 0;
      }

      const p = s.lean === 'OVER' ? s.p_over : s.p_under;
      const oddsStr = s.oddsOffered ? (s.oddsOffered > 0 ? `+${s.oddsOffered}` : `${s.oddsOffered}`) : '—';

      return {
        id: s.id,
        date: s.timestamp ? s.timestamp.slice(0, 10) : `Wk ${s.week}`,
        player: s.player,
        team: s.team,
        opp: '',
        sport: 'NFL',
        market: 'REC',
        line: s.line,
        side: s.lean,
        odds: oddsStr,
        modelP: p,
        actual: act ? String(act.actual) : '—',
        result,
        units,
        qualifying: true
      };
    });
}

/** Groups and aggregates rows by day */
export function aggregateDailyPerformance(rows: ReportBetRow[]): DailyPerformanceSummary[] {
  const byDate = new Map<string, ReportBetRow[]>();
  rows.forEach(r => {
    const list = byDate.get(r.date) || [];
    list.push(r);
    byDate.set(r.date, list);
  });

  const summaries: DailyPerformanceSummary[] = [];
  const sortedDates = Array.from(byDate.keys()).sort().reverse();

  for (const date of sortedDates) {
    const dayRows = byDate.get(date)!;
    const qualifying = dayRows.filter(r => r.qualifying);
    const wins = qualifying.filter(r => r.result === 'HIT').length;
    const losses = qualifying.filter(r => r.result === 'MISS').length;
    const pushes = qualifying.filter(r => r.result === 'PUSH').length;
    const voids = qualifying.filter(r => r.result === 'VOID').length;
    const pending = qualifying.filter(r => r.result === 'PENDING').length;
    const decided = wins + losses;
    const winRate = decided > 0 ? (wins / decided) * 100 : 0;
    const netUnits = qualifying.reduce((acc, r) => acc + (r.result === 'PENDING' ? 0 : r.units), 0);
    const settledPlays = wins + losses + pushes;
    const roi = settledPlays > 0 ? (netUnits / settledPlays) * 100 : 0;

    summaries.push({
      date,
      totalPlays: qualifying.length,
      wins,
      losses,
      pushes,
      voids,
      pending,
      winRate,
      netUnits,
      roi
    });
  }

  return summaries;
}

export interface PdfReportOptions {
  sport: 'MLB' | 'NBA' | 'NHL' | 'NFL';
  title?: string;
  subtitle?: string;
  rows: ReportBetRow[];
  filterQualifyingOnly?: boolean;
}

/**
 * Builds and downloads a formatted PDF report of the daily betting performance using jsPDF and jspdf-autotable.
 */
export function downloadPdfPerformanceReport(opts: PdfReportOptions): void {
  const { sport, rows, filterQualifyingOnly = true } = opts;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  const qualifyingRows = filterQualifyingOnly ? rows.filter(r => r.qualifying) : rows;
  const settledRows = qualifyingRows.filter(r => r.result === 'HIT' || r.result === 'MISS');
  const wins = qualifyingRows.filter(r => r.result === 'HIT').length;
  const losses = qualifyingRows.filter(r => r.result === 'MISS').length;
  const pushes = qualifyingRows.filter(r => r.result === 'PUSH').length;
  const voids = qualifyingRows.filter(r => r.result === 'VOID').length;
  const pending = qualifyingRows.filter(r => r.result === 'PENDING').length;
  const decided = wins + losses;
  const overallWinRate = decided > 0 ? (wins / decided) * 100 : 0;
  const netUnits = qualifyingRows.reduce((acc, r) => acc + (r.result === 'PENDING' ? 0 : r.units), 0);
  const settledCount = wins + losses + pushes;
  const overallRoi = settledCount > 0 ? (netUnits / settledCount) * 100 : 0;

  // Header Banner (Dark Sleek Sports Desk)
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Accent Line
  doc.setFillColor(6, 182, 212); // cyan-500
  doc.rect(0, 27, pageWidth, 1.2, 'F');

  // Header Title
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('GATEKEEP SPORTS DESK', margin, 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(56, 189, 248); // sky-400
  const reportHeading = opts.title || `${sport} BETTING PERFORMANCE & LEDGER REPORT`;
  doc.text(reportHeading.toUpperCase(), margin, 19);

  // Header Right Metadata
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // slate-400
  const generatedAt = `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  doc.text(generatedAt, pageWidth - margin, 12, { align: 'right' });
  doc.setTextColor(52, 211, 153); // emerald-400
  doc.text('INTEGRITY PROTOCOL · OFFICIAL BOXSCORES GRADED', pageWidth - margin, 19, { align: 'right' });

  let currentY = 35;

  // Executive KPI Summary Cards
  const cardWidth = (pageWidth - margin * 2 - 9) / 4;
  const cardHeight = 16;
  const kpis = [
    {
      label: 'SETTLED PLAYS',
      val: `${wins} - ${losses}`,
      sub: `${settledCount} Total Settled (${pushes} Push · ${voids} Void)`,
      color: [15, 23, 42]
    },
    {
      label: 'WIN RATE',
      val: decided > 0 ? `${overallWinRate.toFixed(1)}%` : '—',
      sub: decided > 0 ? `Across ${decided} Decided Bets` : '0 Decided',
      color: overallWinRate >= 50 ? [5, 150, 105] : [225, 29, 72]
    },
    {
      label: 'NET UNITS (1U FLAT)',
      val: `${netUnits >= 0 ? '+' : ''}${netUnits.toFixed(2)} u`,
      sub: netUnits >= 0 ? 'Positive Capital Growth' : 'Current Drawdown',
      color: netUnits >= 0 ? [5, 150, 105] : [225, 29, 72]
    },
    {
      label: 'FLAT ROI',
      val: `${overallRoi >= 0 ? '+' : ''}${overallRoi.toFixed(1)}%`,
      sub: `${pending} Pending Plays`,
      color: overallRoi >= 0 ? [5, 150, 105] : [225, 29, 72]
    }
  ];

  kpis.forEach((kpi, i) => {
    const x = margin + i * (cardWidth + 3);
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.roundedRect(x, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(kpi.label, x + 3, currentY + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.val, x + 3, currentY + 10.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(kpi.sub, x + 3, currentY + 14.5);
  });

  currentY += cardHeight + 8;

  // Section 1: Daily Performance Summary Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('DAILY BETTING PERFORMANCE SUMMARY', margin, currentY);

  currentY += 2;

  const dailySummaries = aggregateDailyPerformance(qualifyingRows);

  const dailyTableHead = [
    ['Date', 'Plays', 'Record (W-L)', 'Push/Void', 'Win %', 'Net Units', 'Day ROI', 'Status']
  ];

  const dailyTableBody = dailySummaries.map(d => {
    const decidedDay = d.wins + d.losses;
    const winRateStr = decidedDay > 0 ? `${d.winRate.toFixed(1)}%` : '—';
    const netUnitsStr = `${d.netUnits >= 0 ? '+' : ''}${d.netUnits.toFixed(2)} u`;
    const roiStr = (d.wins + d.losses + d.pushes) > 0 ? `${d.roi >= 0 ? '+' : ''}${d.roi.toFixed(1)}%` : '—';
    const statusStr = d.pending > 0 && decidedDay === 0 ? 'PENDING' : d.netUnits > 0 ? 'PROFIT' : d.netUnits < 0 ? 'DEFICIT' : 'EVEN';

    return [
      d.date,
      String(d.totalPlays),
      `${d.wins} - ${d.losses}`,
      `${d.pushes} / ${d.voids}${d.pending ? ` (${d.pending} pend)` : ''}`,
      winRateStr,
      netUnitsStr,
      roiStr,
      statusStr
    ];
  });

  // Append Total Row if there are days
  if (dailySummaries.length > 0) {
    dailyTableBody.push([
      'TOTAL ALL SLATES',
      String(qualifyingRows.length),
      `${wins} - ${losses}`,
      `${pushes} / ${voids}${pending ? ` (${pending} pend)` : ''}`,
      decided > 0 ? `${overallWinRate.toFixed(1)}%` : '—',
      `${netUnits >= 0 ? '+' : ''}${netUnits.toFixed(2)} u`,
      settledCount > 0 ? `${overallRoi >= 0 ? '+' : ''}${overallRoi.toFixed(1)}%` : '—',
      netUnits > 0 ? 'PROFIT' : netUnits < 0 ? 'DEFICIT' : 'EVEN'
    ]);
  }

  autoTable(doc, {
    startY: currentY,
    head: dailyTableHead,
    body: dailyTableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center'
    },
    styles: {
      fontSize: 7,
      cellPadding: 2,
      halign: 'center',
      textColor: [51, 65, 85]
    },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold' }
    },
    didParseCell: (data) => {
      // Style total row
      if (data.row.index === dailyTableBody.length - 1 && dailySummaries.length > 0) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249]; // slate-100
      }
      // Style Units and Status columns
      if (data.column.index === 5 || data.column.index === 6) {
        const text = String(data.cell.raw);
        if (text.startsWith('+')) {
          data.cell.styles.textColor = [5, 150, 105]; // emerald-600
        } else if (text.startsWith('-')) {
          data.cell.styles.textColor = [225, 29, 72]; // rose-600
        }
      }
      if (data.column.index === 7) {
        const text = String(data.cell.raw);
        if (text === 'PROFIT') {
          data.cell.styles.textColor = [5, 150, 105];
          data.cell.styles.fontStyle = 'bold';
        } else if (text === 'DEFICIT') {
          data.cell.styles.textColor = [225, 29, 72];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
    margin: { left: margin, right: margin }
  });

  const lastTable = (doc as any).lastAutoTable;
  currentY = (lastTable ? lastTable.finalY : currentY) + 8;

  // Section 2: Graded Plays Detailed Ledger
  if (currentY > pageHeight - 35) {
    doc.addPage();
    currentY = 16;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('DETAILED GRADED PLAYS LEDGER', margin, currentY);

  currentY += 2;

  const detailHead = [
    ['Date', 'Player', 'Matchup', 'Market & Line', 'Pick', 'Odds', 'Model %', 'Actual', 'Result', 'Net Units']
  ];

  const detailBody = qualifyingRows.map(r => {
    const unitsStr = r.result === 'PENDING' ? '—' : `${r.units >= 0 ? '+' : ''}${r.units.toFixed(2)} u`;
    const modelPStr = `${(r.modelP * 100).toFixed(1)}%`;
    const marketLine = `${r.market} ${r.line}`;

    return [
      r.date,
      r.player,
      r.team + (r.opp ? ` ${r.opp}` : ''),
      marketLine,
      r.side,
      String(r.odds),
      modelPStr,
      String(r.actual ?? '—'),
      r.result,
      unitsStr
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: detailHead,
    body: detailBody,
    theme: 'striped',
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center'
    },
    styles: {
      fontSize: 6.8,
      cellPadding: 1.8,
      halign: 'center',
      textColor: [51, 65, 85]
    },
    columnStyles: {
      0: { halign: 'center' },
      1: { halign: 'left', fontStyle: 'bold' },
      2: { halign: 'left' }
    },
    didParseCell: (data) => {
      // Highlight result badges
      if (data.column.index === 8) {
        const res = String(data.cell.raw);
        if (res === 'HIT') {
          data.cell.styles.fillColor = [209, 250, 229]; // emerald-100
          data.cell.styles.textColor = [6, 95, 70]; // emerald-800
          data.cell.styles.fontStyle = 'bold';
        } else if (res === 'MISS') {
          data.cell.styles.fillColor = [254, 226, 226]; // rose-100
          data.cell.styles.textColor = [153, 27, 27]; // rose-800
          data.cell.styles.fontStyle = 'bold';
        } else if (res === 'PUSH' || res === 'VOID') {
          data.cell.styles.fillColor = [254, 243, 199]; // amber-100
          data.cell.styles.textColor = [146, 64, 14]; // amber-800
          data.cell.styles.fontStyle = 'bold';
        }
      }
      // Net units color
      if (data.column.index === 9) {
        const u = String(data.cell.raw);
        if (u.startsWith('+')) {
          data.cell.styles.textColor = [5, 150, 105];
          data.cell.styles.fontStyle = 'bold';
        } else if (u.startsWith('-')) {
          data.cell.styles.textColor = [225, 29, 72];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
    margin: { left: margin, right: margin }
  });

  // Footer for each page
  const totalPages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'Gatekeep Sports Desk · Anti-Leakage Protocol · Graded from official boxscores · EV measured at posted market odds',
      margin,
      pageHeight - 6
    );

    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 6,
      { align: 'right' }
    );
  }

  // Trigger browser download
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `gatekeep_${sport.toLowerCase()}_daily_report_${dateStr}.pdf`;
  doc.save(fileName);
}

/** Convenience export for MLB Ledger */
export function exportPdfMlbReport(ledger: MlbLedgerRow[]): void {
  const rows = mlbLedgerToReportRows(ledger);
  downloadPdfPerformanceReport({
    sport: 'MLB',
    title: 'MLB HIT PROPOSITIONS — DAILY BETTING PERFORMANCE REPORT',
    rows
  });
}

/** Convenience export for NBA Scoreboard / Ledger */
export function exportPdfNbaReport(ledger: NbaLedgerRow[]): void {
  const rows = nbaLedgerToReportRows(ledger);
  downloadPdfPerformanceReport({
    sport: 'NBA',
    title: 'NBA PLAYER PROPS — DAILY BETTING PERFORMANCE REPORT',
    rows
  });
}

/** Convenience export for NHL Scoreboard / Ledger */
export function exportPdfNhlReport(ledger: NhlLedgerRow[]): void {
  const rows = nhlLedgerToReportRows(ledger);
  downloadPdfPerformanceReport({
    sport: 'NHL',
    title: 'NHL SOG & POINTS — DAILY BETTING PERFORMANCE REPORT',
    rows
  });
}

/** Convenience export for NFL Scoreboard / Ledger */
export function exportPdfNflReport(snapshots: NflPropSnapshot[], actuals: Record<string, NflActualRecord> = {}): void {
  const rows = nflSnapshotsToReportRows(snapshots, actuals);
  downloadPdfPerformanceReport({
    sport: 'NFL',
    title: 'NFL RECEPTIONS PROPS — DAILY BETTING PERFORMANCE REPORT',
    rows
  });
}
