import { NflPlayerStats, NflGameContext, NflPropSnapshot } from '../types/nfl';
import { computeStructuralMu, priceNflProp, effectiveAlpha } from '../model/nfl_engine';
import { forcePassIfUnavailable, fuzzyMatchName, AvailabilityStatus, InputsSource } from '../lib/availability';
import { getNflPlayerPrior, shrinkNflReceptions } from '../lib/player_priors';

export const NFL_PLAYERS: Record<string, NflPlayerStats> = {
  // SEA
  "Jaxon Smith-Njigba": { name: "Jaxon Smith-Njigba", pos: "WR", team: "SEA", route_pct: 0.8633, season_tprr: 0.3688, prior_tprr: 0.3919, routes: 135.5, targets: 50, receptions: 36, games: 5, season_avg: 7.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "AJ Barner": { name: "AJ Barner", pos: "TE", team: "SEA", route_pct: 0.9200, season_tprr: 0.1381, prior_tprr: 0.1641, routes: 144.8, targets: 20, receptions: 13, games: 5, season_avg: 2.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Cooper Kupp": { name: "Cooper Kupp", pos: "WR", team: "SEA", route_pct: 0.6833, season_tprr: 0.1398, prior_tprr: 0.1830, routes: 107.3, targets: 15, receptions: 10, games: 4, season_avg: 2.50, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Rashid Shaheed": { name: "Rashid Shaheed", pos: "WR", team: "SEA", route_pct: 0.5067, season_tprr: 0.2203, prior_tprr: 0.2275, routes: 86.3, targets: 19, receptions: 11, games: 5, season_avg: 2.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Tory Horton": { name: "Tory Horton", pos: "WR", team: "SEA", route_pct: 0.1867, season_tprr: 0.1376, prior_tprr: 0.2020, routes: 29.1, targets: 4, receptions: 3, games: 5, season_avg: 0.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // DEN
  "Courtland Sutton": { name: "Courtland Sutton", pos: "WR", team: "DEN", route_pct: 0.8033, season_tprr: 0.1845, prior_tprr: 0.2137, routes: 135.5, targets: 25, receptions: 14, games: 5, season_avg: 2.80, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Evan Engram": { name: "Evan Engram", pos: "TE", team: "DEN", route_pct: 0.5833, season_tprr: 0.1658, prior_tprr: 0.2778, routes: 102.5, targets: 17, receptions: 11, games: 4, season_avg: 2.75, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Jaylen Waddle": { name: "Jaylen Waddle", pos: "WR", team: "DEN", route_pct: 0.6867, season_tprr: 0.2595, prior_tprr: 0.2545, routes: 119.4, targets: 31, receptions: 20, games: 5, season_avg: 4.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Marvin Mims Jr.": { name: "Marvin Mims Jr.", pos: "WR", team: "DEN", route_pct: 0.2133, season_tprr: 0.2143, prior_tprr: 0.2253, routes: 23.3, targets: 5, receptions: 3, games: 5, season_avg: 0.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Troy Franklin": { name: "Troy Franklin", pos: "WR", team: "DEN", route_pct: 0.4300, season_tprr: 0.0946, prior_tprr: 0.2615, routes: 63.5, targets: 6, receptions: 4, games: 5, season_avg: 0.80, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // KC
  "Travis Kelce": { name: "Travis Kelce", pos: "TE", team: "KC", route_pct: 0.8120, season_tprr: 0.2450, prior_tprr: 0.2750, routes: 142.0, targets: 35, receptions: 28, games: 5, season_avg: 5.60, ratio: 1.0120, source: 'seed', asOfWeek: 5 },
  "Xavier Worthy": { name: "Xavier Worthy", pos: "WR", team: "KC", route_pct: 0.7250, season_tprr: 0.1850, prior_tprr: 0.1980, routes: 125.0, targets: 23, receptions: 16, games: 5, season_avg: 3.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Rashee Rice": { name: "Rashee Rice", pos: "WR", team: "KC", route_pct: 0.8800, season_tprr: 0.3200, prior_tprr: 0.3000, routes: 140.0, targets: 45, receptions: 35, games: 5, season_avg: 7.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Noah Gray": { name: "Noah Gray", pos: "TE", team: "KC", route_pct: 0.4200, season_tprr: 0.1400, prior_tprr: 0.1300, routes: 70.0, targets: 10, receptions: 8, games: 5, season_avg: 1.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // LAC
  "Ladd McConkey": { name: "Ladd McConkey", pos: "WR", team: "LAC", route_pct: 0.7840, season_tprr: 0.2610, prior_tprr: 0.2400, routes: 130.0, targets: 34, receptions: 25, games: 5, season_avg: 5.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Quentin Johnston": { name: "Quentin Johnston", pos: "WR", team: "LAC", route_pct: 0.6900, season_tprr: 0.1900, prior_tprr: 0.1800, routes: 110.0, targets: 21, receptions: 14, games: 5, season_avg: 2.80, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Will Dissly": { name: "Will Dissly", pos: "TE", team: "LAC", route_pct: 0.5200, season_tprr: 0.1750, prior_tprr: 0.1550, routes: 80.0, targets: 14, receptions: 11, games: 5, season_avg: 2.20, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Josh Palmer": { name: "Josh Palmer", pos: "WR", team: "LAC", route_pct: 0.6400, season_tprr: 0.1600, prior_tprr: 0.1700, routes: 95.0, targets: 15, receptions: 10, games: 5, season_avg: 2.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // CHI (Monday Night)
  "DJ Moore": { name: "DJ Moore", pos: "WR", team: "CHI", route_pct: 0.8850, season_tprr: 0.2750, prior_tprr: 0.2800, routes: 150.0, targets: 41, receptions: 30, games: 5, season_avg: 6.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Keenan Allen": { name: "Keenan Allen", pos: "WR", team: "CHI", route_pct: 0.7800, season_tprr: 0.2400, prior_tprr: 0.2600, routes: 120.0, targets: 29, receptions: 21, games: 4, season_avg: 5.25, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Rome Odunze": { name: "Rome Odunze", pos: "WR", team: "CHI", route_pct: 0.7500, season_tprr: 0.1950, prior_tprr: 0.2100, routes: 125.0, targets: 24, receptions: 16, games: 5, season_avg: 3.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Cole Kmet": { name: "Cole Kmet", pos: "TE", team: "CHI", route_pct: 0.7100, season_tprr: 0.1800, prior_tprr: 0.1900, routes: 110.0, targets: 20, receptions: 16, games: 5, season_avg: 3.20, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // ATL (Monday Night)
  "Drake London": { name: "Drake London", pos: "WR", team: "ATL", route_pct: 0.8900, season_tprr: 0.2900, prior_tprr: 0.2850, routes: 155.0, targets: 45, receptions: 33, games: 5, season_avg: 6.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Kyle Pitts": { name: "Kyle Pitts", pos: "TE", team: "ATL", route_pct: 0.7400, season_tprr: 0.2100, prior_tprr: 0.2200, routes: 125.0, targets: 26, receptions: 18, games: 5, season_avg: 3.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Darnell Mooney": { name: "Darnell Mooney", pos: "WR", team: "ATL", route_pct: 0.8200, season_tprr: 0.2250, prior_tprr: 0.2100, routes: 135.0, targets: 30, receptions: 20, games: 5, season_avg: 4.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Ray-Ray McCloud": { name: "Ray-Ray McCloud", pos: "WR", team: "ATL", route_pct: 0.5800, season_tprr: 0.1500, prior_tprr: 0.1400, routes: 90.0, targets: 14, receptions: 10, games: 5, season_avg: 2.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // DET
  "Amon-Ra St. Brown": { name: "Amon-Ra St. Brown", pos: "WR", team: "DET", route_pct: 0.8950, season_tprr: 0.3150, prior_tprr: 0.3200, routes: 160.0, targets: 50, receptions: 39, games: 5, season_avg: 7.80, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Sam LaPorta": { name: "Sam LaPorta", pos: "TE", team: "DET", route_pct: 0.7600, season_tprr: 0.2000, prior_tprr: 0.2200, routes: 130.0, targets: 26, receptions: 19, games: 5, season_avg: 3.80, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Jameson Williams": { name: "Jameson Williams", pos: "WR", team: "DET", route_pct: 0.7400, season_tprr: 0.2100, prior_tprr: 0.1900, routes: 120.0, targets: 25, receptions: 17, games: 5, season_avg: 3.40, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // GB
  "Jayden Reed": { name: "Jayden Reed", pos: "WR", team: "GB", route_pct: 0.7500, season_tprr: 0.2700, prior_tprr: 0.2500, routes: 115.0, targets: 31, receptions: 23, games: 5, season_avg: 4.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Romeo Doubs": { name: "Romeo Doubs", pos: "WR", team: "GB", route_pct: 0.8000, season_tprr: 0.2000, prior_tprr: 0.1900, routes: 130.0, targets: 26, receptions: 17, games: 5, season_avg: 3.40, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Tucker Kraft": { name: "Tucker Kraft", pos: "TE", team: "GB", route_pct: 0.7800, season_tprr: 0.2100, prior_tprr: 0.1800, routes: 120.0, targets: 25, receptions: 19, games: 5, season_avg: 3.80, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // SF
  "Jauan Jennings": { name: "Jauan Jennings", pos: "WR", team: "SF", route_pct: 0.8100, season_tprr: 0.2800, prior_tprr: 0.2200, routes: 125.0, targets: 35, receptions: 25, games: 5, season_avg: 5.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "George Kittle": { name: "George Kittle", pos: "TE", team: "SF", route_pct: 0.7700, season_tprr: 0.2500, prior_tprr: 0.2600, routes: 120.0, targets: 30, receptions: 23, games: 5, season_avg: 4.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Ricky Pearsall": { name: "Ricky Pearsall", pos: "WR", team: "SF", route_pct: 0.7000, season_tprr: 0.2100, prior_tprr: 0.2000, routes: 105.0, targets: 22, receptions: 15, games: 4, season_avg: 3.75, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // LAR
  "Puka Nacua": { name: "Puka Nacua", pos: "WR", team: "LAR", route_pct: 0.8900, season_tprr: 0.3200, prior_tprr: 0.3100, routes: 145.0, targets: 46, receptions: 34, games: 5, season_avg: 6.80, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Demarcus Robinson": { name: "Demarcus Robinson", pos: "WR", team: "LAR", route_pct: 0.7600, season_tprr: 0.1700, prior_tprr: 0.1600, routes: 120.0, targets: 20, receptions: 14, games: 5, season_avg: 2.80, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Colby Parkinson": { name: "Colby Parkinson", pos: "TE", team: "LAR", route_pct: 0.6800, season_tprr: 0.1600, prior_tprr: 0.1500, routes: 105.0, targets: 17, receptions: 12, games: 5, season_avg: 2.40, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // BUF
  "Khalil Shakir": { name: "Khalil Shakir", pos: "WR", team: "BUF", route_pct: 0.7200, season_tprr: 0.2400, prior_tprr: 0.2200, routes: 110.0, targets: 26, receptions: 21, games: 5, season_avg: 4.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Dalton Kincaid": { name: "Dalton Kincaid", pos: "TE", team: "BUF", route_pct: 0.7400, season_tprr: 0.2200, prior_tprr: 0.2300, routes: 115.0, targets: 25, receptions: 18, games: 5, season_avg: 3.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Keon Coleman": { name: "Keon Coleman", pos: "WR", team: "BUF", route_pct: 0.7000, season_tprr: 0.1900, prior_tprr: 0.1800, routes: 105.0, targets: 20, receptions: 13, games: 5, season_avg: 2.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // MIA
  "Tyreek Hill": { name: "Tyreek Hill", pos: "WR", team: "MIA", route_pct: 0.8400, season_tprr: 0.3100, prior_tprr: 0.3300, routes: 130.0, targets: 40, receptions: 29, games: 5, season_avg: 5.80, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Jonnu Smith": { name: "Jonnu Smith", pos: "TE", team: "MIA", route_pct: 0.6000, season_tprr: 0.2100, prior_tprr: 0.2000, routes: 85.0, targets: 18, receptions: 14, games: 5, season_avg: 2.80, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // DAL
  "CeeDee Lamb": { name: "CeeDee Lamb", pos: "WR", team: "DAL", route_pct: 0.8900, season_tprr: 0.3200, prior_tprr: 0.3300, routes: 155.0, targets: 50, receptions: 37, games: 5, season_avg: 7.40, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Jake Ferguson": { name: "Jake Ferguson", pos: "TE", team: "DAL", route_pct: 0.7800, season_tprr: 0.2300, prior_tprr: 0.2400, routes: 125.0, targets: 29, receptions: 22, games: 5, season_avg: 4.40, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Jalen Tolbert": { name: "Jalen Tolbert", pos: "WR", team: "DAL", route_pct: 0.7600, season_tprr: 0.1900, prior_tprr: 0.1700, routes: 120.0, targets: 23, receptions: 16, games: 5, season_avg: 3.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // PHI
  "A.J. Brown": { name: "A.J. Brown", pos: "WR", team: "PHI", route_pct: 0.8800, season_tprr: 0.3100, prior_tprr: 0.3200, routes: 130.0, targets: 40, receptions: 29, games: 4, season_avg: 7.25, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "DeVonta Smith": { name: "DeVonta Smith", pos: "WR", team: "PHI", route_pct: 0.8500, season_tprr: 0.2500, prior_tprr: 0.2600, routes: 135.0, targets: 34, receptions: 25, games: 5, season_avg: 5.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Dallas Goedert": { name: "Dallas Goedert", pos: "TE", team: "PHI", route_pct: 0.7500, season_tprr: 0.2200, prior_tprr: 0.2300, routes: 115.0, targets: 25, receptions: 20, games: 5, season_avg: 4.00, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // BAL
  "Zay Flowers": { name: "Zay Flowers", pos: "WR", team: "BAL", route_pct: 0.8500, season_tprr: 0.2900, prior_tprr: 0.2700, routes: 135.0, targets: 39, receptions: 28, games: 5, season_avg: 5.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Mark Andrews": { name: "Mark Andrews", pos: "TE", team: "BAL", route_pct: 0.6500, season_tprr: 0.2000, prior_tprr: 0.2500, routes: 95.0, targets: 19, receptions: 14, games: 5, season_avg: 2.80, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Isaiah Likely": { name: "Isaiah Likely", pos: "TE", team: "BAL", route_pct: 0.5800, season_tprr: 0.2100, prior_tprr: 0.2000, routes: 85.0, targets: 18, receptions: 13, games: 5, season_avg: 2.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // WSH
  "Terry McLaurin": { name: "Terry McLaurin", pos: "WR", team: "WSH", route_pct: 0.8800, season_tprr: 0.2800, prior_tprr: 0.2700, routes: 140.0, targets: 39, receptions: 27, games: 5, season_avg: 5.40, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Zach Ertz": { name: "Zach Ertz", pos: "TE", team: "WSH", route_pct: 0.7200, season_tprr: 0.2000, prior_tprr: 0.2100, routes: 110.0, targets: 22, receptions: 17, games: 5, season_avg: 3.40, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Noah Brown": { name: "Noah Brown", pos: "WR", team: "WSH", route_pct: 0.6500, season_tprr: 0.1700, prior_tprr: 0.1600, routes: 95.0, targets: 16, receptions: 11, games: 5, season_avg: 2.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Luke McCaffrey": { name: "Luke McCaffrey", pos: "WR", team: "WSH", route_pct: 0.5500, season_tprr: 0.1600, prior_tprr: 0.1500, routes: 80.0, targets: 13, receptions: 9, games: 5, season_avg: 1.80, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // HOU
  "Stefon Diggs": { name: "Stefon Diggs", pos: "WR", team: "HOU", route_pct: 0.8500, season_tprr: 0.2800, prior_tprr: 0.2900, routes: 145.0, targets: 41, receptions: 31, games: 5, season_avg: 6.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Nico Collins": { name: "Nico Collins", pos: "WR", team: "HOU", route_pct: 0.8800, season_tprr: 0.3200, prior_tprr: 0.3000, routes: 135.0, targets: 43, receptions: 32, games: 5, season_avg: 6.40, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Tank Dell": { name: "Tank Dell", pos: "WR", team: "HOU", route_pct: 0.7400, season_tprr: 0.2100, prior_tprr: 0.2200, routes: 115.0, targets: 24, receptions: 16, games: 5, season_avg: 3.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Dalton Schultz": { name: "Dalton Schultz", pos: "TE", team: "HOU", route_pct: 0.7100, season_tprr: 0.1800, prior_tprr: 0.1900, routes: 110.0, targets: 20, receptions: 15, games: 5, season_avg: 3.00, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // JAX
  "Brian Thomas Jr.": { name: "Brian Thomas Jr.", pos: "WR", team: "JAX", route_pct: 0.8600, season_tprr: 0.2700, prior_tprr: 0.2500, routes: 140.0, targets: 38, receptions: 26, games: 5, season_avg: 5.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Christian Kirk": { name: "Christian Kirk", pos: "WR", team: "JAX", route_pct: 0.8000, season_tprr: 0.2400, prior_tprr: 0.2500, routes: 130.0, targets: 31, receptions: 22, games: 5, season_avg: 4.40, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Gabe Davis": { name: "Gabe Davis", pos: "WR", team: "JAX", route_pct: 0.7200, season_tprr: 0.1800, prior_tprr: 0.1700, routes: 115.0, targets: 21, receptions: 13, games: 5, season_avg: 2.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Brenton Strange": { name: "Brenton Strange", pos: "TE", team: "JAX", route_pct: 0.6500, season_tprr: 0.1900, prior_tprr: 0.1800, routes: 95.0, targets: 18, receptions: 13, games: 5, season_avg: 2.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // NYJ
  "Garrett Wilson": { name: "Garrett Wilson", pos: "WR", team: "NYJ", route_pct: 0.9200, season_tprr: 0.3100, prior_tprr: 0.3000, routes: 165.0, targets: 51, receptions: 36, games: 5, season_avg: 7.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Davante Adams": { name: "Davante Adams", pos: "WR", team: "NYJ", route_pct: 0.8900, season_tprr: 0.3000, prior_tprr: 0.3100, routes: 155.0, targets: 47, receptions: 33, games: 5, season_avg: 6.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Tyler Conklin": { name: "Tyler Conklin", pos: "TE", team: "NYJ", route_pct: 0.7300, season_tprr: 0.1800, prior_tprr: 0.1900, routes: 120.0, targets: 22, receptions: 16, games: 5, season_avg: 3.20, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // MIN
  "Justin Jefferson": { name: "Justin Jefferson", pos: "WR", team: "MIN", route_pct: 0.9200, season_tprr: 0.3400, prior_tprr: 0.3300, routes: 155.0, targets: 53, receptions: 38, games: 5, season_avg: 7.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Jordan Addison": { name: "Jordan Addison", pos: "WR", team: "MIN", route_pct: 0.7900, season_tprr: 0.2200, prior_tprr: 0.2100, routes: 120.0, targets: 26, receptions: 17, games: 4, season_avg: 4.25, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "T.J. Hockenson": { name: "T.J. Hockenson", pos: "TE", team: "MIN", route_pct: 0.7600, season_tprr: 0.2300, prior_tprr: 0.2400, routes: 115.0, targets: 26, receptions: 19, games: 5, season_avg: 3.80, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // ARI
  "Marvin Harrison Jr.": { name: "Marvin Harrison Jr.", pos: "WR", team: "ARI", route_pct: 0.8800, season_tprr: 0.2800, prior_tprr: 0.2700, routes: 145.0, targets: 41, receptions: 28, games: 5, season_avg: 5.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Trey McBride": { name: "Trey McBride", pos: "TE", team: "ARI", route_pct: 0.8500, season_tprr: 0.2700, prior_tprr: 0.2600, routes: 135.0, targets: 36, receptions: 28, games: 5, season_avg: 5.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },
  "Michael Wilson": { name: "Michael Wilson", pos: "WR", team: "ARI", route_pct: 0.7500, season_tprr: 0.1900, prior_tprr: 0.1800, routes: 120.0, targets: 23, receptions: 15, games: 5, season_avg: 3.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // TB
  "Mike Evans": { name: "Mike Evans", pos: "WR", team: "TB", route_pct: 0.8600, season_tprr: 0.2700, prior_tprr: 0.2800, routes: 140.0, targets: 38, receptions: 26, games: 5, season_avg: 5.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Chris Godwin": { name: "Chris Godwin", pos: "WR", team: "TB", route_pct: 0.8700, season_tprr: 0.2900, prior_tprr: 0.2800, routes: 145.0, targets: 42, receptions: 32, games: 5, season_avg: 6.40, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Cade Otton": { name: "Cade Otton", pos: "TE", team: "TB", route_pct: 0.8000, season_tprr: 0.1900, prior_tprr: 0.1800, routes: 130.0, targets: 25, receptions: 19, games: 5, season_avg: 3.80, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // PIT
  "George Pickens": { name: "George Pickens", pos: "WR", team: "PIT", route_pct: 0.8500, season_tprr: 0.2800, prior_tprr: 0.2700, routes: 135.0, targets: 38, receptions: 25, games: 5, season_avg: 5.00, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Pat Freiermuth": { name: "Pat Freiermuth", pos: "TE", team: "PIT", route_pct: 0.7200, season_tprr: 0.2000, prior_tprr: 0.2100, routes: 110.0, targets: 22, receptions: 17, games: 5, season_avg: 3.40, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // IND
  "Michael Pittman Jr.": { name: "Michael Pittman Jr.", pos: "WR", team: "IND", route_pct: 0.8800, season_tprr: 0.2800, prior_tprr: 0.2900, routes: 140.0, targets: 39, receptions: 28, games: 5, season_avg: 5.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Josh Downs": { name: "Josh Downs", pos: "WR", team: "IND", route_pct: 0.7600, season_tprr: 0.2700, prior_tprr: 0.2500, routes: 110.0, targets: 30, receptions: 23, games: 4, season_avg: 5.75, ratio: 0.9915, source: 'seed', asOfWeek: 5 },

  // LV
  "Jakobi Meyers": { name: "Jakobi Meyers", pos: "WR", team: "LV", route_pct: 0.8700, season_tprr: 0.2600, prior_tprr: 0.2500, routes: 135.0, targets: 35, receptions: 26, games: 5, season_avg: 5.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Brock Bowers": { name: "Brock Bowers", pos: "TE", team: "LV", route_pct: 0.8300, season_tprr: 0.2800, prior_tprr: 0.2700, routes: 130.0, targets: 36, receptions: 28, games: 5, season_avg: 5.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // NO
  "Chris Olave": { name: "Chris Olave", pos: "WR", team: "NO", route_pct: 0.8600, season_tprr: 0.2900, prior_tprr: 0.2900, routes: 135.0, targets: 39, receptions: 28, games: 5, season_avg: 5.60, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Juwan Johnson": { name: "Juwan Johnson", pos: "TE", team: "NO", route_pct: 0.6800, season_tprr: 0.1800, prior_tprr: 0.1700, routes: 100.0, targets: 18, receptions: 13, games: 5, season_avg: 2.60, ratio: 1.0283, source: 'seed', asOfWeek: 5 },

  // NYG
  "Malik Nabers": { name: "Malik Nabers", pos: "WR", team: "NYG", route_pct: 0.9100, season_tprr: 0.3500, prior_tprr: 0.3400, routes: 145.0, targets: 51, receptions: 35, games: 4, season_avg: 8.75, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Wan'Dale Robinson": { name: "Wan'Dale Robinson", pos: "WR", team: "NYG", route_pct: 0.7800, season_tprr: 0.2800, prior_tprr: 0.2600, routes: 125.0, targets: 35, receptions: 26, games: 5, season_avg: 5.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 },
  "Darius Slayton": { name: "Darius Slayton", pos: "WR", team: "NYG", route_pct: 0.7500, season_tprr: 0.2000, prior_tprr: 0.1900, routes: 120.0, targets: 24, receptions: 16, games: 5, season_avg: 3.20, ratio: 0.9915, source: 'seed', asOfWeek: 5 }
};

export const NFL_GAMES: Record<string, NflGameContext> = {
  "2026-6-CHI@ATL": {
    id: "2026-6-CHI@ATL",
    season: 2026,
    week: 6,
    day: "Monday",
    kickoff: "Mon 8:15 PM EDT",
    away: "CHI",
    home: "ATL",
    spread_home: -2.5,
    implied_total_home: 24.5,
    spread_away: 2.5,
    implied_total_away: 22.0,
    hasLine: false
  },
  "2026-6-SEA@DEN": {
    id: "2026-6-SEA@DEN",
    season: 2026,
    week: 6,
    day: "Thursday",
    kickoff: "Thu 8:15 PM EDT",
    away: "SEA",
    home: "DEN",
    spread_home: 3.0,
    implied_total_home: 19.25,
    spread_away: -3.0,
    implied_total_away: 22.25,
    hasLine: false
  },
  "2026-6-KC@LAC": {
    id: "2026-6-KC@LAC",
    season: 2026,
    week: 6,
    day: "Sunday",
    kickoff: "Sun 4:25 PM EDT",
    away: "KC",
    home: "LAC",
    spread_home: 2.5,
    implied_total_home: 21.75,
    spread_away: -2.5,
    implied_total_away: 24.25,
    hasLine: false
  },
  "2026-6-DET@GB": {
    id: "2026-6-DET@GB",
    season: 2026,
    week: 6,
    day: "Sunday",
    kickoff: "Sun 1:00 PM EDT",
    away: "DET",
    home: "GB",
    spread_home: 1.5,
    implied_total_home: 23.5,
    spread_away: -1.5,
    implied_total_away: 25.0,
    hasLine: false
  },
  "2026-6-DAL@PHI": {
    id: "2026-6-DAL@PHI",
    season: 2026,
    week: 6,
    day: "Sunday",
    kickoff: "Sun 4:25 PM EDT",
    away: "DAL",
    home: "PHI",
    spread_home: -3.5,
    implied_total_home: 26.0,
    spread_away: 3.5,
    implied_total_away: 22.5,
    hasLine: false
  },
  "2026-6-BAL@CIN": {
    id: "2026-6-BAL@CIN",
    season: 2026,
    week: 6,
    day: "Sunday",
    kickoff: "Sun 1:00 PM EDT",
    away: "BAL",
    home: "CIN",
    spread_home: 1.0,
    implied_total_home: 24.0,
    spread_away: -1.0,
    implied_total_away: 25.0,
    hasLine: false
  }
};

/**
 * Only live nflverse inputs are REAL, and only while they are current.
 * Hand-typed seed rows, guesses, and stale rows (more than one week behind the
 * game being priced) are ESTIMATED and cannot qualify as BET.
 */
export function inputsSourceFor(p: NflPlayerStats, gameWeek?: number): InputsSource {
  if (p.source !== 'nflverse') return 'ESTIMATED';
  if (gameWeek != null && p.asOfWeek != null && p.asOfWeek < gameWeek - 1) return 'ESTIMATED';
  return 'REAL';
}

const ROLE_NAME_RE = /^(.*\s)?(WR|TE)\d+$|Top Center|Top Winger|1st Pair|Offensive D|Leadoff|Cleanup/i;

export function getOrCreateNflPlayer(
  name: string,
  team: string = 'FA',
  pos: 'WR' | 'TE' = 'WR'
): { player: NflPlayerStats; inputsSource: InputsSource } {
  if (ROLE_NAME_RE.test(name)) {
    // Refuse to materialize role placeholders as players
    throw new Error(`Refusing placeholder name: ${name}`);
  }
  if (NFL_PLAYERS[name]) {
    return { player: NFL_PLAYERS[name], inputsSource: inputsSourceFor(NFL_PLAYERS[name]) };
  }
  const matchKey = Object.keys(NFL_PLAYERS).find(k => fuzzyMatchName(name, k));
  if (matchKey) {
    return { player: NFL_PLAYERS[matchKey], inputsSource: inputsSourceFor(NFL_PLAYERS[matchKey]) };
  }

  const isTE = pos === 'TE' || name.toLowerCase().includes('kmet') || name.toLowerCase().includes('pitts');
  // Conservative estimate for depth / unknown slip players (never elite fake numbers)
  const created: NflPlayerStats = {
    name,
    pos: isTE ? 'TE' : 'WR',
    team: team || 'FA',
    route_pct: isTE ? 0.35 : 0.40,
    season_tprr: isTE ? 0.12 : 0.14,
    prior_tprr: isTE ? 0.14 : 0.15,
    routes: 45,
    targets: 8,
    receptions: 5,
    games: 4,
    season_avg: 1.25,
    ratio: isTE ? 1.0283 : 0.9915,
    source: 'estimated'
  };
  // NOTE: not cached into NFL_PLAYERS — a guess must never become a "known" player.
  return { player: created, inputsSource: 'ESTIMATED' };
}

export function getPlayersForTeam(team: string): NflPlayerStats[] {
  // REAL NAMES ONLY. Never invent "NE WR1" / "CHI TE1".
  // Live path supplies ESPN WR+TE roster when seed is empty.
  return Object.values(NFL_PLAYERS).filter(p => p.team === team);
}

export function calculateNflSnapshotFromInputs(
  pData: NflPlayerStats,
  game: NflGameContext,
  line: number,
  overOdds: string,
  underOdds: string,
  inputsSource: InputsSource = inputsSourceFor(pData, game.week),
  availability: AvailabilityStatus = 'UNKNOWN'
): NflPropSnapshot {
  const isHome = pData.team === game.home;
  const spread = isHome ? game.spread_home : game.spread_away;
  const impliedTotal = isHome ? game.implied_total_home : game.implied_total_away;

  // Prior shrinkage toward external rates (nfl_player_rates_prior.csv)
  const prior = getNflPlayerPrior(pData.name);
  const shrink = shrinkNflReceptions(pData.season_avg, prior, 8.0);
  const effectiveSeasonAvg = shrink.shrunkAvg;

  const math = computeStructuralMu(
    {
      routes: pData.routes,
      season_tprr: pData.season_tprr,
      prior_tprr: pData.prior_tprr,
      receptions: pData.receptions,
      targets: pData.targets,
      route_pct: pData.route_pct,
      walk_forward_ratio: pData.ratio,
      season_avg_receptions: effectiveSeasonAvg,
      absence_g: pData.absence_g
    },
    { spread, implied_total: impliedTotal }
  );

  const alpha = effectiveAlpha(pData.pos, pData.games);
  const priced = priceNflProp({
    mu: math.finalMu,
    alpha,
    line,
    overOdds,
    underOdds,
    seasonAvg: effectiveSeasonAvg
  });

  // Availability & input quality gate enforcement
  let gated = forcePassIfUnavailable(priced.status, priced.reason, availability, inputsSource, { requireKnownAvailability: true });
  if (game.hasLine === false) {
    gated = { ...gated, status: 'PASS', playAllowed: false, reason: 'No spread/total for this game yet — not priced' };
  }

  return {
    id: `snap_${game.season}_w${game.week}_${pData.name.replace(/\s+/g, '_')}_${line}`,
    season: game.season,
    week: game.week,
    book: "Custom",
    kind: "pre",
    timestamp: new Date().toISOString(),
    player: pData.name,
    pos: pData.pos,
    team: pData.team,
    gameKey: game.id,
    line,
    overOdds,
    underOdds,
    mu: math.finalMu,
    absenceFactor: math.absenceFactor,
    muStructural: math.muStructural,
    muAdapted: math.muAdapted,
    dropbacks: math.dropbacks,
    shrunkTprr: math.shrunkTprr,
    shrunkCatchRate: math.shrunkCatchRate,
    seasonAvg: effectiveSeasonAvg,
    priorSource: shrink.source !== 'none' ? shrink.source : undefined,
    priorWeight: shrink.weight > 0 ? shrink.weight : undefined,
    priorAvg: shrink.weight > 0 ? shrink.priorAvg : undefined,
    priorGames: shrink.weight > 0 ? shrink.priorGames : undefined,
    alpha,
    p_over: priced.p_over,
    p_under: priced.p_under,
    p_push: priced.p_push,
    fair_over: priced.fair_over,
    fair_under: priced.fair_under,
    lean: priced.lean,
    edge: priced.edge,
    ev: priced.ev,
    twoWay: priced.twoWay,
    hasMarket: priced.hasMarket,
    cardStatus: gated.status,
    cardReason: gated.reason,
    oddsOffered: priced.oddsOffered,
    availability,
    inputsSource
  };
}

/**
 * The desk starts EMPTY: the old hand-typed lines were not real market prices.
 * Rows are created from the live slate (no odds) or from imported/typed lines.
 */
export function generateInitialNflSnapshots(): NflPropSnapshot[] {
  return [];
}

export const NFL_SAMPLE_IMPORT_TEXT = `Jaxon Smith-Njigba, 6.5, -110, -120
AJ Barner, 2.5, -115, -115
Cooper Kupp, 2.5, -105, -125
Courtland Sutton, 3.5, +130, -175
Evan Engram, 2.5, -130, -105
Jaylen Waddle, 4.5, +100, -130
DJ Moore, 5.5, -125, +105
Keenan Allen, 4.5, -115, -115
Drake London, 6.5, -135, +110
Kyle Pitts, 3.5, -120, -110
Travis Kelce, 5.5, -120, -110
Ladd McConkey, 4.5, -115, -115`;
