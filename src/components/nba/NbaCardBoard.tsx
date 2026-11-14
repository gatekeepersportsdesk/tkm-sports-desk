import React from 'react';
import { NbaPrediction, NBA_MARKETS, NBA_MARKET_UNIT } from '../../types/nba';
import { CardBoard } from '../common/CardBoard';

interface Props {
  rows: NbaPrediction[];
  edge: Set<string>;
  autoStatus: string;
  onGradeDate?: (date?: string) => Promise<void> | void;
  gradeStatus?: string;
  onExport?: () => void;
  onClearHistory?: () => void;
  inMemoryOnly?: boolean;
  onExportCurrentCard?: () => void;
}

const MARKETS = NBA_MARKETS.map(m => ({ id: m as string, label: NBA_MARKET_UNIT[m] }));

/** The automatic NBA daily card (shared board; nothing is logged by hand). */
export const NbaCardBoard: React.FC<Props> = ({
  rows,
  edge,
  autoStatus,
  onGradeDate,
  gradeStatus,
  onExport,
  onClearHistory,
  inMemoryOnly,
  onExportCurrentCard
}) => (
  <CardBoard
    rows={rows}
    edge={edge}
    autoStatus={autoStatus}
    gradeStatus={gradeStatus}
    onGrade={onGradeDate ? () => onGradeDate() : undefined}
    onExport={onExport}
    onClearHistory={onClearHistory}
    inMemoryOnly={inMemoryOnly}
    onExportCurrentCard={onExportCurrentCard}
    sport="NBA"
    markets={MARKETS}
    exposureUnit="min"
    startWord="tip-off"
    sourceWord="the real box score"
    avgNote="this season's per-game average before the game"
  />
);
