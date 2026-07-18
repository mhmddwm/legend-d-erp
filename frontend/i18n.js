/*
 * LEGEND D Localization Engine - PF-01.2
 * تم تحديث الكود لتحسين الأداء ومنع تكرار الترجمة ومعالجة عناصر الواجهة بشكل أكثر استقراراً.
 */
(function(){
  'use strict';

  const STORAGE_KEY = 'erp-lang';
  const DEFAULT_LANG = 'ar';
  const SUPPORTED = ['ar', 'en'];

  // ملاحظة: كانت مصفوفة الترجمة الأصلية (entries) مفقودة من هذا الملف مما كان
  // يتسبب في خطأ فادح (ReferenceError) عند كل تحميل للصفحة ويوقف تهيئة نظام
  // الترجمة بالكامل. تم استبدالها بمصفوفة فارغة آمنة كحل مؤقت — إن كانت هناك
  // نسخة قديمة تحتوي على قائمة الترجمات الفعلية (زوج نص عربي/إنجليزي لكل مفتاح)
  // يجب استعادتها هنا لإعادة تفعيل التبديل بين اللغتين.
  const entries = [];

  const dict = {};
  const reverse = { ar: new Map(), en: new Map() };
  
  // دالة تحسين النصوص للبحث
  function norm(v){ return String(v == null ? '' : v).replace(/\s+/g,' ').trim(); }

  // بناء القاموس
  for (const [key, ar, en] of entries) {
    dict[key] = { ar, en };
    reverse.ar.set(norm(ar), key);
    reverse.en.set(norm(en), key);
  }

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
    if (!trimmed || trimmed.length < 2) return; // تجنب ترجمة النصوص القصيرة جداً أو الرموز
    
    const translated = translateText(trimmed, lang);
    if (translated !== trimmed && original.trim() !== translated) {
        node.nodeValue = original.replace(trimmed, translated);
    }
  }

  function translateAttributes(el, lang){
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    
    // دعم وسم data-i18n
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = translateKey(key, lang);
    
    // تحديث السمات
    ['placeholder', 'title', 'aria-label', 'value'].forEach(attr => {
      if (!el.hasAttribute(attr)) return;
      if (attr === 'value' && !['BUTTON','INPUT'].includes(el.tagName)) return;
      
      const val = el.getAttribute(attr);
      const translated = translateText(val, lang);
      if (translated !== val) el.setAttribute(attr, translated);
    });
  }

  function translateSubtree(root, lang){
    if (!root) return;
    const skipTags = new Set(['SCRIPT','STYLE','TEXTAREA','CODE','PRE']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node){
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!el || el.closest('[data-no-i18n]')) return NodeFilter.FILTER_REJECT;
        if (skipTags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
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
    
    const dir = direction(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    
    if (document.body) {
      document.body.dir = dir;
      document.body.classList.toggle('lang-en', lang === 'en');
      document.body.classList.toggle('lang-ar', lang === 'ar');
    }
    
    translateSubtree(document.body || document.documentElement, lang);
    window.dispatchEvent(new CustomEvent('legendd:language-changed', { detail:{ lang, dir }}));
  }

  // تهيئة النظام
  window.LegendDLocalization = {
    supported: SUPPORTED.slice(),
    t: translateKey,
    applyLanguage,
    setLanguage: applyLanguage,
    getLanguage: current,
    translateSubtree
  };

  document.addEventListener('DOMContentLoaded', () => {
    applyLanguage(current());
    
    // مراقبة التغيرات في DOM مع تقليل استهلاك الموارد
    const observer = new MutationObserver((mutations) => {
      const lang = current();
      for (const m of mutations) {
        m.addedNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) translateNodeText(node, lang);
          else if (node.nodeType === Node.ELEMENT_NODE) translateSubtree(node, lang);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();