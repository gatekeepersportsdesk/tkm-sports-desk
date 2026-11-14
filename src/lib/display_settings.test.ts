import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCurrencyAmount,
  formatProfit,
  formatStake,
  DEFAULT_DISPLAY_CONFIG,
  DisplayConfig
} from './display_settings';

test('display_settings: default config is units with unitValue 1', () => {
  assert.equal(DEFAULT_DISPLAY_CONFIG.mode, 'units');
  assert.equal(DEFAULT_DISPLAY_CONFIG.unitValue, 1);
});

test('display_settings: formatCurrencyAmount formats integers and decimals cleanly', () => {
  assert.equal(formatCurrencyAmount(10), '$10');
  assert.equal(formatCurrencyAmount(0), '$0');
  assert.equal(formatCurrencyAmount(25.5), '$25.50');
  assert.equal(formatCurrencyAmount(9.99), '$9.99');
  assert.equal(formatCurrencyAmount(100.0), '$100');
});

test('display_settings: formatStake in units mode', () => {
  const cfg: DisplayConfig = { mode: 'units', unitValue: 1 };
  assert.equal(formatStake(1, cfg), '1.0u');
  assert.equal(formatStake(2.5, cfg), '2.50u');
  assert.equal(formatStake(0.5, cfg), '0.50u');
});

test('display_settings: formatStake in currency mode with multiplier', () => {
  const cfg: DisplayConfig = { mode: 'currency', unitValue: 20 };
  assert.equal(formatStake(1, cfg), '$20');
  assert.equal(formatStake(2.5, cfg), '$50');
  assert.equal(formatStake(0.5, cfg), '$10');
  assert.equal(formatStake(0.25, cfg), '$5');
});

test('display_settings: formatProfit in units mode handles positive, negative, and zero', () => {
  const cfg: DisplayConfig = { mode: 'units', unitValue: 1 };
  assert.equal(formatProfit(1.25, cfg), '+1.25u');
  assert.equal(formatProfit(-1.0, cfg), '-1.00u');
  assert.equal(formatProfit(0, cfg), '+0.00u');
  assert.equal(formatProfit(1.25, cfg, false), '1.25u');
});

test('display_settings: formatProfit in currency mode scales correctly with sign', () => {
  const cfg: DisplayConfig = { mode: 'currency', unitValue: 25 };
  assert.equal(formatProfit(2.0, cfg), '+$50');
  assert.equal(formatProfit(-1.0, cfg), '-$25');
  assert.equal(formatProfit(0.5, cfg), '+$12.50');
  assert.equal(formatProfit(-0.5, cfg), '-$12.50');
});
