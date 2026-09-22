/* ===========================================================
   wir-sheet-engine.js — live formula engine for the weekly
   calculation sheet (replaces the old static calculations.js logic).

   Wraps HyperFormula so every cell from WIR_TEMPLATE_CELLS behaves
   exactly like it does in Excel: input cells can be edited, formula
   cells recalculate live, and the same A1 addresses/formulas from
   the workbook are used verbatim.
   =========================================================== */

const WirSheet = {
  hf: null,
  sheetName: 'WIR',
  sheetId: 0,
  _listeners: [],

  /** Convert 'YYYY-MM-DD' (or ISO datetime) to an Excel/HyperFormula date serial (epoch 1899-12-30). */
  dateToSerial(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + (String(dateStr).length <= 10 ? 'T00:00:00Z' : ''));
    const epoch = Date.UTC(1899, 11, 30);
    return Math.round((d.getTime() - epoch) / 86400000);
  },
  serialToDate(serial) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + serial * 86400000);
  },

  /** Build (or rebuild) the engine from the template, then apply saved overrides
   *  (only the cells the user actually edited — see diffInputs()) and link cells
   *  (start date / week no) driven by the parent weekly report. */
  init(overrides = {}, linked = {}) {
    if (this.hf) { this.hf.destroy(); this.hf = null; }
    const opts = { licenseKey: 'gpl-v3' };
    this.hf = HyperFormula.buildEmpty(opts);
    const sheetName = this.hf.addSheet(this.sheetName);
    this.sheetId = this.hf.getSheetId(sheetName);

    this.hf.suspendEvaluation();
    for (const addr in WIR_TEMPLATE_CELLS) {
      this._setRaw(addr, WIR_TEMPLATE_CELLS[addr]);
    }
    if (linked.startDate) this._setRaw(WIR_LINKED_CELLS.startDate, this.dateToSerial(linked.startDate));
    if (linked.weekNo != null && linked.weekNo !== '') this._setRaw(WIR_LINKED_CELLS.weekNo, +linked.weekNo);
    for (const addr in overrides) {
      if (overrides[addr] !== undefined && overrides[addr] !== null) this._setRaw(addr, overrides[addr]);
    }
    this.hf.resumeEvaluation();
  },

  _addrToCellRef(addr) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    const colLetters = m[1]; const row = parseInt(m[2], 10) - 1;
    let col2 = 0;
    for (let i = 0; i < colLetters.length; i++) col2 = col2 * 26 + (colLetters.charCodeAt(i) - 64);
    return { sheet: this.sheetId, col: col2 - 1, row };
  },

  _setRaw(addr, value) {
    const ref = this._addrToCellRef(addr);
    this.hf.setCellContents(ref, [[value]]);
  },

  /** Set a value the user typed (raw string/number/formula) into a cell and recompute. */
  set(addr, value) {
    let v = value;
    if (typeof v === 'string' && v.trim() !== '' && !v.startsWith('=') && !isNaN(v)) v = parseFloat(v);
    this._setRaw(addr, v === '' ? null : v);
    this._notify();
  },

  /** Computed (displayed) value of a cell. */
  get(addr) {
    const ref = this._addrToCellRef(addr);
    return this.hf.getCellValue(ref);
  },

  /** Raw formula/value as it would appear in the Excel formula bar (for editing).
   *  getCellSerialized() returns the formula string (with leading '=') for formula
   *  cells, and the plain stored value otherwise — exactly what we need here. */
  getRaw(addr) {
    const ref = this._addrToCellRef(addr);
    return this.hf.getCellSerialized(ref);
  },

  formatNum(n) {
    if (n === null || n === undefined || n === '') return '—';
    const num = parseFloat(n);
    if (isNaN(num)) return String(n);
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  },

  onChange(fn) { this._listeners.push(fn); },
  _notify() { this._listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },

  /** Only the cells whose value differs from the un-edited template — this is
   *  all that needs to be persisted per report (the formulas themselves never change). */
  diffInputs() {
    const out = {};
    for (const addr in WIR_TEMPLATE_CELLS) {
      const raw = this.getRaw(addr);
      const tmpl = WIR_TEMPLATE_CELLS[addr];
      const normTmpl = typeof tmpl === 'string' && !tmpl.startsWith('=') ? tmpl : tmpl;
      if (String(raw) !== String(normTmpl) && !(typeof raw === 'string' && raw.startsWith('=') && raw === tmpl)) {
        // skip the two linked cells — those come from the report record, not saved overrides
        if (addr === WIR_LINKED_CELLS.startDate || addr === WIR_LINKED_CELLS.weekNo) continue;
        out[addr] = raw;
      }
    }
    return out;
  },

  /** Read a whole day-block's live rows for rendering. */
  readBlock(block) {
    return block.dayRows.map((row, i) => {
      const rec = { row, day: i + 1 };
      block.fields.forEach(f => { rec[f.key] = this.get(f.col + row); });
      rec.qty = this.get(block.qtyCol + row);
      return rec;
    });
  },
  readBlockTotal(block) { return this.get(block.qtyCol + block.totalRow); },

  readOutputRows() {
    return WIR_OUTPUT_ROWS.map(row => ({
      row,
      date: this.get('L' + row),
      reportId: this.get('M' + row),
      bricks: this.get(WIR_OUTPUT_COLS.bricks + row),
      cement: this.get(WIR_OUTPUT_COLS.cement + row),
      fineSand: this.get(WIR_OUTPUT_COLS.fineSand + row),
      coarseAgg: this.get(WIR_OUTPUT_COLS.coarseAgg + row),
      steel: this.get(WIR_OUTPUT_COLS.steel + row),
      remarks: this.get(WIR_OUTPUT_COLS.remarks + row),
    }));
  },
  readOutputTotals() {
    const r = WIR_OUTPUT_TOTAL_ROW;
    return {
      bricks: this.get(WIR_OUTPUT_COLS.bricks + r), cement: this.get(WIR_OUTPUT_COLS.cement + r),
      fineSand: this.get(WIR_OUTPUT_COLS.fineSand + r), coarseAgg: this.get(WIR_OUTPUT_COLS.coarseAgg + r),
      steel: this.get(WIR_OUTPUT_COLS.steel + r),
    };
  },
  readMaterialTrack() {
    return WIR_MATERIAL_TRACK_ROWS.map(row => ({
      row, material: this.get('M' + row), unit: this.get('N' + row),
      qtyPerUnitTime: this.get('O' + row), schedule: this.get('P' + row),
      availablePerWeek: this.get('Q' + row), utilisedPerWeek: this.get('R' + row),
      remaining: this.get('S' + row), status: this.get('T' + row),
    }));
  },
  readSteelTotal() { return this.get(WIR_STEEL_TOTAL_ADDR); },
};
