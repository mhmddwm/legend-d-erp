/* LEGEND D ERP — طبقة المصادقة بالواجهة (PF-01.3)
   تُحمَّل أولاً في <head> لكل صفحة محمية. وظائفها:
   1) إن لم يوجد رمز دخول ← تحويل فوري إلى login.html.
   2) تغليف fetch لإضافة Authorization: Bearer تلقائياً لطلبات الـ API.
   3) عند الرد 401 (جلسة منتهية) ← مسح الجلسة والعودة لصفحة الدخول.
   4) عرض اسم المستخدم وزر الخروج في الهيدر، وإخفاء الوحدات غير المسموحة (شكلي فقط —
      الفرض الحقيقي بالخادم). */
(function () {
  'use strict';
  var TOKEN_KEY = 'legend_token';
  var USER_KEY = 'legend_user';
  // نفس منطق script.js: محلياً يشير للباك إند 127.0.0.1:8080، وعند النشر نفس الـ origin.
  var API = (['127.0.0.1', 'localhost'].indexOf(location.hostname) !== -1) ? 'http://127.0.0.1:8080' : '';

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    // يستخدمها script.js كاسم "المنشئ" في القيود والمستندات
    localStorage.setItem('legend_current_user', user.full_name || user.email || '');
  }
  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('legend_current_user');
    } catch (e) { /* ignore */ }
  }
  function toLogin() {
    var next = location.pathname.split('/').pop() + location.search;
    location.replace('login.html?next=' + encodeURIComponent(next));
  }
  function can(module, action) {
    var u = getUser();
    if (!u) return false;
    if (u.role && u.role.code === 'admin') return true;
    var p = (u.permissions || {})[module] || [];
    return p.indexOf(action || 'view') !== -1;
  }
  function logout() { clearSession(); location.replace('login.html'); }

  window.LegendAuth = { API: API, getToken: getToken, getUser: getUser, setSession: setSession,
                        clearSession: clearSession, can: can, logout: logout };

  var isLoginPage = /login\.html$/i.test(location.pathname);
  if (isLoginPage) return;

  if (!getToken()) { toLogin(); return; }

  // ---- تغليف fetch ----
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isApi = url.indexOf('/api/') !== -1 &&
      (url.charAt(0) === '/' || url.indexOf(location.origin) === 0 || (API && url.indexOf(API) === 0));
    if (isApi) {
      init = init || {};
      var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + getToken());
      init.headers = h;
    }
    return origFetch(input, init).then(function (res) {
      if (isApi && res.status === 401 && url.indexOf('/api/auth/login') === -1) {
        clearSession(); toLogin();
      }
      return res;
    });
  };

  // ---- الهيدر + إخفاء الوحدات ----
  var SUB_TO_MODULE = {
    accountsSub: 'accounts', purchaseSub: 'purchasing', salesSub: 'sales', posSub: 'pos',
    customersSub: 'customers', financeSub: 'finance', assetsSub: 'assets', reportsSub: 'reports',
    inventorySub: 'inventory', printTemplatesSub: 'print_templates', generalSettingsSub: 'general_settings'
  };

  function decorate() {
    var u = getUser();
    if (!u) return;
    var slot = document.querySelector('header .header-left');
    if (slot && !document.getElementById('legendUserChip')) {
      var chip = document.createElement('div');
      chip.id = 'legendUserChip';
      chip.style.cssText = 'display:flex;align-items:center;gap:10px;color:#fff;font-size:13px;font-family:inherit';
      var name = document.createElement('span');
      name.textContent = (u.full_name || u.email) + (u.role ? ' — ' + u.role.name_ar : '');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'تسجيل الخروج';
      btn.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.45);' +
        'border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit;font-size:12px';
      btn.onclick = logout;
      chip.appendChild(name); chip.appendChild(btn);
      slot.appendChild(chip);
    }
    document.querySelectorAll('.erp-module-card[onclick]').forEach(function (card) {
      var m = /toggleERPModule\('(\w+)'\)/.exec(card.getAttribute('onclick') || '');
      var mod = m && SUB_TO_MODULE[m[1]];
      if (mod && !can(mod, 'view')) card.style.display = 'none';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    decorate();
    // تحديث الصلاحيات من الخادم (قد تتغير دور المستخدم بعد تسجيل دخوله)
    fetch(API + '/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
      if (me) { localStorage.setItem(USER_KEY, JSON.stringify(me)); decorate(); }
    }).catch(function () { /* ignore */ });
  });
})();
