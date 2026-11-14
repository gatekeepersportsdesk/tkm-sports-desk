import React, { useState, useRef, useEffect } from 'react';
import { inferNbaMarket } from '../../lib/nba_board';
import { cleanOcrLines, sportHint, parsePastedLinesText, ExtractedPropLine } from '../../lib/ocr_clean';
import { Camera, Upload, CheckCircle2, AlertCircle, RefreshCw, X, Sparkles, Plus, Trash2, Image as ImageIcon, FileText, Layers } from 'lucide-react';

export type { ExtractedPropLine };

interface ScreenshotUploadModalProps {
  sport: 'NFL' | 'MLB' | 'NHL' | 'NBA';
  onApplyLines: (lines: ExtractedPropLine[], targetSport: 'NFL' | 'MLB' | 'NHL' | 'NBA') => void;
  onClose: () => void;
}

export const ScreenshotUploadModal: React.FC<ScreenshotUploadModalProps> = ({
  sport: initialSport,
  onApplyLines,
  onClose
}) => {
  const [activeModalSport, setActiveModalSport] = useState<'NFL' | 'MLB' | 'NHL' | 'NBA'>(initialSport);
  const [imagePreviews, setImagePreviews] = useState<{ name: string; url: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedLines, setExtractedLines] = useState<ExtractedPropLine[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('Upload sportsbook screenshots (select multiple or drag & drop) or paste (Ctrl+V)');
  const [detectedBook, setDetectedBook] = useState<string>('Bet99 / Sportsbook');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detectedSportHint, setDetectedSportHint] = useState<'NFL' | 'MLB' | 'NHL' | 'NBA' | null>(null);
  const [inputMode, setInputMode] = useState<'screenshot' | 'text'>('screenshot');
  const [pastedText, setPastedText] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Listen for clipboard image paste (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length) {
        processImageFiles(pastedFiles);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeModalSport]);

  const processImageFiles = async (files: File[]) => {
    if (!files.length) return;
    setErrorMsg(null);
    setIsProcessing(true);
    setStatusMessage(`Scanning ${files.length} screenshot(s) with AI Vision for ${activeModalSport} props...`);

    const newPreviews: { name: string; url: string }[] = [];
    const allClean: ExtractedPropLine[] = [];
    const detectedBooks: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatusMessage(`Scanning screenshot ${i + 1} of ${files.length} (${file.name})...`);

      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newPreviews.push({ name: file.name, url: base64Data });

        const res = await fetch('/api/ocr-lines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64Data,
            mimeType: file.type || 'image/jpeg',
            sport: activeModalSport
          })
        });

        if (res.ok) {
          const json = await res.json();
          if (json.book) detectedBooks.push(json.book);
          const clean = cleanOcrLines(json);
          allClean.push(...clean);
          const hint = sportHint(json);
          if (hint) setDetectedSportHint(hint);
        }
      } catch (err: any) {
        console.warn(`Failed reading file ${file.name}:`, err);
      }
    }

    setImagePreviews(prev => [...prev, ...newPreviews]);
    if (detectedBooks.length) {
      setDetectedBook(Array.from(new Set(detectedBooks)).join(', '));
    }

    if (allClean.length > 0) {
      // Deduplicate by player + line + prop
      setExtractedLines(prev => {
        const existingKeys = new Set(prev.map(l => `${l.player.toLowerCase()}|${l.line}|${(l.prop || '').toLowerCase()}`));
        const toAdd = allClean.filter(l => !existingKeys.has(`${l.player.toLowerCase()}|${l.line}|${(l.prop || '').toLowerCase()}`));
        return [...prev, ...toAdd];
      });
      setStatusMessage(`Extracted ${allClean.length} line(s) across ${files.length} screenshot(s). Review table below before applying.`);
      setErrorMsg(null);
    } else {
      setErrorMsg(`No usable prop lines were extracted from the ${files.length} uploaded screenshot(s). You can add rows manually below or paste lines in Direct Text Input.`);
      setStatusMessage('Scan completed with 0 lines');
    }
    setIsProcessing(false);
  };

  const handleUpdateLine = (index: number, field: keyof ExtractedPropLine, value: any) => {
    setExtractedLines(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleAddLine = () => {
    setExtractedLines(prev => [
      ...prev,
      {
        player: '',
        line: activeModalSport === 'NFL' ? 4.5 : activeModalSport === 'MLB' ? 0.5 : activeModalSport === 'NBA' ? 18.5 : 2.5,
        overOdds: '',
        underOdds: '',
        team: '',
        prop: activeModalSport === 'NFL' ? 'receptions' : activeModalSport === 'MLB' ? 'hits' : activeModalSport === 'NBA' ? 'pts' : 'shots'
      }
    ]);
  };

  const handleRemoveLine = (index: number) => {
    setExtractedLines(prev => prev.filter((_, i) => i !== index));
  };

  const handleApply = () => {
    if (extractedLines.length === 0) {
      alert('No lines to apply. Upload screenshots, paste text, or add rows by hand first.');
      return;
    }
    const usable = extractedLines.filter(l => l.player.trim() && (l.overOdds.trim() || l.underOdds.trim()));
    if (!usable.length) {
      alert('Every row needs a player and at least one price (over or under odds).');
      return;
    }
    onApplyLines(usable, activeModalSport);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121824] border border-[#222d3e] rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-5 space-y-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#222d3e] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/30">
              <Camera className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-display uppercase tracking-wide text-white flex items-center gap-2">
                Sportsbook Screenshot Scanner (Multi-Image)
              </h2>
              <p className="text-xs text-[#8b97ac]">
                Bet99, Bet365, DraftKings, FanDuel, Bovada &middot; Upload multiple screenshots at once
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#8b97ac] hover:text-white p-1 text-xl font-bold cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Target Sport Switcher */}
        <div className="flex items-center justify-between gap-2 bg-[#0f1520] p-1.5 rounded-xl border border-[#222d3e] flex-wrap">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#8b97ac] pl-2 font-semibold">
            Target Sport:
          </span>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setActiveModalSport('NFL')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold uppercase transition cursor-pointer ${
                activeModalSport === 'NFL' ? 'bg-sky-500 text-slate-950 shadow-sm' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              🏈 NFL Receptions
            </button>
            <button
              onClick={() => setActiveModalSport('MLB')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold uppercase transition cursor-pointer ${
                activeModalSport === 'MLB' ? 'bg-amber-400 text-amber-950 shadow-sm' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              ⚾ MLB Hits
            </button>
            <button
              onClick={() => setActiveModalSport('NHL')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold uppercase transition cursor-pointer ${
                activeModalSport === 'NHL' ? 'bg-cyan-400 text-slate-950 shadow-sm' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              🏒 NHL SOG + PTS
            </button>
            <button
              onClick={() => setActiveModalSport('NBA')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold uppercase transition cursor-pointer ${
                activeModalSport === 'NBA' ? 'bg-orange-400 text-orange-950 shadow-sm' : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              🏀 NBA Props
            </button>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex border-b border-[#222d3e]">
          <button
            type="button"
            onClick={() => setInputMode('screenshot')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold border-b-2 transition cursor-pointer ${
              inputMode === 'screenshot'
                ? 'border-sky-400 text-sky-300 bg-[#182232]/50'
                : 'border-transparent text-[#8b97ac] hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            📷 Multi-Screenshot Upload
          </button>
          <button
            type="button"
            onClick={() => setInputMode('text')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold border-b-2 transition cursor-pointer ${
              inputMode === 'text'
                ? 'border-sky-400 text-sky-300 bg-[#182232]/50'
                : 'border-transparent text-[#8b97ac] hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4" />
            📋 Direct Text Input (Paste Lines)
          </button>
        </div>

        {inputMode === 'text' ? (
          <div className="bg-[#0f1520] border border-[#222d3e] rounded-xl p-4 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#8b97ac]">Paste sportsbook lines (comma, tab, or space-separated):</span>
              <button
                type="button"
                onClick={() => {
                  if (activeModalSport === 'NBA') {
                    setPastedText("Nikola Jokic, 27.5, -115, -115, pts\nJamal Murray, 20.5, -120, -110, pts\nLuka Doncic, 9.5, -130, +100, reb\nShai Gilgeous-Alexander, 6.5, -115, -115, ast");
                  } else if (activeModalSport === 'NHL') {
                    setPastedText("Nathan MacKinnon, 3.5, -135, +105, shots\nConnor McDavid, 3.5, -120, -110, shots\nCale Makar, 2.5, -115, -115, shots\nLeon Draisaitl, 0.5, -170, +135, points");
                  } else if (activeModalSport === 'NFL') {
                    setPastedText("Zay Flowers, 5.5, -115, -115\nMark Andrews, 3.0, -115, -115\nIsaiah Likely, 2.5, -115, -115");
                  } else {
                    setPastedText("Shohei Ohtani, 0.5, -180, +140\nFreddie Freeman, 0.5, -150, +120");
                  }
                }}
                className="text-sky-400 hover:text-white underline text-[11px] cursor-pointer"
              >
                Insert sample {activeModalSport} lines
              </button>
            </div>
            <textarea
              rows={5}
              value={pastedText}
              onChange={e => setPastedText(e.target.value)}
              placeholder={`Format: Player, Line, Over Odds, Under Odds, [Prop]\nExample:\nNikola Jokic, 27.5, -115, -115, pts\nNathan MacKinnon, 3.5, -135, +105, shots`}
              className="w-full bg-[#182232] border border-[#222d3e] rounded-lg p-2.5 text-white font-mono text-xs focus:outline-none focus:border-sky-500 resize-none"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const defaultProp = activeModalSport === 'NHL' ? 'shots' : activeModalSport === 'NBA' ? 'pts' : undefined;
                  const parsed = parsePastedLinesText(pastedText, defaultProp);
                  if (!parsed.length) {
                    setErrorMsg("No valid lines recognized in the pasted text. Check the format: Player, Line, Over, Under.");
                    return;
                  }
                  setErrorMsg(null);
                  setExtractedLines(prev => {
                    const existingKeys = new Set(prev.map(l => `${l.player.toLowerCase()}|${l.line}|${(l.prop || '').toLowerCase()}`));
                    const toAdd = parsed.filter(l => !existingKeys.has(`${l.player.toLowerCase()}|${l.line}|${(l.prop || '').toLowerCase()}`));
                    return [...prev, ...toAdd];
                  });
                  setStatusMessage(`Parsed ${parsed.length} line(s) from direct text input. Review below before applying.`);
                }}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold uppercase tracking-wider text-xs transition cursor-pointer"
              >
                📋 Parse Lines into Table
              </button>
            </div>
          </div>
        ) : (
          /* Multi-file Upload Dropzone */
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
              if (files.length) processImageFiles(files);
            }}
            className="border-2 border-dashed border-[#222d3e] hover:border-sky-500/60 rounded-xl p-6 text-center cursor-pointer transition bg-[#0f1520] group relative"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
                if (files.length) processImageFiles(files);
              }}
            />

            <div className="flex flex-col items-center gap-2">
              <div className="p-3 bg-[#182232] rounded-full group-hover:bg-sky-500/20 transition">
                <Upload className="w-6 h-6 text-sky-400" />
              </div>
              <div className="text-xs text-white font-medium">
                Click to browse screenshots (select multiple) or drag image files here
              </div>
              <div className="text-[11px] text-[#556277] font-mono">
                Select 1 or multiple PNG, JPG, WEBP files at once &middot; Or paste screenshots via <kbd className="px-1.5 py-0.5 rounded bg-[#182232] text-sky-300 border border-[#222d3e]">Ctrl+V</kbd>
              </div>
            </div>
          </div>
        )}

        {/* Multi-image thumbnail strip */}
        {imagePreviews.length > 0 && (
          <div className="p-2.5 bg-[#0f1520] rounded-xl border border-[#222d3e] space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-[#8b97ac]">
              <span>Loaded Screenshots ({imagePreviews.length}) &middot; <strong className="text-white">{detectedBook}</strong></span>
              <button
                type="button"
                onClick={() => { setImagePreviews([]); setExtractedLines([]); }}
                className="text-rose-400 hover:text-rose-300 text-[11px] underline cursor-pointer"
              >
                Clear all images
              </button>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {imagePreviews.map((img, idx) => (
                <div key={idx} className="relative group shrink-0">
                  <img src={img.url} alt={img.name} className="w-20 h-14 object-cover rounded-lg border border-[#222d3e]" />
                  <span className="absolute bottom-1 left-1 bg-black/70 text-[9px] font-mono px-1 rounded text-white truncate max-w-[70px]">
                    #{idx + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="p-3 bg-[#182232] rounded-xl border border-[#222d3e] flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-sky-300">
            {isProcessing ? (
              <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{statusMessage}</span>
          </div>
          {detectedSportHint && detectedSportHint !== activeModalSport && (
            <div className="text-amber-400 flex items-center gap-1 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Image looked like {detectedSportHint} — target is {activeModalSport}</span>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-xl text-rose-300 text-xs font-mono flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Extracted / Reviewable Lines Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-white font-bold flex items-center gap-2">
              Review Extracted Lines ({extractedLines.length})
            </span>
            <button
              onClick={handleAddLine}
              className="px-2.5 py-1 bg-[#182232] hover:bg-[#222d3e] text-sky-300 border border-sky-500/30 rounded-lg text-xs font-mono flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Row
            </button>
          </div>

          <div className="border border-[#222d3e] rounded-xl overflow-x-auto max-h-60 bg-[#0b0f14]">
            <table className="w-full text-xs font-mono text-left">
              <thead className="bg-[#121824] text-[#8b97ac] uppercase text-[10px] border-b border-[#222d3e] sticky top-0">
                <tr>
                  <th className="p-2">Player</th>
                  <th className="p-2 w-20">Line</th>
                  <th className="p-2 w-24">Prop Type</th>
                  <th className="p-2 w-24">Over Odds</th>
                  <th className="p-2 w-24">Under Odds</th>
                  <th className="p-2 w-20">Team</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222d3e]/50">
                {extractedLines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-[#556277]">
                      No lines extracted yet. Upload screenshots or click "Add Row".
                    </td>
                  </tr>
                ) : (
                  extractedLines.map((line, idx) => (
                    <tr key={idx} className="hover:bg-[#182232]/40">
                      <td className="p-1.5">
                        <input
                          type="text"
                          value={line.player}
                          onChange={e => handleUpdateLine(idx, 'player', e.target.value)}
                          placeholder="Player name"
                          className="w-full bg-[#121824] border border-[#222d3e] rounded px-2 py-1 text-white outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="number"
                          step="0.5"
                          value={line.line}
                          onChange={e => handleUpdateLine(idx, 'line', parseFloat(e.target.value) || 0)}
                          className="w-full bg-[#121824] border border-[#222d3e] rounded px-2 py-1 text-white font-bold text-center outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="text"
                          value={line.prop || ''}
                          onChange={e => handleUpdateLine(idx, 'prop', e.target.value)}
                          placeholder={activeModalSport === 'NBA' ? 'pts / reb / ast / 3pm / pra' : 'prop'}
                          className="w-full bg-[#121824] border border-[#222d3e] rounded px-2 py-1 text-white outline-none focus:border-sky-500 text-center"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="text"
                          value={line.overOdds}
                          onChange={e => handleUpdateLine(idx, 'overOdds', e.target.value)}
                          placeholder="-115"
                          className="w-full bg-[#121824] border border-[#222d3e] rounded px-2 py-1 text-white text-center outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="text"
                          value={line.underOdds}
                          onChange={e => handleUpdateLine(idx, 'underOdds', e.target.value)}
                          placeholder="-115"
                          className="w-full bg-[#121824] border border-[#222d3e] rounded px-2 py-1 text-white text-center outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="text"
                          value={line.team || ''}
                          onChange={e => handleUpdateLine(idx, 'team', e.target.value.toUpperCase())}
                          placeholder="Team"
                          className="w-full bg-[#121824] border border-[#222d3e] rounded px-2 py-1 text-white text-center outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="p-1.5 text-center">
                        <button
                          onClick={() => handleRemoveLine(idx)}
                          className="text-[#8b97ac] hover:text-rose-400 p-1 cursor-pointer"
                          title="Delete row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-[#222d3e] pt-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#182232] hover:bg-[#222d3e] text-[#8b97ac] hover:text-white rounded-xl text-xs font-mono transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={extractedLines.length === 0}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-500 text-slate-950 font-bold uppercase tracking-wider text-xs font-mono rounded-xl flex items-center gap-2 transition cursor-pointer shadow-lg shadow-emerald-950/60"
          >
            <Sparkles className="w-4 h-4" />
            Apply Lines to {activeModalSport} Board ({extractedLines.length})
          </button>
        </div>
      </div>
    </div>
  );
};
