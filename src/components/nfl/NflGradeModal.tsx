import React, { useState } from 'react';

interface NflGradeModalProps {
  onCommitGrades: (season: number, week: number, text: string) => void;
  onClose: () => void;
  defaultSeason?: number;
  defaultWeek?: number;
}

export const NflGradeModal: React.FC<NflGradeModalProps> = ({
  onCommitGrades,
  onClose,
  defaultSeason,
  defaultWeek
}) => {
  const [season, setSeason] = useState(defaultSeason ?? 2026);
  const [week, setWeek] = useState(defaultWeek ?? 1);
  const [rawText, setRawText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) {
      alert("Please enter actual realized receptions.");
      return;
    }
    onCommitGrades(season, week, rawText);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121824] border border-[#222d3e] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#222d3e] pb-3">
          <div>
            <h2 className="text-xl font-bold font-display uppercase tracking-wide text-white">
              Grade Realized Game Receptions
            </h2>
            <p className="text-xs text-[#8b97ac]">
              Enter final completed receptions: <code className="text-sky-400">player, actual</code> (type <code className="text-amber-400">DNP</code> for inactive)
            </p>
          </div>
          <button onClick={onClose} className="text-[#8b97ac] hover:text-white text-xl font-bold">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-mono">
          <div className="grid grid-cols-2 gap-3">
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
          </div>

          <div>
            <label className="block text-[#8b97ac] uppercase text-[11px] mb-1">Final Receptions List</label>
            <textarea
              rows={8}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder="Jaxon Smith-Njigba, 12&#10;AJ Barner, 3&#10;Courtland Sutton, 2&#10;Evan Engram, DNP"
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
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-display uppercase tracking-wider rounded-xl transition"
            >
              Commit Grades
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
