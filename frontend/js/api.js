/* ===========================================================
   api.js — Local API service layer
   OPTIONAL Flask backend — now used ONLY for Word/PDF export.
   All data lives in Firebase (see storage.js).
   =========================================================== */

const API_BASE_URL = (window.WIR_CONFIG && window.WIR_CONFIG.apiBaseUrl) || "http://localhost:5000/api";

class ApiService {
  constructor() {
    this.online = false;
    this.checked = false;
  }

  async checkHealth() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1800);
      const res = await fetch(`${API_BASE_URL}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      this.online = res.ok;
    } catch (e) {
      this.online = false;
    }
    this.checked = true;
    return this.online;
  }

  async _request(path, options = {}) {
    if (!this.online) throw new Error('API offline');
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`API error ${res.status}: ${txt}`);
    }
    return res.json().catch(() => ({}));
  }

  // ---- Project / master data ----
  async getProject() { return this._request('/projects'); }
  async saveProject(data) { return this._request('/projects', { method: 'PUT', body: JSON.stringify(data) }); }

  // ---- Reports ----
  async getWeeklyReports() { return this._request('/reports'); }
  async getReportById(id) { return this._request(`/reports/${id}`); }
  async createWeeklyReport(payload) { return this._request('/reports', { method: 'POST', body: JSON.stringify(payload) }); }
  async updateWeeklyReport(id, payload) { return this._request(`/reports/${id}`, { method: 'PUT', body: JSON.stringify(payload) }); }
  async deleteWeeklyReport(id) { return this._request(`/reports/${id}`, { method: 'DELETE' }); }

  // ---- Daily progress ----
  async saveDailyProgress(payload) { return this._request('/daily-progress', { method: 'POST', body: JSON.stringify(payload) }); }
  async getDailyProgress(reportId) { return this._request(`/daily-progress?reportId=${reportId}`); }

  // ---- Materials ----
  async saveMaterialRecord(payload) { return this._request('/materials', { method: 'POST', body: JSON.stringify(payload) }); }

  // ---- Photos ----
  async savePhoto(payload) { return this._request('/photos', { method: 'POST', body: JSON.stringify(payload) }); }

  // ---- Cumulative ----
  async getCumulativeProgress() { return this._request('/cumulative-progress'); }

  // ---- Generation (sends full compiled payload to backend) ----
  async generateDocx(payload) {
    const res = await fetch(`${API_BASE_URL}/generate-report?format=docx`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('DOCX generation failed: ' + res.status);
    return res.blob();
  }
  async generatePdf(payload) {
    const res = await fetch(`${API_BASE_URL}/generate-report?format=pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('PDF generation failed: ' + res.status);
    return res.blob();
  }
}

const api = new ApiService();
