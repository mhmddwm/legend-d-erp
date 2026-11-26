/* ===== PF-01.14: وضع التركيز على النماذج =====
   في شاشات كثيرة (الموردون، العملاء، المنتجات، الفواتير، المرتجعات، التصنيفات...) كان نموذج
   الإضافة/التعديل يظهر أسفل بطاقة البحث والقائمة فيضطر المستخدم للنزول لرؤيته.
   هنا نراقب ظهور أي نموذج من القائمة FORM_IDS؛ وعند ظهوره نُخفي كل ما حوله في الشاشة
   (البحث، القائمة، الأزرار العلوية) ونُبقي النموذج وحده، وعند إغلاقه (بأي طريقة: إلغاء، حفظ،
   إغلاق...) يعود كل شيء كما كان ومعه موضع التمرير. لا يلزم تعديل أي دالة فتح/إغلاق قائمة،
   لأن المراقبة تعتمد على ظهور النموذج نفسه. */
(function(){
  'use strict';

  // النماذج المطوية افتراضياً التي تُفتح من أزرار «إضافة/جديد/تعديل» داخل شاشاتها
  var FORM_IDS = [
    'accFormBox',        // دليل الحسابات
    'itemFormBox',       // المنتجات
    'supplierFormCard',  // الموردون
    'dinvFormBox',       // فاتورة مشتريات مباشرة
    'pinvNewFormBox',    // فاتورة مشتريات من استلام
    'prtNewFormBox',     // مرتجع مشتريات
    'spayNewFormBox',    // مدفوعات الموردين
    'sqNewFormBox',      // عرض سعر مبيعات
    'soNewFormBox',      // أمر بيع
    'dnNewFormBox',      // إذن تسليم
    'siNewFormBox',      // فاتورة مبيعات
    'srNewFormBox',      // مرتجع مبيعات
    'custNewFormBox',    // العملاء
    'unitTemplateForm',  // قوالب الوحدات
    'ccFormBox',         // مراكز التكلفة
    'catForm',           // التصنيفات
    'brandFormBox',      // الماركات
    'uzRoleFormBox'      // الأدوار والصلاحيات
  ];
  var HIDE = 'ff-hidden';
  var CLOSE_RE = /إغلاق|رجوع|إلغاء|close|cancel/i;

  function injectStyle(){
    if(document.getElementById('ffStyle')) return;
    var st = document.createElement('style'); st.id = 'ffStyle';
    st.textContent = '.' + HIDE + '{display:none!important}' +
      '.ff-bar{display:flex;margin:0 0 12px}' +
      '.ff-bar .ff-back{font-weight:800}';
    (document.head || document.documentElement).appendChild(st);
  }

  function isVisible(el){
    try{ return window.getComputedStyle(el).display !== 'none'; }catch(e){ return el.style.display !== 'none'; }
  }

  function firstButtonText(form){
    var b = form.querySelectorAll('button')[0];
    return b ? String(b.textContent || '').trim() : '';
  }

  function addBar(form){
    if(form._ffBar) return;
    // لا حاجة لشريط رجوع إن كان أول زر بالنموذج هو أصلاً «إغلاق/إلغاء/رجوع»
    if(CLOSE_RE.test(firstButtonText(form))) return;
    var bar = document.createElement('div'); bar.className = 'ff-bar';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn secondary ff-back'; btn.textContent = '→ رجوع إلى القائمة';
    btn.onclick = function(){ closeForm(form); };
    bar.appendChild(btn);
    form.insertBefore(bar, form.firstChild);
    form._ffBar = bar;
  }

  function removeBar(form){
    if(form._ffBar){ if(form._ffBar.parentElement) form._ffBar.parentElement.removeChild(form._ffBar); form._ffBar = null; }
  }

  // إغلاق النموذج عبر زر الإلغاء/الإغلاق الخاص به (ليُنفّذ تنظيفه المعتاد)، وإلا يُخفى مباشرة
  function closeForm(form){
    var btns = form.querySelectorAll('button'), i, b, oc;
    for(i = 0; i < btns.length; i++){
      b = btns[i]; if(b.classList.contains('ff-back')) continue;
      oc = (b.getAttribute && b.getAttribute('onclick')) || '';
      if(/cancel|close/i.test(oc) || CLOSE_RE.test(String(b.textContent || '').trim())){
        b.click();
        if(!isVisible(form)) return;
      }
    }
    form.style.display = 'none';
    check(form);
  }

  function enter(form){
    if(form._ffOn) return;
    var panel = form.closest ? form.closest('.panel') : null;
    if(!panel) return;
    form._ffOn = true;
    form._ffScroll = window.pageYOffset || 0;
    var hidden = [], node = form;
    while(node && node !== panel && node.parentElement){
      var parent = node.parentElement, kids = parent.children;
      for(var i = 0; i < kids.length; i++){
        var ch = kids[i];
        if(ch === node) continue;
        var tag = String(ch.tagName || '').toUpperCase();
        if(tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') continue;
        if(ch.classList.contains(HIDE) || !isVisible(ch)) continue;   // المخفي أصلاً لا نلمسه
        ch.classList.add(HIDE); hidden.push(ch);
      }
      node = parent;
    }
    form._ffHidden = hidden;
    addBar(form);
    try{ window.scrollTo(0, 0); }catch(e){}
  }

  function exit(form){
    if(!form._ffOn) return;
    (form._ffHidden || []).forEach(function(el){ el.classList.remove(HIDE); });
    form._ffHidden = null; form._ffOn = false;
    removeBar(form);
    var y = form._ffScroll || 0;
    try{ window.scrollTo(0, y); }catch(e){}
  }

  // يُستدعى عند أي تغيّر في style/class/hidden للنموذج
  function check(form){
    var vis = isVisible(form);
    if(vis){
      if(form._ffArmed && !form._ffOn) enter(form);   // لا نتدخل في نموذج ظاهر منذ البداية
    }else{
      form._ffArmed = true;
      if(form._ffOn) exit(form);
    }
  }

  function watch(form){
    if(form._ffWatched) return;
    form._ffWatched = true;
    form._ffArmed = !isVisible(form);
    new MutationObserver(function(){ check(form); }).observe(form, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }

  function init(){
    injectStyle();
    FORM_IDS.forEach(function(id){ var el = document.getElementById(id); if(el) watch(el); });
  }

  window.FormFocus = { init: init, enter: enter, exit: exit, check: check, close: closeForm, ids: FORM_IDS };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
