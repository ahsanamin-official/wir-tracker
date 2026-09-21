/* ===========================================================
   auth.js — Firebase Authentication, roles/permissions (UI side),
   login screen, and the admin pages (Users & Roles, Sites).
   NOTE: these checks only hide/disable UI. The real enforcement
   is in firestore.rules — never rely on the frontend alone.
   =========================================================== */

const Auth = {
  profile: null,
  sites: [],
  ready: false,
  userUnsub: null,
  ROLES: ['ADMIN', 'SUPERVISOR', 'INSPECTOR', 'VIEWER'],
  EDITABLE: ['Draft', 'Returned'],

  /* ---------- role helpers ---------- */
  role() { return this.profile ? this.profile.role : null; },
  isAdmin() { return this.role() === 'ADMIN'; },
  canCreate() { return ['ADMIN', 'INSPECTOR'].includes(this.role()); },
  canEditReport(r) { return !!r && this.canCreate() && (this.isAdmin() || this.EDITABLE.includes(r.status || 'Draft')); },
  canSubmit(r) { return !!r && this.canCreate() && this.EDITABLE.includes(r.status || 'Draft'); },
  canReview(r) { return !!r && ['ADMIN', 'SUPERVISOR'].includes(this.role()) && r.status === 'Submitted'; },
  canDelete(r) {
    if (!r) return false;
    if (this.isAdmin()) return true;
    return this.role() === 'INSPECTOR' && (r.status || 'Draft') === 'Draft' && r.createdBy === (this.profile && this.profile.uid);
  },
  navAllowed(page) {
    if (['users', 'sites', 'setup'].includes(page)) return this.isAdmin();
    if (page === 'new-report') return this.canCreate();
    return true;
  },

  /* ---------- screens ---------- */
  root() { return document.getElementById('authRoot'); },
  lock(on) { document.body.classList.toggle('auth-locked', on); },

  showMessage(html, withSignOut = false) {
    this.lock(true);
    this.root().innerHTML = `<div class="auth-card"><div class="logo">WI</div><h1>WIR Tracker</h1><p class="auth-msg">${html}</p>
      ${withSignOut ? '<button class="btn ghost" id="btnAuthOut">Sign out</button>' : ''}</div>`;
    const b = document.getElementById('btnAuthOut'); if (b) b.onclick = () => this.signOut();
  },

  showLogin(msg = '') {
    this.lock(true);
    this.root().innerHTML = `
      <div class="auth-card">
        <div class="logo">WI</div><h1>WIR Tracker</h1>
        <p class="auth-msg">Sign in with the account created by your administrator.</p>
        <div class="field"><label>Email</label><input id="loginEmail" type="email" autocomplete="username"></div>
        <div class="field"><label>Password</label><input id="loginPass" type="password" autocomplete="current-password"></div>
        <div class="auth-err" id="loginErr">${UI.escapeHtml(msg)}</div>
        <button class="btn primary" id="btnLogin" style="width:100%">Sign in</button>
        <button class="btn ghost" id="btnForgot" style="width:100%;margin-top:8px">Forgot password?</button>
      </div>`;
    const email = document.getElementById('loginEmail'), pass = document.getElementById('loginPass'), err = document.getElementById('loginErr');
    const friendly = (e) => ({
      'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.',
      'auth/user-not-found': 'Wrong email or password.', 'auth/invalid-email': 'Enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Try again later or reset your password.',
      'auth/network-request-failed': 'No internet connection.', 'auth/user-disabled': 'This account is disabled.'
    }[e.code] || e.message);
    const go = async () => {
      err.textContent = '';
      if (!email.value.trim() || !pass.value) { err.textContent = 'Enter email and password.'; return; }
      document.getElementById('btnLogin').disabled = true;
      try { await storage.auth.signInWithEmailAndPassword(email.value.trim(), pass.value); }
      catch (e) { err.textContent = friendly(e); document.getElementById('btnLogin').disabled = false; }
    };
    document.getElementById('btnLogin').onclick = go;
    pass.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    document.getElementById('btnForgot').onclick = async () => {
      if (!email.value.trim()) { err.textContent = 'Type your email first, then click "Forgot password?".'; return; }
      try { await storage.auth.sendPasswordResetEmail(email.value.trim()); err.style.color = 'var(--success)'; err.textContent = 'Password reset email sent (check spam).'; }
      catch (e) { err.style.color = ''; err.textContent = friendly(e); }
    };
  },

  /* ---------- lifecycle ---------- */
  start() {
    if (!storage.init()) {
      this.showMessage('Firebase is not configured yet.<br><br>Copy <code>.env.example</code> to <code>.env</code>, fill in your Firebase web-app values, then run <code>npm run config</code> (see README).');
      return;
    }
    storage.auth.onAuthStateChanged(u => u ? this.onSignedIn(u) : this.onSignedOut());
  },

  onSignedOut() {
    if (this.userUnsub) { this.userUnsub(); this.userUnsub = null; }
    storage.detach(); storage.siteId = null;
    this.profile = null; this.ready = false;
    this.showLogin();
  },

  async signOut() { try { await storage.auth.signOut(); } catch (e) { console.error(e); } },

  async onSignedIn(user) {
    this.showMessage('Signing in…');
    if (this.userUnsub) this.userUnsub();
    let first = true;
    await new Promise(resolve => {
      this.userUnsub = storage.db.doc('users/' + user.uid).onSnapshot(snap => {
        const p = snap.exists ? Object.assign({}, snap.data(), { uid: user.uid }) : null;
        if (first) { first = false; this.profile = p; resolve(); return; }
        const changed = JSON.stringify(p) !== JSON.stringify(this.profile);
        this.profile = p;
        if (!p || p.active === false) { this.signOut(); return; }
        if (changed) { UI.toast('Your access was updated by an administrator.', 'info', 5000); this.enterApp(); }
      }, err => { console.error(err); if (first) { first = false; this.profile = null; resolve(); } });
    });
    if (!this.profile) return this.showMessage('Your account is not set up yet. Ask an administrator to add you (or, for the first admin, create your <code>users/' + user.uid + '</code> document — see README).', true);
    if (this.profile.active === false) return this.showMessage('Your account has been deactivated.', true);
    if (!this.ROLES.includes(this.profile.role)) return this.showMessage('Your account has no valid role assigned.', true);
    await this.enterApp();
  },

  async enterApp() {
    const p = this.profile;
    let sites = [];
    try {
      if (p.role === 'ADMIN') {
        sites = (await storage.db.collection('sites').get()).docs.map(d => ({ id: d.id, name: d.data().name || d.id }));
      } else {
        const snaps = await Promise.all((p.siteIds || []).map(id => storage.db.doc('sites/' + id).get().catch(() => null)));
        sites = snaps.filter(s => s && s.exists).map(s => ({ id: s.id, name: s.data().name || s.id }));
      }
    } catch (e) { console.error(e); return this.showMessage('Could not load sites: ' + UI.escapeHtml(e.message), true); }
    sites.sort((a, b) => a.name.localeCompare(b.name));
    this.sites = sites;

    if (!sites.length) {
      if (!this.isAdmin()) return this.showMessage('No site is assigned to your account yet. Ask an administrator.', true);
      storage.detach(); storage.siteId = null;
    } else {
      const saved = localStorage.getItem('WIR_SITE');
      const id = sites.some(s => s.id === saved) ? saved : sites[0].id;
      if (storage.siteId !== id) { App.currentReportId = null; await storage.attachSite(id); }
      localStorage.setItem('WIR_SITE', id);
    }
    this.ready = true;
    this.lock(false);
    this.root().innerHTML = '';
    App.start();
  },

  async switchSite(id) {
    localStorage.setItem('WIR_SITE', id);
    App.currentReportId = null;
    await storage.attachSite(id);
    location.hash = 'home';
    App.start();
  },

  renderUserBox() {
    const box = document.getElementById('userBox'); if (!box || !this.profile) return;
    const opts = this.sites.map(s => `<option value="${s.id}" ${s.id === storage.siteId ? 'selected' : ''}>${UI.escapeHtml(s.name)}</option>`).join('');
    box.innerHTML = `
      <div class="ub-name">${UI.escapeHtml(this.profile.name || this.profile.email || '')}</div>
      <div class="ub-role"><span class="badge grey">${this.profile.role}</span></div>
      ${this.sites.length > 1 ? `<select id="siteSwitch" title="Switch site">${opts}</select>` : ''}
      <button class="btn sm ghost" id="btnSignOut" style="margin-top:8px;width:100%">Sign out</button>`;
    const sw = document.getElementById('siteSwitch'); if (sw) sw.onchange = () => this.switchSite(sw.value);
    document.getElementById('btnSignOut').onclick = () => this.signOut();
    const t2 = document.querySelector('#brand .t2'); if (t2) t2.textContent = storage.siteName || 'No site selected';
  },

  /* ---------- admin: create user without logging the admin out ---------- */
  async createAuthUser(email, password) {
    const cfg = window.WIR_CONFIG.firebase;
    let app2 = firebase.apps.find(a => a.name === 'secondary');
    if (!app2) app2 = firebase.initializeApp(cfg, 'secondary');
    const cred = await app2.auth().createUserWithEmailAndPassword(email, password);
    await app2.auth().signOut();
    return cred.user.uid;
  }
};

/* =========================================================
   PAGE: Users & Roles (ADMIN)
   ========================================================= */
App.pages.users = async function () {
  if (!Auth.isAdmin()) return this.navigate('home');
  this.main().innerHTML = this.topbar('Users & Roles', 'Create accounts and control who can access which site.', '<button class="btn primary" id="btnAddUser">+ Add User</button>') + '<div class="card" id="userList">Loading…</div>';
  let users = [];
  try { users = (await storage.db.collection('users').get()).docs.map(d => Object.assign({ uid: d.id }, d.data())); }
  catch (e) { document.getElementById('userList').textContent = 'Failed to load users: ' + e.message; return; }
  users.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  const siteName = id => (Auth.sites.find(s => s.id === id) || {}).name || id;
  document.getElementById('userList').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Sites</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${users.map(u => `<tr>
      <td>${UI.escapeHtml(u.name)}</td><td>${UI.escapeHtml(u.email)}</td><td><span class="badge grey">${UI.escapeHtml(u.role)}</span></td>
      <td class="text-sm">${u.role === 'ADMIN' ? 'All sites' : (u.siteIds || []).map(s => UI.escapeHtml(siteName(s))).join(', ') || '—'}</td>
      <td><span class="badge ${u.active === false ? 'red' : 'green'}">${u.active === false ? 'Inactive' : 'Active'}</span></td>
      <td class="flex-gap"><button class="btn sm ghost" data-edit="${u.uid}">Edit</button><button class="btn sm ghost" data-reset="${u.email}">Reset password</button></td>
    </tr>`).join('')}</tbody></table></div>`;
  document.getElementById('btnAddUser').onclick = () => this.openUserForm(null, users);
  this.main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => this.openUserForm(users.find(u => u.uid === b.getAttribute('data-edit')), users));
  this.main().querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    try { await storage.auth.sendPasswordResetEmail(b.getAttribute('data-reset')); UI.toast('Password reset email sent.', 'success'); }
    catch (e) { UI.toast(e.message, 'error'); }
  });
};

App.openUserForm = function (user, users) {
  const isNew = !user;
  const u = user || { role: 'INSPECTOR', siteIds: [], active: true };
  const back = UI.openModal(`
    <h3>${isNew ? 'Add user' : 'Edit user'}</h3>
    <div class="field"><label>Full name *</label><input id="u_name" value="${UI.escapeHtml(u.name || '')}"></div>
    <div class="field"><label>Email *</label><input id="u_email" type="email" value="${UI.escapeHtml(u.email || '')}" ${isNew ? '' : 'disabled'}></div>
    ${isNew ? '<div class="field"><label>Temporary password * (min 8 chars)</label><input id="u_pass" type="text" autocomplete="off"></div>' : ''}
    <div class="field"><label>Role</label><select id="u_role">${Auth.ROLES.map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <div class="text-sm text-muted mt-10">ADMIN: everything · SUPERVISOR: review submitted reports · INSPECTOR: create/edit/submit reports · VIEWER: read-only</div></div>
    <div class="field"><label>Assigned sites (not needed for ADMIN)</label>
      ${Auth.sites.length ? Auth.sites.map(s => `<label style="display:block;font-weight:400"><input type="checkbox" data-site="${s.id}" ${(u.siteIds || []).includes(s.id) ? 'checked' : ''}> ${UI.escapeHtml(s.name)}</label>`).join('') : '<span class="text-sm text-muted">No sites yet — create one under Sites.</span>'}</div>
    ${isNew ? '' : `<label style="display:block"><input type="checkbox" id="u_active" ${u.active === false ? '' : 'checked'}> Account active</label>`}
    <div class="auth-err" id="u_err"></div>
    <div class="flex-end flex-gap mt-16"><button class="btn ghost" id="u_cancel">Cancel</button><button class="btn primary" id="u_save">${isNew ? 'Create user' : 'Save'}</button></div>`);
  back.querySelector('#u_cancel').onclick = () => UI.closeModal(back);
  back.querySelector('#u_save').onclick = async () => {
    const err = back.querySelector('#u_err'); err.textContent = '';
    const name = back.querySelector('#u_name').value.trim();
    const email = back.querySelector('#u_email').value.trim().toLowerCase();
    const role = back.querySelector('#u_role').value;
    const siteIds = [...back.querySelectorAll('[data-site]:checked')].map(c => c.getAttribute('data-site'));
    if (!name || !email) { err.textContent = 'Name and email are required.'; return; }
    if (role !== 'ADMIN' && !siteIds.length) { err.textContent = 'Assign at least one site (or make the user an ADMIN).'; return; }
    back.querySelector('#u_save').disabled = true;
    try {
      if (isNew) {
        const pass = back.querySelector('#u_pass').value;
        if (pass.length < 8) { err.textContent = 'Password must be at least 8 characters.'; back.querySelector('#u_save').disabled = false; return; }
        const uid = await Auth.createAuthUser(email, pass);
        await storage.db.doc('users/' + uid).set({ name, email, role, siteIds, active: true, createdAt: new Date().toISOString(), createdBy: Auth.profile.uid });
        UI.toast('User created. Share the temporary password securely.', 'success', 5000);
      } else {
        const active = back.querySelector('#u_active').checked;
        if (user.uid === Auth.profile.uid && (role !== 'ADMIN' || !active)) { err.textContent = 'You cannot remove your own admin access.'; back.querySelector('#u_save').disabled = false; return; }
        await storage.db.doc('users/' + user.uid).update({ name, role, siteIds, active });
        UI.toast('User updated.', 'success');
      }
      UI.closeModal(back); this.pages.users.call(this);
    } catch (e) {
      err.textContent = e.code === 'auth/email-already-in-use' ? 'That email already has an account.' : (e.message || String(e));
      back.querySelector('#u_save').disabled = false;
    }
  };
};

/* =========================================================
   PAGE: Sites (ADMIN)
   ========================================================= */
App.pages.sites = async function () {
  if (!Auth.isAdmin()) return this.navigate('home');
  this.main().innerHTML = this.topbar('Sites', 'Each site has its own reports, daily records, materials and photos.', '<button class="btn primary" id="btnAddSite">+ Add Site</button>') +
    (Auth.sites.length ? '' : '<div class="card"><strong>Welcome!</strong> Create your first site to start. It starts from the default project template — edit details later in Project Setup.</div>') +
    `<div class="card"><div class="table-wrap"><table><thead><tr><th>Site</th><th>Actions</th></tr></thead><tbody>
    ${Auth.sites.map(s => `<tr><td>${UI.escapeHtml(s.name)} ${s.id === storage.siteId ? '<span class="badge green">current</span>' : ''}</td>
      <td class="flex-gap">${s.id === storage.siteId ? '' : `<button class="btn sm ghost" data-open="${s.id}">Open</button>`}<button class="btn sm ghost" data-rename="${s.id}">Rename</button></td></tr>`).join('') || '<tr><td colspan="2" class="text-muted">No sites yet.</td></tr>'}
    </tbody></table></div></div>`;
  document.getElementById('btnAddSite').onclick = () => {
    const back = UI.openModal(`<h3>Add site</h3><div class="field"><label>Site name *</label><input id="s_name" placeholder="e.g. Jhang Housing Scheme"></div>
      <div class="flex-end flex-gap mt-16"><button class="btn ghost" id="s_cancel">Cancel</button><button class="btn primary" id="s_ok">Create</button></div>`);
    back.querySelector('#s_cancel').onclick = () => UI.closeModal(back);
    back.querySelector('#s_ok').onclick = async () => {
      const name = back.querySelector('#s_name').value.trim(); if (!name) return;
      const master = JSON.parse(JSON.stringify(DEFAULT_MASTER)); delete master.id; master.projectTitle = name;
      try {
        const ref = await storage.db.collection('sites').add({ name, master, createdAt: new Date().toISOString(), createdBy: Auth.profile.uid });
        UI.closeModal(back); UI.toast('Site created.', 'success');
        await Auth.enterApp(); Auth.switchSite(ref.id);
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  };
  this.main().querySelectorAll('[data-open]').forEach(b => b.onclick = () => Auth.switchSite(b.getAttribute('data-open')));
  this.main().querySelectorAll('[data-rename]').forEach(b => b.onclick = () => {
    const s = Auth.sites.find(x => x.id === b.getAttribute('data-rename'));
    const back = UI.openModal(`<h3>Rename site</h3><div class="field"><input id="s_name" value="${UI.escapeHtml(s.name)}"></div>
      <div class="flex-end flex-gap mt-16"><button class="btn ghost" id="s_cancel">Cancel</button><button class="btn primary" id="s_ok">Save</button></div>`);
    back.querySelector('#s_cancel').onclick = () => UI.closeModal(back);
    back.querySelector('#s_ok').onclick = async () => {
      const name = back.querySelector('#s_name').value.trim(); if (!name) return;
      try { await storage.db.doc('sites/' + s.id).update({ name }); UI.closeModal(back); await Auth.enterApp(); App.navigate('sites'); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
  });
};
