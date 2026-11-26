/* ===== LEGEND D — RFQ Smart Analysis (Data Research) v1 =====
   تحليل ذكي لطلب عرض السعر اعتمادًا على بيانات النظام نفسها:
   1) أهمية الطلب من مبيعات الصنف + المخزون + نقطة إعادة الطلب
   2) توصية بالكمية المناسبة (بنفس وحدة الطلب)
   3) مقارنة أسعار الموردين من فواتير الشراء السابقة
   المحرك (RFQ_AI.analyzeLine) دالة نقية بلا اعتماد على الصفحة، لذا يمكن اختبارها وتطويرها
   لاحقًا (مثلًا إضافة نموذج LLM يكتب الشرح) دون تغيير الواجهة. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = (n, d = 0) => (isFinite(n) ? Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '-');
  const money = n => (isFinite(n) && n > 0 ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-');
  const toDate = v => { const d = new Date(v); return isNaN(d) ? null : d; };
  const daysAgo = (d, today) => Math.floor((today - d) / DAY);
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  const DEFAULTS = { leadDays: 14, targetCoverDays: 45, salesWindow: 90 };

  /* ---------- فهرس المبيعات: لكل صنف إحصاءات + ترتيب إيراد (ABC) ---------- */
  function buildSalesIndex(salesInvoices, today, windowDays) {
    const map = new Map();
    (salesInvoices || []).forEach(inv => {
      if (!inv || norm(inv.status) === 'cancelled' || norm(inv.status) === 'ملغي') return;
      const d = toDate(inv.inv_date || inv.date); if (!d) return;
      const age = daysAgo(d, today); if (age < 0 || age > windowDays) return;
      (inv.lines || []).forEach(l => {
        const id = String(l.item_id); const q = num(l.qty); if (!q) return;
        let st = map.get(id); if (!st) { st = { id, d30: 0, d60: 0, win: 0, revenue: 0, tx: 0, first: d, last: d }; map.set(id, st); }
        st.win += q; st.tx += 1; st.revenue += q * num(l.unit_price);
        if (age <= 30) st.d30 += q; else if (age <= 60) st.d60 += q;
        if (d < st.first) st.first = d; if (d > st.last) st.last = d;
      });
    });
    const ranked = [...map.values()].sort((a, b) => b.revenue - a.revenue);
    const total = ranked.reduce((s, x) => s + x.revenue, 0) || 1; let acc = 0;
    ranked.forEach(x => { acc += x.revenue; x.abc = acc - x.revenue < total * 0.8 ? 'A' : (acc - x.revenue < total * 0.95 ? 'B' : 'C'); });
    return map;
  }

  /* ---------- فهرس المشتريات: لكل صنف -> لكل مورد ---------- */
  function buildPurchaseIndex(purchaseInvoices) {
    const map = new Map();
    (purchaseInvoices || []).forEach(inv => {
      if (!inv || norm(inv.status) === 'cancelled' || norm(inv.status) === 'ملغي') return;
      const d = toDate(inv.inv_date || inv.date); if (!d) return;
      (inv.lines || []).forEach(l => {
        const id = String(l.item_id), cost = num(l.unit_cost), q = num(l.qty); if (!cost) return;
        const key = id + '|' + (inv.supplier_code || '');
        let r = map.get(key); if (!r) { r = { item: id, supplier: inv.supplier_code || '', buys: [] }; map.set(key, r); }
        r.buys.push({ date: d, cost, qty: q });
      });
    });
    const byItem = new Map();
    map.forEach(r => { if (!byItem.has(r.item)) byItem.set(r.item, []); byItem.get(r.item).push(r); });
    return byItem;
  }

  function findItem(items, line) {
    const code = norm(line.productCode), name = norm(line.productName);
    return (items || []).find(i => code && norm(i.code) === code) || (items || []).find(i => name && norm(i.name) === name) || null;
  }

  /* ---------- تحليل بند واحد ---------- */
  function analyzeLine(line, ctx) {
    const s = Object.assign({}, DEFAULTS, ctx.settings || {});
    const today = ctx.today || new Date();
    const item = findItem(ctx.items, line);
    const out = { found: !!item, reasons: [], warnings: [] };
    if (!item) { out.level = 'غير معروف'; out.score = 0; out.warnings.push('الصنف غير مرتبط بسجل المنتجات، اختره من القائمة ليعمل التحليل.'); return out; }

    const factor = Math.max(1, num(ctx.getFactor ? ctx.getFactor(item, line.unit) : 1) || 1);
    const qtyReq = num(line.qty), qtyBase = qtyReq * factor;
    const stock = num(item.qty_on_hand != null ? item.qty_on_hand : (item.qty != null ? item.qty : item.quantity));
    const reorder = num(item.reorder_level);
    const st = ctx.salesIndex.get(String(item.id));
    Object.assign(out, { item, factor, qtyReq, qtyBase, stock, reorder, unit: line.unit });

    /* المبيعات */
    let avgDaily = 0, trend = null, conf = 'ضعيفة';
    if (st) {
      const span = Math.min(s.salesWindow, Math.max(14, daysAgo(st.first, today) + 1));
      avgDaily = st.win / span;
      if (st.d60 > 0) trend = (st.d30 - st.d60) / st.d60;
      conf = st.tx >= 10 ? 'عالية' : st.tx >= 3 ? 'متوسطة' : 'ضعيفة';
      out.sales = { d30: st.d30, win: st.win, tx: st.tx, last: st.last, abc: st.abc, daysSinceLast: daysAgo(st.last, today), span };
    } else out.sales = { d30: 0, win: 0, tx: 0, abc: 'C' };
    out.avgDaily = avgDaily; out.trend = trend; out.confidence = conf;
    out.coverDays = avgDaily > 0 ? stock / avgDaily : null;
    out.coverAfter = avgDaily > 0 ? (stock + qtyBase) / avgDaily : null;

    /* درجة الأهمية */
    let score = 0; const R = out.reasons;
    if (avgDaily > 0) {
      if (stock <= 0) { score += 45; R.push('المخزون صفر ويوجد طلب مستمر على الصنف.'); }
      else if (out.coverDays <= s.leadDays) { score += 40; R.push('المخزون يكفي ' + fmt(out.coverDays) + ' يوم فقط، أقل من مدة التوريد المتوقعة (' + s.leadDays + ' يوم).'); }
      else if (out.coverDays <= s.leadDays * 2) { score += 25; R.push('المخزون يكفي ' + fmt(out.coverDays) + ' يوم، قريب من حد التوريد.'); }
      else if (out.coverDays <= 60) { score += 10; R.push('المخزون يكفي ' + fmt(out.coverDays) + ' يوم.'); }
      else R.push('المخزون كافٍ لنحو ' + fmt(out.coverDays) + ' يوم.');
    } else if (st === undefined) R.push('لا توجد مبيعات لهذا الصنف في آخر ' + s.salesWindow + ' يوم.');
    if (reorder > 0 && stock <= reorder) { score += 15; R.push('المخزون (' + fmt(stock) + ') عند أو دون حد إعادة الطلب (' + fmt(reorder) + ').'); }
    const abc = out.sales.abc; score += abc === 'A' ? 20 : abc === 'B' ? 10 : 3;
    if (abc === 'A') R.push('من أعلى الأصناف إيرادًا (فئة A) — نفاده مكلف.');
    if (trend != null && trend > 0.2) { score += 10; R.push('المبيعات في ارتفاع: +' + fmt(trend * 100) + '% عن الشهر السابق.'); }
    if (trend != null && trend < -0.2) { score -= 5; R.push('المبيعات في انخفاض: ' + fmt(trend * 100) + '% عن الشهر السابق.'); }
    if (!st && stock > 0) { score = Math.min(score, 15); }
    out.score = Math.max(0, Math.min(100, Math.round(score)));
    out.level = out.score >= 75 ? 'حرج' : out.score >= 50 ? 'مرتفع' : out.score >= 25 ? 'متوسط' : 'منخفض';

    /* توصية الكمية */
    if (avgDaily > 0) {
      const needBase = Math.max(0, avgDaily * s.targetCoverDays - stock);
      const recUnit = Math.ceil(needBase / factor);
      out.recQty = recUnit;
      if (qtyReq < recUnit * 0.7) { out.qtyVerdict = 'low'; out.warnings.push('الكمية المطلوبة أقل من الحاجة المتوقعة لتغطية ' + s.targetCoverDays + ' يوم (المقترح ' + fmt(recUnit) + ' ' + (line.unit || '') + ').'); }
      else if (recUnit > 0 && qtyReq > recUnit * 1.5) { out.qtyVerdict = 'high'; out.warnings.push('الكمية أكبر بنحو ' + fmt((qtyReq / recUnit - 1) * 100) + '% من الحاجة المتوقعة (' + fmt(recUnit) + ' ' + (line.unit || '') + ') — تأكد من عدم تكدس المخزون.'); }
      else if (recUnit === 0 && qtyReq > 0) { out.qtyVerdict = 'high'; out.warnings.push('المخزون الحالي يغطي ' + s.targetCoverDays + ' يوم بالفعل؛ الطلب قد لا يكون ضروريًا الآن.'); }
      else out.qtyVerdict = 'ok';
    } else out.qtyVerdict = 'unknown';
    if (conf === 'ضعيفة' && st) out.warnings.push('عدد عمليات البيع قليل؛ دقة التقدير ضعيفة.');

    /* مقارنة الموردين من فواتير الشراء */
    const rows = (ctx.purchaseIndex.get(String(item.id)) || []).map(r => {
      const b = [...r.buys].sort((x, y) => y.date - x.date), last = b[0], prev = b[1];
      const tq = b.reduce((a, x) => a + (x.qty || 1), 0) || 1;
      const wavg = b.reduce((a, x) => a + x.cost * (x.qty || 1), 0) / tq;
      const sup = (ctx.suppliers || []).find(x => String(x.code) === String(r.supplier));
      return {
        code: r.supplier, name: sup ? (sup.trade_name || sup.name || r.supplier) : r.supplier,
        last: last.cost * factor, avg: wavg * factor, count: b.length, lastDate: last.date,
        change: prev ? (last.cost - prev.cost) / prev.cost : null, ageDays: daysAgo(last.date, today)
      };
    }).sort((a, b) => a.last - b.last);
    const recent = rows.filter(r => r.ageDays <= 365);
    const pool = recent.length ? recent : rows;
    if (pool.length) {
      pool.forEach(r => r.best = false); pool[0].best = true;
      const worst = pool[pool.length - 1];
      out.bestSupplier = pool[0];
      out.savings = pool.length > 1 ? (worst.last - pool[0].last) * qtyReq : 0;
      out.savingsPct = pool.length > 1 && worst.last ? (worst.last - pool[0].last) / worst.last : 0;
      out.medianLast = median(pool.map(r => r.last));
    }
    const wac = num(item.avg_cost) * factor; out.wac = wac;
    out.suppliers = rows;
    const inRfq = new Set((ctx.rfqSuppliers || []).map(x => String(x.supplierCode || '')).filter(Boolean));
    rows.forEach(r => { r.inRfq = inRfq.has(String(r.code)); });
    if (!rows.length) out.warnings.push('لا يوجد سجل شراء سابق لهذا الصنف؛ لا يمكن ترشيح مورد من التاريخ.');
    const missing = rows.filter(r => !r.inRfq && r.ageDays <= 365).slice(0, 3);
    out.suggestedSuppliers = missing;
    return out;
  }

  function analyzeAll(lines, data, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const today = data.today || new Date();
    const ctx = {
      items: data.items, suppliers: data.suppliers, getFactor: data.getFactor, rfqSuppliers: data.rfqSuppliers, settings: s, today,
      salesIndex: buildSalesIndex(data.salesInvoices, today, s.salesWindow),
      purchaseIndex: buildPurchaseIndex(data.purchaseInvoices)
    };
    return lines.map(l => analyzeLine(l, ctx));
  }

  const RFQ_AI = { analyzeLine, analyzeAll, buildSalesIndex, buildPurchaseIndex, DEFAULTS };
  root.RFQ_AI = RFQ_AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = RFQ_AI;
  if (typeof document === 'undefined') return;

  /* ====================== الواجهة ====================== */
  const settings = Object.assign({}, DEFAULTS);
  const LEVEL_CLR = { 'حرج': '#b91c1c', 'مرتفع': '#c2410c', 'متوسط': '#a16207', 'منخفض': '#15803d', 'غير معروف': '#64748b' };
  const g = name => { try { return (0, eval)('typeof ' + name + "!=='undefined'?" + name + ':null'); } catch (e) { return null; } };
  function data() {
    return {
      items: g('items') || root.items || [], suppliers: g('suppliers') || root.suppliers || [],
      salesInvoices: g('salesInvoices') || [], purchaseInvoices: g('invoices') || [],
      getFactor: (it, u) => (typeof root.getItemUnitFactor === 'function' ? root.getItemUnitFactor(it, u) : 1),
      rfqSuppliers: root.__rfqState ? root.__rfqState.suppliers() : [], today: new Date()
    };
  }
  function ensureCard() {
    let card = document.getElementById('rfqSmartCard'); if (card) return card;
    const grid = document.querySelector('#panel-quotation_request .rfq-main-grid'); if (!grid) return null;
    grid.insertAdjacentHTML('afterend', '<div class="formcard rfq-card" id="rfqSmartCard"></div>');
    return document.getElementById('rfqSmartCard');
  }
  const kpi = (l, v, s) => '<div class="rs-kpi"><span>' + l + '</span><b>' + v + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</div>';

  function lineHtml(a, i, line) {
    const nm = esc(line.productName || '-');
    if (!a.found) return '<div class="rs-line"><b>' + nm + '</b><div class="rs-warn">' + esc(a.warnings[0]) + '</div></div>';
    const clr = LEVEL_CLR[a.level];
    let h = '<div class="rs-line"><div class="rs-head"><div><b>' + nm + '</b><small> ' + fmt(a.qtyReq, 2) + ' ' + esc(line.unit || '') + (a.factor > 1 ? ' = ' + fmt(a.qtyBase) + ' ' + esc(a.item.unit || 'وحدة أساسية') : '') + '</small></div>'
      + '<span class="rs-badge" style="background:' + clr + '">' + a.level + ' · ' + a.score + '/100</span></div>';
    h += '<div class="rs-kpis">' + kpi('المخزون الحالي', fmt(a.stock)) + kpi('مبيعات 30 يوم', fmt(a.sales.d30), a.trend != null ? (a.trend >= 0 ? '▲ ' : '▼ ') + fmt(Math.abs(a.trend) * 100) + '%' : '')
      + kpi('المتوسط اليومي', fmt(a.avgDaily, 1)) + kpi('يكفي', a.coverDays != null ? fmt(a.coverDays) + ' يوم' : '-', a.coverAfter != null ? 'بعد الطلب: ' + fmt(a.coverAfter) + ' يوم' : '')
      + kpi('فئة الصنف', a.sales.abc, 'دقة التقدير: ' + a.confidence) + '</div>';
    if (a.reasons.length) h += '<ul class="rs-reasons">' + a.reasons.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>';
    a.warnings.forEach(w => { h += '<div class="rs-warn">⚠ ' + esc(w) + '</div>'; });
    if (a.recQty != null && a.qtyVerdict !== 'ok' && a.recQty > 0 && Number(a.recQty) !== a.qtyReq)
      h += '<button class="btn secondary" onclick="rfqSmartApplyQty(' + i + ',' + a.recQty + ')">تطبيق الكمية المقترحة: ' + fmt(a.recQty) + ' ' + esc(line.unit || '') + '</button>';
    if (a.suppliers.length) {
      h += '<div class="scrollx"><table class="grid rs-table"><thead><tr><th>المورد</th><th>آخر سعر / ' + esc(line.unit || 'وحدة') + '</th><th>المتوسط المرجّح</th><th>التغير</th><th>عدد المشتريات</th><th>آخر شراء</th><th></th></tr></thead><tbody>'
        + a.suppliers.map(r => '<tr class="' + (r.best ? 'rs-best' : '') + '"><td>' + esc(r.name) + (r.best ? ' <span class="rs-tag">الأفضل سعرًا</span>' : '') + (r.ageDays > 365 ? ' <span class="rs-tag old">قديم</span>' : '') + '</td><td>' + money(r.last) + '</td><td>' + money(r.avg) + '</td><td>'
          + (r.change == null ? '-' : (r.change > 0 ? '▲ ' : r.change < 0 ? '▼ ' : '') + fmt(Math.abs(r.change) * 100, 1) + '%') + '</td><td>' + r.count + '</td><td>' + r.lastDate.toISOString().slice(0, 10) + '</td><td>'
          + (r.inRfq ? '<small>ضمن الطلب ✓</small>' : '<button class="btn secondary" onclick="rfqSmartAddSupplier(\'' + esc(String(r.code).replace(/'/g, '')) + '\',\'' + esc(String(r.name).replace(/'/g, '')) + '\')">+ إضافة للطلب</button>') + '</td></tr>').join('')
        + '</tbody></table></div>';
      const bits = [];
      if (a.savings > 0) bits.push('الفرق بين أرخص وأغلى مورد: ' + money(a.savings) + ' (' + fmt(a.savingsPct * 100, 1) + '%) على كمية هذا الطلب');
      if (a.wac > 0) bits.push('متوسط التكلفة المرجّح بالمخزون: ' + money(a.wac) + ' / ' + esc(line.unit || 'وحدة'));
      if (bits.length) h += '<div class="rs-note">💡 ' + bits.join(' — ') + '</div>';
    }
    return h + '</div>';
  }

  root.rfqSmartRender = function () {
    const card = ensureCard(); if (!card || !root.__rfqState) return;
    const lines = root.__rfqState.lines().filter(l => l.productName);
    let res = [];
    try { res = analyzeAll(lines, data(), settings); } catch (e) { console.warn('RFQ smart', e); }
    const crit = res.filter(r => r.found && r.score >= 75).length;
    const sav = res.reduce((s, r) => s + (r.savings || 0), 0);
    card.innerHTML = '<div class="rfq-section-head"><h3>🤖 التحليل الذكي للطلب (Data Research)</h3>'
      + '<div class="rs-set"><label>مدة التوريد <input type="number" min="1" value="' + settings.leadDays + '" onchange="rfqSmartSet(\'leadDays\',this.value)"> يوم</label>'
      + '<label>تغطية مستهدفة <input type="number" min="7" value="' + settings.targetCoverDays + '" onchange="rfqSmartSet(\'targetCoverDays\',this.value)"> يوم</label></div></div>'
      + (lines.length ? '<div class="rs-summary">' + (crit ? '🔴 ' + crit + ' بند حرج · ' : '') + 'مبنيٌّ على مبيعات آخر ' + settings.salesWindow + ' يوم وفواتير الشراء السابقة' + (sav > 0 ? ' · فرق أسعار محتمل ' + money(sav) : '') + '</div>' : '<div class="hint">أضف منتجات لطلب العرض ليظهر التحليل.</div>')
      + lines.map((l, k) => lineHtml(res[k], root.__rfqState.lines().indexOf(l), l)).join('');
  };
  root.rfqSmartSet = (k, v) => { const n = num(v); if (n > 0) settings[k] = n; root.rfqSmartRender(); };
  root.rfqSmartApplyQty = (i, q) => root.__rfqState && root.__rfqState.setQty(i, q);
  root.rfqSmartAddSupplier = (code, name) => { if (root.__rfqState) { root.__rfqState.addSupplier(code, name); root.rfqSmartRender(); } };

  const css = document.createElement('style');
  css.textContent = '#rfqSmartCard .rs-set{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;font-weight:700;color:#475569}#rfqSmartCard .rs-set input{width:62px;padding:4px 6px;border:1px solid #dbe3ef;border-radius:8px}'
    + '.rs-summary{background:#eef6ff;border:1px solid #cfe4ff;border-radius:12px;padding:8px 12px;margin:8px 0;font-weight:800;color:#0f3768;font-size:13px}'
    + '.rs-line{border:1px solid #e2e8f0;border-radius:14px;padding:12px;margin:10px 0;background:#fff}.rs-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}'
    + '.rs-head small{color:#64748b;font-weight:700}.rs-badge{color:#fff;border-radius:999px;padding:4px 12px;font-weight:900;font-size:12px}'
    + '.rs-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0}.rs-kpi{background:#f8fafc;border-radius:10px;padding:8px}.rs-kpi span{display:block;font-size:11px;color:#64748b;font-weight:800}.rs-kpi b{font-size:16px}.rs-kpi small{display:block;color:#64748b;font-size:11px}'
    + '.rs-reasons{margin:6px 0;padding-inline-start:18px;font-size:13px;color:#334155}.rs-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:6px 10px;margin:6px 0;font-size:13px;font-weight:700}'
    + '.rs-table .rs-best td{background:#f0fdf4}.rs-tag{background:#16a34a;color:#fff;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:900}.rs-tag.old{background:#94a3b8}.rs-note{margin-top:8px;font-size:13px;color:#166534;font-weight:700}';
  document.head.appendChild(css);
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => { try { root.rfqSmartRender(); } catch (e) { } }, 400));
})(typeof window !== 'undefined' ? window : globalThis);
