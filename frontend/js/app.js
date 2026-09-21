/* ===========================================================
   app.js — application shell, router, and page renderers
   =========================================================== */

const NAV_ITEMS = [
  { group: 'Overview', items: [
    { id: 'home', label: 'Project Home', icon: '🏠' },
  ]},
  { group: 'Weekly Workflow', items: [
    { id: 'new-report', label: 'New Weekly Report', icon: '📝' },
    { id: 'daily-progress', label: 'Daily Progress Entry', icon: '📅' },
    { id: 'materials', label: 'Materials & QA/QC', icon: '🧱' },
    { id: 'photos', label: 'Site Photos', icon: '📷' },
  ]},
  { group: 'Analysis', items: [
    { id: 'cumulative', label: 'Cumulative Progress', icon: '📈' },
    { id: 'preview', label: 'Report Preview', icon: '📄' },
    { id: 'history', label: 'Report History', icon: '🗂️' },
  ]},
  { group: 'Configuration', items: [
    { id: 'setup', label: 'Project Setup', icon: '⚙️' },
    { id: 'settings', label: 'Settings', icon: '🔧' },
  ]}
];

const App = {
  currentPage: 'home',
  currentReportId: null,

  async init() {
    document.getElementById('mobileToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
    window.addEventListener('hashchange', () => { if (Auth.ready) this.routeFromHash(); });
    storage.onStatus = () => this.renderStatus();
    storage.onRemoteChange = (k) => this.onRemoteChange(k);
    Auth.start();   // shows login; calls App.start() once signed in
  },

  // called after sign-in (and again after site switch / role change)
  start() {
    this.renderSidebar();
    this.renderStatus();
    if (!this._started) {
      this._started = true;
      api.checkHealth();
      setInterval(() => api.checkHealth(), 60000);   // optional export backend only
    }
    this.routeFromHash();
  },

  // another user changed data: refresh read-only screens, otherwise just notify
  onRemoteChange(key) {
    const modalOpen = document.querySelector('.modal-backdrop');
    if (['home', 'history', 'cumulative'].includes(this.currentPage) && !modalOpen) {
      this.pages[this.currentPage].call(this);
    } else if (this.currentPage === 'daily-progress' && key === 'dailyProgress' && !modalOpen) {
      this.renderDailyList();
    }
    UI.toast('Data updated by another user.', 'info', 2500);
  },

  routeFromHash() {
    const hash = location.hash.replace('#', '') || 'home';
    const [page, param] = hash.split('/');
    this.currentPage = page;
    if (param) this.currentReportId = param;
    this.navigate(page, param, false);
  },

  navigate(page, param = null, pushHash = true) {
    if (!storage.siteId && Auth.isAdmin()) page = 'sites';
    if (!Auth.navAllowed(page)) { UI.toast('You do not have access to that page.', 'error'); page = 'home'; param = null; }
    this.currentPage = page;
    if (param) this.currentReportId = param;
    if (pushHash) location.hash = param ? `${page}/${param}` : page;
    document.getElementById('sidebar').classList.remove('open');
    this.renderSidebar();
    const renderer = this.pages[page] || this.pages.home;
    renderer.call(this);
  },

  renderStatus() {
    const el = document.getElementById('apiStatus');
    if (!el) return;
    const st = storage.connState();
    el.className = st === 'offline' ? 'offline' : 'online';
    el.innerHTML = `<span class="dot"></span> ${st === 'offline' ? 'Offline — changes saved on device' : st === 'syncing' ? 'Online — syncing…' : 'Online — synced to cloud'}`;
  },

  statusBadge(r) {
    const st = r.status || 'Draft';
    const cls = { Draft: 'amber', Submitted: 'blue', Approved: 'green', Final: 'green', Returned: 'red' }[st] || 'grey';
    return `<span class="badge ${cls}">${st}</span>`;
  },

  renderSidebar() {
    const nav = document.getElementById('navList');
    nav.innerHTML = '';
    const groups = NAV_ITEMS.concat(Auth.isAdmin() ? [{ group: 'Administration', items: [
      { id: 'users', label: 'Users & Roles', icon: '👥' }, { id: 'sites', label: 'Sites', icon: '🏗️' }] }] : []);
    groups.forEach(group => {
      const items = group.items.filter(i => Auth.navAllowed(i.id));
      if (!items.length) return;
      nav.appendChild(UI.el('div', { class: 'nav-group-label' }, group.group));
      items.forEach(item => {
        const active = this.currentPage === item.id;
        const el = UI.el('div', {
          class: 'nav-item' + (active ? ' active' : ''),
          onclick: () => this.navigate(item.id, item.id === 'daily-progress' || item.id === 'materials' || item.id === 'photos' || item.id === 'preview' ? this.currentReportId : null)
        }, [UI.el('span', { class: 'ic' }, item.icon), UI.el('span', {}, item.label)]);
        nav.appendChild(el);
      });
    });
    Auth.renderUserBox();
  },

  main() { return document.getElementById('main'); },

  topbar(title, sub, actionsHtml = '') {
    return `<div id="topbar"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="flex-gap">${actionsHtml}</div></div>`;
  },

  async requireReportPicker(pageId, label = 'Select a report') {
    const reports = await storage.getReports();
    if (!this.currentReportId && reports.length) this.currentReportId = reports[reports.length - 1].id;
    const options = reports.map(r => `<option value="${r.id}" ${r.id === this.currentReportId ? 'selected' : ''}>${UI.escapeHtml(r.reportNumber)} — ${UI.escapeHtml(r.weekLabel)} [${r.status || 'Draft'}]</option>`).join('');
    return `
      <div class="card">
        <div class="field mb-0">
          <label>${label}</label>
          <select id="reportPicker">${reports.length ? options : '<option value="">No reports yet — create one first</option>'}</select>
        </div>
      </div>`;
  },

  bindReportPicker(onChange) {
    const sel = document.getElementById('reportPicker');
    if (!sel) return;
    sel.addEventListener('change', (e) => { this.currentReportId = e.target.value; onChange(); });
  },

  pages: {}
};

/* =========================================================
   PAGE: Project Home
   ========================================================= */
App.pages.home = async function () {
  const master = await storage.getMasterData();
  const reports = await storage.getReports();
  const allDaily = await storage.getAllDailyProgress();
  const totalReports = reports.length;
  const lastReport = reports[reports.length - 1];
  const totalBricks = allDaily.reduce((s, d) => s + (parseFloat(d.bricksConsumed) || 0), 0);
  const totalCement = allDaily.reduce((s, d) => s + (parseFloat(d.cementBags) || 0), 0);

  this.main().innerHTML = `
    ${this.topbar('Project Home', master.projectTitle, Auth.canCreate() ? `<button class="btn primary" id="btnNewReport">+ New Weekly Report</button>` : '')}
    <div class="grid cols-4">
      <div class="stat-tile"><div class="label">Weekly Reports</div><div class="value">${totalReports}</div></div>
      <div class="stat-tile"><div class="label">Latest Report</div><div class="value" style="font-size:1.1rem">${lastReport ? UI.escapeHtml(lastReport.reportNumber) : '—'}</div></div>
      <div class="stat-tile"><div class="label">Cumulative Bricks Consumed</div><div class="value">${Calc.formatNum(totalBricks)} <small>Nos.</small></div></div>
      <div class="stat-tile"><div class="label">Cumulative Cement Consumed</div><div class="value">${Calc.formatNum(totalCement)} <small>Bags</small></div></div>
    </div>

    <div class="grid cols-2 mt-16">
      <div class="card">
        <h2>Project Details</h2>
        <table><tbody>
          <tr><td class="text-muted">Project Title</td><td>${UI.escapeHtml(master.projectTitle)}</td></tr>
          <tr><td class="text-muted">Client</td><td>${UI.escapeHtml(master.client)}</td></tr>
          <tr><td class="text-muted">Consultant</td><td>${UI.escapeHtml(master.consultant)}</td></tr>
          <tr><td class="text-muted">Location</td><td>${UI.escapeHtml(master.location)}</td></tr>
          <tr><td class="text-muted">Duration</td><td>${UI.escapeHtml(master.projectDuration)}</td></tr>
          <tr><td class="text-muted">Estimate</td><td>${UI.escapeHtml(master.projectEstimate)}</td></tr>
          <tr><td class="text-muted">Mobilization Date</td><td>${UI.formatDate(master.mobilizationDate)}</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <h2>Reporting Team</h2>
        <table><tbody>
          <tr><td class="text-muted">Resident Engineer</td><td>${UI.escapeHtml(master.residentEngineer)}</td></tr>
          <tr><td class="text-muted">Quality Inspector</td><td>${UI.escapeHtml(master.qualityInspector)}</td></tr>
          <tr><td class="text-muted">Project Coordinator</td><td>${UI.escapeHtml(master.projectCoordinator)}</td></tr>
          <tr><td class="text-muted">Governing Standards</td><td class="text-sm">${UI.escapeHtml(master.governingStandards)}</td></tr>
        </tbody></table>
        <div class="section-divider"></div>
        <div class="flex-gap">
          ${Auth.isAdmin() ? '<button class="btn ghost sm" id="btnGoSetup">Edit Project Setup</button>' : ''}
          <button class="btn ghost sm" id="btnGoHistory">View Report History</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Recent Reports</h2>
      ${reports.length === 0 ? `<div class="empty-state"><div class="ic">🗒️</div>No weekly reports yet. Create your first report to get started.</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>Report #</th><th>Week</th><th>Start</th><th>End</th><th>Status</th><th>Last Updated</th></tr></thead>
        <tbody>
          ${reports.slice(-6).reverse().map(r => `<tr>
            <td>${UI.escapeHtml(r.reportNumber)}</td><td>${UI.escapeHtml(r.weekLabel)}</td>
            <td>${UI.formatDateShort(r.startDate)}</td><td>${UI.formatDateShort(r.endDate)}</td>
            <td>${App.statusBadge(r)}</td>
            <td class="text-sm text-muted">${r.lastUpdated ? new Date(r.lastUpdated).toLocaleString() : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>
  `;
  const _bn = document.getElementById('btnNewReport'); if (_bn) _bn.onclick = () => this.navigate('new-report');
  const _bs = document.getElementById('btnGoSetup'); if (_bs) _bs.onclick = () => this.navigate('setup');
  document.getElementById('btnGoHistory').onclick = () => this.navigate('history');
};

/* =========================================================
   PAGE: New Weekly Report (Google-Form style wizard)
   ========================================================= */
App.pages['new-report'] = async function () {
  const master = await storage.getMasterData();
  const draft = storage.loadDraft('new-report') || {};
  const editingId = this._editingReportId || null;
  let existing = null;
  if (editingId) existing = await storage.getReport(editingId);
  if (existing && !Auth.canEditReport(existing)) {
    UI.toast(`This report is locked (${existing.status}). Only a returned/draft report can be edited.`, 'warn', 5000);
    this._editingReportId = null; return this.navigate('history');
  }
  const f = existing || draft.data || { weather: 'Clear (Mostly)', siteStatus: 'Open', status: 'Draft' };

  this.main().innerHTML = `
    ${this.topbar(existing ? `Edit ${existing.reportNumber}` : 'New Weekly Report', 'Step 1 of 1 — Reporting Information (auto-populated project fields shown below)')}
    ${existing && existing.status === 'Returned' ? `<div class="card"><strong>Returned by ${UI.escapeHtml(existing.reviewedByName || 'supervisor')}:</strong> ${UI.escapeHtml(existing.reviewNote || '(no note)')}</div>` : ''}
    <div class="card">
      <h2>Reporting Information</h2>
      <p class="card-desc">Enter the details specific to this week. Project-wide fields are filled in automatically from Project Setup.</p>
      <div class="grid cols-2">
        <div class="field"><label>Report Number *</label><input id="f_reportNumber" type="text" placeholder="e.g. WIR-11-JH" value="${UI.escapeHtml(f.reportNumber || '')}"><div class="err"></div></div>
        <div class="field"><label>Reporting Week *</label><input id="f_weekLabel" type="text" placeholder="e.g. Week End-11" value="${UI.escapeHtml(f.weekLabel || '')}"><div class="err"></div></div>
        <div class="field"><label>Start Date *</label><input id="f_startDate" type="date" value="${f.startDate || ''}"><div class="err"></div></div>
        <div class="field"><label>End Date *</label><input id="f_endDate" type="date" value="${f.endDate || ''}"><div class="err"></div></div>
        <div class="field"><label>Weather</label><input id="f_weather" type="text" value="${UI.escapeHtml(f.weather || 'Clear (Mostly)')}"></div>
        <div class="field"><label>Overall Site Status</label>
          <select id="f_siteStatus"><option ${f.siteStatus === 'Open' ? 'selected' : ''}>Open</option><option ${f.siteStatus === 'Partially Closed' ? 'selected' : ''}>Partially Closed</option><option ${f.siteStatus === 'Closed' ? 'selected' : ''}>Closed</option></select>
        </div>
      </div>
      <div class="field"><label>General Remarks</label><textarea id="f_remarks">${UI.escapeHtml(f.remarks || '')}</textarea></div>

      <div class="section-divider"></div>
      <h3>Auto-populated Project Information</h3>
      <div class="grid cols-2">
        <div class="field mb-0"><label>Project Title</label><div class="readonly-field">${UI.escapeHtml(master.projectTitle)}</div></div>
        <div class="field mb-0"><label>Client</label><div class="readonly-field">${UI.escapeHtml(master.client)}</div></div>
        <div class="field mb-0"><label>Consultant</label><div class="readonly-field">${UI.escapeHtml(master.consultant)}</div></div>
        <div class="field mb-0"><label>Location</label><div class="readonly-field">${UI.escapeHtml(master.location)}</div></div>
        <div class="field mb-0"><label>Resident Engineer</label><div class="readonly-field">${UI.escapeHtml(master.residentEngineer)}</div></div>
        <div class="field mb-0"><label>Quality Inspector</label><div class="readonly-field">${UI.escapeHtml(master.qualityInspector)}</div></div>
        <div class="field mb-0"><label>Project Coordinator</label><div class="readonly-field">${UI.escapeHtml(master.projectCoordinator)}</div></div>
        <div class="field mb-0"><label>Project Duration</label><div class="readonly-field">${UI.escapeHtml(master.projectDuration)}</div></div>
      </div>

      <div class="section-divider"></div>
      <div class="flex-end flex-gap">
        <button class="btn ghost" id="btnCancel">Cancel</button>
        <button class="btn" id="btnSaveDraft">💾 Save Draft</button>
        <button class="btn primary" id="btnSaveReport">Save & Continue to Daily Progress →</button>
      </div>
    </div>
  `;

  const fields = ['reportNumber', 'weekLabel', 'startDate', 'endDate', 'weather', 'siteStatus', 'remarks'];
  const collect = () => Object.fromEntries(fields.map(k => [k, document.getElementById('f_' + k).value.trim()]));
  fields.forEach(k => document.getElementById('f_' + k).addEventListener('input', () => storage.saveDraft('new-report', collect())));

  document.getElementById('btnCancel').onclick = () => { storage.clearDraft('new-report'); this.navigate('home'); };
  const persist = async () => {
    const data = collect();
    const errors = Validate.validateReportInfo(data);
    fields.forEach(k => {
      const fieldDiv = document.getElementById('f_' + k).closest('.field');
      if (!fieldDiv) return;
      if (errors[k]) { fieldDiv.classList.add('invalid'); fieldDiv.querySelector('.err').textContent = errors[k]; }
      else fieldDiv.classList.remove('invalid');
    });
    if (Validate.hasErrors(errors)) { UI.toast('Please fix the highlighted fields.', 'error'); return null; }
    const isDup = await Validate.checkDuplicateReportNumber(data.reportNumber, existing ? existing.id : editingId);
    if (isDup) { UI.toast('A report with this number already exists.', 'error'); return null; }
    const record = Object.assign({}, existing, data);
    if (!record.status) record.status = 'Draft';
    try {
      const saved = await storage.saveReport(record);
      storage.clearDraft('new-report');
      this._editingReportId = saved.id;      // stay in edit mode after first save
      this.currentReportId = saved.id;
      existing = saved;
      return saved;
    } catch (e) { UI.toast('Save failed: ' + (e.code === 'permission-denied' ? 'permission denied by security rules.' : e.message), 'error', 6000); return null; }
  };
  document.getElementById('btnSaveDraft').onclick = async () => {
    const saved = await persist();
    if (saved) UI.toast('Draft saved. ' + storage.saveNotice(), 'success', 4500);
  };
  document.getElementById('btnSaveReport').onclick = async () => {
    const saved = await persist();
    if (!saved) return;
    UI.toast('Weekly report saved. ' + storage.saveNotice(), 'success');
    this._editingReportId = null;
    this.navigate('daily-progress', saved.id);
  };
};

/* =========================================================
   PAGE: Daily Progress Entry
   ========================================================= */
App.pages['daily-progress'] = async function () {
  const picker = await this.requireReportPicker('daily-progress', 'Weekly report');
  this.main().innerHTML = `
    ${this.topbar('Daily Progress Entry', 'Add day-by-day site records and structural activities for the selected report.', (Auth.canEditReport(storage.reportById(this.currentReportId)) ? `<button class="btn primary" id="btnAddDay">+ Add Daily Record</button>` : '') + (Auth.canSubmit(storage.reportById(this.currentReportId)) ? `<button class="btn amber" id="btnSubmitRep">Submit for Review</button>` : ''))}
    ${picker}
    <div id="dailyList"></div>
  `;
  this.bindReportPicker(() => this.pages['daily-progress'].call(this));
  const _ba = document.getElementById('btnAddDay'); if (_ba) _ba.onclick = () => this.openDailyForm(null);
  const _bsu = document.getElementById('btnSubmitRep'); if (_bsu) _bsu.onclick = () => this.submitReport(this.currentReportId);
  await this.renderDailyList();
};

App.renderDailyList = async function () {
  const host = document.getElementById('dailyList');
  if (!this.currentReportId) { host.innerHTML = `<div class="card"><div class="empty-state">Create a weekly report first.</div></div>`; return; }
  const records = await storage.getDailyProgressByReport(this.currentReportId);
  if (records.length === 0) { host.innerHTML = `<div class="card"><div class="empty-state"><div class="ic">📅</div>No daily records yet for this report.</div></div>`; return; }

  const editable = Auth.canEditReport(storage.reportById(this.currentReportId));
  host.innerHTML = records.map(rec => `
    <div class="card">
      <div class="flex-between">
        <div>
          <h3>${UI.formatDate(rec.date)} <span class="text-muted text-sm">· ${UI.escapeHtml(rec.dailyReportId)}</span></h3>
          <span class="badge ${rec.siteStatus === 'Closed' ? 'red' : rec.siteStatus === 'Partially Closed' ? 'amber' : 'green'}">${rec.siteStatus}</span>
          ${rec.closureReason ? `<span class="text-sm text-muted"> — ${UI.escapeHtml(rec.closureReason)}</span>` : ''}
        </div>
        <div class="flex-gap">
          ${editable ? `<button class="btn sm ghost" data-edit="${rec.id}">Edit</button>
          <button class="btn sm danger" data-del="${rec.id}">Delete</button>` : ''}
        </div>
      </div>
      <div class="grid cols-4 mt-10">
        <div class="stat-tile"><div class="label">Bricks Consumed</div><div class="value" style="font-size:1.1rem">${Calc.formatNum(rec.bricksConsumed)}</div></div>
        <div class="stat-tile"><div class="label">Cement (Bags)</div><div class="value" style="font-size:1.1rem">${Calc.formatNum(rec.cementBags)}</div></div>
        <div class="stat-tile"><div class="label">Fine Sand (ft³)</div><div class="value" style="font-size:1.1rem">${Calc.formatNum(rec.fineSandVol)}</div></div>
        <div class="stat-tile"><div class="label">Coarse Agg. (ft³)</div><div class="value" style="font-size:1.1rem">${Calc.formatNum(rec.coarseAggVol)}</div></div>
      </div>
      ${(rec.activities || []).length ? `
      <div class="table-wrap mt-16"><table>
        <thead><tr><th>Element</th><th>Category</th><th>Description</th><th>L (ft)</th><th>W (ft)</th><th>H (ft)</th><th>Panels</th><th>Qty</th><th>Unit</th></tr></thead>
        <tbody>${rec.activities.map(a => `<tr>
          <td>${UI.escapeHtml(a.structuralElement)}</td><td>${UI.escapeHtml(a.activityCategory)}</td><td>${UI.escapeHtml(a.activityDescription)}</td>
          <td>${Calc.formatNum(a.length)}</td><td>${Calc.formatNum(a.width)}</td><td>${Calc.formatNum(a.height)}</td>
          <td>${a.panels || '—'}</td><td>${Calc.formatNum(a.quantity)}</td><td>${UI.escapeHtml(a.unit)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="text-sm text-muted mt-10">No structural activities logged for this day.</p>`}
      ${rec.remarks ? `<p class="text-sm mt-10"><strong>Remarks:</strong> ${UI.escapeHtml(rec.remarks)}</p>` : ''}
    </div>
  `).join('');

  host.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => this.openDailyForm(b.getAttribute('data-edit')));
  host.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const ok = await UI.confirm('Delete this daily record and its logged activities?', { danger: true, okText: 'Delete' });
    if (!ok) return;
    await storage.deleteDailyProgress(b.getAttribute('data-del'));
    UI.toast('Daily record deleted.', 'success');
    this.renderDailyList();
  });
};

App.openDailyForm = async function (recordId) {
  const existing = recordId ? await storage.getDailyProgressByReport(this.currentReportId).then(list => list.find(r => r.id === recordId)) : null;
  const rec = existing ? JSON.parse(JSON.stringify(existing)) : {
    reportId: this.currentReportId, date: '', dailyReportId: '', siteStatus: 'Open', closureReason: '',
    bricksConsumed: '', cementBags: '', fineSandVol: '', coarseAggVol: '', steelTons: '', remarks: '', activities: []
  };

  const backdrop = UI.openModal(`
    <h3>${existing ? 'Edit' : 'Add'} Daily Progress Record</h3>
    <div class="grid cols-2">
      <div class="field"><label>Date *</label><input id="d_date" type="date" value="${rec.date || ''}"></div>
      <div class="field"><label>Daily Report ID *</label><input id="d_dailyReportId" type="text" placeholder="e.g. DIR-JH-724" value="${UI.escapeHtml(rec.dailyReportId || '')}"></div>
      <div class="field"><label>Site Status *</label>
        <select id="d_siteStatus"><option ${rec.siteStatus === 'Open' ? 'selected' : ''}>Open</option><option ${rec.siteStatus === 'Partially Closed' ? 'selected' : ''}>Partially Closed</option><option ${rec.siteStatus === 'Closed' ? 'selected' : ''}>Closed</option></select>
      </div>
      <div class="field"><label>Closure Reason (if applicable)</label><input id="d_closureReason" type="text" value="${UI.escapeHtml(rec.closureReason || '')}" placeholder="e.g. Rain / Friday"></div>
    </div>
    <div class="section-divider"></div>
    <h3 style="font-size:.85rem">Material Consumption (for Cumulative History, Sec. 7)</h3>
    <div class="grid cols-2">
      <div class="field"><label>Bricks Consumed (Nos.)</label><input id="d_bricksConsumed" type="number" min="0" value="${rec.bricksConsumed}"></div>
      <div class="field"><label>Cement Consumed (Bags)</label><input id="d_cementBags" type="number" min="0" value="${rec.cementBags}"></div>
      <div class="field"><label>Fine Sand Volume (ft³)</label><input id="d_fineSandVol" type="number" min="0" step="0.01" value="${rec.fineSandVol}"></div>
      <div class="field"><label>Coarse Aggregate (ft³)</label><input id="d_coarseAggVol" type="number" min="0" step="0.01" value="${rec.coarseAggVol}"></div>
      <div class="field"><label>Reinforcing Steel (Tons)</label><input id="d_steelTons" type="number" min="0" step="0.01" value="${rec.steelTons}"></div>
    </div>
    <div class="field"><label>Day Remarks</label><textarea id="d_remarks">${UI.escapeHtml(rec.remarks || '')}</textarea></div>

    <div class="section-divider"></div>
    <div class="flex-between"><h3 style="font-size:.85rem">Structural Activities</h3><button class="btn sm amber" id="btnAddActivity">+ Add Activity</button></div>
    <div id="activityList"></div>

    <div class="flex-end flex-gap mt-16">
      <button class="btn ghost" data-act="cancel">Cancel</button>
      <button class="btn primary" id="btnSaveDaily">Save Daily Record</button>
    </div>
  `);

  const renderActivities = () => {
    const host = backdrop.querySelector('#activityList');
    host.innerHTML = rec.activities.map((a, i) => `
      <div class="activity-card">
        <button class="btn sm danger remove-activity" data-idx="${i}">✕</button>
        <div class="grid cols-2">
          <div class="field mb-0"><label>Structural Element</label>
            <select data-f="structuralElement" data-idx="${i}">${STRUCTURAL_ELEMENTS.map(s => `<option ${a.structuralElement === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          </div>
          <div class="field mb-0"><label>Activity Category</label>
            <select data-f="activityCategory" data-idx="${i}">${ACTIVITY_CATEGORIES.map(c => `<option ${a.activityCategory === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field mt-10 mb-0"><label>Activity Description</label><input type="text" data-f="activityDescription" data-idx="${i}" value="${UI.escapeHtml(a.activityDescription || '')}" placeholder="e.g. (1:4) Plaster Above PL"></div>
        <div class="grid cols-4 mt-10">
          <div class="field mb-0"><label>Length (ft)</label><input type="number" step="0.01" data-f="length" data-idx="${i}" value="${a.length ?? ''}"></div>
          <div class="field mb-0"><label>Width (ft)</label><input type="number" step="0.01" data-f="width" data-idx="${i}" value="${a.width ?? ''}"></div>
          <div class="field mb-0"><label>Height/Depth (ft)</label><input type="number" step="0.01" data-f="height" data-idx="${i}" value="${a.height ?? ''}"></div>
          <div class="field mb-0"><label>Panels</label><input type="number" step="1" data-f="panels" data-idx="${i}" value="${a.panels ?? ''}"></div>
        </div>
        <div class="grid cols-2 mt-10">
          <div class="field mb-0"><label>Unit</label>
            <select data-f="unit" data-idx="${i}">
              <option ${a.unit === 'CFT' ? 'selected' : ''}>CFT</option><option ${a.unit === 'SFT' ? 'selected' : ''}>SFT</option>
              <option ${a.unit === 'FT' ? 'selected' : ''}>FT</option><option ${a.unit === 'Nos' ? 'selected' : ''}>Nos</option>
              <option ${a.unit === 'Bags' ? 'selected' : ''}>Bags</option><option ${a.unit === 'Tons' ? 'selected' : ''}>Tons</option>
            </select>
          </div>
          <div class="field mb-0"><label>Quantity (auto or manual)</label><input type="number" step="0.01" data-f="quantity" data-idx="${i}" value="${a.quantity ?? ''}"></div>
        </div>
        <div class="calc-box">Calculated suggestion: <strong>${Calc.autoQuantity(a.unit, a) ?? 'enter manually'}</strong> ${a.unit || ''} <button class="btn sm ghost" style="margin-left:10px" data-apply-calc="${i}">Use this value</button></div>
        <div class="grid cols-2 mt-10">
          <div class="field mb-0"><label>Labour</label><input type="text" data-f="labour" data-idx="${i}" value="${UI.escapeHtml(a.labour || '')}"></div>
          <div class="field mb-0"><label>Equipment</label><input type="text" data-f="equipment" data-idx="${i}" value="${UI.escapeHtml(a.equipment || '')}"></div>
        </div>
        <div class="field mt-10 mb-0"><label>Remarks</label><input type="text" data-f="remarks" data-idx="${i}" value="${UI.escapeHtml(a.remarks || '')}"></div>
      </div>
    `).join('') || `<p class="text-sm text-muted">No activities added yet.</p>`;

    host.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', (e) => {
      const idx = +e.target.getAttribute('data-idx'), field = e.target.getAttribute('data-f');
      rec.activities[idx][field] = e.target.value;
      if (['length', 'width', 'height', 'panels', 'unit'].includes(field)) renderActivities();
    }));
    host.querySelectorAll('[data-apply-calc]').forEach(btn => btn.addEventListener('click', (e) => {
      const idx = +e.target.getAttribute('data-apply-calc');
      const a = rec.activities[idx];
      const v = Calc.autoQuantity(a.unit, a);
      if (v !== null) { a.quantity = v; renderActivities(); }
    }));
    host.querySelectorAll('.remove-activity').forEach(btn => btn.addEventListener('click', (e) => {
      rec.activities.splice(+e.target.getAttribute('data-idx'), 1);
      renderActivities();
    }));
  };
  renderActivities();

  backdrop.querySelector('#btnAddActivity').onclick = () => {
    rec.activities.push({ structuralElement: 'Wall-1', activityCategory: 'Other', activityDescription: '', length: '', width: '', height: '', panels: '', unit: 'CFT', quantity: '', labour: '', equipment: '', remarks: '' });
    renderActivities();
  };

  backdrop.addEventListener('click', (e) => { if (e.target.getAttribute('data-act') === 'cancel') UI.closeModal(backdrop); });

  backdrop.querySelector('#btnSaveDaily').onclick = async () => {
    ['date', 'dailyReportId', 'siteStatus', 'closureReason', 'bricksConsumed', 'cementBags', 'fineSandVol', 'coarseAggVol', 'steelTons', 'remarks'].forEach(f => {
      rec[f] = backdrop.querySelector('#d_' + f).value.trim();
    });
    const errors = Validate.validateDailyRecord(rec);
    for (const a of rec.activities) Object.assign(errors, {});
    if (Validate.hasErrors(errors)) { UI.toast(Object.values(errors)[0], 'error'); return; }
    if (existing) rec.id = existing.id;
    try { await storage.saveDailyProgress(rec); }
    catch (e) { UI.toast('Save failed: ' + (e.code === 'permission-denied' ? 'permission denied (report locked?).' : e.message), 'error', 6000); return; }
    UI.closeModal(backdrop);
    UI.toast('Daily record saved. ' + storage.saveNotice(), 'success');
    this.renderDailyList();
  };
};

/* =========================================================
   PAGE: Materials & QA/QC
   ========================================================= */
App.pages.materials = async function () {
  const picker = await this.requireReportPicker('materials', 'Weekly report');
  this.main().innerHTML = `${this.topbar('Materials & QA/QC', 'Weekly material inspection status. Master defaults are shown; update status/remarks per week.')}${picker}<div id="matForm"></div>`;
  this.bindReportPicker(() => this.pages.materials.call(this));
  await this.renderMaterialsForm();
};

App.renderMaterialsForm = async function () {
  const host = document.getElementById('matForm');
  if (!this.currentReportId) { host.innerHTML = `<div class="card"><div class="empty-state">Create a weekly report first.</div></div>`; return; }
  const master = await storage.getMasterData();
  const existing = await storage.getMaterialsByReport(this.currentReportId);
  const M = existing || {
    reportId: this.currentReportId,
    cement: { brand: master.materials.cement.brand, observation: master.materials.cement.notes, status: 'Compliant (Fresh Batch)' },
    bricks: { brand: master.materials.bricks.brand, observation: master.materials.bricks.notes, status: 'Compliant (C&W First Class)' },
    fineAggregate: { source: master.materials.fineAggregate.source, observation: master.materials.fineAggregate.notes, status: 'Compliant' },
    coarseAggregate: { source: master.materials.coarseAggregate.source, observation: master.materials.coarseAggregate.notes, status: 'Compliant' }
  };

  const block = (key, title, srcLabel) => `
    <div class="card">
      <h3>${title}</h3>
      <div class="grid cols-2">
        <div class="field"><label>${srcLabel}</label><input id="m_${key}_src" type="text" value="${UI.escapeHtml(M[key].brand || M[key].source || '')}"></div>
        <div class="field"><label>Specification Compliance Status</label>
          <select id="m_${key}_status">
            ${['Compliant', 'Compliant (Fresh Batch)', 'Compliant (C&W First Class)', 'Compliant / Conditional', 'Non-Compliant'].map(s => `<option ${M[key].status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field mb-0"><label>Field Quality Observation</label><textarea id="m_${key}_obs">${UI.escapeHtml(M[key].observation || '')}</textarea></div>
    </div>`;

  host.innerHTML = `
    ${block('cement', 'Cement', 'Brand')}
    ${block('bricks', 'Bricks', 'Brand')}
    ${block('fineAggregate', 'Fine Aggregate / Sand', 'Source')}
    ${block('coarseAggregate', 'Coarse Aggregate / Crush', 'Source')}
    <div class="card">
      <h3>Engineering Terminology & Field Quality Reference</h3>
      <p class="card-desc">Standard terminology maintained from the sample report (Sec. 3.2). Not editable per week.</p>
      <ul class="help-list">
        <li><strong>First-Class Bricks (C&W Specs):</strong> Thoroughly burnt, copper-colored, free from cracks; must not absorb more than 20% of dry weight in water over 24 hours.</li>
        <li><strong>Efflorescence Monitoring:</strong> Field check for white alkaline salt deposits weakening the brick-mortar bond.</li>
        <li><strong>Silt Content in Sand:</strong> Silt above 6% reduces compressive strength of mortar and concrete.</li>
        <li><strong>Curing Water Quality (ACI 318 Context):</strong> Water must be clean and potable; chlorides/sulfates attack reinforcement and degrade mortar.</li>
      </ul>
    </div>
    <div class="flex-end"><button class="btn primary" id="btnSaveMaterials">Save Materials Record</button></div>
  `;

  document.getElementById('btnSaveMaterials').onclick = async () => {
    ['cement', 'bricks', 'fineAggregate', 'coarseAggregate'].forEach(key => {
      const src = document.getElementById(`m_${key}_src`).value.trim();
      M[key] = {
        [key === 'fineAggregate' || key === 'coarseAggregate' ? 'source' : 'brand']: src,
        status: document.getElementById(`m_${key}_status`).value,
        observation: document.getElementById(`m_${key}_obs`).value.trim()
      };
    });
    M.reportId = this.currentReportId;
    try { await storage.saveMaterials(M); }
    catch (e) { UI.toast('Save failed: ' + (e.code === 'permission-denied' ? 'permission denied (report locked?).' : e.message), 'error', 6000); return; }
    UI.toast('Materials record saved. ' + storage.saveNotice(), 'success');
  };
  if (!Auth.canEditReport(storage.reportById(this.currentReportId))) {
    host.querySelectorAll('input,select,textarea,button').forEach(el => el.disabled = true);
  }
};

/* =========================================================
   PAGE: Site Photos
   ========================================================= */
App.pages.photos = async function () {
  const picker = await this.requireReportPicker('photos', 'Weekly report');
  this.main().innerHTML = `
    ${this.topbar('Site Photos', 'Upload and tag photos for this weekly report. JPG, PNG and WebP supported.')}
    ${picker}
    <div class="card" ${Auth.canEditReport(storage.reportById(this.currentReportId)) ? '' : 'style="display:none"'}>
      <input type="file" id="photoInput" accept="image/jpeg,image/png,image/webp" multiple>
      <div id="photoPreviewArea" class="mt-16"></div>
    </div>
    <div id="photoGrid" class="photo-grid"></div>
  `;
  this.bindReportPicker(() => this.pages.photos.call(this));
  document.getElementById('photoInput').addEventListener('change', (e) => this.handlePhotoSelect(e.target.files));
  if (this.currentReportId) await storage.getPhotosByReport(this.currentReportId, true);
  await this.renderPhotoGrid();
};

App.handlePhotoSelect = async function (files) {
  if (!this.currentReportId) { UI.toast('Create a weekly report first.', 'error'); return; }
  const area = document.getElementById('photoPreviewArea');
  area.innerHTML = '<p class="text-sm text-muted">Processing images…</p>';
  let ok = 0;
  for (const file of files) {
    try {
      const dataUrl = await PhotoUtil.compress(file);
      await storage.savePhoto({
        reportId: this.currentReportId, dataUrl, fileName: file.name,
        date: '', location: '', activity: '', caption: '', category: 'Visual Inspection'
      });
      ok++;
    } catch (e) { UI.toast(`Photo "${file.name}" failed: ${e.code === 'permission-denied' ? 'permission denied (report locked?)' : e.message}`, 'error', 6000); }
  }
  area.innerHTML = '';
  if (ok) UI.toast(`${ok} photo(s) uploaded. ${storage.saveNotice()} Add captions below.`, 'success', 4500);
  this.renderPhotoGrid();
};

App.renderPhotoGrid = async function () {
  const host = document.getElementById('photoGrid');
  if (!this.currentReportId) { host.innerHTML = ''; return; }
  const photos = await storage.getPhotosByReport(this.currentReportId);
  const editable = Auth.canEditReport(storage.reportById(this.currentReportId));
  if (!photos.length) { host.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="empty-state"><div class="ic">📷</div>No photos uploaded yet.</div></div>`; return; }
  host.innerHTML = photos.map(p => `
    <div class="photo-tile">
      <img src="${p.dataUrl}" alt="${UI.escapeHtml(p.fileName)}">
      <div class="meta">
        <div class="field mb-0"><input type="text" placeholder="Caption" ${editable ? '' : 'disabled'} data-pf="caption" data-pid="${p.id}" value="${UI.escapeHtml(p.caption)}"></div>
        <div class="field mb-0 mt-10"><select data-pf="category" ${editable ? '' : 'disabled'} data-pid="${p.id}">
          ${['Visual Inspection', 'Material Delivery', 'Progress Photo', 'Site Condition'].map(c => `<option ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select></div>
        ${editable ? `<button class="btn sm danger mt-10" data-pdel="${p.id}">Delete</button>` : ''}
      </div>
    </div>
  `).join('');
  host.querySelectorAll('[data-pf]').forEach(inp => inp.addEventListener('change', async (e) => {
    const photos = await storage.getPhotosByReport(this.currentReportId);
    const p = photos.find(x => x.id === e.target.getAttribute('data-pid'));
    p[e.target.getAttribute('data-pf')] = e.target.value;
    await storage.savePhoto(p);
  }));
  host.querySelectorAll('[data-pdel]').forEach(btn => btn.addEventListener('click', async (e) => {
    await storage.deletePhoto(e.target.getAttribute('data-pdel'));
    this.renderPhotoGrid();
  }));
};

/* =========================================================
   PAGE: Cumulative Progress
   ========================================================= */
App.pages.cumulative = async function () {
  const reports = await storage.getReports();
  const allDaily = await storage.getAllDailyProgress();
  const master = await storage.getMasterData();

  const sum = (field) => allDaily.reduce((s, d) => s + (parseFloat(d[field]) || 0), 0);
  const breakdown = reports.length ? ReportEngine.compileStructuralBreakdown(allDaily, []) : [];

  this.main().innerHTML = `
    ${this.topbar('Cumulative Progress', 'Running totals across all stored weekly reports (Sections 7 & 8 basis).')}
    <div class="grid cols-4">
      <div class="stat-tile"><div class="label">Bricks Consumed</div><div class="value">${Calc.formatNum(sum('bricksConsumed'))} <small>Nos.</small></div></div>
      <div class="stat-tile"><div class="label">Cement Consumed</div><div class="value">${Calc.formatNum(sum('cementBags'))} <small>Bags</small></div></div>
      <div class="stat-tile"><div class="label">Fine Sand</div><div class="value">${Calc.formatNum(sum('fineSandVol'))} <small>ft³</small></div></div>
      <div class="stat-tile"><div class="label">Coarse Aggregate</div><div class="value">${Calc.formatNum(sum('coarseAggVol'))} <small>ft³</small></div></div>
    </div>

    <div class="card mt-16">
      <h2>Cumulative Progress by Structural Level (1 Panel = 36'-0")</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Structural Element & Design Specification</th><th>Wall-1</th><th>Wall-2</th><th>Wall-3</th><th>Cumulative Total</th></tr></thead>
        <tbody>${breakdown.map(r => `<tr><td>${UI.escapeHtml(r.label)}</td><td>${r.cumulative ? '' : ''}${r.wall1}</td><td>${r.wall2}</td><td>${r.wall3}</td><td><strong>${r.cumulativeTotal}</strong></td></tr>`).join('') || '<tr><td colspan="5">No data yet.</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Baseline (Pre-Consultancy Mobilization Record)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Activity</th><th>Wall-1</th><th>Wall-2</th><th>Wall-3</th></tr></thead>
        <tbody>${master.baseline.quantities.map(q => `<tr><td>${UI.escapeHtml(q.activity)}</td><td>${UI.escapeHtml(q.wall1)}</td><td>${UI.escapeHtml(q.wall2)}</td><td>${UI.escapeHtml(q.wall3)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
  `;
};

/* =========================================================
   PAGE: Report Preview
   ========================================================= */
App.pages.preview = async function () {
  const picker = await this.requireReportPicker('preview', 'Weekly report to preview');
  this.main().innerHTML = `
    ${this.topbar('Report Preview', 'Live preview of the exact 9-section structure that will be generated.', `
      <button class="btn ghost" id="btnExportDocx">Export Word</button>
      <button class="btn primary" id="btnExportPdf">Export PDF</button>`)}
    ${picker}
    <div id="previewHost"></div>
  `;
  this.bindReportPicker(() => this.pages.preview.call(this));
  document.getElementById('btnExportDocx').onclick = () => this.exportReport('docx');
  document.getElementById('btnExportPdf').onclick = () => this.exportReport('pdf');
  await this.renderPreview();
};

App.renderPreview = async function () {
  const host = document.getElementById('previewHost');
  if (!this.currentReportId) { host.innerHTML = `<div class="card"><div class="empty-state">Create a weekly report first.</div></div>`; return; }
  const payload = await ReportEngine.buildReportPayload(this.currentReportId);
  const { masterData, report, materials, photos, weeklyProgressWork, highlights, cumulativeHistory, structuralBreakdown, execSummary } = payload;

  const weeklyWorkHtml = Object.keys(weeklyProgressWork).length ? Object.entries(weeklyProgressWork).map(([wall, cats]) => `
    <h4>${UI.escapeHtml(wall)}</h4>
    <table><thead><tr><th>Category</th><th>Description</th><th>Unit</th><th>Nos</th><th>Length</th><th>Width</th><th>Depth/Height</th><th>Total Qty</th></tr></thead>
    <tbody>${Object.entries(cats).map(([cat, acts]) => acts.map(a => `<tr><td>${UI.escapeHtml(cat)}</td><td>${UI.escapeHtml(a.activityDescription)}</td><td>${UI.escapeHtml(a.unit)}</td><td>${a.panels || '-'}</td><td>${Calc.formatNum(a.length)}</td><td>${Calc.formatNum(a.width)}</td><td>${Calc.formatNum(a.height)}</td><td>${Calc.formatNum(a.quantity)}</td></tr>`).join('')).join('')}</tbody></table>
  `).join('') : '<p class="text-muted">No activities entered for this reporting period.</p>';

  host.innerHTML = `<div class="doc-preview">
    <h2 style="text-align:center">${UI.escapeHtml(report.reportNumber)} — Weekly Inspection Report</h2>
    <p style="text-align:center;color:#666">${UI.formatDate(report.startDate)} – ${UI.formatDate(report.endDate)} (${UI.escapeHtml(report.weekLabel)})</p>

    <h2 class="section-title">1. Client Details</h2>
    <table><tbody>
      <tr><td>Project Title</td><td>${UI.escapeHtml(masterData.projectTitle)}</td></tr>
      <tr><td>Client Organization</td><td>${UI.escapeHtml(masterData.client)}</td></tr>
      <tr><td>Client Address</td><td>${UI.escapeHtml(masterData.clientAddress)}</td></tr>
      <tr><td>Consultant Name</td><td>${UI.escapeHtml(masterData.consultant)}</td></tr>
      <tr><td>Facility Type</td><td>${UI.escapeHtml(masterData.facility)}</td></tr>
      <tr><td>Site Location</td><td>${UI.escapeHtml(masterData.location)}</td></tr>
      <tr><td>Data Collection Week</td><td>${UI.formatDate(report.startDate)} – ${UI.formatDate(report.endDate)} (${UI.escapeHtml(report.weekLabel)})</td></tr>
      <tr><td>Total Project Duration</td><td>${UI.escapeHtml(masterData.projectDuration)}</td></tr>
      <tr><td>Reporting Resident Engineer (RE)</td><td>${UI.escapeHtml(masterData.residentEngineer)}</td></tr>
      <tr><td>Reporting Quality Inspector</td><td>${UI.escapeHtml(masterData.qualityInspector)}</td></tr>
      <tr><td>Reporting Project Coordinator</td><td>${UI.escapeHtml(masterData.projectCoordinator)}</td></tr>
    </tbody></table>

    <h2 class="section-title">2. Introduction</h2>
    <h3>2.1 Project Background</h3>
    <p>The project is executed by the client with total allocated estimate of ${UI.escapeHtml(masterData.projectEstimate)}. ${UI.escapeHtml(masterData.consultant)} has been appointed as Resident Supervision Consultants, governed by ${UI.escapeHtml(masterData.governingStandards)}</p>
    <h3>2.2 Objective and Scope</h3>
    <p>Resident supervision for construction of ${UI.escapeHtml(masterData.facility)}, ensuring quality assurance, structural durability and execution in accordance with approved drawings and specifications.</p>

    <h2 class="section-title">3. Material Quality Assurance & Field Verification</h2>
    <h3>3.1 Material Status and Inspection Matrix</h3>
    ${materials ? `<table><thead><tr><th>Material</th><th>Source/Brand</th><th>Field Quality Observation</th><th>Compliance</th></tr></thead>
    <tbody>
      <tr><td>Cement</td><td>${UI.escapeHtml(materials.cement.brand)}</td><td>${UI.escapeHtml(materials.cement.observation)}</td><td>${UI.escapeHtml(materials.cement.status)}</td></tr>
      <tr><td>Bricks</td><td>${UI.escapeHtml(materials.bricks.brand)}</td><td>${UI.escapeHtml(materials.bricks.observation)}</td><td>${UI.escapeHtml(materials.bricks.status)}</td></tr>
      <tr><td>Fine Aggregate</td><td>${UI.escapeHtml(materials.fineAggregate.source)}</td><td>${UI.escapeHtml(materials.fineAggregate.observation)}</td><td>${UI.escapeHtml(materials.fineAggregate.status)}</td></tr>
      <tr><td>Coarse Aggregate</td><td>${UI.escapeHtml(materials.coarseAggregate.source)}</td><td>${UI.escapeHtml(materials.coarseAggregate.observation)}</td><td>${UI.escapeHtml(materials.coarseAggregate.status)}</td></tr>
    </tbody></table>` : '<p class="text-muted">No material inspection record entered for this report.</p>'}
    <h3>3.2 Engineering Terminology & Field Quality Reference</h3>
    <ul class="help-list">
      <li><strong>First-Class Bricks:</strong> Thoroughly burnt, copper-colored, free from cracks; ≤20% water absorption over 24 hrs.</li>
      <li><strong>Efflorescence Monitoring:</strong> Checks for white alkaline salt deposits weakening brick-mortar bond.</li>
      <li><strong>Silt Content in Sand:</strong> Above 6% reduces mortar/concrete compressive strength.</li>
      <li><strong>Curing Water Quality:</strong> Must be clean and potable to protect reinforcement and mortar.</li>
    </ul>
    <h3>3.3 Visual Inspection of Material on Site</h3>
    ${photos.length ? `<div class="photo-grid">${photos.map(p => `<div class="photo-tile"><img src="${p.dataUrl}"><div class="meta">${UI.escapeHtml(p.caption || p.category)}</div></div>`).join('')}</div>` : '<p class="text-muted">No site photos uploaded for this report.</p>'}

    <h2 class="section-title">4. Pre-Consultancy Mobilization Baseline Record</h2>
    <table><thead><tr><th>Structural Element & Specification</th><th>Wall-1</th><th>Wall-2</th><th>Wall-3</th></tr></thead>
    <tbody>${masterData.baseline.quantities.map(q => `<tr><td>${UI.escapeHtml(q.activity)}</td><td>${UI.escapeHtml(q.wall1)}</td><td>${UI.escapeHtml(q.wall2)}</td><td>${UI.escapeHtml(q.wall3)}</td></tr>`).join('')}</tbody></table>

    <h2 class="section-title">5. Weekly Progress Work</h2>
    ${weeklyWorkHtml}

    <h2 class="section-title">6. Weekly Progress Work Highlights</h2>
    <ul class="help-list">${highlights.map(h => `<li>${UI.escapeHtml(h)}</li>`).join('')}</ul>

    <h2 class="section-title">7. Cumulative Project History Work Flow (1 Panel = 36'-0")</h2>
    <table><thead><tr><th>Date</th><th>Report ID</th><th>Bricks</th><th>Cement</th><th>Fine Sand</th><th>Coarse Agg.</th><th>Steel (T)</th><th>Remarks</th></tr></thead>
    <tbody>
      ${cumulativeHistory.rows.map(r => `<tr><td>${UI.formatDateShort(r.date)}</td><td>${UI.escapeHtml(r.reportId)}</td><td>${Calc.formatNum(r.bricks)}</td><td>${Calc.formatNum(r.cement)}</td><td>${Calc.formatNum(r.fineSand)}</td><td>${Calc.formatNum(r.coarseAgg)}</td><td>${Calc.formatNum(r.steel)}</td><td>${UI.escapeHtml(r.remarks)}</td></tr>`).join('')}
      <tr class="total-row"><td colspan="2">Total ${UI.escapeHtml(cumulativeHistory.totals.reportId)}</td><td>${Calc.formatNum(cumulativeHistory.totals.bricks)}</td><td>${Calc.formatNum(cumulativeHistory.totals.cement)}</td><td>${Calc.formatNum(cumulativeHistory.totals.fineSand)}</td><td>${Calc.formatNum(cumulativeHistory.totals.coarseAgg)}</td><td>${Calc.formatNum(cumulativeHistory.totals.steel)}</td><td>—</td></tr>
    </tbody></table>

    <h2 class="section-title">8. Weekly Progress Breakdown by Structural Levels</h2>
    <table><thead><tr><th>Structural Element & Design Specification</th><th>Wall-1</th><th>Wall-2</th><th>Wall-3</th><th>Weekly Cumulative Total</th></tr></thead>
    <tbody>${structuralBreakdown.map(r => `<tr><td>${UI.escapeHtml(r.label)}</td><td>${r.wall1}</td><td>${r.wall2}</td><td>${r.wall3}</td><td>${r.weeklyTotal}</td></tr>`).join('')}</tbody></table>

    <h2 class="section-title">9. Executive Summary & Engineering Conclusion</h2>
    ${execSummary.map(p => `<p>${UI.escapeHtml(p)}</p>`).join('')}
  </div>`;
};

App.exportReport = async function (format) {
  if (!this.currentReportId) { UI.toast('Select a report first.', 'error'); return; }
  UI.toast(`Generating ${format.toUpperCase()}…`, 'info');
  try {
    const payload = await ReportEngine.buildReportPayload(this.currentReportId);
    if (!api.online) { UI.toast('Word/PDF export needs the optional local Flask backend (see README). Data is unaffected.', 'warn', 7000); return; }
    const blob = format === 'docx' ? await api.generateDocx(payload) : await api.generatePdf(payload);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${payload.report.reportNumber}.${format}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    UI.toast(`${format.toUpperCase()} downloaded.`, 'success');
  } catch (e) {
    console.error(e);
    UI.toast('Export failed: ' + e.message, 'error');
  }
};

/* =========================================================
   PAGE: Report History
   ========================================================= */
App.pages.history = async function () {
  const reports = await storage.getReports();
  this.main().innerHTML = `
    ${this.topbar('Report History', 'All weekly reports are preserved permanently — nothing is overwritten.', Auth.canCreate() ? `<button class="btn primary" id="btnNew">+ New Weekly Report</button>` : '')}
    <div class="card">
      ${reports.length === 0 ? `<div class="empty-state"><div class="ic">🗂️</div>No weekly reports yet.</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>Report #</th><th>Week</th><th>Start</th><th>End</th><th>Status</th><th>Last Updated</th><th>Actions</th></tr></thead>
        <tbody>${reports.slice().reverse().map(r => `<tr>
          <td>${UI.escapeHtml(r.reportNumber)}</td><td>${UI.escapeHtml(r.weekLabel)}</td>
          <td>${UI.formatDateShort(r.startDate)}</td><td>${UI.formatDateShort(r.endDate)}</td>
          <td>${App.statusBadge(r)}</td>
          <td class="text-sm text-muted">${r.lastUpdated ? new Date(r.lastUpdated).toLocaleString() : ''}</td>
          <td class="flex-gap">
            <button class="btn sm ghost" data-view="${r.id}">Daily</button>
            ${Auth.canEditReport(r) ? `<button class="btn sm ghost" data-edit="${r.id}">Edit</button>` : ''}
            ${Auth.canSubmit(r) ? `<button class="btn sm amber" data-submit="${r.id}">Submit</button>` : ''}
            ${Auth.canReview(r) ? `<button class="btn sm primary" data-approve="${r.id}">Approve</button><button class="btn sm danger" data-return="${r.id}">Return</button>` : ''}
            ${Auth.canCreate() ? `<button class="btn sm ghost" data-dup="${r.id}">Duplicate</button>` : ''}
            <button class="btn sm ghost" data-prev="${r.id}">Preview</button>
            ${Auth.canDelete(r) ? `<button class="btn sm danger" data-del="${r.id}">Delete</button>` : ''}
          </td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>
  `;
  const _bnh = document.getElementById('btnNew'); if (_bnh) _bnh.onclick = () => this.navigate('new-report');
  const main = this.main();
  main.querySelectorAll('[data-view]').forEach(b => b.onclick = () => this.navigate('daily-progress', b.getAttribute('data-view')));
  main.querySelectorAll('[data-prev]').forEach(b => b.onclick = () => this.navigate('preview', b.getAttribute('data-prev')));
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { this._editingReportId = b.getAttribute('data-edit'); this.navigate('new-report'); });
  main.querySelectorAll('[data-submit]').forEach(b => b.onclick = () => this.submitReport(b.getAttribute('data-submit')));
  main.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => this.reviewReport(b.getAttribute('data-approve'), 'Approved'));
  main.querySelectorAll('[data-return]').forEach(b => b.onclick = () => this.reviewReport(b.getAttribute('data-return'), 'Returned'));
  main.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => this.duplicateReport(b.getAttribute('data-dup')));
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const ok = await UI.confirm('This permanently deletes the report and all its daily/material/photo records. Continue?', { danger: true, okText: 'Delete Report' });
    if (!ok) return;
    try { await storage.deleteReport(b.getAttribute('data-del')); }
    catch (e) { UI.toast('Delete failed: ' + e.message, 'error', 6000); return; }
    UI.toast('Report deleted.', 'success');
    this.pages.history.call(this);
  });
};

App.submitReport = async function (id) {
  const days = await storage.getDailyProgressByReport(id);
  if (!days.length) { UI.toast('Add at least one daily record before submitting.', 'error'); return; }
  const ok = await UI.confirm('Submit this report for supervisor review? It will be locked for editing unless it is returned.', { okText: 'Submit' });
  if (!ok) return;
  try { await storage.submitReport(id); }
  catch (e) { UI.toast('Submit failed: ' + (e.code === 'permission-denied' ? 'permission denied.' : e.message), 'error', 6000); return; }
  UI.toast('Report submitted for review. ' + storage.saveNotice(), 'success', 4500);
  this.navigate('history');
};

App.reviewReport = function (id, decision) {
  const approve = decision === 'Approved';
  const back = UI.openModal(`
    <h3>${approve ? 'Approve report' : 'Return report to inspector'}</h3>
    <div class="field"><label>Review note${approve ? ' (optional)' : ' *'}</label><textarea id="rvNote"></textarea></div>
    <div class="flex-end flex-gap mt-16"><button class="btn ghost" id="rvCancel">Cancel</button>
    <button class="btn ${approve ? 'primary' : 'danger'}" id="rvOk">${approve ? 'Approve' : 'Return'}</button></div>`);
  back.querySelector('#rvCancel').onclick = () => UI.closeModal(back);
  back.querySelector('#rvOk').onclick = async () => {
    const note = back.querySelector('#rvNote').value.trim();
    if (!approve && !note) { UI.toast('Please explain what needs to be fixed.', 'error'); return; }
    try { await storage.reviewReport(id, decision, note); }
    catch (e) { UI.toast('Failed: ' + (e.code === 'permission-denied' ? 'permission denied.' : e.message), 'error', 6000); return; }
    UI.closeModal(back);
    UI.toast(`Report ${decision.toLowerCase()}. ${storage.saveNotice()}`, 'success', 4500);
    this.navigate('history');
  };
};

App.duplicateReport = async function (id) {
  const src = await storage.getReport(id);
  const reports = await storage.getReports();
  const nums = reports.map(r => parseInt((r.reportNumber.match(/(\d+)/) || [0, 0])[1])).filter(n => !isNaN(n));
  const nextNum = (Math.max(0, ...nums) + 1);
  const newReport = Object.assign({}, src, {
    id: undefined, createdAt: undefined, submittedAt: undefined, submittedBy: undefined,
    reviewNote: undefined, reviewedBy: undefined, reviewedByName: undefined, reviewedAt: undefined,
    reportNumber: src.reportNumber.replace(/\d+/, String(nextNum).padStart(2, '0')),
    status: 'Draft'
  });
  const saved = await storage.saveReport(newReport);
  UI.toast(`Duplicated as ${saved.reportNumber}. Update dates and daily progress for the new week.`, 'success', 5000);
  this._editingReportId = saved.id;
  this.currentReportId = saved.id;
  this.navigate('new-report');
};

/* =========================================================
   PAGE: Project Setup
   ========================================================= */
App.pages.setup = async function () {
  const m = await storage.getMasterData();
  this.main().innerHTML = `
    ${this.topbar('Project Setup', 'Master project information used across all future weekly reports.')}
    <div class="card">
      <h2>Project Information</h2>
      <div class="grid cols-2">
        <div class="field" style="grid-column:1/-1"><label>Project Title</label><textarea id="s_projectTitle">${UI.escapeHtml(m.projectTitle)}</textarea></div>
        <div class="field"><label>Client</label><input id="s_client" type="text" value="${UI.escapeHtml(m.client)}"></div>
        <div class="field"><label>Facility</label><input id="s_facility" type="text" value="${UI.escapeHtml(m.facility)}"></div>
        <div class="field" style="grid-column:1/-1"><label>Client Address</label><textarea id="s_clientAddress">${UI.escapeHtml(m.clientAddress)}</textarea></div>
        <div class="field"><label>Consultant</label><input id="s_consultant" type="text" value="${UI.escapeHtml(m.consultant)}"></div>
        <div class="field"><label>Location</label><input id="s_location" type="text" value="${UI.escapeHtml(m.location)}"></div>
        <div class="field"><label>Project Duration</label><input id="s_projectDuration" type="text" value="${UI.escapeHtml(m.projectDuration)}"></div>
        <div class="field"><label>Project Estimate</label><input id="s_projectEstimate" type="text" value="${UI.escapeHtml(m.projectEstimate)}"></div>
        <div class="field"><label>Mobilization Date</label><input id="s_mobilizationDate" type="date" value="${m.mobilizationDate}"></div>
        <div class="field"><label>Resident Engineer</label><input id="s_residentEngineer" type="text" value="${UI.escapeHtml(m.residentEngineer)}"></div>
        <div class="field"><label>Quality Inspector</label><input id="s_qualityInspector" type="text" value="${UI.escapeHtml(m.qualityInspector)}"></div>
        <div class="field"><label>Project Coordinator</label><input id="s_projectCoordinator" type="text" value="${UI.escapeHtml(m.projectCoordinator)}"></div>
        <div class="field" style="grid-column:1/-1"><label>Governing Standards</label><textarea id="s_governingStandards">${UI.escapeHtml(m.governingStandards)}</textarea></div>
      </div>
      <div class="flex-end"><button class="btn primary" id="btnSaveMaster">Save Project Information</button></div>
    </div>

    <div class="card">
      <h2>Baseline Quantities (Pre-Consultancy Mobilization Record)</h2>
      <p class="card-desc">Edit only if the verified baseline changes. This feeds Section 4 of every report.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Activity</th><th>Wall-1</th><th>Wall-2</th><th>Wall-3</th></tr></thead>
        <tbody>${m.baseline.quantities.map((q, i) => `<tr>
          <td><input type="text" data-b="activity" data-i="${i}" value="${UI.escapeHtml(q.activity)}"></td>
          <td><input type="text" data-b="wall1" data-i="${i}" value="${UI.escapeHtml(q.wall1)}"></td>
          <td><input type="text" data-b="wall2" data-i="${i}" value="${UI.escapeHtml(q.wall2)}"></td>
          <td><input type="text" data-b="wall3" data-i="${i}" value="${UI.escapeHtml(q.wall3)}"></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="flex-end mt-16"><button class="btn primary" id="btnSaveBaseline">Save Baseline</button></div>
    </div>
  `;

  document.getElementById('btnSaveMaster').onclick = async () => {
    const fields = ['projectTitle', 'client', 'facility', 'clientAddress', 'consultant', 'location', 'projectDuration', 'projectEstimate', 'mobilizationDate', 'residentEngineer', 'qualityInspector', 'projectCoordinator', 'governingStandards'];
    fields.forEach(f => m[f] = document.getElementById('s_' + f).value.trim());
    await storage.saveMasterData(m);
    UI.toast('Project information saved. ' + storage.saveNotice(), 'success');
  };

  document.getElementById('btnSaveBaseline').onclick = async () => {
    document.querySelectorAll('[data-b]').forEach(inp => {
      m.baseline.quantities[+inp.getAttribute('data-i')][inp.getAttribute('data-b')] = inp.value;
    });
    await storage.saveMasterData(m);
    UI.toast('Baseline saved. ' + storage.saveNotice(), 'success');
  };
};

/* =========================================================
   PAGE: Settings (backup / restore / data mgmt)
   ========================================================= */
App.pages.settings = async function () {
  const st = storage.connState();
  this.main().innerHTML = `
    ${this.topbar('Settings', 'Account, cloud connection and backup.')}
    <div class="card">
      <h2>Cloud Connection</h2>
      <p class="text-sm">Signed in as <strong>${UI.escapeHtml(Auth.profile.name || Auth.profile.email)}</strong> (${Auth.profile.role})</p>
      <p class="text-sm">Site: <strong>${UI.escapeHtml(storage.siteName || '—')}</strong></p>
      <p class="text-sm">Backend: <strong>Firebase Firestore</strong> — status: <strong>${st === 'offline' ? 'Offline (changes queue locally)' : st === 'syncing' ? 'Syncing…' : 'Online, synced'}</strong></p>
      <p class="text-sm">Word/PDF export backend (optional): <strong>${api.online ? 'Connected' : 'Not running'}</strong> (${API_BASE_URL})</p>
    </div>
    <div class="card">
      <h2>Backup / Restore</h2>
      <p class="card-desc">Export this site's data to JSON. ${Auth.isAdmin() ? 'Admins can also import a JSON backup — including the backup file exported from the old offline (IndexedDB) version of this app.' : ''}</p>
      <div class="flex-gap">
        <button class="btn primary" id="btnExportData">Export Site Data (JSON)</button>
        ${Auth.isAdmin() ? '<label class="btn ghost" style="cursor:pointer">Import Data (JSON)<input type="file" id="importFile" accept="application/json" class="hidden"></label>' : ''}
      </div>
    </div>`;

  document.getElementById('btnExportData').onclick = async () => {
    const data = await storage.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `wir-backup-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    UI.toast('Backup exported.', 'success');
  };

  const imp = document.getElementById('importFile');
  if (imp) imp.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ok = await UI.confirm('Import this file into the current site? Existing records with the same IDs are overwritten.', { okText: 'Import' });
      if (!ok) return;
      UI.toast('Importing…', 'info');
      const n = await storage.importAll(data);
      UI.toast(`Imported ${n} records. ${storage.saveNotice()}`, 'success', 5000);
    } catch (err) { console.error(err); UI.toast('Import failed: ' + err.message, 'error', 6000); }
  });
};

window.addEventListener('DOMContentLoaded', () => App.init());
