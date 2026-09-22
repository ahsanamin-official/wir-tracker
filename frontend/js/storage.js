/* ===========================================================
   storage.js — Firestore data layer (replaces the old IndexedDB layer)
   Same method names as before so app.js / reports.js / validation.js keep working.

   Data model (all under one site):
     users/{uid}                      { name, email, role, siteIds[], active }
     sites/{siteId}                   { name, master{...project setup...} }
     sites/{siteId}/reports/{id}      weekly report (+ status workflow)
     sites/{siteId}/dailyProgress/{id}
     sites/{siteId}/materials/{id}
     sites/{siteId}/photos/{id}       photo as compressed data-URL (Storage needs Blaze plan)

   Read-cost strategy: live listeners on reports / dailyProgress / materials keep an
   in-memory cache, so every getX() call is free. Photos are fetched per report, cached.
   =========================================================== */

class CloudStorage {
  constructor() {
    this.mode = 'firestore';
    this.db = null;
    this.auth = null;
    this.siteId = null;
    this.siteRef = null;
    this.master = null;
    this.cache = { reports: [], dailyProgress: [], materials: [], calcSheets: [] };
    this.photoCache = {};
    this.unsubs = [];
    this.pending = {};
    this.lastSave = 'cloud';
    this.onRemoteChange = null;
    this.onStatus = null;
  }

  /* ---------- init / connectivity ---------- */
  init() {
    const cfg = window.WIR_CONFIG && window.WIR_CONFIG.firebase;
    if (!cfg || !cfg.apiKey) return false;
    firebase.initializeApp(cfg);
    this.auth = firebase.auth();
    this.db = firebase.firestore();
    this.db.enablePersistence({ synchronizeTabs: true })
      .catch(e => console.warn('Offline cache unavailable:', e.code));
    const ping = () => this.onStatus && this.onStatus();
    window.addEventListener('online', ping);
    window.addEventListener('offline', ping);
    return true;
  }

  connState() {
    if (!navigator.onLine) return 'offline';
    return Object.values(this.pending).some(Boolean) ? 'syncing' : 'synced';
  }

  /* ---------- site attach / detach (real-time listeners) ---------- */
  detach() {
    this.unsubs.forEach(u => { try { u(); } catch (e) {} });
    this.unsubs = [];
    this.pending = {};
  }

  attachSite(siteId) {
    this.detach();
    this.siteId = siteId;
    this.siteRef = this.db.doc('sites/' + siteId);
    this.master = null;
    this.siteName = '';
    this.cache = { reports: [], dailyProgress: [], materials: [], calcSheets: [] };
    this.photoCache = {};

    const waits = [];
    const listen = (key, ref, apply) => {
      let initial = true;
      waits.push(new Promise(resolve => {
        const un = ref.onSnapshot({ includeMetadataChanges: true }, snap => {
          apply(snap);
          this.pending[key] = snap.metadata.hasPendingWrites;
          if (this.onStatus) this.onStatus();
          if (!initial && !snap.metadata.hasPendingWrites && snap.docChanges && snap.docChanges().length && this.onRemoteChange) {
            this.onRemoteChange(key);
          }
          if (initial) { initial = false; resolve(); }
        }, err => {
          console.error('Listener error (' + key + '):', err);
          UI.toast('Cannot read ' + key + ': ' + (err.code || err.message), 'error', 6000);
          resolve();
        });
        this.unsubs.push(un);
      }));
    };

    listen('site', this.siteRef, snap => {
      const d = snap.exists ? snap.data() : {};
      this.master = d.master || null;
      this.siteName = d.name || siteId;
    });
    ['reports', 'dailyProgress', 'materials', 'calcSheets'].forEach(key => {
      listen(key, this.siteRef.collection(key), snap => {
        this.cache[key] = snap.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
      });
    });

    return Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 10000))]);
  }

  /* ---------- helpers ---------- */
  _now() { return new Date().toISOString(); }
  _user() { return this.auth.currentUser; }
  _clean(o) { return JSON.parse(JSON.stringify(o)); }           // strips undefined (Firestore rejects it)
  _id(p) { return p + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
  _col(name) { return this.siteRef.collection(name); }

  // Resolves when the server confirms the write. If offline / slow, resolves as "pending"
  // (Firestore keeps the write queued locally and syncs it automatically).
  _commit(promise) {
    return new Promise((resolve, reject) => {
      let settled = false;
      promise.then(() => {
        this.lastSave = 'cloud';
        if (!settled) { settled = true; resolve(); }
      }, err => {
        if (!settled) { settled = true; reject(err); }
        else UI.toast('A queued change was rejected by the server: ' + (err.code || err.message), 'error', 7000);
      });
      setTimeout(() => {
        if (!settled) { settled = true; this.lastSave = 'pending'; resolve(); }
      }, navigator.onLine ? 6000 : 500);
    });
  }

  saveNotice() {
    return this.lastSave === 'cloud' ? '☁ Saved to cloud.' : '⏳ Saved on this device — will sync when online.';
  }

  async _save(colName, rec, prefix) {
    if (!rec.id) rec.id = this._id(prefix);
    const u = this._user();
    rec.siteId = this.siteId;
    rec.updatedBy = u.uid;
    await this._commit(this._col(colName).doc(rec.id).set(this._clean(rec)));
    return rec;
  }

  /* ---------- Master data (stored on the site document) ---------- */
  async getMasterData() { return this.master ? this._clean(this.master) : this._clean(DEFAULT_MASTER); }
  async saveMasterData(data) {
    delete data.id;
    this.master = data;
    await this._commit(this.siteRef.update({ master: this._clean(data), updatedAt: this._now() }));
    return data;
  }

  /* ---------- Reports ---------- */
  reportById(id) { return this.cache.reports.find(r => r.id === id) || null; }
  async getReports() {
    return this.cache.reports.slice().sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  }
  async getReport(id) { return this.reportById(id); }
  async saveReport(report) {
    const u = this._user();
    if (!report.id) {
      report.createdBy = u.uid;
      report.createdByName = (Auth.profile && Auth.profile.name) || u.email;
      report.createdAt = this._now();
      if (!report.status) report.status = 'Draft';
    }
    report.lastUpdated = this._now();
    return this._save('reports', report, 'rep');
  }
  async submitReport(id) {
    const u = this._user();
    const patch = { status: 'Submitted', submittedBy: u.uid, submittedAt: this._now(), lastUpdated: this._now(), updatedBy: u.uid };
    await this._commit(this._col('reports').doc(id).update(patch));
  }
  async reviewReport(id, decision, note) {
    const u = this._user();
    const patch = {
      status: decision, reviewNote: note || '', reviewedBy: u.uid,
      reviewedByName: (Auth.profile && Auth.profile.name) || u.email,
      reviewedAt: this._now(), lastUpdated: this._now(), updatedBy: u.uid
    };
    await this._commit(this._col('reports').doc(id).update(patch));
  }
  async deleteReport(id) {
    // children first (their rules look at the parent report), report last
    const kids = [];
    this.cache.dailyProgress.filter(d => d.reportId === id).forEach(d => kids.push(this._col('dailyProgress').doc(d.id)));
    this.cache.materials.filter(m => m.reportId === id).forEach(m => kids.push(this._col('materials').doc(m.id)));
    this.cache.calcSheets.filter(c => c.reportId === id).forEach(c => kids.push(this._col('calcSheets').doc(c.id)));
    const ps = await this._col('photos').where('reportId', '==', id).get();
    ps.docs.forEach(d => kids.push(d.ref));
    for (const ref of kids) await this._commit(ref.delete());
    await this._commit(this._col('reports').doc(id).delete());
    delete this.photoCache[id];
  }

  /* ---------- Daily progress ---------- */
  async getDailyProgressByReport(reportId) {
    return this.cache.dailyProgress.filter(d => d.reportId === reportId)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }
  async saveDailyProgress(record) { return this._save('dailyProgress', record, 'day'); }
  async deleteDailyProgress(id) { return this._commit(this._col('dailyProgress').doc(id).delete()); }
  async getAllDailyProgress() { return this.cache.dailyProgress.slice(); }

  /* ---------- Materials (one per report) ---------- */
  async getMaterialsByReport(reportId) { return this.cache.materials.find(m => m.reportId === reportId) || null; }
  async saveMaterials(record) {
    if (!record.id) record.id = 'mat_' + record.reportId;
    return this._save('materials', record, 'mat');
  }

  /* ---------- Weekly calculation sheet (one per report; live-formula overrides only) ---------- */
  async getCalcSheetByReport(reportId) { return this.cache.calcSheets.find(c => c.reportId === reportId) || null; }
  async saveCalcSheet(record) {
    if (!record.id) record.id = 'calc_' + record.reportId;
    return this._save('calcSheets', record, 'calc');
  }

  /* ---------- Photos (compressed data-URL docs) ---------- */
  async getPhotosByReport(reportId, force = false) {
    const c = this.photoCache[reportId];
    if (c && !force && Date.now() - c.ts < 300000) return c.list;
    try {
      const snap = await this._col('photos').where('reportId', '==', reportId).get();
      const list = snap.docs.map(d => Object.assign({}, d.data(), { id: d.id }))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      this.photoCache[reportId] = { ts: Date.now(), list };
      return list;
    } catch (e) {
      console.warn('Photo fetch failed', e);
      return c ? c.list : [];
    }
  }
  async savePhoto(photo) {
    if (!photo.createdAt) photo.createdAt = this._now();
    const saved = await this._save('photos', photo, 'photo');
    const c = this.photoCache[saved.reportId] || (this.photoCache[saved.reportId] = { ts: Date.now(), list: [] });
    const i = c.list.findIndex(p => p.id === saved.id);
    if (i >= 0) c.list[i] = saved; else c.list.push(saved);
    return saved;
  }
  async deletePhoto(id) {
    await this._commit(this._col('photos').doc(id).delete());
    Object.values(this.photoCache).forEach(c => { c.list = c.list.filter(p => p.id !== id); });
  }

  /* ---------- Backup / restore (JSON format identical to the old app) ---------- */
  async exportAll() {
    const photos = (await this._col('photos').get()).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    return {
      masterData: [Object.assign({ id: 'singleton' }, this.master || DEFAULT_MASTER)],
      reports: this.cache.reports, dailyProgress: this.cache.dailyProgress,
      materials: this.cache.materials, calcSheets: this.cache.calcSheets, photos,
      _exportedAt: this._now(), _version: 1
    };
  }

  async importAll(data) {
    if (Array.isArray(data.masterData) && data.masterData[0]) {
      const m = Object.assign({}, data.masterData[0]); delete m.id;
      await this.saveMasterData(m);
    }
    const keys = ['reports', 'dailyProgress', 'materials', 'calcSheets', 'photos'];
    let count = 0;
    for (const key of keys) {
      const list = Array.isArray(data[key]) ? data[key] : [];
      for (let i = 0; i < list.length; i += 100) {
        const batch = this.db.batch();
        for (const rec0 of list.slice(i, i + 100)) {
          const rec = Object.assign({}, rec0);
          if (!rec.id) rec.id = this._id(key);
          rec.siteId = this.siteId;
          if (key === 'photos' && rec.dataUrl && rec.dataUrl.length > 800000) rec.dataUrl = await PhotoUtil.compress(rec.dataUrl);
          if (key === 'reports') { rec.createdBy = rec.createdBy || this._user().uid; rec.status = rec.status || 'Draft'; }
          batch.set(this._col(key).doc(rec.id), this._clean(rec));
          count++;
        }
        await this._commit(batch.commit());
      }
    }
    this.photoCache = {};
    return count;
  }

  /* ---------- Autosave of the in-progress form (local only, no Firestore writes) ---------- */
  saveDraft(key, data) {
    try { localStorage.setItem('WIR_DRAFT_' + key, JSON.stringify({ data, ts: Date.now() })); } catch (e) {}
  }
  loadDraft(key) {
    try { const raw = localStorage.getItem('WIR_DRAFT_' + key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  clearDraft(key) { localStorage.removeItem('WIR_DRAFT_' + key); }
}

/* Resize/compress a photo so it fits comfortably in a Firestore document (< 1 MiB). */
const PhotoUtil = {
  async compress(fileOrDataUrl, maxSide = 1280) {
    const src = typeof fileOrDataUrl === 'string' ? fileOrDataUrl : await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(fileOrDataUrl);
    });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    let scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    let out = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.72;
      out = c.toDataURL('image/jpeg', q);
      while (out.length > 800000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      if (out.length <= 800000) return out;
      scale *= 0.8;
    }
    return out;
  }
};

const storage = new CloudStorage();
