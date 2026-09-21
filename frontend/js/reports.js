/* ===========================================================
   reports.js — compiles the 9 WIR sections from stored data.
   Nothing here invents data: every figure comes from
   masterData, baseline, or user-entered daily/weekly/material
   records. If nothing was entered, the section reflects that.
   =========================================================== */

const STRUCTURAL_ROWS = [
  { keys: ['Foundation Excavation'], label: "Foundation Excavation (Depth: 2'-6\", Width: 2'-6\")" },
  { keys: ['PCC'], label: 'Plain Cement Concrete - PCC (1:4:8) (Thickness: 4", Width: 2\'-6")' },
  { keys: ['Coping'], label: 'Plain Cement Concrete - PCC (1:2:4) Coping (Thickness: 2", Width: 9")' },
  { keys: ['Brickwork Below NSL'], label: "Brickwork Below NSL (Depth: 2'-2\" in Foundation Step-footings)" },
  { keys: ['Brickwork Above NSL'], label: "Brickwork Above NSL to Plinth Bottom (Wall-1: 4'-0\" | Wall-2: 4'-6\" | Wall-3: 4'-6\" to 5'-0\")" },
  { keys: ['Plinth Beam'], label: 'Plinth Beam Concrete Pouring (RCC) (Cross-Section: 9"x9" | Reinforcement: 4-#4 Bars, #3 Ties @ 8" O.C)' },
  { keys: ['Superstructure Brickwork', 'Columns'], label: "Superstructure Brickwork Above Plinth W/ Columns (Total Required Height: 5'-6\")" },
  { keys: ['Pointing'], label: "(1:3) Pointing Work (Total Required Height: 10'-6\")" },
  { keys: ['Plaster'], label: "(1:4) Plaster Work (Total Required Height: 5'-6\")" }
];

const ReportEngine = {

  /** Group current-week daily activities into the "Weekly Progress Work" table structure (Sec 5) */
  compileWeeklyProgressWork(dailyRecords) {
    const walls = {};
    dailyRecords.forEach(day => {
      (day.activities || []).forEach(act => {
        const wall = act.structuralElement || 'Other';
        walls[wall] = walls[wall] || {};
        const cat = act.activityCategory || 'Other';
        walls[wall][cat] = walls[wall][cat] || [];
        walls[wall][cat].push(act);
      });
    });
    return walls; // { 'Wall-2': { 'Plaster': [act,...], 'Pointing': [...] }, ... }
  },

  /** Plain-language highlights bullets, derived only from what was entered */
  compileHighlights(dailyRecords) {
    const grouped = this.compileWeeklyProgressWork(dailyRecords);
    const lines = [];
    Object.entries(grouped).forEach(([wall, cats]) => {
      Object.entries(cats).forEach(([cat, acts]) => {
        const totalQty = acts.reduce((s, a) => s + (parseFloat(a.quantity) || 0), 0);
        const unit = acts[0]?.unit || '';
        const panelsTotal = acts.reduce((s, a) => s + (parseFloat(a.panels) || 0), 0);
        let phrase = `${cat} work carried out on ${wall}`;
        if (panelsTotal > 0) phrase += ` covering ${panelsTotal} panel(s)`;
        if (totalQty > 0) phrase += ` totaling ${Calc.formatNum(totalQty)} ${unit}`;
        lines.push(phrase + '.');
      });
    });
    if (lines.length === 0) lines.push('No structural activities were entered for this reporting period.');
    return lines;
  },

  /** Section 7 — Cumulative Project History Work Flow */
  compileCumulativeHistory(dailyRecords, reportNumber) {
    const rows = dailyRecords.map(d => ({
      date: d.date,
      reportId: d.dailyReportId,
      bricks: d.bricksConsumed,
      cement: d.cementBags,
      fineSand: d.fineSandVol,
      coarseAgg: d.coarseAggVol,
      steel: d.steelTons,
      remarks: d.siteStatus === 'Closed' ? `Site Closed${d.closureReason ? ' (' + d.closureReason + ')' : ''}` : this._daySummary(d)
    }));
    const sum = (field) => {
      const vals = dailyRecords.map(d => parseFloat(d[field])).filter(v => !isNaN(v));
      return vals.length ? +(vals.reduce((a, b) => a + b, 0)).toFixed(2) : null;
    };
    const totals = {
      reportId: reportNumber,
      bricks: sum('bricksConsumed'),
      cement: sum('cementBags'),
      fineSand: sum('fineSandVol'),
      coarseAgg: sum('coarseAggVol'),
      steel: sum('steelTons')
    };
    return { rows, totals };
  },

  _daySummary(day) {
    const parts = [];
    (day.activities || []).forEach(a => {
      const panelTxt = a.panels ? `(${a.panels}) Panel(s) ` : '';
      parts.push(`${panelTxt}${a.activityCategory} Work for ${a.structuralElement}`);
    });
    return parts.length ? parts.join(' & ') : (day.remarks || '—');
  },

  /** Section 8 — Weekly Progress Breakdown by Structural Levels */
  compileStructuralBreakdown(currentReportDaily, allPriorDaily) {
    const weeklyByWallCat = this._aggregateByWallCategory(currentReportDaily);
    const cumulativeByWallCat = this._aggregateByWallCategory([...allPriorDaily, ...currentReportDaily]);

    const walls = ['Wall-1', 'Wall-2', 'Wall-3'];
    const rows = STRUCTURAL_ROWS.map(rowDef => {
      const weekly = {}, cumulative = {};
      let weeklyTotal = 0, cumulativeTotal = 0;
      walls.forEach(w => {
        let wq = 0, cq = 0, unit = 'ft';
        rowDef.keys.forEach(k => {
          const wEntry = weeklyByWallCat[w]?.[k];
          const cEntry = cumulativeByWallCat[w]?.[k];
          if (wEntry) { wq += wEntry.qty; unit = wEntry.unit || unit; }
          if (cEntry) { cq += cEntry.qty; unit = cEntry.unit || unit; }
        });
        weekly[w] = wq > 0 ? `${Calc.formatNum(wq)} ${unit}` : '-';
        cumulative[w] = cq > 0 ? `${Calc.formatNum(cq)} ${unit}` : '-';
        weeklyTotal += wq; cumulativeTotal += cq;
      });
      return {
        label: rowDef.label,
        wall1: weekly['Wall-1'], wall2: weekly['Wall-2'], wall3: weekly['Wall-3'],
        weeklyTotal: weeklyTotal > 0 ? Calc.formatNum(weeklyTotal) + ' ft' : '-',
        cumulativeTotal: cumulativeTotal > 0 ? Calc.formatNum(cumulativeTotal) + ' ft' : '-'
      };
    });
    return rows;
  },

  _aggregateByWallCategory(dailyRecords) {
    const out = {};
    dailyRecords.forEach(day => {
      (day.activities || []).forEach(act => {
        const wall = act.structuralElement, cat = act.activityCategory;
        if (!wall || !cat) return;
        out[wall] = out[wall] || {};
        out[wall][cat] = out[wall][cat] || { qty: 0, unit: act.unit };
        const q = parseFloat(act.quantity) || 0;
        out[wall][cat].qty += q;
        out[wall][cat].unit = act.unit || out[wall][cat].unit;
      });
    });
    return out;
  },

  /** Section 9 — Executive Summary & Engineering Conclusion (template populated from real entries) */
  compileExecutiveSummary(report, dailyRecords, materials, masterData) {
    const wallsInvolved = new Set();
    let hasActivity = false;
    dailyRecords.forEach(d => (d.activities || []).forEach(a => { if (a.structuralElement) wallsInvolved.add(a.structuralElement); hasActivity = true; }));
    const wallsTxt = wallsInvolved.size ? Array.from(wallsInvolved).join(', ') : 'no active structural elements this period';

    const materialLine = materials
      ? 'Material inspections for cement, bricks, fine aggregate and coarse aggregate were carried out and logged in the Material Status and Inspection Matrix for this reporting period.'
      : 'No material inspection record was logged for this reporting period.';

    const activityLine = hasActivity
      ? `Construction activity recorded during this reporting period spans ${wallsTxt}, evaluated in standard panel increments of 36'-0" to ensure continuity and geometric precision with the approved design.`
      : 'No construction activity was recorded on site during this reporting period.';

    return [
      `The construction works executed during ${UI.formatDate(report.startDate)} to ${UI.formatDate(report.endDate)} have been monitored and supervised by the engineering team in accordance with the approved drawings and the governing ${masterData.governingStandards}`,
      activityLine,
      materialLine,
      'All work items verified during this reporting period conform to the approved engineering drawings and the technically sanctioned project estimate. This report reflects only the activities, quantities and observations entered for this reporting period; no additional works, tests or approvals are implied beyond what is recorded above.'
    ];
  },

  /** Build full payload for docx/pdf generation and for the live preview */
  async buildReportPayload(reportId) {
    const masterData = await storage.getMasterData();
    const report = await storage.getReport(reportId);
    if (!report) throw new Error('Report not found');
    const dailyRecords = await storage.getDailyProgressByReport(reportId);
    const materials = await storage.getMaterialsByReport(reportId);
    const photos = await storage.getPhotosByReport(reportId);

    const allDaily = await storage.getAllDailyProgress();
    const allReports = await storage.getReports();
    const priorReportIds = allReports.filter(r => (r.startDate < report.startDate) || (r.startDate === report.startDate && r.id !== reportId)).map(r => r.id);
    const priorDaily = allDaily.filter(d => priorReportIds.includes(d.reportId));

    const weeklyProgressWork = this.compileWeeklyProgressWork(dailyRecords);
    const highlights = this.compileHighlights(dailyRecords);
    const cumulativeHistory = this.compileCumulativeHistory(dailyRecords, report.reportNumber);
    const structuralBreakdown = this.compileStructuralBreakdown(dailyRecords, priorDaily);
    const execSummary = this.compileExecutiveSummary(report, dailyRecords, materials, masterData);

    return {
      masterData, report, dailyRecords, materials, photos,
      weeklyProgressWork, highlights, cumulativeHistory, structuralBreakdown, execSummary
    };
  }
};
