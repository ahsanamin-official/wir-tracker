/* ===========================================================
   calculations.js — number formatting helper only.

   The actual quantity/material calculations used to live here as a
   handful of hardcoded CFT/SFT formulas. They've been replaced by the
   live formula engine in wir-sheet-engine.js (backed by HyperFormula),
   which reproduces every formula from the WIR-17-JH calculation
   workbook cell-for-cell and keeps them editable in the app instead of
   static. See wir-sheet-data.js / wir-sheet-engine.js / wir-sheet-ui.js.
   =========================================================== */

const Calc = {
  formatNum(n) {
    if (n === null || n === undefined || n === '') return '—';
    const num = parseFloat(n);
    if (isNaN(num)) return n;
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
};
