/* LEGEND D ERP — تحسين استيراد المنتجات وقائمة المنتجات (PF-01.5)
   1) تحقق مسبق عند «تحليل الملف»: التصنيف / الماركة / المورد / قالب الوحدة / المستودع
      يجب أن تكون مسجّلة في النظام. يُقبل الكود أو الاسم أو الصيغة «الكود — الاسم»،
      وتُعرض الأكواد المفقودة مجمّعة مع عدد صفوفها قبل أن تضغط «استيراد».
   2) نموذج Excel فيه قوائم منسدلة حقيقية مبنية من المسجَّل في النظام لحظة التنزيل.
   3) ترقيم حقيقي لمعاينة الاستيراد ولقائمة المنتجات (السابق/التالي).
   يُحمَّل هذا الملف في آخر index.html (قبل </body>). */
(function (root) {
  'use strict';

  /* ===================== ثوابت ===================== */
  var SEP = ' — ';
  var REF_SHEET = 'القوائم المرجعية';
  var HEADERS = ['كود المنتج', 'اسم المنتج', 'اسم المنتج (إنجليزي)', 'الوصف', 'الباركود', 'كود التصنيف',
    'كود الماركة', 'كود المورد الافتراضي', 'كود المنتج عند المورد', 'الوحدة', 'كود قالب الوحدة (اختياري)',
    'سعر التكلفة الافتراضي', 'سعر البيع', 'الرصيد الافتتاحي (الكمية)', 'حد إعادة الطلب', 'كود المستودع',
    'الحالة (active/paused/inactive)'];
  var SAMPLE = ['SKU-1001', 'قهوة عربية 250 جرام', 'Arabic Coffee 250g', 'قهوة عربية مطحونة فاخرة',
    '6221234567890', '', '', '', '', 'حبة', '', '18', '25', '50', '10', '', 'active'];
  var MAX_ROWS = 2000; // عدد الصفوف التي يشملها التحقق المنسدل في النموذج

  /* ===================== أدوات نقية (قابلة للاختبار) ===================== */
  function normText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/[إأآا]/g, 'ا')
      .replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim().toLowerCase();
  }
  function normHeader(h) { return normText(h); }

  function labelOf(code, name) {
    code = String(code == null ? '' : code).trim();
    name = String(name == null ? '' : name).trim();
    return name && name !== code ? code + SEP + name : code;
  }

  /* قالب الوحدة: الشاشة الحالية تحفظه في المتصفح بالشكل {id,name,base,higher,higherName,factor}
     بينما الخادم يعيده {code,name,base_unit,higher_unit,factor}. نوحّد الشكلين. */
  function normalizeTemplate(t) {
    t = t || {};
    var name = String(t.name == null ? '' : t.name).trim();
    var code = t.code != null ? t.code : (t.id != null ? t.id : name);
    return { code: String(code).trim(), name: name,
      base_unit: String(t.base_unit != null ? t.base_unit : (t.base || '')).trim(),
      higher_unit: String(t.higher_unit != null ? t.higher_unit : (t.higherName || t.higher || '')).trim(),
      factor: t.factor };
  }
  function mergeTemplates() { // قوائم متعددة (خادم + متصفح) بلا تكرار بالاسم
    var seen = {}, out = [];
    Array.prototype.slice.call(arguments).forEach(function (list) {
      (list || []).forEach(function (t) {
        var n = normalizeTemplate(t);
        var k = normText(n.name || n.code);
        if (k && !seen[k]) { seen[k] = 1; out.push(n); }
      });
    });
    return out;
  }
  function templateLabel(t) { return t.name || t.code; }
  function templateDetail(t) {
    return (t.name || t.code) + ': ' + (t.base_unit || '—') + (t.higher_unit ? ' ← ' + t.higher_unit +
      (t.factor ? ' × ' + t.factor : '') : '');
  }

  /* فهرس مرجعي: يبحث بالكود أولاً ثم بالاسم */
  function buildIndex(list, codeOf, namesOf) {
    var byCode = {}, byName = {};
    (list || []).forEach(function (it) {
      var c = String(codeOf(it) == null ? '' : codeOf(it)).trim();
      if (c) byCode[normText(c)] = it;
      (namesOf(it) || []).forEach(function (n) {
        n = normText(n);
        if (n && !(n in byName)) byName[n] = it;
      });
    });
    return { byCode: byCode, byName: byName, codeOf: codeOf };
  }

  /* يرجع {empty:true} إن كانت الخانة فارغة، أو {ok, item, code} */
  function resolveRef(raw, idx) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return { empty: true, ok: true, code: null, item: null };
    var tries = [v];
    var p = v.indexOf(SEP);
    if (p > 0) tries.push(v.slice(0, p)); // «الكود — الاسم» من القائمة المنسدلة
    var p2 = v.indexOf(' - ');
    if (p2 > 0) tries.push(v.slice(0, p2));
    for (var i = 0; i < tries.length; i++) {
      var hit = idx.byCode[normText(tries[i])] || idx.byName[normText(tries[i])];
      if (hit) return { ok: true, item: hit, code: String(idx.codeOf(hit)).trim(), empty: false };
    }
    return { ok: false, item: null, code: null, empty: false, raw: v };
  }

  /* يحلّل الصفوف ويتحقق منها. refs: {categories, brands, suppliers, warehouses, templates, items}
     أي قائمة null تعني «تعذّر جلبها» فيُتخطّى فحصها ويُذكر في warnings */
  function analyzeRows(rows, refs) {
    var head = rows[0] || [];
    var warnings = [];
    function idxOf(list, key, codeFn, nameFns, label) {
      if (list == null) { warnings.push('تعذّر جلب ' + label + ' من الخادم، فلم يُتحقق منها.'); return null; }
      return buildIndex(list, codeFn, nameFns);
    }
    var I = {
      category: idxOf(refs.categories, 'c', function (x) { return x.code; }, function (x) { return [x.name_ar, x.name_en]; }, 'التصنيفات'),
      brand: idxOf(refs.brands, 'b', function (x) { return x.code; }, function (x) { return [x.name_ar, x.name_en]; }, 'الماركات'),
      supplier: idxOf(refs.suppliers, 's', function (x) { return x.code; }, function (x) { return [x.name, x.trade_name]; }, 'الموردين'),
      template: idxOf(refs.templates, 't', function (x) { return x.code; }, function (x) { return [x.name]; }, 'قوالب الوحدات'),
      warehouse: idxOf(refs.warehouses, 'w', function (x) { return x.code; }, function (x) { return [x.name]; }, 'المستودعات')
    };
    var existingCodes = refs.items == null ? null : {};
    (refs.items || []).forEach(function (x) { existingCodes[normText(x.code)] = true; });

    // قارئ خانات لكل صف (دالة مستقلة كي لا تتشارك الصفوف نفس المتغيرات داخل الحلقة)
    function rowReader(map) {
      return function (names) {
        for (var n = 0; n < names.length; n++) {
          var val = map[normHeader(names[n])];
          if (val !== undefined && String(val).trim() !== '') return String(val).trim();
        }
        return '';
      };
    }
    var parsed = [], codeCounts = {};
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (!row.some(function (v) { return String(v == null ? '' : v).trim(); })) continue;
      var map = {};
      head.forEach(function (h, k) { map[normHeader(h)] = row[k] == null ? '' : row[k]; });
      var reader = rowReader(map);
      parsed.push({ rowNo: i + 1, get: reader });
      var code = reader(['كود المنتج', 'Item Code', 'SKU']);
      if (code) codeCounts[code] = (codeCounts[code] || 0) + 1;
    }

    var valid = [], errors = [];
    var missing = { category: {}, brand: {}, supplier: {}, template: {}, warehouse: {} };
    var LABEL = { category: 'التصنيف', brand: 'الماركة', supplier: 'المورد', template: 'قالب الوحدة', warehouse: 'المستودع' };

    parsed.forEach(function (r) {
      var g = r.get, reasons = [];
      var p = {
        code: g(['كود المنتج', 'Item Code', 'SKU']),
        name: g(['اسم المنتج', 'Item Name']),
        name_en: g(['اسم المنتج (إنجليزي)', 'اسم المنتج انجليزي', 'Item Name (English)', 'Name EN']) || null,
        description: g(['الوصف', 'وصف المنتج', 'Description']) || null,
        barcode: g(['الباركود', 'Barcode']) || null,
        category_code: null, brand_code: null, supplier_code: null,
        supplier_item_code: g(['كود المنتج عند المورد', 'Supplier Item Code']) || null,
        unit: g(['الوحدة', 'Unit']),
        default_warehouse_id: null,
        status: 'active',
        default_cost: parseFloat(g(['سعر التكلفة الافتراضي', 'التكلفة', 'Default Cost']) || 0) || 0,
        price: parseFloat(g(['سعر البيع', 'Price']) || 0) || 0,
        opening_qty: parseFloat(g(['الرصيد الافتتاحي (الكمية)', 'الرصيد الافتتاحي', 'Opening Qty']) || 0) || 0,
        reorder_level: parseFloat(g(['حد إعادة الطلب', 'Reorder Level']) || 0) || 0
      };
      var st = (g(['الحالة (active/paused/inactive)', 'الحالة', 'Status']) || 'active').toLowerCase();
      p.status = ['active', 'paused', 'inactive'].indexOf(st) >= 0 ? st : 'active';

      function check(kind, raws) {
        var raw = g(raws);
        if (!raw) return null;
        if (!I[kind]) return { skipped: true, raw: raw };
        var res = resolveRef(raw, I[kind]);
        if (!res.ok) {
          reasons.push(LABEL[kind] + ' «' + raw + '» غير مسجَّل في النظام');
          missing[kind][raw] = (missing[kind][raw] || 0) + 1;
        }
        return res;
      }
      var cat = check('category', ['كود التصنيف', 'التصنيف', 'Category Code']);
      var br = check('brand', ['كود الماركة', 'الماركة', 'Brand Code']);
      var su = check('supplier', ['كود المورد الافتراضي', 'كود المورد', 'المورد', 'Supplier Code']);
      var tp = check('template', ['كود قالب الوحدة (اختياري)', 'كود قالب الوحدة', 'قالب الوحدة', 'Unit Template']);
      var wh = check('warehouse', ['كود المستودع', 'المستودع', 'Warehouse Code', 'Warehouse']);

      // عند تعذّر التحقق (skipped) نُبقي القيمة كما في الملف ليقرر الخادم
      p.category_code = cat ? (cat.skipped ? cat.raw : cat.code) : null;
      p.brand_code = br ? (br.skipped ? br.raw : br.code) : null;
      p.supplier_code = su ? (su.skipped ? su.raw : su.code) : null;
      if (wh && wh.ok && wh.item && wh.item.id != null) p.default_warehouse_id = wh.item.id;
      if (!p.unit && tp && tp.ok && tp.item && tp.item.base_unit) p.unit = tp.item.base_unit; // الوحدة من القالب
      if (!p.unit) p.unit = 'حبة';

      if (!p.code) reasons.push('كود المنتج فارغ');
      if (!p.name) reasons.push('اسم المنتج فارغ');
      if (p.code && existingCodes && existingCodes[normText(p.code)]) reasons.push('كود المنتج مستخدم من قبل بقائمة المنتجات');
      if (p.code && (codeCounts[p.code] || 0) > 1) reasons.push('كود المنتج مكرر داخل نفس ملف الاستيراد');

      if (reasons.length) errors.push({ rowNo: r.rowNo, name: p.name, code: p.code, reasons: reasons });
      else valid.push({ rowNo: r.rowNo, payload: p });
    });

    return { valid: valid, errors: errors, total: valid.length + errors.length, missing: missing,
      warnings: warnings, labels: LABEL };
  }

  /* ===================== نموذج Excel بقوائم منسدلة ===================== */
  function escXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function colLetter(n) { // 0 → A
    var s = ''; n = n + 1;
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function dvXml(dv) {
    var f = dv.inline ? '"' + escXml(dv.inline) + '"'
      : escXml("'" + REF_SHEET + "'!$" + dv.refCol + '$2:$' + dv.refCol + '$' + (dv.count + 1));
    return '<dataValidation type="list" errorStyle="' + (dv.warn ? 'warning' : 'stop') + '" allowBlank="1"' +
      ' showInputMessage="1" showErrorMessage="1"' +
      ' errorTitle="' + escXml(dv.errTitle) + '" error="' + escXml(dv.err) + '"' +
      ' promptTitle="' + escXml(dv.promptTitle) + '" prompt="' + escXml(dv.prompt) + '"' +
      ' sqref="' + dv.col + '2:' + dv.col + (MAX_ROWS + 1) + '"><formula1>' + f + '</formula1></dataValidation>';
  }
  /* ترتيب عناصر ورقة العمل في معيار OOXML صارم في Excel: dataValidations يجب أن يأتي بعد
     sheetData/mergeCells وقبل hyperlinks/printOptions/pageMargins/.../ignoredErrors/drawing/tableParts. */
  var AFTER_DV = /<(hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s\/>]/;
  function injectValidations(sheetXml, dvs) {
    if (!dvs.length) return sheetXml;
    var body = '<dataValidations count="' + dvs.length + '">' + dvs.map(dvXml).join('') + '</dataValidations>';
    var later = AFTER_DV.exec(sheetXml);
    var at = later ? later.index : sheetXml.lastIndexOf('</worksheet>');
    if (at < 0) return sheetXml;
    return sheetXml.slice(0, at) + body + sheetXml.slice(at); // slice بدل replace لتفادي رموز $ الخاصة
  }

  /* lists: {categories:[{code,name_ar}], brands, suppliers, templates:[{code,name,base_unit,higher_unit}], warehouses} */
  function buildWorkbookSpec(lists) {
    var cat = (lists.categories || []).map(function (x) { return labelOf(x.code, x.name_ar); });
    var brd = (lists.brands || []).map(function (x) { return labelOf(x.code, x.name_ar); });
    var sup = (lists.suppliers || []).map(function (x) { return labelOf(x.code, x.name); });
    var tpl = (lists.templates || []).map(function (x) { return templateLabel(normalizeTemplate(x)); });
    var tplDetails = (lists.templates || []).map(function (x) { return templateDetail(normalizeTemplate(x)); });
    var wh = (lists.warehouses || []).map(function (x) { return labelOf(x.code, x.name); });
    var unitsSet = {}; var units = [];
    ['حبة', 'كرتون', 'علبة', 'كيلو', 'جرام', 'لتر', 'متر', 'دزينة', 'طقم'].concat(
      (lists.templates || []).reduce(function (a, t) { return a.concat([t.base_unit, t.higher_unit]); }, []))
      .forEach(function (u) { u = String(u || '').trim(); if (u && !unitsSet[u]) { unitsSet[u] = 1; units.push(u); } });

    var columns = [ // ترتيب أعمدة الورقة المرجعية
      { key: 'cat', title: 'التصنيفات', values: cat },
      { key: 'brand', title: 'الماركات', values: brd },
      { key: 'sup', title: 'الموردون', values: sup },
      { key: 'tpl', title: 'قوالب الوحدات', values: tpl },
      { key: 'wh', title: 'المستودعات', values: wh },
      { key: 'unit', title: 'الوحدات الشائعة', values: units },
      { key: 'tpld', title: 'تفاصيل قوالب الوحدات (للاطلاع)', values: tplDetails }
    ];
    var refCol = {}; columns.forEach(function (c, i) { refCol[c.key] = colLetter(i); });
    var col = function (h) { return colLetter(HEADERS.indexOf(h)); };

    var targets = [
      { key: 'cat', header: 'كود التصنيف', title: 'التصنيف' },
      { key: 'brand', header: 'كود الماركة', title: 'الماركة' },
      { key: 'sup', header: 'كود المورد الافتراضي', title: 'المورد' },
      { key: 'tpl', header: 'كود قالب الوحدة (اختياري)', title: 'قالب الوحدة' },
      { key: 'wh', header: 'كود المستودع', title: 'المستودع' },
      { key: 'unit', header: 'الوحدة', title: 'الوحدة', warn: true }
    ];
    var dvs = [];
    targets.forEach(function (t) {
      var c = columns.filter(function (x) { return x.key === t.key; })[0];
      if (!c.values.length) return; // لا قيم مسجّلة → لا قائمة (يُترك الحقل حراً وسيرفضه التحليل)
      dvs.push({
        col: col(t.header), refCol: refCol[t.key], count: c.values.length, warn: !!t.warn,
        errTitle: 'قيمة غير مسجَّلة', err: t.warn ? 'هذه الوحدة ليست في القائمة. هل تريد المتابعة؟'
          : 'اختر ' + t.title + ' من القائمة المسجَّلة في النظام، أو اترك الخانة فارغة.',
        promptTitle: t.title, prompt: 'اختر من القائمة المنسدلة (من المسجَّل في النظام).'
      });
    });
    dvs.push({ col: col('الحالة (active/paused/inactive)'), inline: 'active,paused,inactive', count: 3,
      errTitle: 'حالة غير صحيحة', err: 'القيم المسموحة: active أو paused أو inactive.',
      promptTitle: 'الحالة', prompt: 'active = نشط، paused = متوقف مؤقتاً، inactive = غير نشط.' });

    var maxLen = Math.max.apply(null, columns.map(function (c) { return c.values.length; }).concat([1]));
    var refRows = [columns.map(function (c) { return c.title; })];
    for (var i = 0; i < maxLen; i++) refRows.push(columns.map(function (c) { return c.values[i] || ''; }));
    var empties = [];
    if (!cat.length) empties.push('لا توجد تصنيفات مسجَّلة — أنشئها أولاً من: المخزون ← التصنيفات.');
    if (!brd.length) empties.push('لا توجد ماركات مسجَّلة.');
    if (!tpl.length) empties.push('لا توجد قوالب وحدات مسجَّلة.');
    var help = [['تعليمات استيراد المنتجات'],
      ['1) املأ الورقة Items. الأعمدة المطلوبة: كود المنتج واسم المنتج.'],
      ['2) أعمدة التصنيف والماركة والمورد وقالب الوحدة والمستودع فيها قائمة منسدلة من المسجَّل في النظام؛ اتركها فارغة إن لم تحتجها.'],
      ['3) إن لم تجد التصنيف المطلوب فأنشئه في النظام أولاً ثم نزّل هذا النموذج من جديد.'],
      ['4) عمود الوحدة يقبل أي وحدة؛ وإن تُرك فارغاً مع اختيار قالب وحدة تُؤخذ الوحدة الأساسية من القالب.'],
      ['5) لا تغيّر ترتيب الأعمدة ولا أسماءها.']].concat(empties.map(function (e) { return ['تنبيه: ' + e]; }));

    return { dvs: dvs, refRows: refRows, help: help };
  }

  async function buildTemplateBuffer(XLSX, JSZip, lists) {
    var spec = buildWorkbookSpec(lists);
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet([HEADERS, SAMPLE]);
    ws['!cols'] = HEADERS.map(function (h) { return { wch: Math.max(16, String(h).length + 4) }; });
    XLSX.utils.book_append_sheet(wb, ws, 'Items');
    var wr = XLSX.utils.aoa_to_sheet(spec.refRows);
    wr['!cols'] = spec.refRows[0].map(function () { return { wch: 34 }; });
    XLSX.utils.book_append_sheet(wb, wr, REF_SHEET);
    var wh = XLSX.utils.aoa_to_sheet(spec.help);
    wh['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, wh, 'تعليمات');
    var raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var zip = await JSZip.loadAsync(raw);
    var path = 'xl/worksheets/sheet1.xml';
    var xml = await zip.file(path).async('string');
    zip.file(path, injectValidations(xml, spec.dvs));
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  /* ===================== جزء المتصفح ===================== */
  var exported = { normText: normText, labelOf: labelOf, buildIndex: buildIndex, resolveRef: resolveRef,
    analyzeRows: analyzeRows, injectValidations: injectValidations, buildWorkbookSpec: buildWorkbookSpec,
    buildTemplateBuffer: buildTemplateBuffer, normalizeTemplate: normalizeTemplate, mergeTemplates: mergeTemplates,
    HEADERS: HEADERS, SAMPLE: SAMPLE, REF_SHEET: REF_SHEET };
  if (typeof module !== 'undefined' && module.exports) { module.exports = exported; }
  if (typeof document === 'undefined') return; // بيئة اختبار بلا متصفح

  var IMPORT_PAGE_SIZE = 20;
  var state = { file: null, page: 1, failed: [], analysis: { valid: [], errors: [], total: 0, missing: {} } };
  function byId(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function msg(t, ok) {
    var el = byId('itemImportMsg'); if (!el) { alert(t); return; }
    el.style.display = 'block'; el.style.color = ok ? '#166534' : '#b42318';
    el.style.background = ok ? '#f0fdf4' : '#fff1f2';
    el.style.border = ok ? '1px solid #bbf7d0' : '1px solid #fecdd3';
    el.style.borderRadius = '12px'; el.style.padding = '10px 12px'; el.textContent = t;
  }
  function clearUi() {
    state.analysis = { valid: [], errors: [], total: 0, missing: {} }; state.page = 1; state.failed = [];
    var sum = byId('itemImportSummary'); if (sum) { sum.style.display = 'none'; sum.innerHTML = ''; }
    var prev = byId('itemImportPreview'); if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
    var btn = byId('itemImportCommitBtn'); if (btn) btn.disabled = true;
  }
  function loadScript(url, test) {
    return new Promise(function (resolve, reject) {
      if (test()) return resolve();
      var sc = document.createElement('script'); sc.src = url;
      sc.onload = function () { test() ? resolve() : reject(new Error('تعذر تحميل المكتبة')); };
      sc.onerror = function () { reject(new Error('تعذر تحميل المكتبة من الإنترنت')); };
      document.head.appendChild(sc);
      setTimeout(function () { if (!test()) reject(new Error('انتهت مهلة تحميل المكتبة')); }, 12000);
    });
  }
  function ensureXlsx() {
    return loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', function () { return !!root.XLSX; });
  }
  function ensureJsZip() {
    return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', function () { return !!root.JSZip; });
  }

  function decode(buffer) {
    var bytes = new Uint8Array(buffer || []);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { try { return new TextDecoder('windows-1256').decode(bytes); } catch (_) { return new TextDecoder('utf-8').decode(bytes); } }
  }
  function parseDelimited(text) {
    var first = String(text || '').split(/\r?\n/).find(function (l) { return l.trim(); }) || '';
    var d = ';', max = -1;
    [';', ',', '\t'].forEach(function (o) { var c = first.split(o).length - 1; if (c > max) { max = c; d = o; } });
    var rows = [], row = [], cell = '', q = false; text = String(text || '').replace(/^\ufeff/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], nx = text[i + 1];
      if (ch === '"') { if (q && nx === '"') { cell += '"'; i++; } else q = !q; }
      else if (ch === d && !q) { row.push(cell.trim()); cell = ''; }
      else if ((ch === '\n' || ch === '\r') && !q) {
        if (ch === '\r' && nx === '\n') i++;
        row.push(cell.trim()); cell = ''; if (row.some(function (x) { return String(x).trim(); })) rows.push(row); row = [];
      } else cell += ch;
    }
    row.push(cell.trim()); if (row.some(function (x) { return String(x).trim(); })) rows.push(row);
    return rows;
  }
  async function parseFile(file, buffer) {
    if (/\.xlsx?$/i.test(file.name)) {
      await ensureXlsx();
      var wb = root.XLSX.read(buffer, { type: 'array' });
      var sheet = wb.SheetNames[0];
      if (!sheet) throw new Error('ملف Excel لا يحتوي على أي ورقة عمل.');
      return root.XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', raw: false })
        .filter(function (r) { return Array.isArray(r) && r.some(function (v) { return String(v || '').trim(); }); });
    }
    return parseDelimited(decode(buffer));
  }

  async function fetchList(url) {
    try { var r = await root.api('GET', url); return Array.isArray(r) ? r : null; } catch (e) { return null; }
  }
  function localUnitTemplates() { // مصدر شاشة «قوالب الوحدات» الحالية: ذاكرة المتصفح
    try {
      var v = JSON.parse(root.localStorage.getItem('unitTemplates') || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  async function fetchRefs() {
    var r = await Promise.all([fetchList('/api/categories'), fetchList('/api/brands'), fetchList('/api/suppliers'),
      fetchList('/api/unit-templates'), fetchList('/api/warehouses'), fetchList('/api/items')]);
    return { categories: r[0], brands: r[1], suppliers: r[2], templates: mergeTemplates(r[3], localUnitTemplates()),
      warehouses: r[4], items: r[5] };
  }

  function pagerHtml(page, pages, from, to, total, fn) {
    return '<div style="display:flex;gap:10px;align-items:center;justify-content:center;margin-top:12px;flex-wrap:wrap">' +
      '<button type="button" class="btn secondary"' + (page <= 1 ? ' disabled' : '') + ' onclick="' + fn + '(-1)">السابق</button>' +
      '<span>صفحة ' + page + ' من ' + pages + ' — الصفوف ' + from + '–' + to + ' من ' + total + '</span>' +
      '<button type="button" class="btn secondary"' + (page >= pages ? ' disabled' : '') + ' onclick="' + fn + '(1)">التالي</button></div>';
  }

  function render() {
    var a = state.analysis;
    var sum = byId('itemImportSummary'), prev = byId('itemImportPreview'), btn = byId('itemImportCommitBtn');
    if (btn) btn.disabled = !a.valid.length;
    if (sum) {
      sum.style.display = 'grid';
      sum.innerHTML = '<div class="import-stat"><b>' + a.total + '</b><span>عدد الصفوف</span></div>' +
        '<div class="import-stat ok"><b>' + a.valid.length + '</b><span>صفوف صحيحة</span></div>' +
        '<div class="import-stat bad"><b>' + a.errors.length + '</b><span>صفوف بها أخطاء</span></div>';
    }
    if (!prev) return;
    // الأكواد غير المسجَّلة مجمّعة
    var miss = '';
    Object.keys(a.missing || {}).forEach(function (kind) {
      var entries = Object.keys(a.missing[kind]);
      if (!entries.length) return;
      miss += '<div style="margin:6px 0"><b>' + esc(a.labels[kind]) + ' غير مسجَّل في النظام:</b> ' +
        entries.map(function (k) { return esc(k) + ' (' + a.missing[kind][k] + ' صف)'; }).join('، ') + '</div>';
    });
    var warn = (a.warnings || []).map(function (w) { return '<div>⚠ ' + esc(w) + '</div>'; }).join('');
    var box = (miss || warn) ? '<div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:12px;padding:10px 12px;margin-bottom:10px">' +
      (miss ? miss + '<div style="margin-top:6px">أنشئ هذه العناصر أولاً من شاشاتها (المخزون ← التصنيفات / الماركات ...) بنفس الكود تماماً، ثم أعد تحليل الملف. ' +
        'أو اترك الخانة فارغة في الملف.</div>' : '') + warn + '</div>' : '';
    // كل الصفوف (الأخطاء أولاً ثم الصحيحة) مقسَّمة على صفحات حقيقية — لا إخفاء لأي صف
    var all = a.errors.map(function (x) {
      return '<tr><td>' + x.rowNo + '</td><td>❌ خطأ</td><td colspan="2">' + esc(x.name ? x.name + ' — ' : '') + esc(x.reasons.join(' - ')) + '</td></tr>';
    }).concat(a.valid.map(function (x) {
      return '<tr><td>' + x.rowNo + '</td><td>✅ صحيح</td><td>' + esc(x.payload.name) + '</td><td>' + esc(x.payload.code) + '</td></tr>';
    }));
    var total = all.length, pages = Math.max(1, Math.ceil(total / IMPORT_PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    var from = total ? (state.page - 1) * IMPORT_PAGE_SIZE + 1 : 0, to = Math.min(total, state.page * IMPORT_PAGE_SIZE);
    var failedHtml = (state.failed || []).length ?
      '<div class="scrollx" style="margin-top:14px"><table class="grid"><thead><tr><th>الصف</th><th>الحالة</th><th colspan="2">سبب فشل الحفظ بالخادم</th></tr></thead><tbody>' +
      state.failed.map(function (f) { return '<tr><td>' + f.rowNo + '</td><td>❌ فشل الحفظ</td><td colspan="2">' + esc(f.name) + ' — ' + esc(f.reason) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : '';
    prev.style.display = 'block';
    prev.innerHTML = box + '<div class="scrollx"><table class="grid"><thead><tr><th>الصف</th><th>الحالة</th><th>اسم المنتج / سبب الخطأ</th><th>الكود</th></tr></thead><tbody>' +
      all.slice(from ? from - 1 : 0, to).join('') + '</tbody></table></div>' +
      (pages > 1 ? pagerHtml(state.page, pages, from, to, total, 'itemImportGoPage') : '') + failedHtml;
  }
  root.itemImportGoPage = function (delta) { state.page += delta; render(); };

  root.selectItemImportFile = function (file) {
    state.file = file || null; clearUi();
    var fn = byId('itemImportFileName'); if (fn) fn.value = file ? file.name : 'لم يتم اختيار ملف';
    if (file) msg('تم اختيار الملف: ' + file.name + ' — اضغط زر تحليل الملف الآن.', true);
  };

  root.analyzeItemImportFile = async function () {
    var input = byId('itemImportFile');
    var file = state.file || (input && input.files && input.files[0]);
    if (!file) { msg('اختر ملفًا أولًا من زر رفع الملف / اختيار ملف، ثم اضغط تحليل الملف.', false); return; }
    state.file = file; msg('جاري تحليل الملف والتحقق من التصنيفات والماركات والموردين، انتظر لحظة...', true);
    try {
      var buffer = await file.arrayBuffer();
      var rows = await parseFile(file, buffer);
      if (!rows || rows.length < 2) {
        msg('الملف لا يحتوي على بيانات منتجات. تأكد من وجود صف عناوين وصف بيانات واحد على الأقل.', false); return;
      }
      var refs = await fetchRefs();
      state.analysis = analyzeRows(rows, refs); state.page = 1; state.failed = [];
      render();
      var a = state.analysis;
      msg('تم تحليل الملف: ' + a.valid.length + ' صف صحيح، ' + a.errors.length + ' صف به أخطاء.' +
        (a.errors.length ? ' راجع الأسباب في الجدول أدناه.' : ''), a.errors.length === 0);
    } catch (e) { msg('تعذر تحليل الملف: ' + (e.message || e), false); }
  };

  root.commitItemImport = async function () {
    var a = state.analysis;
    if (!a.valid.length) { msg('لا توجد صفوف صحيحة للاستيراد. حل الأخطاء ثم أعد التحليل.', false); return; }
    var btn = byId('itemImportCommitBtn'); if (btn) btn.disabled = true;
    var ok = 0, failed = [];
    for (var i = 0; i < a.valid.length; i++) {
      var item = a.valid[i], p = item.payload;
      try { await root.api('POST', '/api/items', p); ok++; }
      catch (e) { failed.push({ rowNo: item.rowNo, name: p.name, reason: (e && e.message) || 'خطأ غير معروف من الخادم' }); }
    }
    try { await root.loadAll(); } catch (e) { try { if (typeof root.renderItems === 'function') root.renderItems(); } catch (_) { /* ignore */ } }
    if (failed.length) {
      state.failed = failed; render();
      msg('تم حفظ ' + ok + ' منتج بنجاح، وفشل حفظ ' + failed.length + ' صف فعلياً بالخادم (انظر التفاصيل أسفله).', ok > 0);
      if (btn) btn.disabled = false;
    } else {
      msg('تم استيراد وحفظ ' + ok + ' منتج بنجاح فعلياً بقائمة المنتجات.', true); clearUi();
    }
  };

  var origClose = root.closeItemImport;
  root.closeItemImport = function () { if (typeof origClose === 'function') origClose(); state.file = null; clearUi(); };

  root.downloadItemImportTemplate = async function () {
    msg('جاري تجهيز النموذج من التصنيفات والقوالب المسجَّلة في النظام...', true);
    try {
      await ensureXlsx();
      var r = await fetchRefs();
      var lists = { categories: r.categories || [], brands: r.brands || [], suppliers: r.suppliers || [],
        templates: r.templates || [], warehouses: r.warehouses || [] };
      var data, withDropdowns = true;
      try {
        await ensureJsZip();
        data = await buildTemplateBuffer(root.XLSX, root.JSZip, lists);
      } catch (e) { // بدون القوائم المنسدلة إن تعذّر تحميل JSZip
        withDropdowns = false;
        var wb = root.XLSX.utils.book_new();
        var ws = root.XLSX.utils.aoa_to_sheet([HEADERS, SAMPLE]);
        root.XLSX.utils.book_append_sheet(wb, ws, 'Items');
        var sp = buildWorkbookSpec(lists);
        root.XLSX.utils.book_append_sheet(wb, root.XLSX.utils.aoa_to_sheet(sp.refRows), REF_SHEET);
        data = root.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      }
      var blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'items_import_template.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      var counts = 'وُجد في النظام: تصنيفات ' + lists.categories.length + '، ماركات ' + lists.brands.length +
        '، موردون ' + lists.suppliers.length + '، قوالب وحدات ' + lists.templates.length + '، مستودعات ' + lists.warehouses.length + '.';
      var empty = [];
      if (!lists.categories.length) empty.push('التصنيفات');
      if (!lists.brands.length) empty.push('الماركات');
      if (!lists.templates.length) empty.push('قوالب الوحدات');
      msg('تم تنزيل النموذج' + (withDropdowns ? ' مع قوائم منسدلة من المسجَّل في النظام. ' + counts : ' (بدون قوائم منسدلة لتعذّر تحميل مكتبة إضافية؛ راجع ورقة «' + REF_SHEET + '»).') +
        (empty.length ? ' تنبيه: لا توجد ' + empty.join(' و') + ' مسجَّلة بعد، فلن تظهر لها قائمة — أنشئها أولاً ثم أعد تنزيل النموذج.' : ''), true);
    } catch (e) { msg('تعذر تنزيل النموذج: ' + (e.message || e), false); }
  };

  /* ===================== ترقيم حقيقي لقائمة المنتجات =====================
     الأزرار الأصلية (prevItemPage/nextItemPage) كانت تغيّر الرقم فقط دون إعادة رسم الجدول،
     والجدول كان يعرض كل المنتجات دفعة واحدة. هنا نغلّف دالة الرسم الأصلية لتعرض صفحة واحدة. */
  var ITEM_SIZES = [25, 50, 100, 200];
  function itemPageSize() {
    var v = 50; try { v = parseInt(root.localStorage.getItem('itemPageSize') || '50', 10); } catch (e) { /* ignore */ }
    return ITEM_SIZES.indexOf(v) >= 0 ? v : 50;
  }
  function itemsSource() { // نفس منطق الاختيار الأصلي لمصدر الصفوف (مفلتر أو الكل)
    return itemFiltered.isFiltered ? itemFiltered :
      (Array.isArray(itemFiltered) && itemFiltered.length ? itemFiltered : (items || []));
  }
  function paintItemPager(page, pages, from, to, total) {
    var info = byId('itemPageInfo'); if (!info) return;
    info.textContent = total ? 'صفحة ' + page + ' من ' + pages + ' — عرض ' + from + '–' + to + ' من ' + total : 'لا توجد منتجات';
    var box = info.parentNode, btns = box.querySelectorAll('button');
    if (btns.length >= 2) { btns[0].disabled = page <= 1; btns[btns.length - 1].disabled = page >= pages; }
    var sel = byId('itemPageSizeSel');
    if (!sel) {
      sel = document.createElement('select'); sel.id = 'itemPageSizeSel'; sel.className = 'field';
      sel.style.cssText = 'width:auto;display:inline-block;margin-inline-start:12px';
      sel.title = 'عدد المنتجات في الصفحة';
      sel.innerHTML = ITEM_SIZES.map(function (n) { return '<option value="' + n + '">' + n + ' في الصفحة</option>'; }).join('');
      sel.onchange = function () {
        try { root.localStorage.setItem('itemPageSize', sel.value); } catch (e) { /* ignore */ }
        itemPage = 1; root.renderItemsTable();
      };
      box.appendChild(sel);
    }
    sel.value = String(itemPageSize());
  }
  if (typeof root.renderItemsTable === 'function' && typeof itemPage !== 'undefined' && typeof itemFiltered !== 'undefined') {
    var origRenderItems = root.renderItemsTable;
    root.renderItemsTable = function () {
      var all = itemsSource(), size = itemPageSize(), total = all.length;
      var pages = Math.max(1, Math.ceil(total / size));
      if (itemPage > pages) itemPage = pages;
      if (itemPage < 1) itemPage = 1;
      var start = (itemPage - 1) * size, slice = all.slice(start, start + size);
      slice.isFiltered = true; // الدالة الأصلية ترسم هذه الشريحة فقط
      var saved = itemFiltered; itemFiltered = slice;
      try { origRenderItems.apply(this, arguments); } finally { itemFiltered = saved; }
      paintItemPager(itemPage, pages, total ? start + 1 : 0, Math.min(total, start + size), total);
    };
    root.prevItemPage = function () { if (itemPage > 1) { itemPage--; root.renderItemsTable(); } };
    root.nextItemPage = function () { itemPage++; root.renderItemsTable(); }; // يُقيَّد داخل الرسم
    try { root.renderItemsTable(); } catch (e) { /* قد لا تكون البيانات محمّلة بعد */ }
  }
})(typeof window !== 'undefined' ? window : globalThis);