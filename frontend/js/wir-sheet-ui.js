/* ===========================================================
   wir-sheet-ui.js — renders the Weekly Calculation Sheet page:
   INPUTS / CALCULATIONS / OUTPUTS, each cell live and editable,
   backed by WirSheet (HyperFormula). Mirrors the three
   thick-outlined sections of the source workbook.
   =========================================================== */

const WirSheetUI = {
  _loaded: false,

  async ensureLib() {
    if (window.HyperFormula) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hyperformula@2/dist/hyperformula.full.min.js';
      s.onload = resolve; s.onerror = () => reject(new Error('Could not load the calculation engine (offline?).'));
      document.head.appendChild(s);
    });
  },

  fmt(n) { return WirSheet.formatNum(n); },

  async render(host, report) {
    try { await this.ensureLib(); } catch (e) { host.innerHTML = `<div class="card"><div class="empty-state">${UI.escapeHtml(e.message)}</div></div>`; return; }

    const calcDoc = await storage.getCalcSheetByReport(report.id);
    const overrides = (calcDoc && calcDoc.overrides) || {};
    WirSheet.init(overrides, { startDate: report.startDate, weekNo: (report.weekLabel || report.reportNumber || '').toString().replace(/\D/g, '') || undefined });

    const editable = Auth.canEditReport(report);
    host.innerHTML = this._shell();
    const redraw = () => this._fillSections(host, editable);
    redraw();
    WirSheet.onChange(redraw);

    host.querySelectorAll('input[data-addr]').forEach(inp => this._bindCell(inp));

    const saveBtn = host.querySelector('#btnSaveCalcSheet');
    if (saveBtn) saveBtn.onclick = async () => { await this.save(report); UI.toast('Calculation sheet saved. ' + storage.saveNotice(), 'success'); };
  },

  _shell() {
    return `
      <div class="card" id="wirInputsSection"><h3>INPUTS</h3><div class="wir-blocks" id="wirInputBlocks"></div></div>
      <div class="card" id="wirCalcSection"><h3>CALCULATIONS</h3>
        <div class="wir-grid-sm" id="wirConstants"></div>
        <h4 class="mt-16">Steel Calculations (per member)</h4>
        <div class="wir-blocks" id="wirSteelBlocks"></div>
        <div class="text-sm mt-10" id="wirSteelTotal"></div>
        <h4 class="mt-16">Material Track Record</h4>
        <div id="wirMaterialTrack"></div>
      </div>
      <div class="card" id="wirOutputsSection"><h3>OUTPUTS</h3><div id="wirOutputTable"></div></div>
      <div class="flex-end mt-16"><button class="btn primary" id="btnSaveCalcSheet">Save Calculation Sheet</button></div>
    `;
  },

  _cellInput(addr, value, opts = {}) {
    const raw = WirSheet.getRaw(addr);
    const isFormula = typeof raw === 'string' && raw.startsWith('=');
    const cls = isFormula ? 'wir-cell calc' : 'wir-cell input';
    const displayVal = isFormula ? this.fmt(value) : (value ?? '');
    return `<input class="${cls}" data-addr="${addr}" data-formula="${isFormula ? '1' : ''}"
      type="text" value="${UI.escapeHtml(String(displayVal))}" ${(opts.readonly || isFormula) ? 'readonly' : ''}
      title="${isFormula ? UI.escapeHtml(String(raw)) : ''}">`;
  },

  _bindCell(inp) {
    inp.addEventListener('focus', (e) => {
      if (e.target.dataset.formula) return; // formula cells stay read-only inline; power users edit via getRaw/set in console if ever needed
    });
    inp.addEventListener('change', (e) => {
      if (e.target.dataset.formula) return;
      const addr = e.target.getAttribute('data-addr');
      WirSheet.set(addr, e.target.value);
    });
  },

  _fillSections(host, editable) {
    // ---- INPUTS: six day-by-day activity blocks ----
    const ib = host.querySelector('#wirInputBlocks');
    ib.innerHTML = WIR_INPUT_BLOCKS.map(block => {
      const rows = WirSheet.readBlock(block);
      const total = WirSheet.readBlockTotal(block);
      return `<div class="wir-block">
        <div class="wir-block-title">${block.wall} — ${block.activity} <span class="text-muted">(${block.unit})</span></div>
        <table class="wir-table"><thead><tr><th>Day</th>${block.fields.map(f => `<th>${f.label}</th>`).join('')}<th>Quantity</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.day}</td>${block.fields.map(f => `<td>${this._cellInput(f.col + r.row, r[f.key], { readonly: !editable })}</td>`).join('')}<td class="wir-readonly">${this.fmt(r.qty)}</td></tr>`).join('')}
        <tr class="wir-total-row"><td colspan="${block.fields.length + 1}">TOTAL</td><td>${this.fmt(total)}</td></tr>
        </tbody></table>
      </div>`;
    }).join('');
    ib.querySelectorAll('input[data-addr]').forEach(i => this._bindCell(i));

    // ---- CALCULATIONS: constants ----
    const cc = host.querySelector('#wirConstants');
    cc.innerHTML = WIR_CONSTANTS.map(c => `<div class="field mb-0"><label>${c.label}</label>${this._cellInput(c.addr, WirSheet.get(c.addr), { readonly: !editable })}</div>`).join('');
    cc.querySelectorAll('input[data-addr]').forEach(i => this._bindCell(i));

    // ---- CALCULATIONS: steel blocks ----
    const sb = host.querySelector('#wirSteelBlocks');
    sb.innerHTML = WIR_STEEL_BLOCKS.map(block => `<div class="wir-block">
      <div class="wir-block-title">${block.label}</div>
      <div class="grid cols-${Math.min(block.fields.length, 4)}">
        ${block.fields.map(f => `<div class="field mb-0"><label>${f.label}</label>${this._cellInput(f.addr, WirSheet.get(f.addr), { readonly: !editable })}</div>`).join('')}
      </div>
      <div class="wir-readonly mt-6">${block.resultLabel}: <strong>${this.fmt(WirSheet.get(block.resultAddr))}</strong></div>
    </div>`).join('');
    sb.querySelectorAll('input[data-addr]').forEach(i => this._bindCell(i));
    host.querySelector('#wirSteelTotal').innerHTML = `<strong>Total steel per member: ${this.fmt(WirSheet.readSteelTotal())} kg</strong>`;

    // ---- CALCULATIONS: material track record ----
    const mt = host.querySelector('#wirMaterialTrack');
    const track = WirSheet.readMaterialTrack();
    mt.innerHTML = `<table class="wir-table"><thead><tr><th>Material</th><th>Unit</th><th>Qty / Unit Time</th><th>Schedule</th><th>Available/Week</th><th>Utilised/Week</th><th>Remaining</th><th>Status</th></tr></thead>
      <tbody>${track.map(t => `<tr><td>${UI.escapeHtml(String(t.material))}</td><td>${UI.escapeHtml(String(t.unit))}</td>
        <td>${this._cellInput('O' + t.row, t.qtyPerUnitTime, { readonly: !editable })}</td>
        <td><select class="wir-cell input" data-addr="P${t.row}" ${editable ? '' : 'disabled'}>
          <option ${t.schedule === 'Daily' ? 'selected' : ''}>Daily</option><option ${t.schedule === 'Weekly' ? 'selected' : ''}>Weekly</option>
        </select></td>
        <td class="wir-readonly">${this.fmt(t.availablePerWeek)}</td><td class="wir-readonly">${this.fmt(t.utilisedPerWeek)}</td>
        <td class="wir-readonly">${this.fmt(t.remaining)}</td><td class="wir-readonly">${UI.escapeHtml(String(t.status))}</td></tr>`).join('')}</tbody></table>`;
    mt.querySelectorAll('input[data-addr]').forEach(i => this._bindCell(i));
    mt.querySelectorAll('select[data-addr]').forEach(sel => sel.addEventListener('change', e => WirSheet.set(e.target.getAttribute('data-addr'), e.target.value)));

    // ---- OUTPUTS ----
    const ot = host.querySelector('#wirOutputTable');
    const rows = WirSheet.readOutputRows();
    const totals = WirSheet.readOutputTotals();
    ot.innerHTML = `<table class="wir-table"><thead><tr><th>Date</th><th>Report ID</th><th>Bricks (Nos.)</th><th>Cement (Bags)</th><th>Fine Sand (ft³)</th><th>Coarse Agg. (ft³)</th><th>Steel (kg)</th><th>Remarks</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="wir-readonly">${r.date ? UI.formatDateShort(WirSheet.serialToDate(r.date).toISOString().slice(0,10)) : '—'}</td>
        <td class="wir-readonly">${UI.escapeHtml(String(r.reportId ?? ''))}</td>
        <td>${this._cellInput('N' + r.row, r.bricks, { readonly: !editable })}</td>
        <td>${this._cellInput('O' + r.row, r.cement, { readonly: !editable })}</td>
        <td>${this._cellInput('P' + r.row, r.fineSand, { readonly: !editable })}</td>
        <td>${this._cellInput('Q' + r.row, r.coarseAgg, { readonly: !editable })}</td>
        <td>${this._cellInput('R' + r.row, r.steel, { readonly: !editable })}</td>
        <td>${this._cellInput('S' + r.row, r.remarks, { readonly: !editable })}</td>
      </tr>`).join('')}
      <tr class="wir-total-row"><td colspan="2">TOTAL</td><td>${this.fmt(totals.bricks)}</td><td>${this.fmt(totals.cement)}</td><td>${this.fmt(totals.fineSand)}</td><td>${this.fmt(totals.coarseAgg)}</td><td>${this.fmt(totals.steel)}</td><td></td></tr>
      </tbody></table>`;
    ot.querySelectorAll('input[data-addr]').forEach(i => this._bindCell(i));
  },

  /** Persist: (1) the sheet's edited cells for this report, (2) computed OUTPUT rows
   *  fanned out into dailyProgress records so Materials / Cumulative Progress / the
   *  report preview keep working off real numbers instead of manual entry. */
  async save(report) {
    const overrides = WirSheet.diffInputs();
    await storage.saveCalcSheet({ reportId: report.id, overrides });

    const rows = WirSheet.readOutputRows();
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const dateStr = r.date ? WirSheet.serialToDate(r.date).toISOString().slice(0, 10) : '';
      const isFirstDay = idx === 0; // sheet's fixed "site closed" placeholder day
      const activities = [];
      if (!isFirstDay) {
        const blockDay = idx; // rows[1] -> block day index 1 (0-based dayRows[0])
        WIR_INPUT_BLOCKS.forEach(block => {
          const br = WirSheet.readBlock(block)[blockDay - 1];
          if (br && parseFloat(br.qty) > 0) {
            activities.push({
              structuralElement: block.wall, activityCategory: block.activity, activityDescription: block.activity,
              length: br.length ?? '', width: br.width ?? '', height: br.height ?? '', panels: '',
              unit: block.unit, quantity: br.qty, labour: '', equipment: '', remarks: ''
            });
          }
        });
      }
      const rec = {
        id: 'day_' + report.id + '_' + r.row,
        reportId: report.id, date: dateStr, dailyReportId: String(r.reportId ?? ''),
        siteStatus: isFirstDay ? 'Closed' : 'Open', closureReason: isFirstDay ? 'See remarks' : '',
        bricksConsumed: (typeof r.bricks === 'number') ? r.bricks : 0,
        cementBags: (typeof r.cement === 'number') ? r.cement : 0,
        fineSandVol: (typeof r.fineSand === 'number') ? r.fineSand : 0,
        coarseAggVol: (typeof r.coarseAgg === 'number') ? r.coarseAgg : 0,
        steelTons: (typeof r.steel === 'number') ? r.steel / 1000 : 0,
        remarks: String(r.remarks ?? ''), activities
      };
      await storage.saveDailyProgress(rec);
    }
  }
};
