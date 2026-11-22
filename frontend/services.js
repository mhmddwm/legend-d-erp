/* =====================================================================
   LEGEND D ERP — شاشة الخدمات (PF-01.8)
   كتالوج الخدمات + فواتير خدمات المبيعات والمشتريات مع محاكاة القيد قبل الترحيل.
   كل حسابات القيود تتم في الخادم (service_engine.py)؛ هذه الواجهة تعرض وتجمع المدخلات فقط.
   ===================================================================== */
(function () {
  'use strict';

  var TYPE_LABEL = { sales: 'بيع', purchase: 'شراء', both: 'بيع وشراء' };
  var PAY_LABEL = { credit: 'آجل', cash: 'نقدي', bank: 'بنكي' };
  var UNITS = ['خدمة', 'ساعة', 'يوم', 'أسبوع', 'شهر', 'سنة', 'مرة', 'زيارة', 'رحلة', 'مشروع', 'ترخيص', 'اشتراك'];
  var DIR = {
    sales:    { path: '/api/service-sales-invoices',    title: 'فواتير خدمات المبيعات',  party: 'العميل', partyKey: 'customers', priceKey: 'sales_price',    newLabel: 'فاتورة بيع خدمات' },
    purchase: { path: '/api/service-purchase-invoices', title: 'فواتير خدمات المشتريات', party: 'المورد', partyKey: 'suppliers', priceKey: 'purchase_cost', newLabel: 'فاتورة شراء خدمات' }
  };

  var S = {
    tab: 'catalog', loaded: false, busy: false,
    services: [], summary: null,
    accounts: [], accMap: {}, parents: {}, taxTypes: [], costCenters: [], customers: [], suppliers: [],
    f: { q: '', type: '', status: '', category: '', sort: 'code' }, page: 1, pageSize: 25,
    inv: { sales: { rows: [], f: { from: '', to: '', party: '', status: '', q: '' } },
           purchase: { rows: [], f: { from: '', to: '', party: '', status: '', q: '' } } }
  };

  /* ------------------------------------------------------------ أدوات */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function byCode(a, b) { return String(a.code).localeCompare(String(b.code), 'en', { numeric: true }); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function root() { return document.getElementById('svcRoot'); }
  function call(method, path, body) { return window.api(method, path, body); }

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'svc-toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, bad ? 5500 : 2600);
  }

  /* ------------------------------------------------------------ مراجع الحسابات */
  function indexAccounts() {
    S.accMap = {}; S.parents = {};
    S.accounts.forEach(function (a) { S.accMap[a.code] = a; if (a.parent_code) S.parents[a.parent_code] = true; });
  }
  function leafAccounts(type) {
    return S.accounts.filter(function (a) { return a.account_type === type && !S.parents[a.code]; }).sort(byCode);
  }
  function cashAccounts() {
    var leaf = leafAccounts('assets');
    var cash = leaf.filter(function (a) { return /^111/.test(a.code); });
    return cash.length ? cash : leaf;
  }
  function accLabel(code) { var a = S.accMap[code]; return a ? code + ' — ' + a.name_ar : (code || '—'); }
  function taxOf(code) { return S.taxTypes.filter(function (t) { return t.code === code; })[0] || null; }
  function opt(value, label, sel) { return '<option value="' + esc(value) + '"' + (String(sel) === String(value) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function accOptions(list, sel, blank) {
    return (blank ? opt('', blank, sel) : '') + list.map(function (a) { return opt(a.code, a.code + ' — ' + a.name_ar, sel); }).join('');
  }
  function taxOptions(sel, blank) {
    return opt('', blank || 'بلا ضريبة', sel) + S.taxTypes.filter(function (t) { return t.is_active !== false; })
      .map(function (t) { return opt(t.code, t.name_ar + ' (' + t.rate + '%)', sel); }).join('');
  }

  /* ------------------------------------------------------------ تحميل */
  function loadRefs() {
    return Promise.all([
      call('GET', '/api/accounts'), call('GET', '/api/tax-types'), call('GET', '/api/cost-centers'),
      call('GET', '/api/customers'), call('GET', '/api/suppliers')
    ]).then(function (r) {
      S.accounts = r[0] || []; S.taxTypes = r[1] || []; S.costCenters = r[2] || [];
      S.customers = (r[3] || []).filter(function (c) { return c.is_active !== false; });
      S.suppliers = (r[4] || []).filter(function (c) { return c.is_active !== false; });
      indexAccounts();
    });
  }
  function loadServices() {
    return Promise.all([call('GET', '/api/services'), call('GET', '/api/services/summary')]).then(function (r) {
      S.services = r[0] || []; S.summary = r[1] || null;
    });
  }
  function loadInvoices(dir) {
    var f = S.inv[dir].f, qs = [];
    if (f.status) qs.push('status=' + encodeURIComponent(f.status));
    if (f.from) qs.push('date_from=' + f.from);
    if (f.to) qs.push('date_to=' + f.to);
    if (f.party) qs.push('party_code=' + encodeURIComponent(f.party));
    if (f.q) qs.push('q=' + encodeURIComponent(f.q));
    return call('GET', DIR[dir].path + (qs.length ? '?' + qs.join('&') : '')).then(function (rows) { S.inv[dir].rows = rows || []; });
  }

  /* ------------------------------------------------------------ الهيكل */
  function injectCss() {
    if (document.getElementById('svcCss')) return;
    var s = document.createElement('style'); s.id = 'svcCss';
    s.textContent = [
      '.svc{direction:rtl;font-family:inherit}',
      '.svc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}',
      '.svc-head h2{margin:0;font-size:20px;color:var(--ink-2,#1A3257)}.svc-head p{margin:2px 0 0;color:var(--muted,#5C6B7D);font-size:12.5px}',
      '.svc-btn{background:var(--accent,#1565C0);color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}',
      '.svc-btn:hover{filter:brightness(1.08)}.svc-btn[disabled]{opacity:.5;cursor:not-allowed}',
      '.svc-btn.ghost{background:#fff;color:var(--ink-2,#1A3257);border:1.5px solid var(--line,#D0D8E4)}',
      '.svc-btn.danger{background:var(--coral,#C62828)}.svc-btn.ok{background:var(--success,#2E7D32)}.svc-btn.sm{padding:5px 10px;font-size:12px}',
      '.svc-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px}',
      '.svc-kpi{background:var(--bg-card,#fff);border:1px solid var(--line,#D0D8E4);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow,0 2px 12px rgba(13,27,46,.1))}',
      '.svc-kpi small{display:block;color:var(--muted,#5C6B7D);font-size:11.5px;font-weight:700}.svc-kpi b{display:block;font-size:20px;margin-top:4px;color:var(--ink,#0D1B2E)}',
      '.svc-kpi.green b{color:var(--success,#2E7D32)}.svc-kpi.red b{color:var(--coral,#C62828)}.svc-kpi.blue b{color:var(--accent,#1565C0)}',
      '.svc-tabs{display:flex;gap:6px;border-bottom:2px solid var(--line-2,#E8EDF3);margin-bottom:14px}',
      '.svc-tab{background:none;border:0;padding:10px 18px;font-weight:700;font-size:13.5px;color:var(--muted,#5C6B7D);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;font-family:inherit}',
      '.svc-tab.active{color:var(--accent,#1565C0);border-bottom-color:var(--accent,#1565C0)}',
      '.svc-card{background:var(--bg-card,#fff);border:1px solid var(--line,#D0D8E4);border-radius:14px;padding:16px;box-shadow:var(--shadow,0 2px 12px rgba(13,27,46,.1))}',
      '.svc-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center}',
      '.svc-toolbar input,.svc-toolbar select,.svc-form input,.svc-form select,.svc-form textarea,.svc-lines input,.svc-lines select{border:1.5px solid var(--line,#D0D8E4);border-radius:8px;padding:7px 10px;font-family:inherit;font-size:13px;background:#fff;min-width:0}',
      '.svc-toolbar input.grow{flex:1 1 220px}',
      '.svc-table{width:100%;border-collapse:collapse;font-size:13px}',
      '.svc-table th{background:var(--bg-card-2,#F8FAFD);color:var(--muted,#5C6B7D);font-size:11.5px;text-align:right;padding:9px 10px;border-bottom:1.5px solid var(--line,#D0D8E4);white-space:nowrap}',
      '.svc-table td{padding:9px 10px;border-bottom:1px solid var(--line-2,#E8EDF3);vertical-align:middle}',
      '.svc-table tr:hover td{background:#F5F9FF}.svc-table .num{text-align:left;direction:ltr;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.svc-table .code{font-family:monospace;font-weight:700;color:var(--ink-3,#2E4D7A)}.svc-table small{display:block;color:var(--muted,#5C6B7D)}',
      '.svc-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700}',
      '.svc-badge.sales{background:#E3EDFF;color:#1565C0}.svc-badge.purchase{background:#FFF8E1;color:#B45309}.svc-badge.both{background:#E0F2F1;color:#00897B}',
      '.svc-badge.posted{background:#E8F5E9;color:#2E7D32}.svc-badge.cancelled{background:#FFEBEE;color:#C62828}',
      '.svc-badge.credit{background:#FFF8E1;color:#B45309}.svc-badge.cash{background:#E8F5E9;color:#2E7D32}.svc-badge.bank{background:#E3EDFF;color:#1565C0}',
      '.svc-switch{position:relative;width:38px;height:20px;display:inline-block}.svc-switch input{display:none}',
      '.svc-switch span{position:absolute;inset:0;background:#cbd5e1;border-radius:20px;cursor:pointer;transition:.2s}',
      '.svc-switch span:before{content:"";position:absolute;width:14px;height:14px;top:3px;right:3px;background:#fff;border-radius:50%;transition:.2s}',
      '.svc-switch input:checked+span{background:var(--success,#2E7D32)}.svc-switch input:checked+span:before{right:21px}',
      '.svc-act{background:none;border:0;cursor:pointer;font-size:15px;padding:3px 6px;border-radius:6px}.svc-act:hover{background:#EEF2F7}.svc-act[disabled]{opacity:.3;cursor:not-allowed}',
      '.svc-pager{display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:12.5px;color:var(--muted,#5C6B7D)}',
      '.svc-empty{text-align:center;padding:40px;color:var(--muted,#5C6B7D)}.svc-empty b{display:block;font-size:15px;color:var(--ink-2,#1A3257);margin-bottom:6px}',
      '.svc-overlay{position:fixed;inset:0;background:rgba(13,27,46,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 12px}',
      '.svc-modal{background:#fff;border-radius:14px;width:min(760px,100%);box-shadow:var(--shadow-lg,0 8px 32px rgba(13,27,46,.2));direction:rtl}',
      '.svc-modal.wide{width:min(1180px,100%)}',
      '.svc-mh{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line-2,#E8EDF3)}.svc-mh h3{margin:0;font-size:16px;color:var(--ink-2,#1A3257)}',
      '.svc-mb{padding:16px 18px}.svc-mf{padding:12px 18px;border-top:1px solid var(--line-2,#E8EDF3);display:flex;gap:8px;justify-content:flex-start;flex-wrap:wrap;background:var(--bg-card-2,#F8FAFD);border-radius:0 0 14px 14px}',
      '.svc-x{background:none;border:0;font-size:20px;cursor:pointer;color:var(--muted,#5C6B7D)}',
      '.svc-form{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.svc-form .full{grid-column:1/-1}.svc-form .two{grid-column:span 2}',
      '.svc-form label{display:block;font-size:12px;font-weight:700;color:var(--muted,#5C6B7D);margin-bottom:4px}.svc-form label i{color:var(--coral,#C62828);font-style:normal}',
      '.svc-form input,.svc-form select,.svc-form textarea{width:100%;box-sizing:border-box}',
      '.svc-sec{grid-column:1/-1;font-weight:800;color:var(--ink-3,#2E4D7A);font-size:13px;border-bottom:1px solid var(--line-2,#E8EDF3);padding-bottom:4px;margin-top:6px}',
      '.svc-chips{display:flex;gap:6px}.svc-chip{flex:1;text-align:center;padding:7px;border:1.5px solid var(--line,#D0D8E4);border-radius:8px;cursor:pointer;font-weight:700;font-size:12.5px}',
      '.svc-chip.on{border-color:var(--accent,#1565C0);background:var(--accent-light,#E3EDFF);color:var(--accent,#1565C0)}',
      '.svc-hint{grid-column:1/-1;background:#F1F7FF;border:1px dashed #9DB8E6;border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--ink-2,#1A3257);line-height:1.8}',
      '.svc-err{grid-column:1/-1;background:#FFEBEE;color:#C62828;border-radius:8px;padding:9px 12px;font-size:13px;font-weight:700}',
      '.svc-lines{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}.svc-lines th{background:var(--bg-card-2,#F8FAFD);font-size:11px;padding:6px;text-align:right;color:var(--muted,#5C6B7D)}',
      '.svc-lines td{padding:4px;border-bottom:1px solid var(--line-2,#E8EDF3)}.svc-lines input,.svc-lines select{width:100%;box-sizing:border-box;padding:5px 6px}',
      '.svc-lines td.num{text-align:left;direction:ltr;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:700}',
      '.svc-totals{display:flex;gap:22px;justify-content:flex-end;margin-top:12px;font-size:13px;flex-wrap:wrap}.svc-totals div{text-align:center}',
      '.svc-totals small{display:block;color:var(--muted,#5C6B7D);font-size:11px}.svc-totals b{font-size:17px;direction:ltr;display:block}',
      '.svc-jr{margin-top:14px;border:1.5px solid #9DB8E6;border-radius:12px;overflow:hidden}.svc-jr h4{margin:0;padding:9px 14px;background:#E3EDFF;color:var(--accent-hover,#0D47A1);font-size:13px;display:flex;justify-content:space-between}',
      '.svc-jr table{width:100%;border-collapse:collapse;font-size:12.5px}.svc-jr th,.svc-jr td{padding:7px 12px;border-bottom:1px solid var(--line-2,#E8EDF3);text-align:right}',
      '.svc-jr td.num{text-align:left;direction:ltr;font-variant-numeric:tabular-nums}.svc-jr tfoot td{font-weight:800;background:#F8FAFD}',
      '.svc-ok{color:var(--success,#2E7D32);font-weight:800}.svc-bad{color:var(--coral,#C62828);font-weight:800}',
      '.svc-toast{position:fixed;bottom:24px;left:50%;transform:translate(-50%,20px);background:#15803d;color:#fff;padding:10px 20px;border-radius:10px;z-index:99999;opacity:0;transition:.3s;font-size:14px}',
      '.svc-toast.bad{background:#b91c1c}.svc-toast.show{opacity:1;transform:translate(-50%,0)}',
      '@media(max-width:1000px){.svc-kpis{grid-template-columns:repeat(3,1fr)}.svc-form{grid-template-columns:1fr 1fr}}',
      '@media print{body *{visibility:hidden}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function shell() {
    var el = root(); if (!el) return;
    el.innerHTML =
      '<div class="svc">' +
      '<div class="svc-head"><div><h2>الخدمات</h2><p>بطاقات الخدمات وفواتير البيع والشراء مع ترحيل محاسبي مباشر ومعاينة القيد قبل الحفظ</p></div>' +
      '<div style="display:flex;gap:8px"><button class="svc-btn ghost" data-act="refresh">↻ تحديث</button></div></div>' +
      '<div id="svcKpis"></div>' +
      '<div class="svc-tabs" id="svcTabs"></div><div id="svcBody"></div></div>';
    el.onclick = onClick;
    el.oninput = onInput;
    el.onchange = onInput;
  }

  function renderKpis() {
    var box = document.getElementById('svcKpis'); if (!box) return;
    var s = S.summary || { total: 0, active: 0, sales_services: 0, purchase_services: 0, month_sales_net: 0, month_purchase_net: 0, month_label: '' };
    var k = function (cls, label, val) { return '<div class="svc-kpi ' + cls + '"><small>' + label + '</small><b>' + val + '</b></div>'; };
    box.innerHTML = '<div class="svc-kpis">' +
      k('', 'إجمالي الخدمات', s.total) + k('green', 'الخدمات النشطة', s.active) +
      k('blue', 'خدمات بيع', s.sales_services) + k('', 'خدمات شراء', s.purchase_services) +
      k('green', 'إيراد خدمات الشهر ' + esc(s.month_label), money(s.month_sales_net)) +
      k('red', 'مصروف خدمات الشهر', money(s.month_purchase_net)) + '</div>';
  }

  function renderTabs() {
    var tabs = [['catalog', 'كتالوج الخدمات'], ['sales', DIR.sales.title], ['purchase', DIR.purchase.title]];
    document.getElementById('svcTabs').innerHTML = tabs.map(function (t) {
      return '<button class="svc-tab' + (S.tab === t[0] ? ' active' : '') + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
  }

  function renderBody() {
    renderTabs();
    if (S.tab === 'catalog') renderCatalog(); else renderInvoices(S.tab);
  }

  /* ------------------------------------------------------------ الكتالوج */
  function filteredServices() {
    var f = S.f, q = f.q.trim().toLowerCase();
    var rows = S.services.filter(function (s) {
      if (q && (s.code + ' ' + s.name + ' ' + (s.name_en || '') + ' ' + (s.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (f.type && s.service_type !== f.type && !(f.type !== 'both' && s.service_type === 'both')) return false;
      if (f.status === 'active' && !s.is_active) return false;
      if (f.status === 'inactive' && s.is_active) return false;
      if (f.category && (s.category || '') !== f.category) return false;
      return true;
    });
    var key = f.sort;
    rows.sort(function (a, b) {
      if (key === 'name') return String(a.name).localeCompare(String(b.name), 'ar');
      if (key === 'usage') return (b.posted_invoices - a.posted_invoices) || byCode(a, b);
      if (key === 'newest') return String(b.created_at || '').localeCompare(String(a.created_at || '')) || byCode(b, a);
      return byCode(a, b);
    });
    return rows;
  }

  function renderCatalog() {
    var cats = {}; S.services.forEach(function (s) { if (s.category) cats[s.category] = 1; });
    var rows = filteredServices();
    var pages = Math.max(1, Math.ceil(rows.length / S.pageSize));
    if (S.page > pages) S.page = pages;
    var slice = rows.slice((S.page - 1) * S.pageSize, S.page * S.pageSize);

    var body = '<div class="svc-card"><div class="svc-toolbar">' +
      '<input class="grow" id="svcQ" placeholder="بحث بالكود أو الاسم أو التصنيف…" value="' + esc(S.f.q) + '" data-f="q">' +
      '<select data-f="type">' + opt('', 'كل الأنواع', S.f.type) + opt('sales', 'بيع', S.f.type) + opt('purchase', 'شراء', S.f.type) + opt('both', 'بيع وشراء', S.f.type) + '</select>' +
      '<select data-f="status">' + opt('', 'كل الحالات', S.f.status) + opt('active', 'نشطة', S.f.status) + opt('inactive', 'معطّلة', S.f.status) + '</select>' +
      '<select data-f="category">' + opt('', 'كل التصنيفات', S.f.category) + Object.keys(cats).sort().map(function (c) { return opt(c, c, S.f.category); }).join('') + '</select>' +
      '<select data-f="sort">' + opt('code', 'ترتيب: الكود', S.f.sort) + opt('name', 'ترتيب: الاسم', S.f.sort) + opt('usage', 'الأكثر استخداماً', S.f.sort) + opt('newest', 'الأحدث', S.f.sort) + '</select>' +
      '<button class="svc-btn ghost" data-act="export">⬇ تصدير CSV</button>' +
      '<button class="svc-btn" data-act="svc-new">+ خدمة جديدة</button></div>';

    if (!rows.length) {
      body += '<div class="svc-empty"><b>' + (S.services.length ? 'لا نتائج مطابقة' : 'لا توجد خدمات بعد') + '</b>' +
        (S.services.length ? 'غيّر عوامل التصفية.' : 'أنشئ أول خدمة واربطها بحساب الإيراد أو المصروف.') + '</div>';
    } else {
      body += '<div style="overflow-x:auto"><table class="svc-table"><thead><tr><th>الكود</th><th>الخدمة</th><th>النوع</th><th>التصنيف</th><th>الوحدة</th>' +
        '<th>سعر البيع</th><th>تكلفة الشراء</th><th>الضريبة</th><th>حساب الإيراد / المصروف</th><th>الاستخدام</th><th>نشطة</th><th></th></tr></thead><tbody>' +
        slice.map(function (s) {
          var tax = s.tax_type_code ? (taxOf(s.tax_type_code) ? taxOf(s.tax_type_code).rate + '%' : s.tax_type_code) : '—';
          var accs = [];
          if (s.revenue_account_code) accs.push('<small>إيراد: ' + esc(accLabel(s.revenue_account_code)) + '</small>');
          if (s.expense_account_code) accs.push('<small>مصروف: ' + esc(accLabel(s.expense_account_code)) + '</small>');
          return '<tr><td class="code">' + esc(s.code) + '</td>' +
            '<td><b>' + esc(s.name) + '</b>' + (s.name_en ? '<small>' + esc(s.name_en) + '</small>' : '') + '</td>' +
            '<td><span class="svc-badge ' + s.service_type + '">' + TYPE_LABEL[s.service_type] + '</span></td>' +
            '<td>' + esc(s.category || '—') + '</td><td>' + esc(s.unit) + '</td>' +
            '<td class="num">' + (s.service_type !== 'purchase' ? money(s.sales_price) : '—') + '</td>' +
            '<td class="num">' + (s.service_type !== 'sales' ? money(s.purchase_cost) : '—') + '</td>' +
            '<td>' + esc(tax) + '</td><td>' + accs.join('') + '</td>' +
            '<td>' + s.posted_invoices + ' <small>سطر مرحّل</small></td>' +
            '<td><label class="svc-switch"><input type="checkbox" ' + (s.is_active ? 'checked' : '') + ' data-act="svc-toggle" data-code="' + esc(s.code) + '"><span></span></label></td>' +
            '<td style="white-space:nowrap"><button class="svc-act" title="تعديل" data-act="svc-edit" data-code="' + esc(s.code) + '">✎</button>' +
            '<button class="svc-act" title="' + (s.total_lines ? 'لا يمكن حذف خدمة استُخدمت — عطّلها' : 'حذف') + '" data-act="svc-del" data-code="' + esc(s.code) + '"' + (s.total_lines ? ' disabled' : '') + '>🗑</button></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="svc-pager"><span>' + rows.length + ' خدمة — صفحة ' + S.page + ' من ' + pages + '</span><span>' +
        '<select data-f="pageSize">' + [25, 50, 100].map(function (n) { return opt(n, n + ' / صفحة', S.pageSize); }).join('') + '</select> ' +
        '<button class="svc-btn ghost sm" data-act="page" data-d="-1"' + (S.page <= 1 ? ' disabled' : '') + '>السابق</button> ' +
        '<button class="svc-btn ghost sm" data-act="page" data-d="1"' + (S.page >= pages ? ' disabled' : '') + '>التالي</button></span></div>';
    }
    document.getElementById('svcBody').innerHTML = body + '</div>';
    var q = document.getElementById('svcQ');
    if (q && document.activeElement === document.body) { /* لا نسرق التركيز */ }
  }

  function exportCsv() {
    var rows = filteredServices();
    var head = ['code', 'name', 'name_en', 'type', 'category', 'unit', 'sales_price', 'purchase_cost', 'tax', 'revenue_account', 'expense_account', 'active'];
    var lines = [head.join(',')].concat(rows.map(function (s) {
      return [s.code, s.name, s.name_en || '', s.service_type, s.category || '', s.unit, s.sales_price, s.purchase_cost,
        s.tax_type_code || '', s.revenue_account_code || '', s.expense_account_code || '', s.is_active ? 'yes' : 'no']
        .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    }));
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'services-' + today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ------------------------------------------------------------ نوافذ */
  function removeOverlay() { var o = document.getElementById('svcOverlay'); if (o) o.remove(); }
  function openModal(title, bodyHtml, footHtml, wide) {
    removeOverlay();
    var o = document.createElement('div'); o.className = 'svc-overlay'; o.id = 'svcOverlay';
    o.innerHTML = '<div class="svc-modal' + (wide ? ' wide' : '') + '"><div class="svc-mh"><h3>' + esc(title) + '</h3>' +
      '<button class="svc-x" data-act="close">×</button></div><div class="svc-mb">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="svc-mf">' + footHtml + '</div>' : '') + '</div>';
    o.addEventListener('click', onClick); o.addEventListener('input', onInput); o.addEventListener('change', onInput);
    document.body.appendChild(o);
    return o;
  }
  function closeModal() { removeOverlay(); S.form = null; S.invForm = null; }

  /* ------------------------------------------------------------ نموذج الخدمة */
  function openServiceForm(code) {
    var cur = code ? S.services.filter(function (s) { return s.code === code; })[0] : null;
    S.form = { code: code || '', type: cur ? cur.service_type : 'sales' };
    var v = cur || { code: '', name: '', name_en: '', category: '', unit: 'خدمة', service_type: 'sales', sales_price: 0, purchase_cost: 0,
      tax_type_code: '', revenue_account_code: '', expense_account_code: '', cost_center_code: '', description: '', is_active: true };
    var cats = {}; S.services.forEach(function (s) { if (s.category) cats[s.category] = 1; });
    var body = '<div class="svc-form" id="sf">' +
      '<div class="svc-err" id="sfErr" style="display:none"></div>' +
      '<div class="svc-sec">المعلومات الأساسية</div>' +
      '<div><label>الكود</label><input id="sfCode" value="' + esc(v.code) + '" placeholder="يُولَّد تلقائياً (SRV-0001)" ' + (cur ? 'disabled' : '') + '></div>' +
      '<div class="two"><label>اسم الخدمة <i>*</i></label><input id="sfName" value="' + esc(v.name) + '"></div>' +
      '<div><label>الاسم بالإنجليزية</label><input id="sfNameEn" value="' + esc(v.name_en || '') + '" style="direction:ltr"></div>' +
      '<div><label>التصنيف</label><input id="sfCat" list="svcCats" value="' + esc(v.category || '') + '"><datalist id="svcCats">' +
      Object.keys(cats).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>' +
      '<div><label>وحدة القياس <i>*</i></label><input id="sfUnit" list="svcUnits" value="' + esc(v.unit) + '"><datalist id="svcUnits">' +
      UNITS.map(function (u) { return '<option value="' + u + '">'; }).join('') + '</datalist></div>' +
      '<div class="full"><label>نوع الخدمة <i>*</i></label><div class="svc-chips" id="sfType">' +
      ['sales', 'purchase', 'both'].map(function (t) { return '<div class="svc-chip' + (v.service_type === t ? ' on' : '') + '" data-act="sf-type" data-t="' + t + '">' + TYPE_LABEL[t] + '</div>'; }).join('') + '</div></div>' +
      '<div class="svc-sec">التسعير والضريبة</div>' +
      '<div id="sfSalesBox"><label>سعر البيع الافتراضي</label><input id="sfPrice" type="number" min="0" step="0.01" value="' + v.sales_price + '"></div>' +
      '<div id="sfCostBox"><label>تكلفة الشراء الافتراضية</label><input id="sfCost" type="number" min="0" step="0.01" value="' + v.purchase_cost + '"></div>' +
      '<div><label>نوع الضريبة الافتراضي</label><select id="sfTax">' + taxOptions(v.tax_type_code || '') + '</select></div>' +
      '<div class="svc-sec">الربط المحاسبي</div>' +
      '<div id="sfRevBox" class="two"><label>حساب الإيراد <i>*</i></label><select id="sfRev">' + accOptions(leafAccounts('revenue'), v.revenue_account_code || '', 'اختر حساب الإيراد…') + '</select></div>' +
      '<div id="sfExpBox" class="two"><label>حساب المصروف <i>*</i></label><select id="sfExp">' + accOptions(leafAccounts('expenses'), v.expense_account_code || '', 'اختر حساب المصروف…') + '</select></div>' +
      '<div><label>مركز التكلفة</label><select id="sfCc">' + opt('', 'بلا', v.cost_center_code || '') + S.costCenters.map(function (c) { return opt(c.code, c.code + ' — ' + c.name_ar, v.cost_center_code || ''); }).join('') + '</select></div>' +
      '<div class="svc-hint" id="sfHint"></div>' +
      '<div class="full"><label>وصف</label><textarea id="sfDesc" rows="2">' + esc(v.description || '') + '</textarea></div>' +
      '<div class="full"><label class="svc-switch" style="vertical-align:middle"><input type="checkbox" id="sfActive" ' + (v.is_active ? 'checked' : '') + '><span></span></label> <b style="margin-right:6px">خدمة نشطة</b></div>' +
      '</div>';
    openModal(cur ? 'تعديل الخدمة ' + cur.code : 'خدمة جديدة', body,
      '<button class="svc-btn" data-act="sf-save">حفظ</button><button class="svc-btn ghost" data-act="close">إلغاء</button>');
    syncServiceForm();
  }

  function syncServiceForm() {
    var t = S.form.type, g = function (id) { return document.getElementById(id); };
    g('sfSalesBox').style.display = t === 'purchase' ? 'none' : '';
    g('sfRevBox').style.display = t === 'purchase' ? 'none' : '';
    g('sfCostBox').style.display = t === 'sales' ? 'none' : '';
    g('sfExpBox').style.display = t === 'sales' ? 'none' : '';
    document.querySelectorAll('#sfType .svc-chip').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-t') === t); });
    var tax = taxOf(g('sfTax').value), taxAcc = tax && tax.account_code ? accLabel(tax.account_code) : null;
    var lines = [];
    if (t !== 'purchase') {
      var rev = g('sfRev').value;
      lines.push('<b>عند البيع:</b> مدين ذمم العميل (أو الصندوق/البنك) ← دائن ' + (rev ? esc(accLabel(rev)) : '<span class="svc-bad">— اختر حساب الإيراد —</span>') +
        (tax && tax.rate > 0 ? ' + دائن ' + (taxAcc ? esc(taxAcc) : '<span class="svc-bad">الضريبة غير مربوطة بحساب!</span>') : ''));
    }
    if (t !== 'sales') {
      var ex = g('sfExp').value;
      lines.push('<b>عند الشراء:</b> مدين ' + (ex ? esc(accLabel(ex)) : '<span class="svc-bad">— اختر حساب المصروف —</span>') +
        (tax && tax.rate > 0 ? ' + مدين ' + (taxAcc ? esc(taxAcc) : '<span class="svc-bad">الضريبة غير مربوطة بحساب!</span>') : '') + ' ← دائن ذمم المورد (أو الصندوق/البنك)');
    }
    g('sfHint').innerHTML = '🧾 الأثر المحاسبي المتوقع:<br>' + lines.join('<br>');
  }

  function saveService() {
    var g = function (id) { return document.getElementById(id); }, err = g('sfErr');
    var t = S.form.type;
    var data = {
      name: g('sfName').value.trim(), name_en: g('sfNameEn').value.trim() || null, category: g('sfCat').value.trim() || null,
      unit: g('sfUnit').value.trim() || 'خدمة', service_type: t, description: g('sfDesc').value.trim() || null,
      sales_price: num(g('sfPrice').value), purchase_cost: num(g('sfCost').value),
      tax_type_code: g('sfTax').value || null,
      revenue_account_code: t === 'purchase' ? null : (g('sfRev').value || null),
      expense_account_code: t === 'sales' ? null : (g('sfExp').value || null),
      cost_center_code: g('sfCc').value || null, is_active: g('sfActive').checked
    };
    var msg = null;
    if (!data.name) msg = 'اسم الخدمة مطلوب';
    else if (t !== 'purchase' && !data.revenue_account_code) msg = 'اختر حساب الإيراد';
    else if (t !== 'sales' && !data.expense_account_code) msg = 'اختر حساب المصروف';
    if (msg) { err.textContent = msg; err.style.display = ''; return; }
    var code = S.form.code, btn = document.querySelector('[data-act="sf-save"]');
    btn.disabled = true;
    var req = code ? call('PUT', '/api/services/' + encodeURIComponent(code), data)
      : call('POST', '/api/services', Object.assign({ code: g('sfCode').value.trim() || null }, data));
    req.then(function () { closeModal(); toast('تم حفظ الخدمة'); return refreshAll(); })
      .catch(function (e) { btn.disabled = false; err.textContent = e.message || 'تعذر الحفظ'; err.style.display = ''; });
  }

  /* ------------------------------------------------------------ قوائم الفواتير */
  function partyName(dir, code) {
    var list = S[DIR[dir].partyKey] || [], p = list.filter(function (x) { return x.code === code; })[0];
    return p ? p.name : code;
  }

  function renderInvoices(dir) {
    var st = S.inv[dir], f = st.f, rows = st.rows, d = DIR[dir];
    var posted = rows.filter(function (r) { return r.status === 'posted'; });
    var sum = function (k) { return posted.reduce(function (a, r) { return a + (r[k] || 0); }, 0); };
    var kp = function (cls, l, v) { return '<div class="svc-kpi ' + cls + '"><small>' + l + '</small><b>' + v + '</b></div>'; };
    var body = '<div class="svc-kpis" style="grid-template-columns:repeat(4,1fr)">' +
      kp('blue', 'فواتير مرحّلة', posted.length) + kp('', 'الصافي قبل الضريبة', money(sum('subtotal'))) +
      kp('', 'الضريبة', money(sum('tax_amount'))) + kp(dir === 'sales' ? 'green' : 'red', 'الإجمالي', money(sum('total'))) + '</div>' +
      '<div class="svc-card"><div class="svc-toolbar">' +
      '<input class="grow" data-if="q" placeholder="بحث برقم الفاتورة/المرجع/الملاحظات…" value="' + esc(f.q) + '">' +
      '<input type="date" data-if="from" value="' + esc(f.from) + '" title="من تاريخ"><input type="date" data-if="to" value="' + esc(f.to) + '" title="إلى تاريخ">' +
      '<select data-if="party">' + opt('', 'كل ' + (dir === 'sales' ? 'العملاء' : 'الموردين'), f.party) +
      S[d.partyKey].map(function (p) { return opt(p.code, p.name, f.party); }).join('') + '</select>' +
      '<select data-if="status">' + opt('', 'كل الحالات', f.status) + opt('posted', 'مرحّلة', f.status) + opt('cancelled', 'ملغاة', f.status) + '</select>' +
      '<button class="svc-btn" data-act="inv-new" data-dir="' + dir + '">+ ' + d.newLabel + '</button></div>';
    if (!rows.length) {
      body += '<div class="svc-empty"><b>لا توجد فواتير</b>أنشئ ' + d.newLabel + ' لترحيل قيدها تلقائياً.</div>';
    } else {
      body += '<div style="overflow-x:auto"><table class="svc-table"><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>' + d.party + '</th>' +
        (dir === 'purchase' ? '<th>رقم فاتورة المورد</th>' : '') +
        '<th>الدفع</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr' + (r.status === 'cancelled' ? ' style="opacity:.6"' : '') + '><td class="code"><a href="#" data-act="inv-view" data-dir="' + dir + '" data-n="' + esc(r.inv_number) + '">' + esc(r.inv_number) + '</a></td>' +
            '<td>' + esc(r.inv_date) + '</td><td>' + esc(r.party_name || r.party_code) + '<small>' + esc(r.party_code) + '</small></td>' +
            (dir === 'purchase' ? '<td>' + esc(r.party_inv_number || '—') + '</td>' : '') +
            '<td><span class="svc-badge ' + r.payment_method + '">' + PAY_LABEL[r.payment_method] + '</span></td>' +
            '<td class="num">' + money(r.subtotal) + '</td><td class="num">' + money(r.tax_amount) + '</td><td class="num"><b>' + money(r.total) + '</b></td>' +
            '<td><span class="svc-badge ' + r.status + '">' + (r.status === 'posted' ? 'مرحّلة' : 'ملغاة') + '</span></td>' +
            '<td style="white-space:nowrap"><button class="svc-act" title="عرض والقيد" data-act="inv-view" data-dir="' + dir + '" data-n="' + esc(r.inv_number) + '">👁</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    document.getElementById('svcBody').innerHTML = body + '</div>';
  }

  /* ------------------------------------------------------------ نموذج الفاتورة */
  function newLine() { return { service_code: '', description: '', qty: 1, unit_price: 0, discount_percent: 0, tax: '' }; }

  function openInvoiceForm(dir) {
    var d = DIR[dir];
    S.invForm = { dir: dir, lines: [newLine()], previewed: false };
    var avail = S.services.filter(function (s) { return s.is_active && (s.service_type === dir || s.service_type === 'both'); });
    S.invForm.services = avail;
    var body = '<div class="svc-form" id="ivf">' +
      '<div class="svc-err" id="ivErr" style="display:none"></div>' +
      '<div><label>التاريخ <i>*</i></label><input type="date" id="ivDate" value="' + today() + '"></div>' +
      '<div><label>' + d.party + ' <i>*</i></label><select id="ivParty">' + opt('', 'اختر…', '') + S[d.partyKey].map(function (p) { return opt(p.code, p.code + ' — ' + p.name, ''); }).join('') + '</select></div>' +
      (dir === 'purchase' ? '<div><label>رقم فاتورة المورد</label><input id="ivRef" placeholder="لمنع التكرار"></div>' : '<div></div>') +
      '<div><label>طريقة الدفع</label><select id="ivPay">' + opt('credit', 'آجل (على الحساب)', 'credit') + opt('cash', 'نقدي', 'credit') + opt('bank', 'بنكي', 'credit') + '</select></div>' +
      '<div id="ivSetBox" style="display:none"><label>حساب الصندوق/البنك <i>*</i></label><select id="ivSet">' + accOptions(cashAccounts(), '', 'اختر الحساب…') + '</select></div>' +
      '<div><label>احتساب الضريبة</label><select id="ivTaxCalc">' + opt('exclusive', 'السعر لا يشمل الضريبة', 'exclusive') + opt('inclusive', 'السعر شامل الضريبة', 'exclusive') + '</select></div>' +
      '<div><label>مركز التكلفة</label><select id="ivCc">' + opt('', 'بلا', '') + S.costCenters.map(function (c) { return opt(c.code, c.code + ' — ' + c.name_ar, ''); }).join('') + '</select></div>' +
      '<div class="two"><label>ملاحظات</label><input id="ivNotes"></div>' +
      '<div class="full"><table class="svc-lines"><thead><tr><th style="width:26px">#</th><th style="width:22%">الخدمة</th><th>الوصف</th><th style="width:70px">الكمية</th><th style="width:96px">السعر</th><th style="width:70px">خصم %</th><th style="width:130px">الضريبة</th><th style="width:90px">الصافي</th><th style="width:80px">الضريبة</th><th style="width:95px">الإجمالي</th><th style="width:30px"></th></tr></thead><tbody id="ivLines"></tbody></table>' +
      '<button class="svc-btn ghost sm" style="margin-top:8px" data-act="iv-addline">+ إضافة سطر</button></div>' +
      '<div class="full"><div class="svc-totals" id="ivTotals"></div></div>' +
      '<div class="full" id="ivJournal"></div></div>';
    openModal(d.newLabel, body,
      '<button class="svc-btn ok" data-act="iv-post" id="ivPostBtn">ترحيل الفاتورة</button>' +
      '<button class="svc-btn" data-act="iv-preview">👁 معاينة القيد المحاسبي</button><button class="svc-btn ghost" data-act="close">إلغاء</button>', true);
    renderInvLines();
  }

  function lineCalc(l, method) {
    var t = taxOf(l.tax), rate = t ? num(t.rate) : 0, gross = num(l.qty) * num(l.unit_price), base = gross - gross * num(l.discount_percent) / 100, net, tax, total;
    if (method === 'inclusive' && rate > 0) { total = r2(base); net = r2(total / (1 + rate / 100)); tax = r2(total - net); }
    else { net = r2(base); tax = r2(net * rate / 100); total = r2(net + tax); }
    return { net: net, tax: tax, total: total };
  }

  function renderInvLines() {
    var F = S.invForm; if (!F) return;
    var tbody = document.getElementById('ivLines');
    tbody.innerHTML = F.lines.map(function (l, i) {
      return '<tr data-i="' + i + '"><td>' + (i + 1) + '</td>' +
        '<td><select data-lf="service_code">' + opt('', 'اختر خدمة…', l.service_code) + F.services.map(function (s) { return opt(s.code, s.code + ' — ' + s.name, l.service_code); }).join('') + '</select></td>' +
        '<td><input data-lf="description" value="' + esc(l.description) + '"></td>' +
        '<td><input type="number" min="0" step="0.0001" data-lf="qty" value="' + l.qty + '"></td>' +
        '<td><input type="number" min="0" step="0.01" data-lf="unit_price" value="' + l.unit_price + '"></td>' +
        '<td><input type="number" min="0" max="100" step="0.01" data-lf="discount_percent" value="' + l.discount_percent + '"></td>' +
        '<td><select data-lf="tax">' + taxOptions(l.tax) + '</select></td>' +
        '<td class="num" data-c="net"></td><td class="num" data-c="tax"></td><td class="num" data-c="total"></td>' +
        '<td><button class="svc-act" data-act="iv-delline" data-i="' + i + '" title="حذف السطر">✕</button></td></tr>';
    }).join('');
    updateInvTotals();
  }

  function updateInvTotals() {
    var F = S.invForm; if (!F) return;
    var method = document.getElementById('ivTaxCalc').value, st = 0, tx = 0, tt = 0;
    F.lines.forEach(function (l, i) {
      var c = lineCalc(l, method), row = document.querySelector('#ivLines tr[data-i="' + i + '"]');
      if (row) { row.querySelector('[data-c="net"]').textContent = money(c.net); row.querySelector('[data-c="tax"]').textContent = money(c.tax); row.querySelector('[data-c="total"]').textContent = money(c.total); }
      st += c.net; tx += c.tax; tt += c.total;
    });
    document.getElementById('ivTotals').innerHTML = '<div><small>الصافي قبل الضريبة</small><b>' + money(r2(st)) + '</b></div><div><small>الضريبة</small><b>' + money(r2(tx)) + '</b></div><div><small>الإجمالي</small><b style="color:var(--accent,#1565C0)">' + money(r2(tt)) + '</b></div>';
  }

  function invPayload() {
    var F = S.invForm, g = function (id) { return document.getElementById(id); };
    return {
      inv_date: g('ivDate').value, party_code: g('ivParty').value, party_inv_number: F.dir === 'purchase' ? (g('ivRef').value.trim() || null) : null,
      payment_method: g('ivPay').value, settlement_account_code: g('ivPay').value === 'credit' ? null : (g('ivSet').value || null),
      tax_calc_method: g('ivTaxCalc').value, cost_center_code: g('ivCc').value || null, notes: g('ivNotes').value.trim() || null,
      lines: F.lines.filter(function (l) { return l.service_code; }).map(function (l) {
        return { service_code: l.service_code, description: l.description || null, qty: num(l.qty), unit_price: num(l.unit_price),
          discount_percent: num(l.discount_percent), tax_type_code: l.tax || null };
      })
    };
  }

  function invError(msg) { var e = document.getElementById('ivErr'); e.textContent = msg; e.style.display = msg ? '' : 'none'; }

  function journalTable(journal, title, extra) {
    var d = journal.reduce(function (a, l) { return a + l.debit; }, 0), c = journal.reduce(function (a, l) { return a + l.credit; }, 0);
    var ok = Math.abs(d - c) < 0.005;
    return '<div class="svc-jr"><h4><span>' + esc(title) + '</span><span class="' + (ok ? 'svc-ok' : 'svc-bad') + '">' + (ok ? '✔ القيد متوازن' : '✖ القيد غير متوازن') + '</span></h4>' +
      '<table><thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead><tbody>' +
      journal.map(function (l) {
        return '<tr><td><b>' + esc(l.account_code) + '</b> ' + esc(l.account_name || '') + '</td><td>' + esc(l.description || '') + '</td>' +
          '<td class="num">' + (l.debit ? money(l.debit) : '') + '</td><td class="num">' + (l.credit ? money(l.credit) : '') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td class="num">' + money(d) + '</td><td class="num">' + money(c) + '</td></tr></tfoot></table>' + (extra || '') + '</div>';
  }

  function previewInvoice() {
    var p = invPayload(); invError('');
    var F = S.invForm;
    if (!p.party_code) return invError('اختر ' + DIR[F.dir].party);
    if (!p.lines.length) return invError('أضف خدمة واحدة على الأقل');
    call('POST', DIR[F.dir].path + '/preview', p).then(function (r) {
      F.previewed = true;
      var w = (r.warnings || []).map(function (x) { return '<div class="svc-bad" style="padding:6px 14px">⚠ ' + esc(x) + '</div>'; }).join('');
      document.getElementById('ivJournal').innerHTML = journalTable(r.journal, 'معاينة القيد (لم يُحفظ بعد)', w);
    }).catch(function (e) { invError(e.message); });
  }

  function postInvoice() {
    var F = S.invForm, p = invPayload(); invError('');
    if (!p.party_code) return invError('اختر ' + DIR[F.dir].party);
    if (!p.lines.length) return invError('أضف خدمة واحدة على الأقل');
    var tot = document.querySelector('#ivTotals div:last-child b').textContent;
    if (!window.confirm('سيتم ترحيل الفاتورة بإجمالي ' + tot + ' وإنشاء قيد محاسبي. هل تريد المتابعة؟')) return;
    var btn = document.getElementById('ivPostBtn'); btn.disabled = true;
    call('POST', DIR[F.dir].path, p).then(function (inv) {
      var dir = F.dir; closeModal(); toast('تم الترحيل: ' + inv.inv_number);
      return refreshAll().then(function () { viewInvoice(dir, inv.inv_number); });
    }).catch(function (e) { btn.disabled = false; invError(e.message || 'تعذر الترحيل'); });
  }

  /* ------------------------------------------------------------ عرض الفاتورة والإلغاء والطباعة */
  function viewInvoice(dir, n) {
    call('GET', DIR[dir].path + '/' + encodeURIComponent(n)).then(function (inv) {
      var d = DIR[dir];
      var head = '<div class="svc-form"><div><label>' + d.party + '</label><b>' + esc(inv.party_name || inv.party_code) + '</b></div>' +
        '<div><label>التاريخ</label><b>' + esc(inv.inv_date) + '</b></div>' +
        '<div><label>الحالة</label><span class="svc-badge ' + inv.status + '">' + (inv.status === 'posted' ? 'مرحّلة' : 'ملغاة') + '</span></div>' +
        '<div><label>الدفع</label><b>' + PAY_LABEL[inv.payment_method] + '</b></div>' +
        (inv.party_inv_number ? '<div><label>رقم فاتورة المورد</label><b>' + esc(inv.party_inv_number) + '</b></div>' : '') +
        '<div><label>القيد المحاسبي</label><b>#' + esc(inv.journal_entry_id || '—') + '</b></div>' +
        (inv.notes ? '<div class="full"><label>ملاحظات</label>' + esc(inv.notes) + '</div>' : '') +
        (inv.cancel_reason ? '<div class="full svc-err">سبب الإلغاء: ' + esc(inv.cancel_reason) + '</div>' : '') + '</div>';
      var lines = '<table class="svc-table" style="margin-top:12px"><thead><tr><th>#</th><th>الخدمة</th><th>الوصف</th><th>الكمية</th><th>السعر</th><th>خصم</th><th>الصافي</th><th>الضريبة</th><th>الإجمالي</th><th>الحساب</th></tr></thead><tbody>' +
        inv.lines.map(function (l) {
          return '<tr><td>' + l.line_no + '</td><td><b>' + esc(l.service_code) + '</b> ' + esc(l.service_name || '') + '</td><td>' + esc(l.description || '') + '</td>' +
            '<td class="num">' + l.qty + '</td><td class="num">' + money(l.unit_price) + '</td><td class="num">' + (l.discount_percent ? l.discount_percent + '%' : '—') + '</td>' +
            '<td class="num">' + money(l.net_amount) + '</td><td class="num">' + money(l.tax_amount) + (l.tax_rate ? ' <small>(' + l.tax_rate + '%)</small>' : '') + '</td>' +
            '<td class="num"><b>' + money(l.line_total) + '</b></td><td>' + esc(l.account_code) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<div class="svc-totals"><div><small>الصافي</small><b>' + money(inv.subtotal) + '</b></div><div><small>الضريبة</small><b>' + money(inv.tax_amount) + '</b></div><div><small>الإجمالي</small><b>' + money(inv.total) + '</b></div></div>';
      var jr = inv.journal && inv.journal.length ? journalTable(inv.journal, 'الأثر المحاسبي — قيد #' + inv.journal_entry_id + (inv.status === 'cancelled' ? ' (ملغى)' : '')) : '';
      S.viewInv = inv; S.viewDir = dir;
      openModal(d.newLabel.replace('فاتورة', 'فاتورة') + ' ' + inv.inv_number, head + lines + jr,
        '<button class="svc-btn ghost" data-act="inv-print">🖨 طباعة</button>' +
        (inv.status === 'posted' ? '<button class="svc-btn danger" data-act="inv-cancel">إلغاء الفاتورة وقيدها</button>' : '') +
        '<button class="svc-btn ghost" data-act="close">إغلاق</button>', true);
    }).catch(function (e) { toast(e.message, true); });
  }

  function cancelInvoice() {
    var inv = S.viewInv, dir = S.viewDir;
    var reason = window.prompt('سبب الإلغاء (اختياري). سيتم إلغاء الفاتورة وقيدها المحاسبي:');
    if (reason === null) return;
    call('POST', DIR[dir].path + '/' + encodeURIComponent(inv.inv_number) + '/cancel', { reason: reason }).then(function () {
      closeModal(); toast('تم إلغاء الفاتورة وقيدها'); return refreshAll();
    }).catch(function (e) { toast(e.message, true); });
  }

  function printInvoice() {
    var inv = S.viewInv, d = DIR[S.viewDir];
    var w = window.open('', '_blank'); if (!w) return toast('اسمح بالنوافذ المنبثقة للطباعة', true);
    w.document.write('<html dir="rtl"><head><meta charset="utf-8"><title>' + esc(inv.inv_number) + '</title><style>body{font-family:Tahoma,Arial;padding:24px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:6px;font-size:13px;text-align:right}h2{margin:0}.t{margin-top:14px;text-align:left}</style></head><body>' +
      '<h2>' + esc(d.newLabel) + ' ' + esc(inv.inv_number) + '</h2><p>' + d.party + ': ' + esc(inv.party_name || inv.party_code) + ' — التاريخ: ' + esc(inv.inv_date) + ' — الحالة: ' + (inv.status === 'posted' ? 'مرحّلة' : 'ملغاة') + '</p>' +
      '<table><tr><th>#</th><th>الخدمة</th><th>الكمية</th><th>السعر</th><th>خصم</th><th>الصافي</th><th>الضريبة</th><th>الإجمالي</th></tr>' +
      inv.lines.map(function (l) { return '<tr><td>' + l.line_no + '</td><td>' + esc(l.service_name || l.service_code) + '</td><td>' + l.qty + '</td><td>' + money(l.unit_price) + '</td><td>' + (l.discount_percent || 0) + '%</td><td>' + money(l.net_amount) + '</td><td>' + money(l.tax_amount) + '</td><td>' + money(l.line_total) + '</td></tr>'; }).join('') +
      '</table><div class="t">الصافي: ' + money(inv.subtotal) + ' | الضريبة: ' + money(inv.tax_amount) + ' | <b>الإجمالي: ' + money(inv.total) + '</b></div></body></html>');
    w.document.close(); w.focus(); w.print();
  }

  /* ------------------------------------------------------------ الأحداث */
  var debounce;
  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute('data-f')) {                       // مرشحات الكتالوج
      var k = t.getAttribute('data-f');
      if (k === 'pageSize') S.pageSize = parseInt(t.value, 10); else S.f[k] = t.value;
      S.page = 1;
      clearTimeout(debounce);
      debounce = setTimeout(function () { var pos = t.selectionStart; renderCatalog(); var q = document.getElementById('svcQ'); if (k === 'q' && q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) { } } }, k === 'q' ? 220 : 0);
    } else if (t.hasAttribute('data-if') && S.tab !== 'catalog') {        // مرشحات الفواتير
      S.inv[S.tab].f[t.getAttribute('data-if')] = t.value;
      var dir = S.tab; clearTimeout(debounce);
      debounce = setTimeout(function () { loadInvoices(dir).then(function () { if (S.tab === dir) { var a = document.activeElement, id = a && a.getAttribute && a.getAttribute('data-if'); var pos = a && a.selectionStart; renderInvoices(dir); if (id) { var n = document.querySelector('[data-if="' + id + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) { } } } } }); }, t.tagName === 'INPUT' && t.type === 'text' ? 350 : 0);
    } else if (t.hasAttribute('data-lf') && S.invForm) {                     // أسطر الفاتورة
      var i = parseInt(t.closest('tr').getAttribute('data-i'), 10), field = t.getAttribute('data-lf'), l = S.invForm.lines[i];
      l[field] = t.value;
      if (field === 'service_code') {
        var s = S.invForm.services.filter(function (x) { return x.code === t.value; })[0];
        if (s) { l.description = s.name; l.unit_price = s[DIR[S.invForm.dir].priceKey]; l.tax = s.tax_type_code || ''; l.discount_percent = 0; renderInvLines(); return; }
      }
      updateInvTotals();
    } else if (t.id === 'ivPay') {
      document.getElementById('ivSetBox').style.display = t.value === 'credit' ? 'none' : '';
    } else if (t.id === 'ivTaxCalc') {
      updateInvTotals();
    } else if (t.id === 'sfTax' || t.id === 'sfRev' || t.id === 'sfExp') {
      syncServiceForm();
    } else if (t.getAttribute && t.getAttribute('data-act') === 'svc-toggle' && e.type === 'change') {
      call('POST', '/api/services/' + encodeURIComponent(t.getAttribute('data-code')) + '/toggle')
        .then(function () { return refreshAll(); }).catch(function (er) { toast(er.message, true); refreshAll(); });
    }
  }

  function onClick(e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'svc-toggle') return;                     // يعالجه حدث change
    if (el.tagName === 'A') e.preventDefault();
    switch (act) {
      case 'close': closeModal(); break;
      case 'refresh': refreshAll(true); break;
      case 'tab': S.tab = el.getAttribute('data-tab'); S.tab === 'catalog' ? renderBody() : loadInvoices(S.tab).then(renderBody); break;
      case 'page': S.page += parseInt(el.getAttribute('data-d'), 10); renderCatalog(); break;
      case 'export': exportCsv(); break;
      case 'svc-new': openServiceForm(null); break;
      case 'svc-edit': openServiceForm(el.getAttribute('data-code')); break;
      case 'svc-del':
        if (window.confirm('حذف الخدمة نهائياً؟')) call('DELETE', '/api/services/' + encodeURIComponent(el.getAttribute('data-code')))
          .then(function () { toast('تم الحذف'); return refreshAll(); }).catch(function (er) { toast(er.message, true); });
        break;
      case 'sf-type': S.form.type = el.getAttribute('data-t'); syncServiceForm(); break;
      case 'sf-save': saveService(); break;
      case 'inv-new': openInvoiceForm(el.getAttribute('data-dir')); break;
      case 'inv-view': viewInvoice(el.getAttribute('data-dir'), el.getAttribute('data-n')); break;
      case 'iv-addline': S.invForm.lines.push(newLine()); renderInvLines(); break;
      case 'iv-delline': if (S.invForm.lines.length > 1) { S.invForm.lines.splice(parseInt(el.getAttribute('data-i'), 10), 1); renderInvLines(); } break;
      case 'iv-preview': previewInvoice(); break;
      case 'iv-post': postInvoice(); break;
      case 'inv-cancel': cancelInvoice(); break;
      case 'inv-print': printInvoice(); break;
    }
  }

  /* ------------------------------------------------------------ التشغيل */
  function refreshAll(withRefs) {
    var jobs = [loadServices()];
    if (withRefs) jobs.push(loadRefs());
    if (S.tab !== 'catalog') jobs.push(loadInvoices(S.tab));
    return Promise.all(jobs).then(function () { renderKpis(); renderBody(); })
      .catch(function (e) { toast(e.message || 'تعذر تحميل البيانات', true); });
  }

  window.renderServicesModule = function () {
    if (!root()) return;
    injectCss(); shell();
    S.loaded = false;
    loadRefs().then(function () { return loadServices(); }).then(function () {
      S.loaded = true; renderKpis(); renderBody();
    }).catch(function (e) {
      document.getElementById('svcBody').innerHTML = '<div class="svc-card"><div class="svc-err">تعذر تحميل الخدمات: ' + esc(e.message) + '</div></div>';
    });
  };

  // فتح الشاشة من القائمة: نلتف حول activateTab بدل تعديل script.js
  var orig = window.activateTab;
  if (typeof orig === 'function') {
    window.activateTab = function (k) {
      var r = orig.apply(this, arguments);
      if (k === 'services') window.renderServicesModule();
      return r;
    };
  }
})();
