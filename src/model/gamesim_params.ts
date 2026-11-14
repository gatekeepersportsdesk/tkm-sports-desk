/**
 * Game-simulator constants and where each came from. NONE of these is a guess:
 *  - shots / points teammate and opponent correlations are MEASURED on MoneyPuck game logs
 *    (scripts/measure_nhl_dependence.py, 848 team-games of 12+ min skaters, walk-forward means, game-block bootstrap se)
 *  - pointsTeamLoading is SOLVED (scripts/calibrate_gamesim.ts) so the simulated teammate points correlation equals the measured one
 *  - NFL teammate correlation is MEASURED (scripts/estimate_nfl_corr.ts, nflverse 2025 wk3-18 + 2026 wk3-6)
 *  - NFL unlisted-target share / catch rate are MEASURED on nflverse 2024-2026 weeks 3+ (RB, QB and other players)
 * Opponent correlations were measured at about zero (shots -0.005 +/- 0.003, points -0.009 +/- 0.005), so the two teams
 * are simulated independently.
 */
export const GAMESIM_PARAMS = {
  nhl: {
    /** latent shots<->points copula parameter; the live app value (fitted) is passed in by the caller */
    rhoShotsPoints: 0.276,
    /** mean pairwise residual correlation of teammates' shots: +0.0181 (se 0.0027) */
    shotsTeammateCorr: 0.0181,
    /** measured teammate points residual correlation target: +0.0962 (se 0.0049) */
    pointsTeammateCorrTarget: 0.0962,
    /** SOLVED loading of the shared team goal-environment factor on points (see scripts/calibrate_gamesim.ts) */
    pointsTeamLoading: 0.373
  },
  nfl: {
    /** WR/TE teammates residual correlation: +0.027 (+/-0.016) */
    teammateCorr: 0.027,
    /** share of a team's targets that go to players the model does not list (RB, QB, others): 0.203 */
    otherTargetsShare: 0.203,
    /** catch rate of those unlisted targets: 0.763 (listed WR/TE: 0.656) */
    otherCatchRate: 0.763
  }
} as const;
