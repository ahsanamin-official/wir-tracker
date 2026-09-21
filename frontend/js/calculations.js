/* ===========================================================
   calculations.js — automatic quantity calculations
   =========================================================== */

const PANEL_LENGTH_FT = 36;

const Calc = {
  /** CFT = Length x Width x Height */
  cft(length, width, height) {
    const l = parseFloat(length) || 0, w = parseFloat(width) || 0, h = parseFloat(height) || 0;
    return +(l * w * h).toFixed(2);
  },
  /** SFT = Length x Height (no width) */
  sft(length, height) {
    const l = parseFloat(length) || 0, h = parseFloat(height) || 0;
    return +(l * h).toFixed(2);
  },
  /** Panel length = number of panels x 36 ft */
  panelLength(numPanels) {
    const n = parseFloat(numPanels) || 0;
    return +(n * PANEL_LENGTH_FT).toFixed(2);
  },
  /** Suggest a formula + computed quantity from entered dims, based on unit selected */
  autoQuantity(unit, { length, width, height, panels }) {
    const u = (unit || '').toUpperCase();
    if (u === 'CFT') return this.cft(length, width, height);
    if (u === 'SFT') return this.sft(length, height);
    if (u === 'FT' && panels) return this.panelLength(panels);
    if (u === 'FT') return +((parseFloat(length) || 0)).toFixed(2);
    return null; // manual entry required
  },
  formatNum(n) {
    if (n === null || n === undefined || n === '') return '—';
    const num = parseFloat(n);
    if (isNaN(num)) return n;
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
};
