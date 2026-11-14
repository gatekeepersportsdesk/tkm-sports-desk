import React, { createContext, useContext, useState } from 'react';
import {
  DisplayConfig,
  DEFAULT_DISPLAY_CONFIG,
  loadDisplayConfig,
  saveDisplayConfig,
  formatStake as fmtStake,
  formatProfit as fmtProfit,
  formatUnits as fmtUnits
} from '../../lib/display_settings';

export interface DisplayContextType {
  displayCfg: DisplayConfig;
  setDisplayCfg: (c: DisplayConfig | ((prev: DisplayConfig) => DisplayConfig)) => void;
  formatStake: (u: number) => string;
  formatProfit: (u: number, showSign?: boolean) => string;
  formatUnits: (u: number, showSign?: boolean) => string;
}

export const DisplaySettingsContext = createContext<DisplayContextType>({
  displayCfg: DEFAULT_DISPLAY_CONFIG,
  setDisplayCfg: () => {},
  formatStake: (u: number) => fmtStake(u, DEFAULT_DISPLAY_CONFIG),
  formatProfit: (u: number, showSign = true) => fmtProfit(u, DEFAULT_DISPLAY_CONFIG, showSign),
  formatUnits: (u: number, showSign = false) => fmtUnits(u, DEFAULT_DISPLAY_CONFIG, showSign)
});

export const DisplaySettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [displayCfg, setDisplayCfgState] = useState<DisplayConfig>(() => loadDisplayConfig());

  const setDisplayCfg = (valOrFn: DisplayConfig | ((prev: DisplayConfig) => DisplayConfig)) => {
    setDisplayCfgState(prev => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      saveDisplayConfig(next);
      return next;
    });
  };

  const contextValue: DisplayContextType = {
    displayCfg,
    setDisplayCfg,
    formatStake: (u: number) => fmtStake(u, displayCfg),
    formatProfit: (u: number, showSign = true) => fmtProfit(u, displayCfg, showSign),
    formatUnits: (u: number, showSign = false) => fmtUnits(u, displayCfg, showSign)
  };

  return (
    <DisplaySettingsContext.Provider value={contextValue}>
      {children}
    </DisplaySettingsContext.Provider>
  );
};

export const useDisplaySettings = () => useContext(DisplaySettingsContext);
