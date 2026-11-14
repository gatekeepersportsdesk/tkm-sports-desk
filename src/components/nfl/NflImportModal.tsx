import React, { useState } from 'react';
import { NFL_SAMPLE_IMPORT_TEXT } from '../../data/nfl_seed';

interface NflImportModalProps {
  onImport: (season: number, week: number, book: string, kind: 'pre' | 'open' | 'close', text: string) => void;
  onOpenScreenshotUpload: () => void;
  onClose: () => void;
  defaultSeason?: number;
  defaultWeek?: number;
}

export const NflImportModal: React.FC<NflImportModalProps> = ({
  onImport,
  onOpenScreenshotUpload,
  onClose,
  defaultSeason,
  defaultWeek
}) => {
  const [season, setSeason] = useState(defaultSeason ?? 2026);
  const [week, setWeek] = useState(defaultWeek ?? 1);
  const [book, setBook] = useState("Bet99");
  const [kind, setKind] = useState<'pre' | 'open' | 'close'>("pre");
  const [rawText, setRawText] = useState("");

  const handlePasteSample = () => {
    setRawText(NFL_SAMPLE_IMPORT_TEXT);
  };

  const handleRunPredict = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) {
      alert("Please enter or paste proposition lines.");
      return;
    }
    onImport(season, week, book, kind, rawText);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121824] border border-[#222d3e] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#222d3e] pb-3">
          <div>
            <h2 className="text-xl font-bold font-display uppercase tracking-wide text-white">
              Import Two-Way Proposition Lines
            </h2>
            <p className="text-xs text-[#8b97ac]">
              Paste Bet99 lines or CSV: <code className="text-sky-400">player, line, over_odds, under_odds</code>
            </p>
          </div>
          <button onClick={onClose} className="text-[#8b97ac] hover:text-white text-xl font-bold">
            &times;
          </button>
        </div>

        <form onSubmit={handleRunPredict} className="space-y-4 text-xs font-mono">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[#8b97ac] uppercase text-[11px] mb-1">Season</label>
              <input
                type="number"
                value={season}
                onChange={e => setSeason(parseInt(e.target.value) || 2026)}
                className="w-full bg-[#0f1520] border border-[#222d3e] rounded-lg p-2 text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-[#8b97ac] uppercase text-[11px] mb-1">Week</label>
              <input
                type="number"
                value={week}
                onChange={e => setWeek(parseInt(e.target.value) || 6)}
                className="w-full bg-[#0f1520] border border-[#222d3e] rounded-lg p-2 text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-[#8b97ac] uppercase text-[11px] mb-1">Sportsbook</label>
              <input
                type="text"
                value={book}
                onChange={e => setBook(e.target.value)}
                className="w-full bg-[#0f1520] border border-[#222d3e] rounded-lg p-2 text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-[#8b97ac] uppercase text-[11px] mb-1">Snapshot</label>
              <select
                value={kind}
                onChange={e => setKind(e.target.value as any)}
                className="w-full bg-[#0f1520] border border-[#222d3e] rounded-lg p-2 text-white outline-none focus:border-sky-500"
              >
                <option value="pre">Pre-Kickoff</option>
                <option value="open">Opening</option>
                <option value="close">Closing</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <label className="text-[#8b97ac] uppercase text-[11px]">Lines Input</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenScreenshotUpload();
                  }}
                  className="px-2.5 py-1 bg-[#182232] hover:bg-[#222d3e] text-emerald-400 border border-emerald-600/50 rounded text-xs flex items-center gap-1 font-mono"
                >
                  📷 Upload Screenshot
                </button>
                <button
                  type="button"
                  onClick={handlePasteSample}
                  className="text-xs text-sky-400 hover:underline font-mono"
                >
                  Paste Sample Week 6
                </button>
              </div>
            </div>
            <textarea
              rows={8}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder="Jaxon Smith-Njigba, 6.5, -110, -120&#10;AJ Barner, 2.5, -115, -115&#10;Courtland Sutton, 3.5, +130, -175"
              className="w-full bg-[#0f1520] border border-[#222d3e] rounded-xl p-3 text-xs text-white outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#222d3e]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-[#8b97ac] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold font-display uppercase tracking-wider rounded-xl transition"
            >
              Run Predict &amp; Log Snapshot
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
