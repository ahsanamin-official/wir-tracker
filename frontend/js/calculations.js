/* ===========================================================
   calculations.js — number formatting helper only.

   The actual quantity/material calculations used to live here as a
   handful of hardcoded CFT/SFT formulas. They've been replaced by the
   live formula engine in wir-sheet-engine.js (backed by HyperFormula),
   which reproduces every formula from the WIR-17-JH calculation
   workbook cell-for-cell and keeps them editable in the app instead of
   static. See wir-sheet-data.js / wir-sheet-engine.js / wir-sheet-ui.js.
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
  /** Suggest a computed quantity, using the same logic as the WIR workbook:
   *  Plaster/Pointing = Length x Height (SFT, no width/thickness).
   *  Brickwork = Length x Width x Height (CFT).
   *  Footing/Columns/Plinth Beam (concrete work) = Nos x Length x Width x Height (CFT),
   *  where "Panels" is used as the Nos multiplier.
   *  Anything else falls back to a generic guess from the unit selected. */
  autoQuantity(category, unit, { length, width, height, panels }) {
    const cat = (category || '').toLowerCase();
    if (cat === 'plaster' || cat === 'pointing') return this.sft(length, height);
    if (cat === 'brickwork') return this.cft(length, width, height);
    if (cat === 'footing' || cat === 'columns' || cat === 'plinth beam') {
      const nos = parseFloat(panels) || 1;
      return +(nos * this.cft(length, width, height)).toFixed(2);
    }
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
