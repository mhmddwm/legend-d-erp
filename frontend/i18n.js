/*
 * LEGEND D Localization Engine - PF-01.2
 * هدف الملف: جعل النظام متعدد اللغات من طبقة مركزية واحدة بدل ترجمة النصوص داخل الكود.
 * يدعم: Arabic RTL / English LTR، ترجمة النصوص الثابتة، placeholders، والعناصر التي تظهر ديناميكياً.
 */
(function(){
  'use strict';

  const STORAGE_KEY = 'erp-lang';
  const DEFAULT_LANG = 'ar';
  const SUPPORTED = ['ar','en'];

  const entries = [
    ['app.name','LEGEND D ERP SYS','LEGEND D ERP SYS'],
    ['user.system_manager','مدير النظام','System Manager'],
    ['user.general_manager','المدير العام','General Manager'],
    ['user.full_permissions','صلاحيات كاملة','Full permissions'],
    ['settings.display','إعدادات العرض','Display Settings'],
    ['settings.layout_method','طريقة العرض','Layout'],
    ['settings.language','اللغة','Language'],
    ['layout.horizontal','أفقي','Horizontal'],
    ['layout.vertical','عمودي','Vertical'],
    ['language.arabic','عربي','Arabic'],
    ['language.english','English','English'],
    ['auth.logout','تسجيل الخروج','Logout'],
    ['status.ready_for_development','جاهزة للتطوير','Ready for development'],
    ['action.save','حفظ','Save'],
    ['action.cancel','إلغاء','Cancel'],
    ['action.add','إضافة','Add'],
    ['action.edit','تعديل','Edit'],
    ['action.delete','حذف','Delete'],
    ['action.view','عرض','View'],
    ['action.copy','نسخ','Copy'],
    ['action.search','بحث','Search'],
    ['action.refresh','تحديث','Refresh'],
    ['action.import','استيراد','Import'],
    ['action.export_excel','تصدير إلى اكسيل','Export to Excel'],
    ['action.print','طباعة','Print'],
    ['action.close','إغلاق','Close'],
    ['nav.dashboard','لوحة التحكم','Dashboard'],
    ['nav.accounting','الحسابات','Accounting'],
    ['nav.inventory','المخزون','Inventory'],
    ['nav.purchasing','المشتريات','Purchasing'],
    ['nav.sales','المبيعات','Sales'],
    ['nav.products_services','إعدادات المنتجات والخدمات','Products & Services Settings'],
    ['nav.print_templates','قوالب الطباعة','Print Templates'],
    ['nav.whatsapp_templates','قوالب الواتس اب','WhatsApp Templates'],
    ['nav.email_templates','قوالب الايميل','Email Templates'],
    ['nav.auto_send_rules','قواعد الارسال الالي','Auto Sending Rules'],
    ['nav.general_settings','الإعدادات العامة','General Settings'],
    ['nav.account_info','معلومات الحساب','Account Information'],
    ['nav.account_settings','إعدادات الحساب','Account Settings'],
    ['nav.sequence_settings','إعدادات الترقيم المتسلسل','Sequence Settings'],
    ['nav.apps_management','إدارة التطبيقات','Applications Management'],
    ['nav.themes','السمات والخلفيات','Themes & Backgrounds'],
    ['module.chart_of_accounts','دليل الحسابات','Chart of Accounts'],
    ['module.products','المنتجات','Products'],
    ['module.services','الخدمات','Services'],
    ['module.categories','التصنيفات','Categories'],
    ['module.unit_templates','قوالب الوحدات','Unit Templates'],
    ['module.brands','الماركات','Brands'],
    ['module.barcode_settings','إعدادات الباركود','Barcode Settings'],
    ['module.extra_fields','الحقول الإضافية','Extra Fields'],
    ['module.suppliers','الموردين','Suppliers'],
    ['module.purchase_request','طلب شراء','Purchase Request'],
    ['module.rfq','طلب عرض سعر','Request for Quotation'],
    ['module.purchase_orders','أوامر الشراء','Purchase Orders'],
    ['module.goods_receipt','استلام بضاعة','Goods Receipt'],
    ['module.purchase_invoices','فواتير الشراء','Purchase Invoices'],
    ['module.purchase_returns','مرتجعات المشتريات','Purchase Returns'],
    ['module.supplier_payments','مدفوعات الموردين','Supplier Payments'],
    ['module.tax_settings','إعدادات الضرائب','Tax Settings'],
    ['field.name','الاسم','Name'],
    ['field.trade_name','الاسم التجاري','Trade Name'],
    ['field.first_name','الاسم الاول','First Name'],
    ['field.last_name','الاسم الاخير','Last Name'],
    ['field.phone','الهاتف','Phone'],
    ['field.mobile','رقم الجوال','Mobile'],
    ['field.email','البريد الاليكتروني','Email'],
    ['field.supplier_code','رقم المورد','Supplier Code'],
    ['field.vat_number','الرقم الضريبي','VAT Number'],
    ['field.commercial_register','السجل التجاري','Commercial Register'],
    ['field.currency','العملة','Currency'],
    ['field.opening_balance','الرصيد الافتتاحي','Opening Balance'],
    ['field.opening_date','تاريخ الافتتاحي','Opening Date'],
    ['field.payment_terms','شروط الدفع','Payment Terms'],
    ['field.product','المنتج','Product'],
    ['field.product_name','اسم المنتج','Product Name'],
    ['field.product_name_en','إسم المنتج انجليزي','Product English Name'],
    ['field.sku','الرقم التسلسلي SKU','SKU'],
    ['field.barcode','الباركود','Barcode'],
    ['field.supplier_product_code','كود المورد في شاشة المنتج','Supplier Product Code'],
    ['field.quantity','الكمية','Quantity'],
    ['field.required_qty','الكمية المطلوبة','Required Quantity'],
    ['field.unit','الوحدة','Unit'],
    ['field.purchase_price','سعر الشراء','Purchase Price'],
    ['field.sale_price','سعر البيع','Sale Price'],
    ['field.avg_purchase','متوسط الشراء','Average Purchase'],
    ['field.category','التصنيف','Category'],
    ['field.brand','الماركة','Brand'],
    ['field.supplier','المورد','Supplier'],
    ['field.notes','ملاحظات','Notes'],
    ['field.attachments','مرفقات','Attachments'],
    ['field.date','التاريخ','Date'],
    ['field.due_date','تاريخ الاستحقاق','Due Date'],
    ['field.creator','منشي الطلب','Created By'],
    ['field.status','الحالة','Status'],
    ['field.actions','إجراءات','Actions'],
    ['field.options','خيارات','Options'],
    ['field.image','الصورة','Image'],
    ['field.additional_info','معلومات إضافية','Additional Information'],
    ['field.created_at','تاريخ الإضافة','Created At'],
    ['field.tax','الضريبة','Tax'],
    ['field.rate','النسبة','Rate'],
    ['field.included','متضمنة','Included'],
    ['tax.included','متضمنة','Included'],
    ['tax.not_included','غير متضمنة','Not included'],
    ['status.draft','مسودة','Draft'],
    ['status.pending_reply','بانتظار الرد','Waiting Reply'],
    ['status.replied','تم الرد','Replied'],
    ['status.declined','اعتذر','Declined'],
    ['status.needs_update','يحتاج تحديث العرض','Needs Offer Update'],
    ['status.approved','معتمد','Approved'],
    ['status.cancelled','ملغي','Cancelled'],
    ['status.closed','مغلق','Closed'],
    ['pr.saved_requests','طلبات الشراء المحفوظة','Saved Purchase Requests'],
    ['pr.no_saved','لا توجد طلبات شراء محفوظة حتى الآن','No saved purchase requests yet'],
    ['pr.search_placeholder','بحث برقم الطلب أو العنوان أو المنشئ','Search by request number, title, or creator'],
    ['rfq.suppliers_requested','الموردون المطلوب منهم عرض سعر','Suppliers Requested for Quotation'],
    ['rfq.comparison','مقارنة عروض الأسعار','Quotation Comparison'],
    ['core.title','نواة النظام والذكاء','System Core & Intelligence'],
    ['core.ai_ready','AI Ready','AI Ready'],
    ['core.workflow','Workflow Engine','Workflow Engine'],
    ['core.revision','Revision Engine','Revision Engine'],
    ['core.audit','Audit Engine','Audit Engine'],
    ['core.notification','Notification Engine','Notification Engine'],
    ['core.search','Search Engine','Search Engine'],
    ['core.numbering','Numbering Engine','Numbering Engine'],
    ['core.decision','Decision Engine','Decision Engine'],
    ['core.ai','AI Engine','AI Engine'],
    ['msg.title_required','عنوان الطلب مطلوب','Request title is required'],
    ['msg.add_one_product','أضف منتجًا واحدًا على الأقل','Add at least one product'],
    ['msg.saved_success','تم الحفظ بنجاح','Saved successfully']
  ];

  const dict = {};
  const reverse = { ar:new Map(), en:new Map() };
  for (const [key, ar, en] of entries) {
    dict[key] = { ar, en };
    reverse.ar.set(norm(ar), key);
    reverse.en.set(norm(en), key);
  }

  function norm(v){ return String(v == null ? '' : v).replace(/\s+/g,' ').trim(); }
  function current(){ return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG; }
  function direction(lang){ return lang === 'ar' ? 'rtl' : 'ltr'; }
  function translateText(value, lang){
    const n = norm(value);
    if (!n) return value;
    const key = reverse.ar.get(n) || reverse.en.get(n);
    if (!key) return value;
    return dict[key][lang] || value;
  }
  function translateKey(key, lang){ return (dict[key] && dict[key][lang]) || key; }

  function translateNodeText(node, lang){
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const original = node.nodeValue;
    const trimmed = norm(original);
    if (!trimmed) return;
    const translated = translateText(trimmed, lang);
    if (translated !== trimmed) node.nodeValue = original.replace(trimmed, translated);
  }

  function translateAttributes(el, lang){
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = translateKey(key, lang);
    ['placeholder','title','aria-label','value'].forEach(attr => {
      if (!el.hasAttribute(attr)) return;
      if (attr === 'value' && !['BUTTON','INPUT'].includes(el.tagName)) return;
      if (attr === 'value' && el.tagName === 'INPUT' && !['button','submit','reset'].includes((el.type||'').toLowerCase())) return;
      const val = el.getAttribute(attr);
      const translated = translateText(val, lang);
      if (translated !== val) el.setAttribute(attr, translated);
    });
  }

  function translateSubtree(root, lang){
    if (!root) return;
    const skipTags = new Set(['SCRIPT','STYLE','TEXTAREA']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node){
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (el.closest && el.closest('[data-no-i18n]')) return NodeFilter.FILTER_REJECT;
        if (skipTags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return node.nodeType === Node.ELEMENT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateNodeText(node, lang);
      else translateAttributes(node, lang);
    }
  }

  function applyLanguage(lang){
    lang = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = direction(lang);
    document.body && (document.body.dir = direction(lang));
    document.body && document.body.classList.toggle('lang-en', lang === 'en');
    document.body && document.body.classList.toggle('lang-ar', lang === 'ar');
    const optAr = document.getElementById('optAr');
    const optEn = document.getElementById('optEn');
    if (optAr) optAr.classList.toggle('active', lang === 'ar');
    if (optEn) optEn.classList.toggle('active', lang === 'en');
    translateSubtree(document.body || document.documentElement, lang);
    window.dispatchEvent(new CustomEvent('legendd:language-changed', { detail:{ lang, dir: direction(lang) }}));
  }

  function localizedValue(record, field, lang=current()){
    if (!record) return '';
    const value = record[field];
    if (value && typeof value === 'object') return value[lang] || value.ar || value.en || '';
    const alt = record[`${field}_${lang}`] || record[`${field}${lang.toUpperCase()}`];
    return alt || value || '';
  }

  function patchSetLanguage(){
    const previous = window.setLanguage;
    window.setLanguage = function(lang){
      if (typeof previous === 'function') {
        try { previous(lang); } catch(e) { console.warn('Previous setLanguage failed', e); }
      }
      applyLanguage(lang);
    };
  }

  let observer;
  function startObserver(){
    if (observer || !document.body) return;
    observer = new MutationObserver((mutations)=>{
      const lang = current();
      for (const m of mutations) {
        m.addedNodes && m.addedNodes.forEach(node=>{
          if (node.nodeType === Node.TEXT_NODE) translateNodeText(node, lang);
          else if (node.nodeType === Node.ELEMENT_NODE) translateSubtree(node, lang);
        });
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  window.LegendDLocalization = {
    supported: SUPPORTED.slice(),
    dictionary: dict,
    t: translateKey,
    translateText,
    applyLanguage,
    setLanguage: applyLanguage,
    getLanguage: current,
    getDirection: (lang=current()) => direction(lang),
    localizedValue,
    translateSubtree
  };

  document.addEventListener('DOMContentLoaded', function(){
    patchSetLanguage();
    applyLanguage(current());
    startObserver();
  });
})();
