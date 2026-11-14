import React from 'react';
import { ShieldCheck, Camera, RefreshCw } from 'lucide-react';

export type ActiveSport = 'nfl' | 'mlb' | 'nhl' | 'nba';

interface HeaderProps {
  activeSport: ActiveSport;
  setActiveSport: (sport: ActiveSport) => void;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  onOpenScreenshotUpload: () => void;
  onRefreshLiveSchedule: () => void;
  isLoadingSchedule: boolean;
  myBetsCount?: { total: number; pending: number };
}

export const Header: React.FC<HeaderProps> = ({
  activeSport,
  setActiveSport,
  activeSubTab,
  setActiveSubTab,
  onOpenScreenshotUpload,
  onRefreshLiveSchedule,
  isLoadingSchedule,
  myBetsCount
}) => {
  const sportConfigs = {
    nfl: {
      title: "NFL Receptions Props",
      version: "Engine v1.6",
      sub: "WR/TE Only · OLS Dropbacks · Bayesian Shrinkage · Strict -150 Chalk Ceiling",
      tabs: [
        { id: "desk", label: "Prop Desk" },
        { id: "my-bets", label: "My Bets" },
        { id: "scoreboard", label: "History & Calibration" },
        { id: "parlays", label: "Ticket Builder" },
        { id: "settings", label: "Settings" }
      ]
    },
    mlb: {
      title: "MLB 0.5-Hit Desk",
      version: "Engine v5.9",
      sub: "11-Step Bayesian Engine · K% Suppression · Anchor Centering (0.673) · Copula Parlays",
      tabs: [
        { id: "desk", label: "Hit Board" },
        { id: "my-bets", label: "My Bets" },
        { id: "ledger", label: "History & Calibration" },
        { id: "parlays", label: "Ticket Builder" },
        { id: "settings", label: "TUNE Settings" }
      ]
    },
    nba: {
      title: "NBA Player Props Desk",
      version: "nba_v2 · 7 markets",
      sub: "Per-minute shrunk rates · Minutes-aware NB pricing · Opponent + teammate-absence factors · Live injury gate · De-vigged EV",
      tabs: [
        { id: "desk", label: "NBA Desk" },
        { id: "my-bets", label: "My Bets" },
        { id: "scoreboard", label: "History & Calibration" },
        { id: "parlays", label: "Ticket Builder" },
        { id: "settings", label: "Settings" }
      ]
    },
    nhl: {
      title: "NHL Shots + Points Desk",
      version: "sog_v2 · shots + points",
      sub: "Shrunk skater rates · Live opponent factors · NB pricing · De-vigged EV · Box-score graded",
      tabs: [
        { id: "desk", label: "Shots + Points Desk" },
        { id: "my-bets", label: "My Bets" },
        { id: "scoreboard", label: "History & Calibration" },
        { id: "parlays", label: "Ticket Builder" },
        { id: "settings", label: "Settings" }
      ]
    }
  };

  const current = sportConfigs[activeSport];

  return (
    <header className="bg-[#0f1520]/95 border-b border-[#222d3e] sticky top-0 z-40 backdrop-blur-md px-4 py-3">
      <div className="max-w-6xl mx-auto flex flex-col gap-3">
        {/* Top bar with Branding, Sport Selector and Quick Actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-sky-400 uppercase tracking-wider">
                Gatekeep Sports Desk
              </span>
              <span className="bg-[#182232] text-xs px-2 py-0.5 rounded font-mono text-sky-300 border border-[#222d3e]">
                {current.version}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-emerald-950/70 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                Pure Math Verified
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-display mt-0.5 uppercase">
              {current.title}
            </h1>
            <p className="text-xs text-[#8b97ac] hidden sm:block">
              {current.sub}
            </p>
          </div>

          {/* Sport Selector Switcher */}
          <div className="flex items-center gap-1 bg-[#121824] p-1 rounded-xl border border-[#222d3e] self-stretch sm:self-auto">
            <button
              onClick={() => { setActiveSport('nfl'); setActiveSubTab('desk'); }}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-semibold font-display uppercase tracking-wider transition ${
                activeSport === 'nfl'
                  ? 'bg-sky-500 text-slate-950 shadow-sm'
                  : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              🏈 NFL Receptions
            </button>
            <button
              onClick={() => { setActiveSport('mlb'); setActiveSubTab('desk'); }}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-semibold font-display uppercase tracking-wider transition ${
                activeSport === 'mlb'
                  ? 'bg-amber-400 text-amber-950 shadow-sm'
                  : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              ⚾ MLB 0.5-Hits
            </button>
            <button
              onClick={() => { setActiveSport('nhl'); setActiveSubTab('desk'); }}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-semibold font-display uppercase tracking-wider transition ${
                activeSport === 'nhl'
                  ? 'bg-cyan-400 text-slate-950 shadow-sm'
                  : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              🏒 NHL SOG + PTS
            </button>
            <button
              onClick={() => { setActiveSport('nba'); setActiveSubTab('desk'); }}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-semibold font-display uppercase tracking-wider transition ${
                activeSport === 'nba'
                  ? 'bg-orange-400 text-orange-950 shadow-sm'
                  : 'text-[#8b97ac] hover:text-white'
              }`}
            >
              🏀 NBA PROPS
            </button>
          </div>
        </div>

        {/* Navigation Tabs and Global Quick Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-b border-[#222d3e]/80 pb-1">
          <nav className="flex items-center gap-1 overflow-x-auto">
            {current.tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`px-3.5 py-1.5 text-xs sm:text-sm font-semibold uppercase tracking-wider font-display rounded-lg transition whitespace-nowrap flex items-center gap-1.5 ${
                  activeSubTab === tab.id
                    ? 'text-sky-400 bg-[#182232] border border-[#222d3e]'
                    : 'text-[#8b97ac] hover:text-white hover:bg-[#121824]/50'
                }`}
              >
                <span>{tab.label}</span>
                {tab.id === 'my-bets' && (myBetsCount?.total ?? 0) > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                    myBetsCount?.pending ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {myBetsCount?.pending ? `${myBetsCount.pending}p` : myBetsCount?.total}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Quick Action: Screenshot OCR Scanner & Live Game Auto-Sync */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <button
              onClick={onRefreshLiveSchedule}
              disabled={isLoadingSchedule}
              className="px-2.5 py-1.5 bg-[#121824] hover:bg-[#182232] border border-[#222d3e] text-xs font-mono text-[#8b97ac] hover:text-white rounded-lg flex items-center gap-1.5 transition"
              title="Auto-pull today's games for all sports"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isLoadingSchedule ? 'animate-spin' : ''}`} />
              <span className="hidden xs:inline">Today's Games</span>
            </button>

            <button
              onClick={onOpenScreenshotUpload}
              className="px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold font-display uppercase tracking-wider text-xs rounded-lg flex items-center gap-1.5 shadow-sm transition"
              title="Upload screenshot of lines from sportsbooks"
            >
              <Camera className="w-3.5 h-3.5 text-slate-950 stroke-[2.5]" />
              <span>Scan Lines Screenshot</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
