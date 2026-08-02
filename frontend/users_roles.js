// ============================================================
// المستخدمون والأدوار والصلاحيات — LEGEND D ERP
// يعتمد على api()/API المعرّفين بـ script.js (يُحمَّل هذا الملف بعده).
// ============================================================

let uzUsers = [];
let uzRoles = [];
let uzCatalog = { modules: [], actions: [] };
let uzLoaded = false;
let uzEditUserId = null;
let uzEditRoleId = null;
let uzMatrixRoleId = null;
let uzMatrixDraft = null; // { moduleKey: Set(actionKeys) }

function uzEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uzToast(msg, ok) {
  if (typeof toast === 'function') { toast(msg); return; }
  if (ok === false) alert(msg); else alert(msg);
}

function uzInitials(name) {
  name = (name || '').trim();
  if (!name) return '؟';
  const parts = name.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function uzFmtDateTime(iso) {
  if (!iso) return 'لم يسجّل الدخول بعد';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const time = d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  return `${date} — ${time}`;
}

const UZ_ROLE_COLORS = {
  admin: 'uz-role-c0',
  accountant: 'uz-role-c2',
  purchasing_officer: 'uz-role-c3',
  warehouse_manager: 'uz-role-c1',
  warehouse_keeper: 'uz-role-c1',
  cashier: 'uz-role-c4',
  viewer: 'uz-role-c5',
};
function uzRoleColorClass(code) {
  if (UZ_ROLE_COLORS[code]) return UZ_ROLE_COLORS[code];
  let h = 0;
  for (const ch of String(code || '')) h = (h * 31 + ch.charCodeAt(0)) % 6;
  return 'uz-role-c' + h;
}

// ============================================================
// تحميل البيانات
// ============================================================
async function uzEnsureLoaded() {
  if (uzLoaded) return;
  await uzLoadAll();
}

async function uzLoadAll() {
  try {
    const [catalog, roles, users] = await Promise.all([
      api('GET', '/api/permissions/catalog'),
      api('GET', '/api/roles'),
      api('GET', '/api/users'),
    ]);
    uzCatalog = catalog || { modules: [], actions: [] };
    uzRoles = roles || [];
    uzUsers = users || [];
    uzLoaded = true;
    uzRenderAll();
  } catch (e) {
    uzToast('تعذر تحميل بيانات المستخدمين والصلاحيات: ' + (e.message || e), false);
  }
}

function uzRenderAll() {
  uzRenderKpis();
  uzPopulateRoleSelectors();
  uzRenderUsers();
  uzRenderRoles();
}

// ============================================================
// شاشة المستخدمين
// ============================================================
function uzRenderKpis() {
  const box = document.getElementById('uzKpiRow');
  if (!box) return;
  const total = uzUsers.length;
  const active = uzUsers.filter(u => u.is_active).length;
  const suspended = total - active;
  const rolesUsed = new Set(uzUsers.filter(u => u.role).map(u => u.role.id)).size;
  box.innerHTML = `
    <div class="uz-kpi uz-kpi-accent"><small>إجمالي المستخدمين</small><b>${total}</b></div>
    <div class="uz-kpi uz-kpi-success"><small>حسابات نشطة</small><b>${active}</b></div>
    <div class="uz-kpi uz-kpi-coral"><small>حسابات موقوفة</small><b>${suspended}</b></div>
    <div class="uz-kpi"><small>أدوار مُستخدَمة</small><b>${rolesUsed}</b></div>
  `;
}

function uzPopulateRoleSelectors() {
  const filter = document.getElementById('uzRoleFilter');
  const select = document.getElementById('uzRoleSelect');
  if (filter) {
    const current = filter.value;
    filter.innerHTML = '<option value="">كل الأدوار</option>' +
      uzRoles.map(r => `<option value="${r.id}">${uzEsc(r.name_ar)}</option>`).join('');
    filter.value = current;
  }
  if (select) {
    const current = select.value;
    select.innerHTML = uzRoles.filter(r => r.is_active).map(r =>
      `<option value="${r.id}">${uzEsc(r.name_ar)}</option>`
    ).join('');
    if (current) select.value = current;
  }
}

function uzRenderUsers() {
  const body = document.getElementById('uzUsersBody');
  const empty = document.getElementById('uzUsersEmpty');
  if (!body) return;

  const search = (document.getElementById('uzSearchInput')?.value || '').trim().toLowerCase();
  const roleId = document.getElementById('uzRoleFilter')?.value || '';
  const status = document.getElementById('uzStatusFilter')?.value || '';

  let list = [...uzUsers];
  if (search) {
    list = list.filter(u =>
      (u.full_name || '').toLowerCase().includes(search) ||
      (u.email || '').toLowerCase().includes(search)
    );
  }
  if (roleId) list = list.filter(u => u.role && String(u.role.id) === String(roleId));
  if (status === 'active') list = list.filter(u => u.is_active);
  if (status === 'suspended') list = list.filter(u => !u.is_active);

  if (!list.length) {
    body.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  body.innerHTML = list.map(u => {
    const roleBadge = u.role
      ? `<span class="uz-role-badge ${uzRoleColorClass(u.role.code)}">${uzEsc(u.role.name_ar)}</span>`
      : `<span class="uz-role-badge uz-role-c5">بدون دور</span>`;
    const statusBadge = u.is_active
      ? `<span class="badge received">نشط</span>`
      : `<span class="badge returned">موقوف</span>`;
    return `
      <tr>
        <td>
          <div class="uz-user-cell">
            <div class="uz-avatar">${uzEsc(uzInitials(u.full_name))}</div>
            <div class="uz-user-meta"><b>${uzEsc(u.full_name)}</b><span>${uzEsc(u.email)}</span></div>
          </div>
        </td>
        <td>${uzEsc(u.phone || '—')}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td class="muted">${uzFmtDateTime(u.last_login_at)}</td>
        <td>
          <div class="uz-row-actions">
            <button class="uz-icon-btn" title="تعديل" onclick="uzOpenUserForm(${u.id})">✏️</button>
            <button class="uz-icon-btn" title="إعادة تعيين كلمة المرور" onclick="uzResetPassword(${u.id})">🔑</button>
            <button class="uz-icon-btn" title="${u.is_active ? 'إيقاف' : 'تفعيل'}" onclick="uzToggleActive(${u.id})">${u.is_active ? '⏸' : '▶️'}</button>
            <button class="uz-icon-btn uz-danger" title="حذف" onclick="uzDeleteUser(${u.id})">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function uzOpenUserForm(userId) {
  uzEditUserId = userId || null;
  const box = document.getElementById('uzUserFormBox');
  const title = document.getElementById('uzUserFormTitle');
  const pwField = document.getElementById('uzPasswordField');
  if (!box) return;

  if (uzEditUserId) {
    const u = uzUsers.find(x => x.id === uzEditUserId);
    if (!u) return;
    title.textContent = 'تعديل بيانات المستخدم';
    document.getElementById('uzFullName').value = u.full_name || '';
    document.getElementById('uzEmail').value = u.email || '';
    document.getElementById('uzPhone').value = u.phone || '';
    document.getElementById('uzRoleSelect').value = u.role ? u.role.id : '';
    document.getElementById('uzActiveToggle').checked = !!u.is_active;
    if (pwField) pwField.style.display = 'none';
  } else {
    title.textContent = 'إضافة مستخدم جديد';
    document.getElementById('uzFullName').value = '';
    document.getElementById('uzEmail').value = '';
    document.getElementById('uzPhone').value = '';
    document.getElementById('uzPassword').value = '';
    document.getElementById('uzActiveToggle').checked = true;
    if (pwField) pwField.style.display = '';
  }

  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function uzCloseUserForm() {
  uzEditUserId = null;
  const box = document.getElementById('uzUserFormBox');
  if (box) box.style.display = 'none';
}

async function uzSaveUser() {
  const full_name = document.getElementById('uzFullName').value.trim();
  const email = document.getElementById('uzEmail').value.trim();
  const phone = document.getElementById('uzPhone').value.trim();
  const role_id = parseInt(document.getElementById('uzRoleSelect').value || '0', 10);
  const is_active = !!document.getElementById('uzActiveToggle').checked;

  if (!full_name || !email || !role_id) {
    uzToast('الرجاء تعبئة الاسم والبريد الإلكتروني واختيار الدور', false);
    return;
  }

  try {
    if (uzEditUserId) {
      await api('PUT', `/api/users/${uzEditUserId}`, { full_name, email, phone, role_id, is_active });
      uzToast('تم حفظ تعديلات المستخدم');
    } else {
      const password = document.getElementById('uzPassword').value;
      if (!password || password.length < 6) {
        uzToast('كلمة المرور يجب ألا تقل عن 6 أحرف', false);
        return;
      }
      await api('POST', '/api/users', { full_name, email, phone, password, role_id, is_active });
      uzToast('تم إضافة المستخدم بنجاح');
    }
    uzCloseUserForm();
    await uzLoadAll();
  } catch (e) {
    uzToast('تعذر حفظ المستخدم: ' + (e.message || e), false);
  }
}

async function uzToggleActive(id) {
  try {
    await api('POST', `/api/users/${id}/toggle-active`);
    await uzLoadAll();
  } catch (e) {
    uzToast('تعذر تنفيذ الإجراء: ' + (e.message || e), false);
  }
}

async function uzResetPassword(id) {
  const pw = prompt('أدخل كلمة المرور الجديدة (6 أحرف على الأقل):');
  if (!pw) return;
  if (pw.length < 6) { uzToast('كلمة المرور قصيرة جداً', false); return; }
  try {
    await api('POST', `/api/users/${id}/reset-password`, { new_password: pw });
    uzToast('تم تحديث كلمة المرور');
  } catch (e) {
    uzToast('تعذر تحديث كلمة المرور: ' + (e.message || e), false);
  }
}

async function uzDeleteUser(id) {
  const u = uzUsers.find(x => x.id === id);
  if (!confirm(`هل أنت متأكد من حذف المستخدم "${u ? u.full_name : ''}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
  try {
    await api('DELETE', `/api/users/${id}`);
    uzToast('تم حذف المستخدم');
    await uzLoadAll();
  } catch (e) {
    uzToast('تعذر حذف المستخدم: ' + (e.message || e), false);
  }
}

// ============================================================
// شاشة الأدوار والصلاحيات
// ============================================================
function uzRenderRoles() {
  const grid = document.getElementById('uzRolesGrid');
  if (!grid) return;

  const cards = uzRoles.map(r => `
    <div class="uz-role-card ${uzMatrixRoleId === r.id ? 'uz-role-selected' : ''}">
      <div class="uz-role-card-head">
        <div>
          <h4>${uzEsc(r.name_ar)}</h4>
          <small>${uzEsc(r.code)}</small>
        </div>
        ${r.is_system ? '<span class="uz-badge-system">دور أساسي</span>' : ''}
      </div>
      <div class="uz-role-desc">${uzEsc(r.description || 'لا يوجد وصف')}</div>
      <div class="uz-role-card-foot">
        <span class="uz-role-users-count">👤 ${r.users_count} مستخدم</span>
        <div class="uz-row-actions">
          <button class="uz-icon-btn" title="الصلاحيات" onclick="uzOpenMatrix(${r.id})">🛡️</button>
          <button class="uz-icon-btn" title="تعديل بيانات الدور" onclick="uzOpenRoleForm(${r.id})">✏️</button>
          ${r.is_system ? '' : `<button class="uz-icon-btn uz-danger" title="حذف" onclick="uzDeleteRole(${r.id})">🗑️</button>`}
        </div>
      </div>
    </div>
  `).join('');

  grid.innerHTML = cards + `
    <div class="uz-role-card uz-new-role-card" onclick="uzOpenRoleForm()">
      <span>+</span>
      <span>إضافة دور جديد</span>
    </div>`;
}

function uzOpenRoleForm(roleId) {
  uzEditRoleId = roleId || null;
  const box = document.getElementById('uzRoleFormBox');
  const title = document.getElementById('uzRoleFormTitle');
  const codeField = document.getElementById('uzRoleCode');
  if (!box) return;

  if (uzEditRoleId) {
    const r = uzRoles.find(x => x.id === uzEditRoleId);
    if (!r) return;
    title.textContent = 'تعديل بيانات الدور';
    codeField.value = r.code;
    codeField.disabled = true;
    document.getElementById('uzRoleNameAr').value = r.name_ar || '';
    document.getElementById('uzRoleNameEn').value = r.name_en || '';
    document.getElementById('uzRoleDesc').value = r.description || '';
  } else {
    title.textContent = 'دور جديد';
    codeField.value = '';
    codeField.disabled = false;
    document.getElementById('uzRoleNameAr').value = '';
    document.getElementById('uzRoleNameEn').value = '';
    document.getElementById('uzRoleDesc').value = '';
  }

  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function uzCloseRoleForm() {
  uzEditRoleId = null;
  const box = document.getElementById('uzRoleFormBox');
  if (box) box.style.display = 'none';
}

async function uzSaveRole() {
  const name_ar = document.getElementById('uzRoleNameAr').value.trim();
  const name_en = document.getElementById('uzRoleNameEn').value.trim();
  const description = document.getElementById('uzRoleDesc').value.trim();

  if (!name_ar) { uzToast('الرجاء إدخال اسم الدور بالعربية', false); return; }

  try {
    if (uzEditRoleId) {
      await api('PUT', `/api/roles/${uzEditRoleId}`, { name_ar, name_en, description });
      uzToast('تم حفظ تعديلات الدور');
    } else {
      const code = document.getElementById('uzRoleCode').value.trim();
      if (!code) { uzToast('الرجاء إدخال رمز الدور', false); return; }
      const created = await api('POST', '/api/roles', { code, name_ar, name_en, description, permissions: {} });
      uzToast('تم إنشاء الدور — يمكنك الآن ضبط صلاحياته');
      uzCloseRoleForm();
      await uzLoadAll();
      uzOpenMatrix(created.id);
      return;
    }
    uzCloseRoleForm();
    await uzLoadAll();
  } catch (e) {
    uzToast('تعذر حفظ الدور: ' + (e.message || e), false);
  }
}

async function uzDeleteRole(id) {
  const r = uzRoles.find(x => x.id === id);
  if (!confirm(`هل تريد حذف الدور "${r ? r.name_ar : ''}"؟`)) return;
  try {
    await api('DELETE', `/api/roles/${id}`);
    uzToast('تم حذف الدور');
    await uzLoadAll();
  } catch (e) {
    uzToast('تعذر حذف الدور: ' + (e.message || e), false);
  }
}

// ---------------- مصفوفة الصلاحيات ----------------
function uzOpenMatrix(roleId) {
  const role = uzRoles.find(r => r.id === roleId);
  if (!role) return;
  uzMatrixRoleId = roleId;

  uzMatrixDraft = {};
  (uzCatalog.modules || []).forEach(m => {
    uzMatrixDraft[m.key] = new Set((role.permissions || {})[m.key] || []);
  });

  const nameEl = document.getElementById('uzMatrixRoleName');
  if (nameEl) nameEl.textContent = role.name_ar;

  uzRenderMatrixTable();
  uzRenderRoles();

  const box = document.getElementById('uzMatrixBox');
  if (box) { box.style.display = 'block'; box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function uzCloseMatrix() {
  uzMatrixRoleId = null;
  uzMatrixDraft = null;
  const box = document.getElementById('uzMatrixBox');
  if (box) box.style.display = 'none';
  uzRenderRoles();
}

function uzRenderMatrixTable() {
  const table = document.getElementById('uzMatrixTable');
  if (!table || !uzMatrixDraft) return;

  const actions = uzCatalog.actions || [];
  const modules = uzCatalog.modules || [];

  const headCells = actions.map(a => `
    <th>
      ${uzEsc(a.name_ar)}
      <div class="uz-matrix-row-all" onclick="uzToggleMatrixCol('${a.key}')">الكل</div>
    </th>
  `).join('');

  const rows = modules.map(m => {
    const cells = actions.map(a => {
      const checked = uzMatrixDraft[m.key] && uzMatrixDraft[m.key].has(a.key) ? 'checked' : '';
      return `<td><input type="checkbox" ${checked} onchange="uzToggleMatrixCell('${m.key}','${a.key}',this.checked)"></td>`;
    }).join('');
    return `
      <tr>
        <td>${uzEsc(m.name_ar)} <span class="uz-matrix-row-all" onclick="uzToggleMatrixRow('${m.key}')">الكل</span></td>
        ${cells}
      </tr>`;
  }).join('');

  table.innerHTML = `
    <thead><tr><th>الوحدة</th>${headCells}</tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function uzToggleMatrixCell(moduleKey, actionKey, checked) {
  if (!uzMatrixDraft[moduleKey]) uzMatrixDraft[moduleKey] = new Set();
  if (checked) uzMatrixDraft[moduleKey].add(actionKey);
  else uzMatrixDraft[moduleKey].delete(actionKey);
}

function uzToggleMatrixRow(moduleKey) {
  const actions = uzCatalog.actions || [];
  const set = uzMatrixDraft[moduleKey] || new Set();
  const allChecked = actions.every(a => set.has(a.key));
  uzMatrixDraft[moduleKey] = allChecked ? new Set() : new Set(actions.map(a => a.key));
  uzRenderMatrixTable();
}

function uzToggleMatrixCol(actionKey) {
  const modules = uzCatalog.modules || [];
  const allChecked = modules.every(m => uzMatrixDraft[m.key] && uzMatrixDraft[m.key].has(actionKey));
  modules.forEach(m => {
    if (!uzMatrixDraft[m.key]) uzMatrixDraft[m.key] = new Set();
    if (allChecked) uzMatrixDraft[m.key].delete(actionKey);
    else uzMatrixDraft[m.key].add(actionKey);
  });
  uzRenderMatrixTable();
}

async function uzSaveMatrix() {
  if (!uzMatrixRoleId || !uzMatrixDraft) return;
  const permissions = {};
  Object.keys(uzMatrixDraft).forEach(k => { permissions[k] = Array.from(uzMatrixDraft[k]); });

  try {
    await api('PUT', `/api/roles/${uzMatrixRoleId}`, { permissions });
    uzToast('تم حفظ صلاحيات الدور بنجاح');
    await uzLoadAll();
    uzCloseMatrix();
  } catch (e) {
    uzToast('تعذر حفظ الصلاحيات: ' + (e.message || e), false);
  }
}

// ============================================================
// تفعيل التحميل عند فتح أي من التبويبين لأول مرة
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-tab="users_list"], [data-tab="roles_permissions"]').forEach(btn => {
    btn.addEventListener('click', function () { uzEnsureLoaded(); });
  });
});
