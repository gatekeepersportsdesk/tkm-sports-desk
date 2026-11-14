import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Download,
  Code,
  FileSpreadsheet,
  HelpCircle,
  Copy,
  Check
} from 'lucide-react';
import { PersonalBet, parseBetsFromCsv, parseBetsFromJson } from '../../lib/personal_bets';

interface ImportBetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (bets: PersonalBet[]) => void;
}

const SAMPLE_JSON_BETS = [
  {
    date: '2026-11-06',
    sport: 'nba',
    player: 'Luka Doncic',
    team: 'DAL',
    opp: 'DEN',
    market: 'points',
    side: 'OVER',
    line: 28.5,
    odds: -110,
    stake: 1.5,
    notes: 'Home game pace up'
  },
  {
    date: '2026-11-06',
    sport: 'nhl',
    player: 'Connor McDavid',
    team: 'EDM',
    opp: 'CGY',
    market: 'shots',
    side: 'OVER',
    line: 3.5,
    odds: -125,
    stake: 1.0,
    notes: 'Powerplay minutes'
  }
];

const SAMPLE_CSV_TEXT = `date,player,sport,market,side,line,odds,stake,notes
2026-11-06,Luka Doncic,nba,points,OVER,28.5,-110,1.5,Home game pace up
2026-11-06,Connor McDavid,nhl,shots,OVER,3.5,-125,1.0,Powerplay minutes
2026-11-06,Travis Kelce,nfl,receptions,OVER,5.5,-115,1.0,Red zone target`;

export const ImportBetsModal: React.FC<ImportBetsModalProps> = ({
  isOpen,
  onClose,
  onImport
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [formatTab, setFormatTab] = useState<'json' | 'csv'>('json');
  const [pastedText, setPastedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedBets, setParsedBets] = useState<PersonalBet[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedSample, setCopiedSample] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleProcessText = (text: string, sourceFileName: string = '') => {
    setIsProcessing(true);
    setErrors([]);
    setParsedBets([]);

    const clean = text.replace(/^\uFEFF/, '').trim();
    if (!clean) {
      setErrors([`File "${sourceFileName || 'uploaded'}" is empty (0 bytes). Please check your file content.`]);
      setIsProcessing(false);
      return;
    }

    const isExplicitJson =
      sourceFileName.toLowerCase().endsWith('.json') ||
      clean.startsWith('[') ||
      clean.startsWith('{');

    if (isExplicitJson) {
      const { bets, errors: jsonErrors } = parseBetsFromJson(clean);
      if (bets.length > 0) {
        setParsedBets(bets);
        setErrors(jsonErrors);
      } else {
        // If JSON parse returned 0 bets, check if user accidentally gave CSV with .json extension
        if (!clean.startsWith('{') && !clean.startsWith('[') && clean.includes(',')) {
          const { bets: csvBets, errors: csvErrors } = parseBetsFromCsv(clean);
          if (csvBets.length > 0) {
            setParsedBets(csvBets);
            setErrors(csvErrors);
            setIsProcessing(false);
            return;
          }
        }
        setParsedBets([]);
        setErrors(
          jsonErrors.length > 0
            ? jsonErrors
            : [
                'No valid bets found in JSON. Expected an array of bets (e.g. `[ { "player": "...", "market": "points", "line": 24.5 } ]`) or an object with a "bets", "personal_bets", or date-grouped lists.'
              ]
        );
      }
    } else {
      const { bets, errors: csvErrors } = parseBetsFromCsv(clean);
      if (bets.length > 0) {
        setParsedBets(bets);
        setErrors(csvErrors);
      } else {
        // Try JSON in case CSV didn't match
        const { bets: jsonBets, errors: jsonErrors } = parseBetsFromJson(clean);
        if (jsonBets.length > 0) {
          setParsedBets(jsonBets);
          setErrors(jsonErrors);
        } else {
          setParsedBets([]);
          setErrors(
            csvErrors.length > 0
              ? csvErrors
              : ['Could not parse any bets from the file. Please verify columns or check the Format Guide below.']
          );
        }
      }
    }
    setIsProcessing(false);
  };

  const processFile = async (file: File) => {
    setFileName(file.name);
    setIsProcessing(true);
    setErrors([]);
    setParsedBets([]);

    if (file.name.toLowerCase().endsWith('.json')) {
      setFormatTab('json');
    } else if (file.name.toLowerCase().endsWith('.csv')) {
      setFormatTab('csv');
    }

    if (file.size === 0) {
      setErrors([`File "${file.name}" is completely empty (0 bytes).`]);
      setIsProcessing(false);
      return;
    }

    try {
      let content = '';
      if (typeof file.text === 'function') {
        content = await file.text();
      } else {
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = event => resolve((event.target?.result as string) || '');
          reader.onerror = () => reject(new Error(`Failed to read file "${file.name}".`));
          reader.readAsText(file);
        });
      }
      setPastedText(content);
      handleProcessText(content, file.name);
    } catch (err: any) {
      setErrors([`Failed to read file "${file.name}": ${err?.message || 'Unknown read error'}`]);
      setIsProcessing(false);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleConfirmImport = () => {
    if (parsedBets.length > 0) {
      onImport(parsedBets);
      onClose();
    }
  };

  const downloadSampleJson = () => {
    const jsonStr = JSON.stringify(SAMPLE_JSON_BETS, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_personal_bets.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSampleCsv = () => {
    const blob = new Blob([SAMPLE_CSV_TEXT], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_personal_bets.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copySampleJson = () => {
    navigator.clipboard.writeText(JSON.stringify(SAMPLE_JSON_BETS, null, 2));
    setCopiedSample(true);
    setTimeout(() => setCopiedSample(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#0f1520] border border-[#222d3e] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#222d3e] bg-[#121824]">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-cyan-400" />
            <h3 className="font-display font-bold text-white text-base uppercase tracking-wider">
              Bulk Import Personal Bets (CSV / JSON)
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#8b97ac] hover:text-white hover:bg-[#182232] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-[#222d3e] bg-[#0b0f14] px-4 pt-2">
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 text-xs font-mono font-semibold border-b-2 transition ${
              activeTab === 'upload'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-[#8b97ac] hover:text-white'
            }`}
          >
            File Upload
          </button>
          <button
            onClick={() => setActiveTab('paste')}
            className={`px-4 py-2 text-xs font-mono font-semibold border-b-2 transition ${
              activeTab === 'paste'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-[#8b97ac] hover:text-white'
            }`}
          >
            Paste Text
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'upload' ? (
            <div>
              <label
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition text-center ${
                  isDragging
                    ? 'border-cyan-400 bg-cyan-950/30 ring-2 ring-cyan-500/30'
                    : 'border-[#222d3e] hover:border-cyan-500/50 bg-[#0b0f14]/50'
                }`}
              >
                <FileText className={`w-8 h-8 mb-2 transition ${isDragging ? 'text-cyan-300 scale-110' : 'text-cyan-400'}`} />
                <span className="text-sm font-mono text-white font-semibold">
                  {fileName ? fileName : 'Choose CSV or JSON file'}
                </span>
                <span className="text-xs font-mono text-[#8b97ac] mt-1">
                  Drag &amp; drop or click to browse from computer
                </span>
                <span className="text-[10px] font-mono text-[#556277] mt-1">
                  Supports .json, .csv, and .txt files
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,.txt,application/json,text/csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-mono text-[#8b97ac] uppercase tracking-wider block">
                  Paste CSV or JSON contents:
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const txt = JSON.stringify(SAMPLE_JSON_BETS, null, 2);
                      setPastedText(txt);
                      handleProcessText(txt, 'sample.json');
                    }}
                    className="text-[10px] font-mono text-cyan-400 hover:underline"
                  >
                    + Load Sample JSON
                  </button>
                  <span className="text-[#334155] text-xs">|</span>
                  <button
                    onClick={() => {
                      setPastedText(SAMPLE_CSV_TEXT);
                      handleProcessText(SAMPLE_CSV_TEXT, 'sample.csv');
                    }}
                    className="text-[10px] font-mono text-emerald-400 hover:underline"
                  >
                    + Load Sample CSV
                  </button>
                </div>
              </div>
              <textarea
                rows={7}
                placeholder={`[
  {
    "date": "2026-11-06",
    "player": "Luka Doncic",
    "sport": "nba",
    "market": "points",
    "side": "OVER",
    "line": 28.5,
    "odds": -110,
    "stake": 1.5
  }
]`}
                value={pastedText}
                onChange={e => {
                  setPastedText(e.target.value);
                  handleProcessText(e.target.value);
                }}
                className="w-full bg-[#0b0f14] border border-[#222d3e] rounded-xl p-3 text-xs text-white font-mono placeholder:text-[#556277] outline-none focus:border-cyan-400"
              />
            </div>
          )}

          {/* Validation & Preview Status */}
          {parsedBets.length > 0 && (
            <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Ready to import {parsedBets.length} bet{parsedBets.length === 1 ? '' : 's'}</span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                {parsedBets.slice(0, 5).map((b, idx) => (
                  <div key={idx} className="text-[11px] font-mono text-[#8b97ac] flex items-center justify-between bg-[#0b0f14]/60 px-2 py-1 rounded">
                    <span className="text-white font-semibold">{b.player} ({b.sport.toUpperCase()})</span>
                    <span>{b.side} {b.line} {b.market} ({b.odds > 0 ? `+${b.odds}` : b.odds}) · {b.stake}u</span>
                  </div>
                ))}
                {parsedBets.length > 5 && (
                  <div className="text-[10px] font-mono text-center text-[#556277] pt-1">
                    + {parsedBets.length - 5} more bets
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Explicit Error Box */}
          {errors.length > 0 && (
            <div className="bg-rose-950/50 border border-rose-800/60 rounded-xl p-3 space-y-1.5 animate-fade-in">
              <div className="flex items-center gap-1.5 text-rose-400 text-xs font-mono font-bold">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Import Notice / Validation Errors ({errors.length}):</span>
              </div>
              <ul className="text-[11px] font-mono text-rose-300 list-disc pl-4 space-y-1 max-h-28 overflow-y-auto">
                {errors.slice(0, 5).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
              <p className="text-[10px] font-mono text-rose-400/80 pt-1">
                Tip: See the supported schema below or download a sample file to check your format.
              </p>
            </div>
          )}

          {/* Interactive Format Reference Guide */}
          <div className="bg-[#121824] rounded-xl border border-[#222d3e] overflow-hidden text-xs font-mono">
            <div className="flex items-center justify-between px-3 py-2 bg-[#182232] border-b border-[#222d3e]">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#8b97ac] uppercase font-bold">Format Reference:</span>
                <div className="flex bg-[#0b0f14] rounded-lg p-0.5 border border-[#222d3e]">
                  <button
                    onClick={() => setFormatTab('json')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition flex items-center gap-1 ${
                      formatTab === 'json' ? 'bg-cyan-500 text-slate-950' : 'text-[#8b97ac] hover:text-white'
                    }`}
                  >
                    <Code className="w-3 h-3" />
                    <span>JSON</span>
                  </button>
                  <button
                    onClick={() => setFormatTab('csv')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition flex items-center gap-1 ${
                      formatTab === 'csv' ? 'bg-emerald-500 text-slate-950' : 'text-[#8b97ac] hover:text-white'
                    }`}
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              {formatTab === 'json' ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={copySampleJson}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                    title="Copy sample JSON structure"
                  >
                    {copiedSample ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSample ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={downloadSampleJson}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                    title="Download ready-to-use sample JSON template"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download .json</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={downloadSampleCsv}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  title="Download ready-to-use sample CSV template"
                >
                  <Download className="w-3 h-3" />
                  <span>Download .csv</span>
                </button>
              )}
            </div>

            <div className="p-3 space-y-2">
              {formatTab === 'json' ? (
                <>
                  <p className="text-[11px] text-[#8b97ac]">
                    Accepts a direct array <code className="text-cyan-400">[ ... ]</code>, an object with <code className="text-cyan-400">&quot;bets&quot;</code> or <code className="text-cyan-400">&quot;personal_bets&quot;</code>, or a single bet object:
                  </p>
                  <pre className="text-[10px] bg-[#0b0f14] p-2 rounded-lg text-slate-300 overflow-x-auto border border-[#222d3e]">
{`[
  {
    "date": "2026-11-06",
    "player": "Luka Doncic",
    "sport": "nba",
    "market": "points",
    "side": "OVER",
    "line": 28.5,
    "odds": -110,
    "stake": 1.5,
    "notes": "Starter vs GSW"
  }
]`}
                  </pre>
                  <span className="text-[10px] text-[#556277] block">
                    Supported sports: nba, nhl, nfl, mlb. Odds can be American (-110, +135) or decimal (1.91).
                  </span>
                </>
              ) : (
                <>
                  <span className="text-emerald-400 font-bold block mb-1">Required / Supported CSV Columns:</span>
                  <code className="text-[#8b97ac] text-[11px] block break-all bg-[#0b0f14] p-2 rounded-lg border border-[#222d3e]">
                    date, player, sport, market, side, line, odds, stake, notes
                  </code>
                  <span className="text-[10px] text-[#556277] block">
                    Supports American odds (-110, +135), sport (nba, nhl, nfl, mlb), side (OVER/UNDER), and stake in units.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[#222d3e] bg-[#121824]">
          <span className="text-xs font-mono text-[#8b97ac]">
            {isProcessing ? 'Processing file...' : `${parsedBets.length} valid bets ready`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-mono font-semibold text-[#8b97ac] hover:text-white hover:bg-[#182232] transition"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={parsedBets.length === 0}
              className="px-5 py-2 rounded-xl text-xs font-mono font-bold bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 flex items-center gap-1.5 shadow-md transition cursor-pointer disabled:cursor-not-allowed"
            >
              <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
              Import {parsedBets.length > 0 ? `(${parsedBets.length})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
