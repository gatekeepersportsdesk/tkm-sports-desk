export type DisplayMode = 'units' | 'currency';

export interface DisplayConfig {
  mode: DisplayMode;
  /** Amount in dollars representing 1 unit (default 1, e.g. 10 means 1u = $10) */
  unitValue: number;
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  mode: 'units',
  unitValue: 1
};

export const DISPLAY_CONFIG_KEY = 'gatekeep_display_config_v1';

export function loadDisplayConfig(): DisplayConfig {
  try {
    const raw = localStorage.getItem(DISPLAY_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.mode === 'units' || parsed.mode === 'currency')) {
        const uv = Number(parsed.unitValue);
        return {
          mode: parsed.mode,
          unitValue: Number.isFinite(uv) && uv > 0 ? uv : 1
        };
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_DISPLAY_CONFIG;
}

export function saveDisplayConfig(cfg: DisplayConfig): void {
  try {
    localStorage.setItem(DISPLAY_CONFIG_KEY, JSON.stringify(cfg));
  } catch { /* ignore */ }
}

/** Formats dollar amounts cleanly, e.g. $10 or $10.50 */
export function formatCurrencyAmount(val: number): string {
  const rounded = Math.round(val * 100) / 100;
  const isInt = Math.abs(rounded - Math.round(rounded)) < 1e-4;
  const absFormatted = isInt ? Math.round(Math.abs(rounded)).toString() : Math.abs(rounded).toFixed(2);
  return `$${absFormatted}`;
}

/**
 * Formats a stake in units or currency based on user display settings.
 * Example: 1.0 -> "1.0u" or "$10" (when 1u = $10)
 */
export function formatStake(u: number, cfg: DisplayConfig): string {
  if (cfg.mode === 'currency') {
    const dollars = u * (cfg.unitValue || 1);
    return formatCurrencyAmount(dollars);
  }
  return Number.isInteger(u) ? `${u.toFixed(1)}u` : `${u.toFixed(2)}u`;
}

/**
 * Formats profit / P&L in units or currency with proper signs.
 * Example: 1.5 -> "+1.50u" or "+$15", -1.0 -> "-1.00u" or "-$10"
 */
export function formatProfit(u: number, cfg: DisplayConfig, showSign = true): string {
  if (cfg.mode === 'currency') {
    const dollars = u * (cfg.unitValue || 1);
    const amountStr = formatCurrencyAmount(dollars);
    if (dollars > 0) return showSign ? `+${amountStr}` : amountStr;
    if (dollars < 0) return `-${amountStr}`;
    return showSign ? `+$0` : `$0`;
  }
  const absStr = Math.abs(u).toFixed(2);
  if (u > 0) return showSign ? `+${absStr}u` : `${absStr}u`;
  if (u < 0) return `-${absStr}u`;
  return showSign ? `+0.00u` : `0.00u`;
}

/**
 * Generic unit display helper.
 */
export function formatUnits(u: number, cfg: DisplayConfig, showSign = false): string {
  return formatProfit(u, cfg, showSign);
}
