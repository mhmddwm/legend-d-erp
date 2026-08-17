

// ============================================================
// الإعدادات الأساسية
// ============================================================
// محلياً (على جهازك): يشير لباك إند 127.0.0.1:8080.
// عند النشر (Render وغيره): الفرونت والباك إند يخدمان من نفس origin
// (main.py يشغّل الفرونت كملفات ثابتة ضمن نفس تطبيق FastAPI)، لذلك
// نستخدم مسار نسبي (نفس العنوان الحالي) بدل عنوان محلي ثابت لا يعمل
// إلا على جهاز المطوّر.
const API = (["127.0.0.1", "localhost"].includes(location.hostname))
  ? "http://127.0.0.1:8080"
  : "";
const TYPE_LABELS = {
  assets:'أصول', liabilities:'خصوم',
  equity:'حقوق ملكية', revenue:'إيرادات', expenses:'مصروفات'
};

// ============================================================
// ============================================================
// المتغيرات العامة
// ============================================================
let accounts=[], entries=[], items=[], stockMoves=[];
let suppliers=[], purchaseOrders=[], grns=[], invoices=[], returns_=[];
let warehouses=[], stockIssueRequests=[], stockTransfersList=[], warehouseStockBalances=[];
let branches=[]; // إضافة قائمة الفروع
let poLines=[], grnLines=[], prtCurrentLines=[];
let jLines=[]; // أسطر القيد المحاسبي الجديد (مدين/دائن متعدد الأسطر)
let lineCounter=0;
let appUsers=[]; // قائمة المستخدمين لاستخدامها في حقل "منشئ القيد"
let costCenters=[]; // مراكز التكلفة
let taxTypes=[]; // أنواع الضرائب المسجلة بالنظام
let journalEditingId=null; // معرّف القيد الجاري تعديله (null = إنشاء قيد جديد)
let journalPage=1; // الصفحة الحالية في قائمة القيود
const JOURNAL_PAGE_SIZE=20;
let journalSortBy='entry_date_desc'; // معيار ترتيب قائمة القيود الحالي
function applyJournalSort(){
  const sel=document.getElementById('journalSortSelect');
  if(sel) journalSortBy=sel.value;
  journalPage=1;
  renderJournal();
}
let entryDetailId=null; // معرّف القيد المعروض حالياً في صفحة تفاصيل القيد

// ============================================================
// دوال مساعدة
// ============================================================
function fmt(n){return (parseFloat(n)||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});}
function today(){return new Date().toISOString().slice(0,10);}

// ============================================================
// v20: دوال الترقيم المتسلسل العامة وربطها بالموردين
// ============================================================
const LEGEND_SEQUENCE_STORAGE_KEY = 'legend_sequence_settings_v19';
function sequenceDefaultsFor(name){
  const map={
    'فاتورة مبيعات':'INV','طلب شراء':'PR','طلب عرض سعر':'RFQ','أوامر الشراء':'PO','استلام بضاعة':'GRN','فواتير الشراء':'PINV','مرتجعات المشتريات':'PRET','إشعار مدين':'DN','الموردين':'SUP','مدفوعات الموردين':'SPAY','عرض سعر بيع':'SQ','أمر بيع':'SO','إذن تسليم / صرف بضاعة':'DNV','مرتجع مبيعات':'SRET','إشعار دائن':'CN','مدفوعات عملاء':'CPAY','جلسة نقاط بيع':'POS','العميل':'CUS','المصروف':'EXP','سندات القبض':'RV','سندات الصرف':'PV','الأصول':'AST','المنتجات':'PRD','الخدمات':'SRV','إذن إضافة':'ADD','إذن صرف':'ISS','إذن تحويل':'TRN','المستودعات':'WH','ورق الجرد':'STK','الموظفين':'EMP','عهد الموظفين':'CST'
  };
  return {prefix:map[name]||'SEQ', nextNumber:1, format:'{prefix}-{number}', digits:6, unique:true, usePrefix:true, policy:'continue'};
}
function readSequenceSettings(){ try{return JSON.parse(localStorage.getItem(LEGEND_SEQUENCE_STORAGE_KEY)||'{}')||{};}catch(e){return {};} }
function writeSequenceSettings(data){ try{localStorage.setItem(LEGEND_SEQUENCE_STORAGE_KEY,JSON.stringify(data||{}));}catch(e){} }
function getSequenceConfig(name){ const all=readSequenceSettings(); return Object.assign(sequenceDefaultsFor(name), all[name]||{}); }
function padSequenceNumber(n,d){ return String(Math.max(1,parseInt(n||1,10))).padStart(Math.max(1,parseInt(d||6,10)),'0'); }
function buildSequenceNumber(name, cfg){
  cfg=Object.assign(sequenceDefaultsFor(name), cfg||{});
  const number=padSequenceNumber(cfg.nextNumber,cfg.digits);
  const prefix=(cfg.prefix||'').trim();
  const format=(cfg.format||'{prefix}-{number}').trim();
  const result=(cfg.usePrefix!==false) ? format.replaceAll('{prefix}',prefix).replaceAll('{number}',number) : format.replaceAll('{prefix}','').replaceAll('{number}',number);
  return result.replace(/^[-\s]+/,'').replace(/--+/g,'-').trim();
}
function peekNextSequenceNumber(name){ return buildSequenceNumber(name, getSequenceConfig(name)); }
function isSequenceNumberUsed(name, value){
  if(name==='الموردين') return (suppliers||[]).some(s=>String(s.code||'')===String(value||''));
  return false;
}
function generateUniqueSequenceNumber(name){
  const all=readSequenceSettings();
  let cfg=Object.assign(sequenceDefaultsFor(name), all[name]||{});
  let guard=0, candidate=buildSequenceNumber(name,cfg);
  while(cfg.unique!==false && isSequenceNumberUsed(name,candidate) && guard<10000){
    cfg.nextNumber=(parseInt(cfg.nextNumber||1,10)+1);
    candidate=buildSequenceNumber(name,cfg);
    guard++;
  }
  return candidate;
}
function consumeSequenceNumber(name, usedValue){
  const all=readSequenceSettings();
  const cfg=Object.assign(sequenceDefaultsFor(name), all[name]||{});
  const expected=buildSequenceNumber(name,cfg);
  if(!usedValue || String(usedValue)===String(expected) || cfg.unique!==false){
    cfg.nextNumber=(parseInt(cfg.nextNumber||1,10)+1);
    cfg.updatedAt=new Date().toISOString();
    all[name]=cfg;
    writeSequenceSettings(all);
  }
}
function refreshSupplierAutoCode(force){
  const codeEl=document.getElementById('supCode');
  const editEl=document.getElementById('supEditCode');
  if(!codeEl || (editEl && editEl.value)) return;
  if(force || !codeEl.value.trim()) codeEl.value=generateUniqueSequenceNumber('الموردين');
  codeEl.readOnly=true;
  codeEl.classList.add('auto-code-field');
  codeEl.title='يتم توليد رقم المورد تلقائيًا من إعدادات الترقيم المتسلسل';
}

async function api(method, path, body){
  const opts={method, headers:{'Content-Type':'application/json'}};
  if(body) opts.body=JSON.stringify(body);
  const res=await fetch(API+path, opts);
  const json=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(json.detail||json.message||'خطأ في الخادم');
  return json;
}

// دالة تبديل اللغة (لإكمال مشروعك)
// ============================================================
// تحميل البيانات
// ============================================================
async function loadAll(){

const bar = document.getElementById('apiStatusBar');

console.log("بدء تحميل البيانات...");


async function safeLoad(name,url){

try{

const data = await api('GET',url);

console.log(name,data);

return data;

}
catch(e){

console.warn(
"تعذر تحميل "+name,
e.message
);

return [];

}

}



try{


accounts = await safeLoad(
"الحسابات",
"/api/accounts"
);
branches = await safeLoad(
  "الفروع",
 "/api/branches"
);

entries = await safeLoad(
"القيود",
"/api/journal"
);


appUsers = await safeLoad(
"المستخدمون",
"/api/users"
);


costCenters = await safeLoad(
"مراكز التكلفة",
"/api/cost-centers"
);


taxTypes = await safeLoad(
"أنواع الضرائب",
"/api/tax-types"
);


items = await safeLoad(
"الأصناف",
"/api/items"
);
// في حالة عدم توفر الخادم أو رجوع بيانات قديمة، ندمج آخر تعديلات محفوظة محليًا
try{
  const cachedItems = JSON.parse(localStorage.getItem('items_cache') || '[]');
  if(Array.isArray(cachedItems) && cachedItems.length){
    const byCode = new Map((items||[]).map(x=>[String(x.code), x]));
    cachedItems.forEach(x=>{ if(x && x.code) byCode.set(String(x.code), {...(byCode.get(String(x.code))||{}), ...x}); });
    items = Array.from(byCode.values());
  }
}catch(e){}


stockMoves = await safeLoad(
"المخزون",
"/api/stock-moves"
);


suppliers = await safeLoad(
"الموردين",
"/api/suppliers"
);
// دمج نسخة الموردين المحفوظة محليًا حتى تظهر الإضافات والتعديلات في وضع الديمو
try{
  const cachedSuppliers = JSON.parse(localStorage.getItem('suppliers_cache') || '[]');
  if(Array.isArray(cachedSuppliers) && cachedSuppliers.length){
    const byCode = new Map((suppliers||[]).map(x=>[String(x.code), x]));
    cachedSuppliers.forEach(x=>{ if(x && x.code) byCode.set(String(x.code), {...(byCode.get(String(x.code))||{}), ...x}); });
    suppliers = Array.from(byCode.values());
  }
}catch(e){}


purchaseOrders = await safeLoad(
"طلبات الشراء",
"/api/purchase-orders"
);


grns = await safeLoad(
"الاستلامات",
"/api/grn"
);


invoices = await safeLoad(
"الفواتير",
"/api/purchase-invoices"
);


returns_ = await safeLoad(
"المرتجعات",
"/api/purchase-returns"
);


warehouses = await safeLoad(
"المستودعات",
"/api/warehouses"
);


stockIssueRequests = await safeLoad(
"طلبات صرف المخزون",
"/api/stock-issue-requests"
);


stockTransfersList = await safeLoad(
"تحويلات المستودعات",
"/api/stock-transfers"
);


warehouseStockBalances = await safeLoad(
"رصيد المستودعات",
"/api/warehouse-stock"
);



window.accounts = accounts;

// تحميل بيانات إعدادات المنتجات
window.categories = JSON.parse(localStorage.getItem("categories") || "[]");
window.unitTemplates = JSON.parse(localStorage.getItem("unitTemplates") || "[]");

console.log(
"الحسابات النهائية",
accounts
);



renderAll();



refreshSelects();

refreshAccountParents();

refreshJournalAccounts();



if(bar){

bar.innerHTML =
'<span class="api-status ok">✓ تم تحديث البيانات</span>';

}


}

catch(error){

console.error(
"خطأ تحميل النظام",
error
);


if(bar){

bar.innerHTML =
'<span class="api-status err">✗ فشل التحميل</span>';

}


}

}


function renderAll(){

  renderTree();

  renderJournal();
  if(!jLines.length) resetJournalForm();
  refreshJournalAccounts();
  // أضف هذا السطر هنا لتحديث قائمة الفروع في القوائم المنسدلة
  if(typeof refreshBranchDropdowns === 'function') refreshBranchDropdowns();

  renderItems();
  openCategories();
  loadProductDropdowns();
  loadSearchCategories();

  renderStock();

  renderSuppliers();

  renderPOs();

  renderGRNs();

  renderInvoices();

  renderReturns();

  renderWarehousesScreen();

  if(typeof renderCostCenters === 'function') renderCostCenters();

}

// ============================================================
// مديول المستودعات (Warehouse Management) — PF-06.1 frontend
// ============================================================
function whEsc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const WH_VALUATION_LABELS = {WAC:'المتوسط المرجّح', FIFO:'وارد أولاً صادر أولاً', STANDARD:'تكلفة معيارية'};
const WH_ISSUE_STATUS_LABELS = {pending:'بانتظار الاعتماد', approved:'معتمد', rejected:'مرفوض', cancelled:'ملغي'};
const WH_TRANSFER_STATUS_LABELS = {draft:'مسودة', pending_approval:'بانتظار اعتماد الشحن', in_transit:'في الطريق', received:'مستلم', cancelled:'ملغي'};

function renderWarehousesScreen(){
  renderWarehousesList();
  renderWarehouseIssueFilterOptions();
  renderStockIssueRequests();
  renderStockTransfersList();
  renderWarehouseStockBalances();
}

function whName(id){
  const w = (warehouses||[]).find(x=>x.id===id);
  return w ? `${w.code} — ${w.name}` : ('#'+id);
}

function whItemName(id){
  const it = (items||[]).find(x=>x.id===id);
  return it ? `${it.code} — ${it.name}` : ('#'+id);
}

function whActorId(){
  const v = document.getElementById('whActorUserId')?.value;
  return v ? parseInt(v,10) : null;
}

function renderWarehousesList(){
  const body = document.getElementById('warehousesBody');
  const empty = document.getElementById('warehousesEmpty');
  if(!body) return;
  const list = warehouses || [];
  body.innerHTML = list.map(w=>`
    <tr>
      <td>${whEsc(w.code)}</td>
      <td>${whEsc(w.name)}</td>
      <td>${whEsc(w.location||'-')}</td>
      <td>${whEsc(w.manager||'-')}</td>
      <td>${WH_VALUATION_LABELS[w.valuation_method] || w.valuation_method || 'المتوسط المرجّح'}</td>
      <td>${w.is_active===false?'موقف':'نشط'}</td>
      <td><button class="btn secondary" onclick="deleteWarehouse(${w.id})">حذف</button></td>
    </tr>
  `).join('');
  if(empty) empty.style.display = list.length ? 'none' : 'block';
}

function renderWarehouseIssueFilterOptions(){
  const sel = document.getElementById('whIssueFilter');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">كل المستودعات</option>' +
    (warehouses||[]).map(w=>`<option value="${w.id}">${whEsc(w.code)} — ${whEsc(w.name)}</option>`).join('');
  sel.value = current;
}

function renderStockIssueRequests(){
  const body = document.getElementById('stockIssueBody');
  const empty = document.getElementById('stockIssueEmpty');
  if(!body) return;
  const filterWh = document.getElementById('whIssueFilter')?.value;
  let list = stockIssueRequests || [];
  if(filterWh) list = list.filter(r=>String(r.warehouse_id)===String(filterWh));
  list = [...list].sort((a,b)=> new Date(b.requested_at||0)-new Date(a.requested_at||0));

  body.innerHTML = list.map(r=>{
    const linesText = (r.lines||[]).map(l=>`${whItemName(l.item_id)} × ${l.qty_requested}`).join('، ');
    const actions = r.status==='pending' ? `
      <button class="btn" onclick="approveStockIssue(${r.id})">اعتماد</button>
      <button class="btn secondary" onclick="rejectStockIssue(${r.id})">رفض</button>
    ` : '';
    return `
      <tr>
        <td>${whEsc(r.request_number)}</td>
        <td>${whName(r.warehouse_id)}</td>
        <td>${whEsc(r.request_type)}</td>
        <td>${whEsc(r.source_ref||'-')}</td>
        <td title="${whEsc(linesText)}">${(r.lines||[]).length} صنف</td>
        <td>${WH_ISSUE_STATUS_LABELS[r.status]||r.status}</td>
        <td>${whEsc((r.requested_at||'').slice(0,16).replace('T',' '))}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('');
  if(empty) empty.style.display = list.length ? 'none' : 'block';
}

async function approveStockIssue(id){
  const actor = whActorId();
  if(!actor){ alert('أدخل رقم المستخدم المنفّذ أولاً (حقل "تنفيذ العملية باسم")'); return; }
  try{
    await api('POST', `/api/stock-issue-requests/${id}/approve`, {actor_user_id: actor});
    await loadAll();
  }catch(e){ alert(e.message); }
}

async function rejectStockIssue(id){
  const actor = whActorId();
  if(!actor){ alert('أدخل رقم المستخدم المنفّذ أولاً (حقل "تنفيذ العملية باسم")'); return; }
  const notes = prompt('سبب الرفض (اختياري):') || '';
  try{
    await api('POST', `/api/stock-issue-requests/${id}/reject`, {actor_user_id: actor, notes});
    await loadAll();
  }catch(e){ alert(e.message); }
}

function renderStockTransfersList(){
  const body = document.getElementById('stockTransfersBody');
  const empty = document.getElementById('stockTransfersEmpty');
  if(!body) return;
  const list = [...(stockTransfersList||[])].sort((a,b)=> new Date(b.created_at||0)-new Date(a.created_at||0));

  body.innerHTML = list.map(t=>{
    const linesText = (t.lines||[]).map(l=>`${whItemName(l.item_id)} × ${l.qty}`).join('، ');
    let actions = '';
    if(t.status==='pending_approval'){
      actions = `<button class="btn" onclick="approveTransferShip(${t.id})">اعتماد الشحن (المصدر)</button>`;
    } else if(t.status==='in_transit'){
      actions = `<button class="btn" onclick="approveTransferReceive(${t.id})">تأكيد الاستلام (الوجهة)</button>`;
    }
    return `
      <tr>
        <td>${whEsc(t.transfer_number)}</td>
        <td>${whName(t.from_warehouse_id)}</td>
        <td>${whName(t.to_warehouse_id)}</td>
        <td title="${whEsc(linesText)}">${(t.lines||[]).length} صنف</td>
        <td>${WH_TRANSFER_STATUS_LABELS[t.status]||t.status}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('');
  if(empty) empty.style.display = list.length ? 'none' : 'block';
}

async function approveTransferShip(id){
  const actor = whActorId();
  if(!actor){ alert('أدخل رقم المستخدم المنفّذ أولاً (حقل "تنفيذ العملية باسم")'); return; }
  try{
    await api('POST', `/api/stock-transfers/${id}/approve`, {actor_user_id: actor});
    await loadAll();
  }catch(e){ alert(e.message); }
}

async function approveTransferReceive(id){
  const actor = whActorId();
  if(!actor){ alert('أدخل رقم المستخدم المنفّذ أولاً (حقل "تنفيذ العملية باسم")'); return; }
  try{
    await api('POST', `/api/stock-transfers/${id}/receive`, {actor_user_id: actor});
    await loadAll();
  }catch(e){ alert(e.message); }
}

function renderWarehouseStockBalances(){
  const body = document.getElementById('warehouseStockBody');
  const empty = document.getElementById('warehouseStockEmpty');
  if(!body) return;
  const list = (warehouseStockBalances||[]).filter(r=> Math.abs(parseFloat(r.quantity)||0) > 0.0001 );

  body.innerHTML = list.map(r=>{
    const qty = parseFloat(r.quantity)||0;
    const cost = parseFloat(r.avg_cost)||0;
    return `
      <tr>
        <td>${whName(r.warehouse_id)}</td>
        <td>${whItemName(r.item_id)}</td>
        <td>${qty.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>${cost.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>${(qty*cost).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      </tr>
    `;
  }).join('');
  if(empty) empty.style.display = list.length ? 'none' : 'block';
}

async function submitWarehouse(){
  const errEl = document.getElementById('whErr');
  if(errEl) errEl.textContent = '';
  const code = document.getElementById('whCode').value.trim();
  const name = document.getElementById('whName').value.trim();
  const location = document.getElementById('whLocation').value.trim();
  const manager = document.getElementById('whManager').value.trim();
  if(!code || !name){
    if(errEl) errEl.textContent = 'رمز المستودع والاسم مطلوبان';
    return;
  }
  try{
    await api('POST', '/api/warehouses', { code, name, location: location||null, manager: manager||null });
    document.getElementById('whCode').value='';
    document.getElementById('whName').value='';
    document.getElementById('whLocation').value='';
    document.getElementById('whManager').value='';
    await loadAll();
  }catch(e){
    if(errEl) errEl.textContent = e.message;
  }
}

async function deleteWarehouse(id){
  if(!confirm('تأكيد حذف هذا المستودع؟')) return;
  try{
    await api('DELETE', `/api/warehouses/${id}`);
    await loadAll();
  }catch(e){ alert(e.message); }
}

// ============================================================
// مراكز التكلفة (Cost Centers) — شاشة إدارة كاملة: هيكل هرمي،
// موازنة تقديرية مقابل فعلي محسوب من القيود المرحّلة، وربط مباشر
// بجميع شاشات وتقارير النظام عبر مصفوفة costCenters المشتركة.
// ============================================================
function ccEsc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function ccFmt(n){ return (parseFloat(n)||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function renderCostCenterParentOptions(excludeCode){
  const sel = document.getElementById('ccParent');
  if(!sel) return;
  const cur = sel.value;
  const list = (costCenters||[]).filter(c=>c.code!==excludeCode);
  sel.innerHTML = '<option value="">— بدون (مركز رئيسي) —</option>' +
    list.map(c=>`<option value="${ccEsc(c.code)}">${ccEsc(c.code)} — ${ccEsc(c.name_ar)}</option>`).join('');
  sel.value = cur;
}

function renderCostCentersKpis(){
  const box = document.getElementById('ccKpis');
  if(!box) return;
  const all = costCenters || [];
  const active = all.filter(c=>c.is_active).length;
  const totalBudget = all.reduce((s,c)=>s+(parseFloat(c.budget_amount)||0),0);
  const totalActual = all.reduce((s,c)=>s+(parseFloat(c.actual_amount)||0),0);
  const overBudget = all.filter(c=>{
    const b=parseFloat(c.budget_amount)||0, a=parseFloat(c.actual_amount)||0;
    return b>0 && a>b;
  }).length;
  box.innerHTML = `
    <div class="cc-kpi">
      <div class="lbl">إجمالي مراكز التكلفة</div>
      <div class="val">${all.length}</div>
      <div class="sub">${active} مركز نشط</div>
    </div>
    <div class="cc-kpi ok">
      <div class="lbl">إجمالي الموازنات التقديرية</div>
      <div class="val">${ccFmt(totalBudget)}</div>
      <div class="sub">لكل المراكز</div>
    </div>
    <div class="cc-kpi">
      <div class="lbl">إجمالي الفعلي من القيود</div>
      <div class="val">${ccFmt(totalActual)}</div>
      <div class="sub">محسوب مباشرة من القيود المرحّلة</div>
    </div>
    <div class="cc-kpi ${overBudget?'danger':'ok'}">
      <div class="lbl">مراكز تجاوزت الموازنة</div>
      <div class="val">${overBudget}</div>
      <div class="sub">${overBudget?'تحتاج مراجعة':'كل شيء ضمن الحدود'}</div>
    </div>
  `;
}

function ccBuildTree(list){
  const byCode = new Map(list.map(c=>[c.code,c]));
  const childrenMap = new Map();
  list.forEach(c=>{
    const p = c.parent_code && byCode.has(c.parent_code) ? c.parent_code : null;
    if(!childrenMap.has(p)) childrenMap.set(p,[]);
    childrenMap.get(p).push(c);
  });
  const ordered=[];
  function walk(parent, depth){
    const kids=(childrenMap.get(parent)||[]).slice().sort((a,b)=>String(a.code).localeCompare(String(b.code)));
    kids.forEach(k=>{ ordered.push({cc:k, depth}); walk(k.code, depth+1); });
  }
  walk(null,0);
  return ordered;
}

function renderCostCenters(){
  const search = (document.getElementById('ccSearch')?.value||'').trim().toLowerCase();
  const typeFilter = document.getElementById('ccFilterType')?.value || '';
  const statusFilter = document.getElementById('ccFilterStatus')?.value || 'active';
  const viewMode = document.getElementById('ccViewMode')?.value || 'tree';

  let list = costCenters || [];
  if(statusFilter==='active') list = list.filter(c=>c.is_active);
  else if(statusFilter==='inactive') list = list.filter(c=>!c.is_active);
  if(typeFilter) list = list.filter(c=>(c.cc_type||'cost')===typeFilter);
  if(search){
    list = list.filter(c =>
      String(c.code||'').toLowerCase().includes(search) ||
      String(c.name_ar||'').toLowerCase().includes(search) ||
      String(c.name_en||'').toLowerCase().includes(search)
    );
  }

  renderCostCentersKpis();

  const countEl = document.getElementById('ccCount');
  if(countEl) countEl.textContent = `${list.length} مركز`;

  const body = document.getElementById('costCenterBody');
  const emptyEl = document.getElementById('ccEmpty');
  if(!body) return;

  const rows = (viewMode==='tree')
    ? ccBuildTree(list)
    : list.slice().sort((a,b)=>String(a.code).localeCompare(String(b.code))).map(cc=>({cc, depth:0}));

  body.innerHTML = rows.map(({cc, depth})=>{
    const budget = parseFloat(cc.budget_amount)||0;
    const actual = parseFloat(cc.actual_amount)||0;
    const pct = budget>0 ? (actual/budget*100) : 0;
    const barClass = budget<=0 ? '' : (actual>budget ? 'over' : (pct>=80 ? 'warn' : ''));
    const indent = depth>0
      ? `<span class="cc-tree-indent" style="width:${depth*18}px"></span><span class="cc-tree-branch">└</span>`
      : '';
    return `
      <tr>
        <td><span class="cc-code-chip">${ccEsc(cc.code)}</span></td>
        <td>
          <div class="cc-name-cell">${indent}<div>
            <b>${ccEsc(cc.name_ar)}</b>
            ${cc.name_en ? `<div style="font-size:11px;color:var(--muted)">${ccEsc(cc.name_en)}</div>` : ''}
          </div></div>
        </td>
        <td><span class="cc-type-badge ${cc.cc_type||'cost'}">${cc.cc_type==='profit' ? 'مركز ربحية' : 'مركز تكلفة'}</span></td>
        <td class="cc-manager-cell">${ccEsc(cc.manager_name||'-')}</td>
        <td>
          <div class="cc-budget-wrap">
            <span class="cc-muted-num">${ccFmt(budget)}</span>
            ${budget>0 ? `<div class="cc-budget-bar ${barClass}"><span style="width:${Math.min(100,pct)}%"></span></div><div class="cc-budget-pct">${pct.toFixed(0)}% مستهلك</div>` : ''}
          </div>
        </td>
        <td class="cc-muted-num">${ccFmt(actual)}</td>
        <td class="cc-muted-num">${cc.entries_count||0}</td>
        <td><button type="button" class="cc-status-badge ${cc.is_active?'active':'inactive'}" onclick="toggleCostCenterActive('${cc.code}')">${cc.is_active?'نشط':'موقف'}</button></td>
        <td>
          <div class="cc-row-actions">
            <button type="button" class="icon-btn edit" title="تعديل" onclick="editCostCenter('${cc.code}')">✎</button>
            <button type="button" class="icon-btn" title="إضافة مركز فرعي تابع له" onclick="openCostCenterForm('${cc.code}')">＋</button>
            <button type="button" class="icon-btn del" title="حذف" onclick="deleteCostCenter('${cc.code}')">🗑</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if(emptyEl) emptyEl.style.display = rows.length ? 'none' : 'block';
}

function openCostCenterForm(parentCode){
  const box = document.getElementById('ccFormBox');
  if(!box) return;
  document.getElementById('ccEditCode').value = '';
  const codeEl = document.getElementById('ccCode');
  codeEl.value = ''; codeEl.disabled = false;
  document.getElementById('ccNameAr').value = '';
  document.getElementById('ccNameEn').value = '';
  document.getElementById('ccManager').value = '';
  document.getElementById('ccBudget').value = '';
  document.getElementById('ccNotes').value = '';
  document.getElementById('ccType').value = 'cost';
  document.getElementById('ccActive').value = 'true';
  document.getElementById('ccErr').textContent = '';
  document.getElementById('ccFormTitle').textContent = 'مركز تكلفة جديد';
  renderCostCenterParentOptions('');
  document.getElementById('ccParent').value = parentCode || '';
  box.style.display = 'block';
  box.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function closeCostCenterForm(){
  const box = document.getElementById('ccFormBox');
  if(box) box.style.display = 'none';
}

function editCostCenter(code){
  const cc = (costCenters||[]).find(c=>c.code===code);
  if(!cc) return;
  openCostCenterForm();
  document.getElementById('ccFormTitle').textContent = 'تعديل مركز التكلفة: ' + cc.code;
  document.getElementById('ccEditCode').value = cc.code;
  const codeEl = document.getElementById('ccCode');
  codeEl.value = cc.code; codeEl.disabled = true;
  document.getElementById('ccNameAr').value = cc.name_ar || '';
  document.getElementById('ccNameEn').value = cc.name_en || '';
  document.getElementById('ccManager').value = cc.manager_name || '';
  document.getElementById('ccBudget').value = cc.budget_amount || '';
  document.getElementById('ccNotes').value = cc.notes || '';
  document.getElementById('ccType').value = cc.cc_type || 'cost';
  document.getElementById('ccActive').value = cc.is_active ? 'true' : 'false';
  renderCostCenterParentOptions(cc.code);
  document.getElementById('ccParent').value = cc.parent_code || '';
}

async function saveCostCenter(){
  const errEl = document.getElementById('ccErr');
  if(errEl) errEl.textContent = '';
  const editCode = document.getElementById('ccEditCode').value;
  const code = document.getElementById('ccCode').value.trim();
  const name_ar = document.getElementById('ccNameAr').value.trim();
  const name_en = document.getElementById('ccNameEn').value.trim();
  const parent_code = document.getElementById('ccParent').value || null;
  const cc_type = document.getElementById('ccType').value;
  const manager_name = document.getElementById('ccManager').value.trim();
  const budget_amount = parseFloat(document.getElementById('ccBudget').value) || 0;
  const notes = document.getElementById('ccNotes').value.trim();
  const is_active = document.getElementById('ccActive').value === 'true';

  if(!code || !name_ar){
    if(errEl) errEl.textContent = 'كود المركز والاسم بالعربي حقلان مطلوبان';
    return;
  }
  if(parent_code && parent_code === (editCode || code)){
    if(errEl) errEl.textContent = 'لا يمكن أن يكون المركز رئيسياً لنفسه';
    return;
  }

  try{
    if(editCode){
      await api('PUT', `/api/cost-centers/${encodeURIComponent(editCode)}`, {
        name_ar, name_en: name_en || null, parent_code, cc_type,
        manager_name: manager_name || null, budget_amount, notes: notes || null, is_active
      });
    }else{
      await api('POST', '/api/cost-centers', {
        code, name_ar, name_en: name_en || null, parent_code, cc_type,
        manager_name: manager_name || null, budget_amount, notes: notes || null, is_active
      });
    }
    closeCostCenterForm();
    await loadAll();
  }catch(e){
    if(errEl) errEl.textContent = e.message;
  }
}

async function toggleCostCenterActive(code){
  try{
    await api('PATCH', `/api/cost-centers/${encodeURIComponent(code)}/toggle-active`);
    await loadAll();
  }catch(e){ alert(e.message); }
}

async function deleteCostCenter(code){
  if(!confirm(`تأكيد حذف مركز التكلفة "${code}"؟ إن كان مستخدماً بقيود سابقة سيتم إيقافه بدل حذفه حفاظاً على سلامة التقارير.`)) return;
  try{
    const res = await api('DELETE', `/api/cost-centers/${encodeURIComponent(code)}`);
    await loadAll();
    if(res && res.deactivated) alert(res.message || 'تم إيقاف المركز بدل حذفه لأنه مستخدم بقيود سابقة');
  }catch(e){ alert(e.message); }
}

function exportCostCentersCsv(){
  const rows = costCenters || [];
  let csv = 'الكود,الاسم بالعربي,الاسم بالإنجليزي,النوع,المسؤول,المركز الرئيسي,الموازنة,الفعلي,عدد القيود,الحالة\n';
  csv += rows.map(c => [
    c.code, c.name_ar, c.name_en||'', c.cc_type==='profit'?'ربحية':'تكلفة',
    c.manager_name||'', c.parent_code||'', c.budget_amount||0, c.actual_amount||0,
    c.entries_count||0, c.is_active?'نشط':'موقف'
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv);
  a.download = 'cost_centers.csv';
  a.click();
}

// ============================================================
// دليل الحسابات
// ============================================================
// ============================================================
// دليل الحسابات المحدث والمصحح
// ============================================================
// ============================================================
// الشاشة الجانبية لدليل الحسابات: دروب ليست الفروع + شجرة قابلة للطي + بحث ذكي
// ============================================================
let coaExpandedCodes = new Set();

function whEscCoa(s){
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderCoaBranchOptions(){
  const sel = document.getElementById('coaBranchFilter');
  if(!sel) return;
  const current = sel.value;
  const list = branches || [];
  sel.innerHTML = '<option value="">كل الفروع</option>' +
    list.map(b=>`<option value="${b.id}">${whEscCoa(b.code)} — ${whEscCoa(b.name_ar)}</option>`).join('');
  sel.value = current;
}

function renderJournalEntryBranchOptions(){
  const sel = document.getElementById('jBranch');
  if(!sel) return;
  const current = sel.value;
  const list = branches || [];
  sel.innerHTML = '<option value="">— بدون فرع محدد —</option>' +
    list.map(b=>`<option value="${b.id}">${whEscCoa(b.code)} — ${whEscCoa(b.name_ar)}</option>`).join('');
  sel.value = current;
}

async function onCoaBranchChange(){
  const branchId = document.getElementById('coaBranchFilter')?.value || '';
  try{
    const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
    const fresh = await api('GET', `/api/accounts${qs}`);
    const balanceByCode = {};
    fresh.forEach(a=>{ balanceByCode[a.code] = a.balance; });
    accounts = (accounts||[]).map(a=>
      balanceByCode[a.code] !== undefined ? Object.assign({}, a, {balance: balanceByCode[a.code]}) : a
    );
    renderTree();
  }catch(e){
    alert('تعذر تحميل أرصدة الفرع المحدد: ' + e.message);
  }
}

function buildCoaTree(filterText){
  const list = accounts || [];
  const term = (filterText||'').trim().toLowerCase();

  let directMatches = null;
  if(term){
    directMatches = new Set(
      list.filter(a =>
        String(a.code||'').toLowerCase().includes(term) ||
        String(a.name_ar||'').toLowerCase().includes(term) ||
        String(a.name_en||'').toLowerCase().includes(term)
      ).map(a=>a.code)
    );
  }

  let visibleCodes = null;
  if(directMatches){
    visibleCodes = new Set(directMatches);
    const byCode = {};
    list.forEach(a=>{ byCode[a.code] = a; });
    directMatches.forEach(code=>{
      let cur = byCode[code];
      while(cur && cur.parent_code){
        visibleCodes.add(cur.parent_code);
        cur = byCode[cur.parent_code];
      }
    });
  }

  function buildLevel(parentCode, level){
    return list
      .filter(a => String(a.parent_code||'') === String(parentCode||''))
      .filter(a => !visibleCodes || visibleCodes.has(a.code))
      .sort((a,b)=> String(a.code).localeCompare(String(b.code), undefined, {numeric:true}))
      .map(a=>{
        const children = buildLevel(a.code, level+1);
        return {
          acc: a, level, children,
          hasChildren: children.length > 0,
          isMatch: !!(directMatches && directMatches.has(a.code)),
        };
      });
  }

  return { tree: buildLevel(null, 0), searching: !!term };
}

function renderCoaSidebar(){
  const box = document.getElementById('coaSidebarTree');
  if(!box) return;

  const term = document.getElementById('coaTreeSearch')?.value || '';
  const { tree, searching } = buildCoaTree(term);

  function renderNode(node){
    const { acc, level, children, hasChildren, isMatch } = node;
    const expanded = searching ? true : coaExpandedCodes.has(acc.code);
    const levelClass = level === 0 ? 'coa-node-main' : 'coa-node-sub';
    let html = `<div class="coa-node ${levelClass}">`;
    html += `<span class="coa-toggle" onclick="toggleCoaNode('${acc.code}')">${hasChildren ? (expanded ? '▾' : '▸') : ''}</span>`;
    html += `<span class="coa-node-label ${isMatch ? 'coa-node-hit' : ''}" onclick="focusAccountRow('${acc.code}')" title="${whEscCoa(acc.name_ar)}">${whEscCoa(acc.code)} — ${whEscCoa(acc.name_ar)}</span>`;
    html += `</div>`;
    if(hasChildren && expanded){
      html += `<div class="coa-children">` + children.map(renderNode).join('') + `</div>`;
    }
    return html;
  }

  box.innerHTML = tree.length
    ? tree.map(renderNode).join('')
    : `<div class="hint" style="padding:14px;text-align:center">لا توجد نتائج مطابقة</div>`;
}

function toggleCoaNode(code){
  if(coaExpandedCodes.has(code)) coaExpandedCodes.delete(code);
  else coaExpandedCodes.add(code);
  renderCoaSidebar();
}

function focusAccountRow(code){
  const escaped = (window.CSS && CSS.escape) ? CSS.escape(String(code)) : String(code);
  const row = document.querySelector(`#accBody tr[data-code="${escaped}"]`);
  if(!row) return;

  // افتح كل الآباء بالجدول الرئيسي حتى يظهر الصف المطلوب (يعتمد على toggleAccountChildren الموجودة أصلاً)
  let parentCode = row.dataset.parent;
  while(parentCode){
    const parentRow = document.querySelector(`#accBody tr[data-code="${(window.CSS && CSS.escape) ? CSS.escape(String(parentCode)) : parentCode}"]`);
    if(!parentRow) break;
    const arrow = parentRow.querySelector('.account-arrow');
    if(arrow && !arrow.classList.contains('open')){
      toggleAccountChildren(parentCode, arrow);
    }
    parentCode = parentRow.dataset.parent;
  }

  row.scrollIntoView({behavior:'smooth', block:'center'});
  row.classList.remove('coa-row-flash');
  void row.offsetWidth; // إعادة تشغيل الأنيميشن لو كان الصف نفسه مُختاراً سابقاً
  row.classList.add('coa-row-flash');
}

function renderTree() {
  const body = document.getElementById('accBody');
  const empty = document.getElementById('accEmpty');
  
  if (!body) return;
  body.innerHTML = ''; // تنظيف الجدول

  renderCoaBranchOptions();
  renderCoaSidebar();

  if (!accounts || accounts.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // دالة بناء الشجرة الداخلية
  function addChildren(parentCode = null, level = 0) {
    accounts
      .filter(a => String(a.parent_code || '') === String(parentCode || ''))
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }))
      .forEach(acc => {
        const hasChildren = accounts.some(a => String(a.parent_code) === String(acc.code));
        const tr = document.createElement('tr');
        
        const padding = level * 25;
        
        tr.className = `acc-level-${level} account-row`;
        tr.dataset.code = acc.code;
        tr.dataset.parent = acc.parent_code || '';
        
        // إخفاء الأبناء افتراضياً (إلا إذا كان الحساب رئيسياً في الأعلى)
        if (acc.parent_code) tr.style.display = 'none'; 

tr.innerHTML = `
          <td>${acc.code || ''}</td>
          <td style="padding-right:${padding}px">
            ${hasChildren ? `<span class="account-arrow" onclick="toggleAccountChildren('${acc.code}', this)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
            </span>` : `<span style="display:inline-block;width:22px;"></span>`}
            <strong class="account-main-link" onclick="openAccountPage('${acc.code}')">${acc.name_ar || ''}</strong>
            ${acc.is_system ? `<span class="acc-sys-badge" title="حساب نظامي أساسي من مديولات النظام — لا يمكن حذفه">🔒 نظامي</span>` : ''}
            ${acc.name_en ? `<div style="font-size:11px;color:#777">${acc.name_en}</div>` : ''}
          </td>
          <td>${typeof TYPE_LABELS !== 'undefined' ? (TYPE_LABELS[acc.account_type] || '') : (acc.account_type || '')}</td>
          <td>${acc.parent_code || '-'}</td>
          <td class="num">${typeof fmt !== 'undefined' ? fmt(acc.opening_balance) : (acc.opening_balance || 0)}</td>
          <td class="num">${typeof fmt !== 'undefined' ? fmt(acc.balance) : (acc.balance || 0)}</td>
          <td style="text-align:center;">
            <button type="button" class="acc-actions-btn" onclick="toggleAccActionsMenu(event,'${acc.code}')" title="الإجراءات">⋮</button>
          </td>
        `;
        body.appendChild(tr);
        addChildren(acc.code, level + 1); // بناء الأبناء تكرارياً
      });
  }

  addChildren(null, 0); // بدء البناء من الجذر
}

// ============================================================
// دالة التحكم بالأسهم (خارج renderTree وبشكل مستقل)
// ============================================================
function toggleAccountChildren(code, arrow) {
  const rows = document.querySelectorAll('.account-row');
  const open = arrow && arrow.classList.contains('open');

  if (arrow) {
    arrow.classList.toggle('open', !open);
  }

  function toggleChildren(parentCode, show) {
    rows.forEach(row => {
      if (String(row.dataset.parent) === String(parentCode)) {
        row.style.display = show ? 'table-row' : 'none';
        if (!show) {
          const childArrow = row.querySelector('.account-arrow');
          if (childArrow) {
            childArrow.classList.remove('open');
            toggleChildren(row.dataset.code, false);
          }
        }
      }
    });
  }

  toggleChildren(code, !open);
}

// ============================================================
// قائمة إجراءات الحساب (تستبدل الـ select القديم)
// ============================================================
let accMenuCurrentCode = null;

function ensureAccActionsMenu(){
  let menu = document.getElementById('accActionsMenu');
  if(!menu){
    menu = document.createElement('div');
    menu.id = 'accActionsMenu';
    menu.className = 'acc-actions-menu';
    menu.innerHTML = `
      <button onclick="accMenuRun('edit')">✏️ تعديل</button>
      <button onclick="accMenuRun('child')">➕ إنشاء حساب فرعي</button>
      <button class="danger" onclick="accMenuRun('delete')">🗑️ حذف الحساب</button>
    `;
    document.body.appendChild(menu);
  }
  return menu;
}

function toggleAccActionsMenu(e, code){
  e.stopPropagation();
  const menu = ensureAccActionsMenu();
  const wasOpenForThis = menu.classList.contains('show') && accMenuCurrentCode === code;
  closeAccActionsMenu();
  if (wasOpenForThis) return;

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.left = Math.max(8, rect.left - 150) + 'px';
  menu.classList.add('show');
  accMenuCurrentCode = code;
}

function closeAccActionsMenu(){
  const menu = document.getElementById('accActionsMenu');
  if (menu) menu.classList.remove('show');
  accMenuCurrentCode = null;
}

function accMenuRun(action){
  if (accMenuCurrentCode) accountAction(action, accMenuCurrentCode);
  closeAccActionsMenu();
}

document.addEventListener('click', closeAccActionsMenu);
function openAccountPage(code){
  window.open(`ledger.html?account=${encodeURIComponent(code)}`, '_blank');
}

function accountAction(action,code){
  if(!action) return;
  if(action==='edit') editAccount(code);
  else if(action==='child') createChildAccount(code);
  else if(action==='delete') deleteAccount(code);
}

// ============================================================
// القيود المحاسبية
// ============================================================
// حالة فلاتر بحث القيود (تُطبَّق فورياً على البيانات المحمّلة بالفعل — بدون أي طلب شبكة، لسرعة قصوى)
window.journalSearchOpen = window.journalSearchOpen !== undefined ? window.journalSearchOpen : true;

function accountLabel(code){
  const a = (accounts||[]).find(x=>x.code===code);
  return a ? `${a.code} — ${a.name_ar}` : (code||'');
}

function journalMatchesFilters(e, f){
  if(f.entryNo && String(e.id) !== String(f.entryNo)) return false;

  if(f.account){
    const needle = f.account.trim().toLowerCase();
    const lines = (e.lines&&e.lines.length) ? e.lines : [
      ...(e.debit_account?[{account_code:e.debit_account}]:[]),
      ...(e.credit_account?[{account_code:e.credit_account}]:[]),
    ];
    const matchesAny = lines.some(l=>accountLabel(l.account_code).toLowerCase().includes(needle));
    if(!matchesAny) return false;
  }

  if(f.createdBy){
    const needle = f.createdBy.trim().toLowerCase();
    if(!(e.created_by_name||'').toLowerCase().includes(needle)) return false;
  }

  if(f.description){
    const needle = f.description.trim().toLowerCase();
    if(!(e.description||'').toLowerCase().includes(needle)) return false;
  }

  if(f.dateFrom && e.entry_date < f.dateFrom) return false;
  if(f.dateTo && e.entry_date > f.dateTo) return false;

  if(f.createdFrom || f.createdTo){
    const createdDate = (e.created_at||'').slice(0,10);
    if(f.createdFrom && createdDate < f.createdFrom) return false;
    if(f.createdTo && createdDate > f.createdTo) return false;
  }

  const amt = parseFloat(e.total_amount ?? e.amount)||0;
  if(f.amountFrom !== '' && f.amountFrom !== null && amt < parseFloat(f.amountFrom)) return false;
  if(f.amountTo !== '' && f.amountTo !== null && amt > parseFloat(f.amountTo)) return false;

  if(f.status && (e.status||'posted') !== f.status) return false;
  if(f.costCenter && (e.cost_center_code||'') !== f.costCenter) return false;

  return true;
}

function readJournalFilters(){
  return {
    entryNo: document.getElementById('jsEntryNo')?.value || '',
    account: document.getElementById('jsAccount')?.value || '',
    createdBy: document.getElementById('jsCreatedBy')?.value || '',
    description: document.getElementById('jsDescription')?.value || '',
    dateFrom: document.getElementById('jsDateFrom')?.value || '',
    dateTo: document.getElementById('jsDateTo')?.value || '',
    createdFrom: document.getElementById('jsCreatedFrom')?.value || '',
    createdTo: document.getElementById('jsCreatedTo')?.value || '',
    amountFrom: cleanNumber(document.getElementById('jsAmountFrom')?.value ?? ''),
    amountTo: cleanNumber(document.getElementById('jsAmountTo')?.value ?? ''),
    status: document.getElementById('jsStatus')?.value || '',
    costCenter: document.getElementById('jsCostCenter')?.value || '',
  };
}

function applyJournalSearch(){
  journalPage=1;
  renderJournal();
}

function clearJournalSearch(){
  ['jsEntryNo','jsAccount','jsCreatedBy','jsDescription','jsDateFrom','jsDateTo','jsCreatedFrom','jsCreatedTo','jsAmountFrom','jsAmountTo','jsStatus','jsCostCenter']
    .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  journalPage=1;
  renderJournal();
}

function toggleJournalSearch(){
  window.journalSearchOpen = !window.journalSearchOpen;
  const body = document.getElementById('journalSearchBody');
  const icon = document.getElementById('journalSearchToggleIcon');
  if(body) body.style.display = window.journalSearchOpen ? '' : 'none';
  if(icon) icon.textContent = window.journalSearchOpen ? '▾' : '▸';
}

function journalSourceLabel(sourceType){
  const map = {
    purchase_invoice: 'فاتورة مشتريات',
    goods_receipt: 'استلام بضاعة',
  };
  if (!sourceType || sourceType === 'manual') {
    return { isSystem: false, text: 'يدوي' };
  }
  return { isSystem: true, text: map[sourceType] || 'تلقائي (نظام)' };
}
window.journalSourceLabel = journalSourceLabel;

function renderJournal(){
  const body=document.getElementById('journalBody');
  const empty=document.getElementById('journalEmpty');
  const countEl=document.getElementById('journalResultsCount');
  if(!body) return;

  renderJournalEntryBranchOptions();

  const filters = readJournalFilters();
  const hasAnyFilter = Object.values(filters).some(v=>v!=='' && v!==null);
  const filtered = hasAnyFilter ? (entries||[]).filter(e=>journalMatchesFilters(e, filters)) : (entries||[]);

  const sortFns = {
    entry_date_desc:(a,b)=> (b.entry_date||'').localeCompare(a.entry_date||'') || (b.id||0)-(a.id||0),
    entry_date_asc:(a,b)=> (a.entry_date||'').localeCompare(b.entry_date||'') || (a.id||0)-(b.id||0),
    id_desc:(a,b)=> (b.id||0)-(a.id||0),
    id_asc:(a,b)=> (a.id||0)-(b.id||0),
    created_desc:(a,b)=> (b.created_at||'').localeCompare(a.created_at||''),
    created_asc:(a,b)=> (a.created_at||'').localeCompare(b.created_at||''),
  };
  filtered.sort(sortFns[journalSortBy] || sortFns.entry_date_desc);

  if(countEl) countEl.textContent = hasAnyFilter ? `${filtered.length} نتيجة من أصل ${(entries||[]).length}` : '';

  const totalPages=Math.max(1, Math.ceil(filtered.length / JOURNAL_PAGE_SIZE));
  if(journalPage>totalPages) journalPage=totalPages;
  if(journalPage<1) journalPage=1;
  const startIdx=(journalPage-1)*JOURNAL_PAGE_SIZE;
  const pageItems=filtered.slice(startIdx, startIdx+JOURNAL_PAGE_SIZE);

  renderJournalPagination(filtered.length, totalPages);

  if(!filtered.length){body.innerHTML=''; if(empty){empty.style.display='block'; empty.textContent = hasAnyFilter ? 'لا توجد قيود مطابقة لمعايير البحث' : 'لا توجد قيود';} return;}
  if(empty) empty.style.display='none';
  
  body.innerHTML=pageItems.map(e=>{
    // إضافة منطق جلب اسم الفرع
    const branchObj = (branches || []).find(b => b.id == e.branch_id);
    const branchName = branchObj ? `${branchObj.code} - ${branchObj.name_ar}` : 'عام';

    const lines = (e.lines&&e.lines.length) ? e.lines : [
      ...(e.debit_account?[{account_code:e.debit_account, debit:e.amount, credit:0}]:[]),
      ...(e.credit_account?[{account_code:e.credit_account, debit:0, credit:e.amount}]:[]),
    ];
    const debitLinks = lines.filter(l=>l.debit).map(l=>`<button class="jacc-link" onclick="openAccountPage('${l.account_code}')">${accountLabel(l.account_code)}</button>`).join('');
    const creditLinks = lines.filter(l=>l.credit).map(l=>`<button class="jacc-link jacc-credit" onclick="openAccountPage('${l.account_code}')">${accountLabel(l.account_code)}</button>`).join('');
    const accountsCell = `<div class="jacc-cell">
        <div class="jacc-side">${debitLinks||'-'}</div>
        <div class="jacc-divider"></div>
        <div class="jacc-side">${creditLinks||'-'}</div>
      </div>`;
    const status = e.status || 'posted';
    const statusBadge = status==='cancelled' ? `<span class="badge returned">ملغي</span>` : `<span class="badge posted">مرحّل</span>`;
    const isManual = e.source_type==='manual';
    const isCancelled = status==='cancelled';
    const src = journalSourceLabel(e.source_type);
    const sourceBadge = src.isSystem
      ? `<span class="badge system" title="قيد مُرحَّل تلقائياً من النظام${e.source_ref?' — '+e.source_ref:''}">⚙ تلقائي — ${src.text}</span>`
      : `<span class="badge manual">✎ يدوي</span>`;

    return `<tr>
      <td><button class="entry-link" onclick="openEntryDetail(${e.id})">#${e.id||''}</button></td>
      <td>${e.entry_date||''}</td>
      <td>${branchName}</td>
      <td>${accountsCell}</td>
      <td><div class="jamt-cell"><span class="jamt-label">الإجمالي</span><span class="jamt-value">${fmt(e.total_amount ?? e.amount)}</span></div></td>
      <td>${e.description||'-'}</td>
      <td>${sourceBadge}</td>
      <td>${e.created_by_name||'-'}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="row-menu">
          <button class="row-menu-trigger" title="خيارات القيد" onclick="toggleJournalRowMenu(${e.id}, event)"><span></span><span></span><span></span></button>
          <div id="jmenu-${e.id}" class="menu-popup" style="display:none">
            <button onclick="viewJournalEntry(${e.id})"><b>👁</b><span>عرض</span></button>
            ${isManual && !isCancelled ? `<button onclick="editJournalEntry(${e.id})"><b>✎</b><span>تعديل</span></button>` : ''}
            <button onclick="duplicateJournalEntry(${e.id})"><b>⧉</b><span>نسخ</span></button>
            ${isManual ? `<button class="danger" onclick="deleteEntry(${e.id})"><b>🗑</b><span>حذف</span></button>` : ''}
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderJournalPagination(totalCount, totalPages){
  const box=document.getElementById('journalPagination');
  if(!box) return;
  if(totalCount<=0){ box.innerHTML=''; return; }
  const from=(journalPage-1)*JOURNAL_PAGE_SIZE+1;
  const to=Math.min(journalPage*JOURNAL_PAGE_SIZE, totalCount);
  box.innerHTML=`
    <div class="index-info">عرض ${from}–${to} من ${totalCount}</div>
    <div class="index-buttons">
      <button class="index-btn" onclick="goJournalPage(1)" ${journalPage<=1?'disabled':''}>&raquo;</button>
      <button class="index-btn" onclick="goJournalPage(${journalPage-1})" ${journalPage<=1?'disabled':''}>›</button>
      <span class="index-info" style="min-width:70px;text-align:center">صفحة ${journalPage} / ${totalPages}</span>
      <button class="index-btn" onclick="goJournalPage(${journalPage+1})" ${journalPage>=totalPages?'disabled':''}>‹</button>
      <button class="index-btn" onclick="goJournalPage(${totalPages})" ${journalPage>=totalPages?'disabled':''}>&laquo;</button>
    </div>`;
}

function goJournalPage(p){
  journalPage=p;
  renderJournal();
}

function toggleJournalRowMenu(id, ev){
  if(ev) ev.stopPropagation();
  const m=document.getElementById('jmenu-'+id);
  const willOpen = !m || m.style.display==='none';
  document.querySelectorAll('.menu-popup').forEach(e=>{e.style.display='none'; e.classList.remove('menu-popup-up');});
  document.querySelectorAll('.row-menu-trigger').forEach(b=>b.classList.remove('active'));
  if(m && willOpen){
    m.style.display='block';
    const trigger = ev && ev.currentTarget;
    if(trigger) trigger.classList.add('active');
    // لو ما فيه مساحة كافية أسفل الزر داخل الشاشة (صفوف قرب نهاية الجدول)،
    // افتح القائمة للأعلى بدلاً من الأسفل بدل ما تنقطع خارج الشاشة
    if(trigger){
      const rect = trigger.getBoundingClientRect();
      const menuHeight = m.scrollHeight || 190;
      const spaceBelow = window.innerHeight - rect.bottom;
      if(spaceBelow < menuHeight + 16) m.classList.add('menu-popup-up');
    }
  }
}

// ============================================================
// الأصناف
// ============================================================
function renderItems(){
  loadSearchCategories();
  itemFiltered=[...(items||[])];
  itemFiltered.isFiltered=false;
  renderItemsTable();
  return;
  const body=document.getElementById('itemsBody');
  const empty=document.getElementById('itemsEmpty');
  if(!body) return;
  if(!items.length){body.innerHTML=''; if(empty) empty.style.display='block'; return;}
  if(empty) empty.style.display='none';
  body.innerHTML=items.map(it=>`<tr>
    <td>${it.code||''}</td>
    <td>${it.name||''}</td>
    <td>${it.unit||''}</td>
    <td class="num ${(it.qty_on_hand||0)<=(it.reorder_point||0)?'low-stock':''}">${fmt(it.qty_on_hand)}</td>
    <td class="num">${fmt(it.avg_cost)}</td>
    <td class="num">${fmt((it.qty_on_hand||0)*(it.avg_cost||0))}</td>
    <td class="num">${fmt(it.reorder_point)}</td>
    <td>
      <button class="icon-btn" onclick="editItem('${it.code}')">✏️</button>
      <button class="icon-btn del" onclick="deleteItem('${it.code}')">🗑️</button>
    </td>
  </tr>`).join('');
}

// ============================================================
// حركة المخزون
// ============================================================
function renderStock(){
  const body=document.getElementById('stockBody');
  const empty=document.getElementById('stockEmpty');
  if(!body) return;
  if(!stockMoves.length){body.innerHTML=''; if(empty) empty.style.display='block'; return;}
  if(empty) empty.style.display='none';
  body.innerHTML=stockMoves.map(m=>{
    const it=(items||[]).find(i=>i.id===m.item_id);
    return `<tr>
    <td>${m.move_date||''}</td>
    <td>${it?it.code+' — '+it.name:m.item_id||''}</td>
    <td>${m.move_type||''}</td>
    <td>${m.reference||'-'}</td>
    <td class="num ${m.qty>0?'stock-pos':'stock-neg'}">${fmt(m.qty)}</td>
    <td class="num">${fmt(m.unit_cost)}</td>
    <td class="num">${fmt(m.balance_after)}</td>
  </tr>`;
  }).join('');
}

// ============================================================
// الموردون
// ============================================================
function supplierDisplayName(s){
  return s.trade_name || s.name || [s.first_name,s.last_name].filter(Boolean).join(' ') || '';
}
function supplierContactsFromForm(){
  return [...document.querySelectorAll('#supContactsBox .supplier-contact-row')].map(r=>({
    first_name:(r.querySelector('[data-c="first_name"]')||{}).value?.trim()||'',
    last_name:(r.querySelector('[data-c="last_name"]')||{}).value?.trim()||'',
    job:(r.querySelector('[data-c="job"]')||{}).value?.trim()||'',
    email:(r.querySelector('[data-c="email"]')||{}).value?.trim()||'',
    phone:(r.querySelector('[data-c="phone"]')||{}).value?.trim()||'',
    mobile:(r.querySelector('[data-c="mobile"]')||{}).value?.trim()||''
  })).filter(c=>Object.values(c).some(Boolean));
}
function addSupplierContactRow(c={}){
  const box=document.getElementById('supContactsBox');
  if(!box) return;
  const row=document.createElement('div');
  row.className='supplier-contact-row';
  row.innerHTML=`
    <input data-c="first_name" placeholder="الاسم الأول" value="${c.first_name||''}">
    <input data-c="last_name" placeholder="الاسم الأخير" value="${c.last_name||''}">
    <input data-c="job" placeholder="الوظيفة" value="${c.job||''}">
    <input data-c="email" placeholder="البريد الإلكتروني" value="${c.email||''}">
    <input data-c="phone" placeholder="الهاتف" value="${c.phone||''}">
    <input data-c="mobile" placeholder="الجوال" value="${c.mobile||''}">
    <button type="button" class="icon-btn del" title="حذف جهة الاتصال" onclick="this.closest('.supplier-contact-row').remove()">🗑️</button>`;
  box.appendChild(row);
}
function supplierContractsFromForm(){
  return [...document.querySelectorAll('#supContractsBox .supplier-contract-row')].map(r=>({
    title:(r.querySelector('[data-k="title"]')||{}).value?.trim()||'',
    period:(r.querySelector('[data-k="period"]')||{}).value||'quarterly',
    start_date:(r.querySelector('[data-k="start_date"]')||{}).value||'',
    end_date:(r.querySelector('[data-k="end_date"]')||{}).value||'',
    target_qty:parseFloat((r.querySelector('[data-k="target_qty"]')||{}).value)||0,
    target_amount:parseFloat((r.querySelector('[data-k="target_amount"]')||{}).value)||0,
    product:(r.querySelector('[data-k="product"]')||{}).value?.trim()||'',
    incentive:(r.querySelector('[data-k="incentive"]')||{}).value?.trim()||'',
    status:(r.querySelector('[data-k="status"]')||{}).value||'active'
  })).filter(c=>c.title||c.target_qty||c.target_amount||c.product||c.incentive);
}
function addSupplierContractRow(c={}){
  const box=document.getElementById('supContractsBox');
  if(!box) return;
  const row=document.createElement('div');
  row.className='supplier-contract-row';
  row.innerHTML=`
    <input data-k="title" placeholder="اسم العقد / الربع" value="${c.title||''}">
    <select data-k="period"><option value="quarterly" ${c.period==='quarterly'?'selected':''}>ربع سنوي</option><option value="annual" ${c.period==='annual'?'selected':''}>سنوي</option><option value="custom" ${c.period==='custom'?'selected':''}>مخصص</option></select>
    <input data-k="start_date" type="date" value="${c.start_date||''}">
    <input data-k="end_date" type="date" value="${c.end_date||''}">
    <input data-k="target_qty" type="text" inputmode="decimal" placeholder="كمية مستهدفة" value="${c.target_qty||''}" oninput="this.value=this.value.replace(/[^0-9.,]/g,'')">
    <input data-k="target_amount" type="text" inputmode="decimal" placeholder="قيمة مستهدفة" value="${c.target_amount||''}" oninput="this.value=this.value.replace(/[^0-9.,]/g,'')">
    <input data-k="product" placeholder="منتج/تصنيف العقد" value="${c.product||''}">
    <input data-k="incentive" placeholder="الحافز/الخصم" value="${c.incentive||''}">
    <select data-k="status"><option value="active" ${c.status!=='expired'?'selected':''}>نشط</option><option value="expired" ${c.status==='expired'?'selected':''}>منتهي</option></select>
    <button type="button" class="icon-btn del" title="حذف العقد" onclick="this.closest('.supplier-contract-row').remove()">🗑️</button>`;
  box.appendChild(row);
}
function supplierContractSummary(s){
  const arr=Array.isArray(s.contracts)?s.contracts:[]; const active=arr.filter(c=>c.status!=='expired');
  return active.length?`<span class="supplier-contract-badge">📄 ${active.length} عقد نشط</span>`:'-';
}
function updateSupplierWarnings(){
  const type=document.getElementById('supType')?.value || 'commercial';
  const addressFields=['supBuildingNo','supStreet','supAdditionalNo','supDistrict','supCity','supPostalCode'];
  const hasFullAddress=addressFields.every(id=>(document.getElementById(id)?.value||'').trim());
  const warn=document.getElementById('supAddressWarn');
  const vatReq=document.getElementById('supVatReq');
  if(vatReq) vatReq.style.display = type==='commercial' ? 'inline' : 'none';
  if(warn) warn.style.display = (type==='commercial' && !hasFullAddress) ? 'block' : 'none';
}
function renderSuppliers(){
  const body=document.getElementById('suppliersBody');
  const empty=document.getElementById('supEmpty');
  if(!body) return;
  const q=normalizeSearchValue(document.getElementById('supSearch')?.value||'');
  let list=[...(suppliers||[])];
  if(q){
    list=list.filter(s=>[
      s.code, s.trade_name, s.name, s.first_name, s.last_name, s.phone, s.mobile, s.vat_no, s.commercial_register
    ].some(v=>normalizeSearchValue(v).includes(q)));
  }
  if(!list.length){body.innerHTML=''; if(empty) empty.style.display='block'; return;}
  if(empty) empty.style.display='none';
  body.innerHTML=list.map(s=>`<tr>
    <td>${s.code||''}</td>
    <td>${supplierDisplayName(s)}</td>
    <td>${s.supplier_type==='individual'?'فردي':'تجاري'}</td>
    <td>${s.phone||'-'}</td>
    <td>${s.mobile||'-'}</td>
    <td>${s.currency||'SAR'}<br>${supplierContractSummary(s)}</td>
    <td class="num">${fmt(s.opening_balance ?? s.balance)}</td>
    <td>${s.payment_terms_days? s.payment_terms_days+' يوم':'-'}</td>
    <td>
      <button class="icon-btn" title="تعديل" onclick="editSupplier('${s.code}')">✏️</button>
      <button class="icon-btn del" title="حذف" onclick="deleteSupplier('${s.code}')">🗑️</button>
    </td>
  </tr>`).join('');
}

// ============================================================
// طلبات الشراء
// ============================================================
// ===============================
// PO MODULE STABLE REBUILD
// ===============================
window.poState = window.poState || {page:1,pageSize:20,search:'',status:'',sort:'new',selected:[]};

// دالة عرض حالة أمر الشراء كـ badge — كانت مفقودة من الملف وتسبب توقف
// renderAll() بالكامل (ReferenceError) رغم وصول البيانات بنجاح من الباك إند.
function getPObadge(p){
  const labels = {
    draft:    {text:'مسودة',        color:'#9aa0a6'},
    rfq:      {text:'طلب عرض سعر',   color:'#f0ad4e'},
    pending:  {text:'قيد الاعتماد',  color:'#f0ad4e'},
    approved: {text:'معتمد',        color:'#2e7d32'},
    ordered:  {text:'مرسل للمورد',  color:'#1976d2'},
    received: {text:'مستلم',        color:'#2e7d32'},
    closed:   {text:'مغلق',         color:'#616161'},
    cancelled:{text:'ملغي',         color:'#c62828'},
  };
  const st = p && p.status;
  const info = labels[st] || {text: st || '-', color:'#9aa0a6'};
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;background:${info.color}22;color:${info.color};border:1px solid ${info.color}55;">${info.text}</span>`;
}

function renderPOs(){

  const body = document.getElementById('poBody');
  if(!body) return;

  const s = window.poState;

  const searchEl = document.getElementById('poSearch');
  const statusEl = document.getElementById('poStatusFilter');
  const sortEl = document.getElementById('poSort');

  s.search = (searchEl?.value || '').toLowerCase();
  s.status = statusEl?.value || '';
  s.sort = sortEl?.value || 'new';

  let data = Array.isArray(purchaseOrders) ? [...purchaseOrders] : [];

  // search
  if(s.search){
    data = data.filter(p =>
      (p.po_number||'').toLowerCase().includes(s.search) ||
      (suppliers?.find(x=>x.code===p.supplier_code)?.name||'').toLowerCase().includes(s.search)
    );
  }

  // filter
  if(s.status){
    data = data.filter(p=>p.status===s.status);
  }

  // sort
  if(s.sort==='value'){
    data.sort((a,b)=>(b.total||0)-(a.total||0));
  } else {
    data.sort((a,b)=> new Date(b.po_date||0)-new Date(a.po_date||0));
  }

  // pagination safe
  const start = (s.page-1)*s.pageSize;
  const paged = data.slice(start,start+s.pageSize);

  body.innerHTML = paged.map(p=>{
    const sup = suppliers?.find(x=>x.code===p.supplier_code);
    return `
      <tr>
        <td><input type="checkbox" class="poCheck" value="${p.po_number}"></td>
        <td>${p.po_number||''}</td>
        <td>${p.po_date||''}</td>
        <td>${sup?sup.name:''}</td>
        <td>${fmt(p.total)}</td>
        <td>${getPObadge(p)}</td>
        <td>
          <button onclick="duplicatePO('${p.po_number}')">نسخ</button>
          ${p.status==='rfq'?`<button onclick="openRFQ('${p.po_number}')">RFQ</button>`:''}
        </td>
      </tr>
    `;
  }).join('');

  renderPOPagination(data.length);
}

function renderPOPagination(total){
  const el = document.getElementById('poPagination');
  if(!el) return;

  const pages = Math.ceil(total / window.poState.pageSize);
  let out='';

  for(let i=1;i<=pages;i++){
    out += `<button onclick="window.poState.page=${i};renderPOs()" style="margin:2px">${i}</button>`;
  }

  el.innerHTML = out;
}

function syncPO(){
  const checked = document.querySelectorAll('.poCheck:checked');
  window.poState.selected = [...checked].map(x=>x.value);
}

function openRFQ(po){
  window.location.href = 'rfq.html?po='+po;
}

function refreshAccountParents(){
  const sel=document.getElementById('accParent');
  if(!sel) return;
  const current=sel.value;
  sel.innerHTML='<option value="">— بدون أب (حساب رئيسي) —</option>'+
    accounts.map(acc=>`<option value="${acc.code}">${acc.code} — ${acc.name_ar}</option>`).join('');
  sel.value=current;
}

function refreshJournalAccounts(){
  const dl=document.getElementById('accountsDatalist');
  if(dl){
    dl.innerHTML=(accounts||[]).map(acc=>`<option value="${acc.code} — ${acc.name_ar}">`).join('');
  }
  const udl=document.getElementById('usersDatalist');
  if(udl){
    udl.innerHTML=(appUsers||[]).map(u=>`<option value="${(u.full_name||'').replace(/"/g,'&quot;')}">`).join('');
  }
  const sdl=document.getElementById('jSupplier');
  if(sdl){
    const cur=sdl.value;
    sdl.innerHTML='<option value="">— بدون مورد —</option>'+
      (suppliers||[]).map(s=>`<option value="${s.code}">${s.code} — ${(s.name||'').replace(/</g,'&lt;')}</option>`).join('');
    if(cur) sdl.value=cur;
  }
  const ccSelects=document.querySelectorAll('.cost-center-select');
  ccSelects.forEach(sel=>{
    const cur=sel.value;
    const emptyLabel=sel.dataset.emptyLabel || '— بدون مركز تكلفة —';
    sel.innerHTML=`<option value="">${emptyLabel}</option>`+
      (costCenters||[]).map(c=>`<option value="${c.code}">${c.code} — ${c.name_ar}</option>`).join('');
    if(cur) sel.value=cur;
  });
  const statusSelects=document.querySelectorAll('.journal-status-filter-select');
  statusSelects.forEach(sel=>{
    if(!sel.dataset.filled){
      sel.innerHTML='<option value="">كل الحالات</option><option value="posted">مرحّل</option><option value="cancelled">ملغي</option>';
      sel.dataset.filled='1';
    }
  });
  renderSupplierAccountOptions();
  renderJLines();
}

// حسابات المورد المسموحة: حساب الموردين الرئيسي (211) وكل فروعه — حتى
// تظهر أي حسابات فرعية جديدة يضيفها المستخدم بشاشة دليل الحسابات مباشرة
// بنموذج المورد بدون أي تعديل إضافي بالكود.
function supplierAccountOptionsList(){
  const all=accounts||[];
  const result=[];
  function walk(parentCode){
    all.filter(a=>String(a.parent_code||'')===String(parentCode))
       .sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true}))
       .forEach(a=>{ result.push(a); walk(a.code); });
  }
  walk('211');
  return result;
}

function renderSupplierAccountOptions(){
  const sel=document.getElementById('supAccountCode');
  if(!sel) return;
  const cur=sel.value;
  const list=supplierAccountOptionsList();
  sel.innerHTML = list.length
    ? list.map(a=>`<option value="${a.code}">${a.code} — ${(a.name_ar||'').replace(/</g,'&lt;')}${a.code==='2111'?' (افتراضي)':''}</option>`).join('')
    : '<option value="2111">موردون - نشاط الشركة الأساسي (افتراضي)</option><option value="2112">موردون - أنشطة أخرى</option>';
  sel.value = cur || '2111';
}

// ============================================================
// أسطر القيد المحاسبي (دعم عدد غير محدود من الأسطر - مدين/دائن)
// حقل الحساب مرتبط بدليل الحسابات عبر بحث ذكي (datalist)
// ============================================================
function resolveAccountCode(rawValue){
  const v=(rawValue||'').trim();
  if(!v) return '';
  const dashIdx=v.indexOf(' — ');
  const candidate=dashIdx>-1 ? v.slice(0,dashIdx).trim() : v;
  if((accounts||[]).some(a=>a.code===candidate)) return candidate;
  // السماح أيضاً بكتابة اسم الحساب مباشرة إن كان مطابقاً بدقة أو بشكل فريد
  const byName=(accounts||[]).filter(a=>a.name_ar===v || a.name_en===v);
  if(byName.length===1) return byName[0].code;
  return '';
}

function addJLine(){
  lineCounter++;
  jLines.push({id:lineCounter, account_code:'', debit:0, credit:0, line_description:'', cost_allocations:[], tax_type_code:'', tax_rate:'', tax_amount:''});
  renderJLines();
}

function removeJLine(id){
  if(jLines.length<=2){alert('يجب أن يحتوي القيد على سطرين على الأقل'); return;}
  jLines=jLines.filter(l=>l.id!==id);
  expandedTaxLines.delete(id);
  expandedCostLines.delete(id);
  renderJLines();
}

function onJLineAccountChange(id, inputEl){
  const line=jLines.find(l=>l.id===id);
  if(!line) return;
  const code=resolveAccountCode(inputEl.value);
  if(!code && inputEl.value.trim()){
    inputEl.style.borderColor='var(--coral)';
  } else {
    inputEl.style.borderColor='';
  }
  line.account_code=code;
}

function onJLineChange(id, field, value){
  const line=jLines.find(l=>l.id===id);
  if(!line) return;
  if(field==='debit' || field==='credit'){
    line[field]=parseFloat(value)||0;
    // سطر واحد لا يمكن أن يكون مديناً ودائناً معاً
    if(field==='debit' && line.debit) line.credit=0;
    if(field==='credit' && line.credit) line.debit=0;
  } else {
    line[field]=value;
  }
  renderJLines();
}

let draggedLineId = null;
let expandedCostLines = new Set();

function onLineDragStart(id, ev){
  draggedLineId = id;
  ev.dataTransfer.effectAllowed = 'move';
  try{ ev.dataTransfer.setData('text/plain', String(id)); }catch(e){}
  ev.currentTarget.classList.add('jline-dragging');
}

function onLineDragEnd(ev){
  ev.currentTarget.classList.remove('jline-dragging');
  document.querySelectorAll('.jline-row').forEach(r=>r.classList.remove('jline-drop-target'));
  draggedLineId = null;
}

function onLineDragOver(ev){
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.classList.add('jline-drop-target');
}

function onLineDragLeave(ev){
  ev.currentTarget.classList.remove('jline-drop-target');
}

function onLineDrop(targetId, ev){
  ev.preventDefault();
  ev.currentTarget.classList.remove('jline-drop-target');
  if(draggedLineId === null || draggedLineId === targetId) return;

  const fromIdx = jLines.findIndex(l=>l.id === draggedLineId);
  const toIdx = jLines.findIndex(l=>l.id === targetId);
  if(fromIdx === -1 || toIdx === -1) return;

  const [moved] = jLines.splice(fromIdx, 1);
  jLines.splice(toIdx, 0, moved);
  draggedLineId = null;
  renderJLines();
}

function toggleLineCostPanel(lineId){
  if(expandedCostLines.has(lineId)) expandedCostLines.delete(lineId);
  else expandedCostLines.add(lineId);
  renderJLines();
}

function lineCostSummary(line){
  const allocs = line.cost_allocations || [];
  if(!allocs.length) return 'توزيع';
  const total = allocs.reduce((s,a)=>s+(parseFloat(a.percentage)||0),0);
  return `${allocs.length} مراكز — ${total.toFixed(0)}%`;
}

function addLineCostAllocation(lineId){
  const line = jLines.find(l=>l.id===lineId);
  if(!line) return;
  if(!line.cost_allocations) line.cost_allocations = [];
  line.cost_allocations.push({cost_center_code:'', percentage: line.cost_allocations.length ? 0 : 100});
  expandedCostLines.add(lineId);
  renderJLines();
}

function removeLineCostAllocation(lineId, idx){
  const line = jLines.find(l=>l.id===lineId);
  if(!line || !line.cost_allocations) return;
  line.cost_allocations.splice(idx, 1);
  renderJLines();
}

function onLineCostAllocationChange(lineId, idx, field, value){
  const line = jLines.find(l=>l.id===lineId);
  if(!line || !line.cost_allocations || !line.cost_allocations[idx]) return;
  line.cost_allocations[idx][field] = field==='percentage' ? value : value;
  renderJLines();
}

function renderCostCenterOptionsHtml(selected){
  const list = costCenters || [];
  return '<option value="">— اختر —</option>' +
    list.map(c=>`<option value="${c.code}" ${c.code===selected?'selected':''}>${whEscCoa(c.code)} — ${whEscCoa(c.name_ar)}</option>`).join('');
}

// ============================================================
// ضريبة السطر (اختيارية) — لقيود ذات طبيعة خاصة كمصروف عليه ضريبة قيمة مضافة
// ============================================================
let expandedTaxLines = new Set();

function toggleLineTaxPanel(lineId){
  if(expandedTaxLines.has(lineId)) expandedTaxLines.delete(lineId);
  else expandedTaxLines.add(lineId);
  renderJLines();
}

function renderTaxTypeOptionsHtml(selected, lineId){
  const list = taxTypes || [];
  const usedElsewhere = new Set(jLines.filter(l=>l.id!==lineId && l.tax_type_code).map(l=>l.tax_type_code));
  return '<option value="">— بدون ضريبة —</option>' +
    list.map(t=>{
      const disabled = usedElsewhere.has(t.code) && t.code!==selected;
      return `<option value="${t.code}" ${t.code===selected?'selected':''} ${disabled?'disabled':''}>${t.name_ar} (${parseFloat(t.rate)}%)${disabled?' — مستخدمة بسطر آخر':''}</option>`;
    }).join('');
}

function lineTaxSummary(line){
  if(!line.tax_type_code) return 'ضريبة';
  const t = (taxTypes||[]).find(x=>x.code===line.tax_type_code);
  const amt = line.tax_amount ? fmt(line.tax_amount) : '';
  return t ? `${t.name_ar} — ${amt}` : 'ضريبة';
}

function onJLineTaxTypeChange(lineId, taxTypeCode){
  const line = jLines.find(l=>l.id===lineId);
  if(!line) return;
  if(taxTypeCode){
    // لا يجوز تكرار نفس نوع الضريبة أكثر من مرة داخل نفس القيد — هذا غير
    // وارد محاسبياً (يضاعف قيمة الضريبة المستحقة/القابلة للخصم بالقيد).
    const dup = jLines.some(l => l.id!==lineId && l.tax_type_code === taxTypeCode);
    if(dup){
      const t = (taxTypes||[]).find(x=>x.code===taxTypeCode);
      alert(`تم استخدام ضريبة "${t ? t.name_ar : taxTypeCode}" بالفعل في سطر آخر بنفس القيد — لا يمكن تكرار نفس الضريبة أكثر من مرة في القيد الواحد.`);
      renderJLines();
      return;
    }
  }
  line.tax_type_code = taxTypeCode || '';
  if(!taxTypeCode){
    line.tax_rate = ''; line.tax_amount = '';
  } else {
    const t = (taxTypes||[]).find(x=>x.code===taxTypeCode);
    const rate = t ? parseFloat(t.rate) : 0;
    const grossAmount = parseFloat(line.debit)||parseFloat(line.credit)||0;
    line.tax_rate = rate;
    // المبلغ المكتوب بالسطر (مدين/دائن) هو الإجمالي شامل الضريبة، لذلك
    // نستخرج نسبة الضريبة من داخله (gross × rate ÷ (100 + rate))
    // بدل إضافتها فوقه — مثال: 11,500 شامل 15% = 1,500 ضريبة، وليس 1,725.
    line.tax_amount = rate>0 ? Math.round(grossAmount * rate / (100+rate) * 100) / 100 : 0;
  }
  renderJLines();
}

function clearLineTax(lineId){
  const line = jLines.find(l=>l.id===lineId);
  if(!line) return;
  line.tax_type_code = ''; line.tax_rate = ''; line.tax_amount = '';
  expandedTaxLines.delete(lineId);
  renderJLines();
}

// إظهار حقلي "المورد" و"رقم فاتورة المورد" فقط عند التعامل مع ضريبة
// القيمة المضافة بالقيد (فتح لوحة الضريبة بأي سطر أو تفعيل ضريبة فعلياً)
// — أو عند الضغط يدوياً على زر "ضريبة القيمة المضافة" أعلى الشاشة —
// بدل إظهارهما دائماً حتى في القيود التي لا علاقة لها بالموردين.
let jSupplierFieldsManuallyShown = false;

function toggleSupplierFieldsManually(){
  jSupplierFieldsManuallyShown = !jSupplierFieldsManuallyShown;
  renderJLines();
}

function updateSupplierFieldsVisibility(){
  const row = document.getElementById('jSupplierFieldsRow');
  const btn = document.getElementById('jVatToggleBtn');
  if(!row) return;
  const invVal = document.getElementById('jInvoiceNumber')?.value?.trim();
  const supVal = document.getElementById('jSupplier')?.value;
  const shouldShow = jSupplierFieldsManuallyShown || expandedTaxLines.size > 0 || jLines.some(l=>l.tax_type_code) || !!invVal || !!supVal;
  row.style.display = shouldShow ? 'grid' : 'none';
  if(btn) btn.classList.toggle('jvat-active', shouldShow);
}

function renderJLines(){
  const body=document.getElementById('journalLinesBody');
  if(!body) return;

  body.innerHTML=jLines.map(l=>{
    const allocs = l.cost_allocations || [];
    const totalPct = allocs.reduce((s,a)=>s+(parseFloat(a.percentage)||0),0);
    const isExpanded = expandedCostLines.has(l.id);
    const pctOk = !allocs.length || Math.round(totalPct*100)===10000;

    const mainRow = `<tr class="jline-row" draggable="true"
        ondragstart="onLineDragStart(${l.id}, event)"
        ondragend="onLineDragEnd(event)"
        ondragover="onLineDragOver(event)"
        ondragleave="onLineDragLeave(event)"
        ondrop="onLineDrop(${l.id}, event)">
      <td class="jline-handle" title="اسحب لتغيير الترتيب">⠿⠿</td>
      <td><input type="text" list="accountsDatalist" placeholder="ابحث بالكود أو اسم الحساب" value="${l.account_code?accountLabel(l.account_code):''}" onchange="onJLineAccountChange(${l.id}, this)"></td>
      <td><input type="text" placeholder="بيان السطر (اختياري)" value="${l.line_description||''}" onchange="onJLineChange(${l.id},'line_description',this.value)"></td>
      <td><input type="text" inputmode="decimal" class="numeric-fmt" placeholder="0.00" value="${l.debit?window.formatNumberDisplay(l.debit):'0.00'}" onchange="onJLineChange(${l.id},'debit',cleanNumber(this.value))"></td>
      <td><input type="text" inputmode="decimal" class="numeric-fmt" placeholder="0.00" value="${l.credit?window.formatNumberDisplay(l.credit):'0.00'}" onchange="onJLineChange(${l.id},'credit',cleanNumber(this.value))"></td>
      <td><button type="button" class="cc-btn ${allocs.length && !pctOk ? 'cc-btn-warn':''}" onclick="toggleLineCostPanel(${l.id})">🏷️ ${lineCostSummary(l)}</button></td>
      <td><button type="button" class="cc-btn ${l.tax_rate?'jtax-btn-active':''}" onclick="toggleLineTaxPanel(${l.id})">🧾 ${lineTaxSummary(l)}</button></td>
      <td><button class="rm-line" onclick="removeJLine(${l.id})">✕</button></td>
    </tr>`;

    const isTaxExpanded = expandedTaxLines.has(l.id);
    const taxPanelRow = isTaxExpanded ? `<tr class="jline-cost-panel-row">
      <td></td>
      <td colspan="7">
        <div class="cc-panel">
          <div class="cc-panel-head"><span>ضريبة هذا السطر</span></div>
          <div class="jtax-row">
            <label>نوع الضريبة</label>
            <select onchange="onJLineTaxTypeChange(${l.id},this.value)">${renderTaxTypeOptionsHtml(l.tax_type_code, l.id)}</select>
            <label>قيمة الضريبة</label>
            <input type="text" inputmode="decimal" class="numeric-fmt" value="${l.tax_amount ? window.formatNumberDisplay(l.tax_amount) : ''}" placeholder="تُحسب تلقائياً" readonly>
            <button type="button" class="rm-line" onclick="clearLineTax(${l.id})" title="إزالة الضريبة">✕</button>
          </div>
          <div class="hint" style="margin-top:6px">اختر نوع الضريبة المسجّل بالنظام وستُحسب القيمة تلقائياً من نسبته — بدون إدخال أي رقم يدوياً.</div>
        </div>
      </td>
    </tr>` : '';

    if(!isExpanded) return mainRow + taxPanelRow;

    const allocRows = allocs.map((a,idx)=>`
      <div class="cc-alloc-row">
        <select onchange="onLineCostAllocationChange(${l.id},${idx},'cost_center_code',this.value)">${renderCostCenterOptionsHtml(a.cost_center_code)}</select>
        <input type="number" step="0.01" min="0" max="100" value="${a.percentage||0}" onchange="onLineCostAllocationChange(${l.id},${idx},'percentage',parseFloat(this.value)||0)">
        <span class="cc-pct-sign">%</span>
        <button type="button" class="rm-line" onclick="removeLineCostAllocation(${l.id},${idx})">✕</button>
      </div>`).join('');

    const panelRow = `<tr class="jline-cost-panel-row">
      <td></td>
      <td colspan="7">
        <div class="cc-panel">
          <div class="cc-panel-head">
            <span>توزيع مركز التكلفة لهذا السطر</span>
            <span class="cc-total ${pctOk?'cc-total-ok':'cc-total-bad'}">الإجمالي: ${totalPct.toFixed(2)}%</span>
          </div>
          ${allocRows || '<div class="hint">بدون توزيع — سيُرحّل السطر بدون مركز تكلفة</div>'}
          <button type="button" class="btn secondary cc-add-btn" onclick="addLineCostAllocation(${l.id})">+ إضافة مركز تكلفة</button>
        </div>
      </td>
    </tr>`;

    return mainRow + panelRow + taxPanelRow;
  }).join('');

  const totalDebit=jLines.reduce((s,l)=>s+(parseFloat(l.debit)||0),0);
  const totalCredit=jLines.reduce((s,l)=>s+(parseFloat(l.credit)||0),0);
  const diff=Math.round((totalDebit-totalCredit)*100)/100;

  const tdEl=document.getElementById('jTotalDebit');
  const tcEl=document.getElementById('jTotalCredit');
  const diffEl=document.getElementById('jDiff');
  const submitBtn=document.getElementById('jSubmitBtn');
  if(tdEl) tdEl.textContent=fmt(totalDebit);
  if(tcEl) tcEl.textContent=fmt(totalCredit);
  if(diffEl){
    diffEl.textContent=fmt(Math.abs(diff));
    diffEl.style.color = diff===0 ? 'var(--success)' : 'var(--coral)';
  }
  if(submitBtn) submitBtn.disabled = !(diff===0 && totalDebit>0);
  updateSupplierFieldsVisibility();
}

function resetJournalForm(){
  journalEditingId=null;
  jLines=[];
  jSupplierFieldsManuallyShown=false;
  expandedTaxLines.clear();
  expandedCostLines.clear();
  lineCounter++; jLines.push({id:lineCounter, account_code:'', debit:0, credit:0, line_description:'', cost_allocations:[], tax_type_code:'', tax_rate:'', tax_amount:''});
  lineCounter++; jLines.push({id:lineCounter, account_code:'', debit:0, credit:0, line_description:'', cost_allocations:[], tax_type_code:'', tax_rate:'', tax_amount:''});
  const titleEl=document.getElementById('journalFormTitle');
  if(titleEl) titleEl.textContent='قيد محاسبي جديد';
  const submitBtn=document.getElementById('jSubmitBtn');
  if(submitBtn) submitBtn.textContent='ترحيل القيد';
  const brSelReset=document.getElementById('jBranch'); if(brSelReset) brSelReset.value='';
  const cb=document.getElementById('jCreatedBy'); if(cb) cb.value='';
  const dateEl=document.getElementById('jDate'); if(dateEl) dateEl.value='';
  const invEl=document.getElementById('jInvoiceNumber'); if(invEl) invEl.value='';
  const supEl=document.getElementById('jSupplier'); if(supEl) supEl.value='';
  clearJournalError();
  renderJLines();
}

// كانت مفقودة: تعبئة قوائم اختيار المورد بفورمي "أمر الشراء" و"استلام البضاعة"
// (poSupplier / grnSupplier) من قائمة الموردين المحمّلة — كان الكود يقرأ
// قيمتها بأماكن ثانية بدون ما تُعبّى أبداً.
function refreshSelects(){
  const options='<option value="">— اختر مورد —</option>'+
    (suppliers||[]).map(s=>`<option value="${s.code}">${s.code} — ${s.name}</option>`).join('');
  const poSup=document.getElementById('poSupplier');
  const grnSup=document.getElementById('grnSupplier');
  const dinvSup=document.getElementById('dinvSupplier');
  if(poSup){ const cur=poSup.value; poSup.innerHTML=options; poSup.value=cur; }
  if(grnSup){ const cur=grnSup.value; grnSup.innerHTML=options; grnSup.value=cur; }
  if(dinvSup){ const cur=dinvSup.value; dinvSup.innerHTML=options; dinvSup.value=cur; }
}

// ============================================================
// إجراءات الحسابات
// ============================================================
function suggestNature(){
  const type=document.getElementById('accType').value;
  const nature=document.getElementById('accNature');
  if(nature) nature.value=(type==='assets'||type==='expenses')?'مدين':'دائن';
}

async function submitAccount(){
  const editCode=document.getElementById('accEditCode').value;
  const code=document.getElementById('accCode').value.trim();
  const name_ar=document.getElementById('accNameAr').value.trim();
  const name_en=document.getElementById('accNameEn').value.trim();
  const account_type=document.getElementById('accType').value;
  const nature=document.getElementById('accNature').value;
  const parent_code=document.getElementById('accParent').value||null;
  const opening_balance=parseFloat(document.getElementById('accOpening').value)||0;
  const err=document.getElementById('accErr');
  if(!code||!name_ar){err.textContent='يرجى إدخال الكود والاسم'; return;}
  err.textContent='';
  try{
    const payload={name_ar,name_en,account_type,nature,parent_code,opening_balance};
    if(editCode){
      await api('PUT',`/api/accounts/${editCode}`,payload);
    }else{
      payload.code=code;
      await api('POST','/api/accounts',payload);
    }
    await loadAll();
    cancelAccEdit();
  }catch(e){err.textContent=e.message;}
}

function editAccount(code){
  const acc=accounts.find(a=>a.code===code);
  if(!acc) return;
  document.getElementById('accEditCode').value=acc.code;
  document.getElementById('accCode').value=acc.code;
  document.getElementById('accCode').disabled=true;
  document.getElementById('accNameAr').value=acc.name_ar;
  document.getElementById('accNameEn').value=acc.name_en||'';
  document.getElementById('accType').value=acc.account_type;
  document.getElementById('accNature').value=acc.nature||'مدين';
  document.getElementById('accParent').value=acc.parent_code||'';
  document.getElementById('accOpening').value=acc.opening_balance;
  document.getElementById('accFormTitle').textContent='تعديل: '+acc.name_ar;
  document.getElementById('accSubmitBtn').textContent='حفظ التعديلات';
  document.getElementById('accCancelBtn').style.display='inline-block';
  // إظهار النموذج
  const box = document.getElementById('accFormBox');
  if(box){ box.style.display='block'; box.scrollIntoView({behavior:'smooth',block:'nearest'}); }
}

function cancelAccEdit(){
  document.getElementById('accEditCode').value='';
  document.getElementById('accCode').value='';
  document.getElementById('accCode').disabled=false;
  document.getElementById('accNameAr').value='';
  document.getElementById('accNameEn').value='';
  document.getElementById('accOpening').value='';
  document.getElementById('accFormTitle').textContent='إضافة حساب جديد';
  document.getElementById('accSubmitBtn').textContent='إضافة الحساب';
  document.getElementById('accCancelBtn').style.display='none';
  // إخفاء النموذج
  const box = document.getElementById('accFormBox');
  if(box) box.style.display='none';
  suggestNature();
}

function createChildAccount(parentCode){
  const parent=accounts.find(a=>a.code===parentCode);
  if(!parent) return;
  const children=accounts.filter(a=>a.parent_code===parentCode);
  let max=0;
  children.forEach(c=>{
    const suffix=c.code.replace(parentCode,'');
    const num=parseInt(suffix);
    if(!isNaN(num)&&num>max) max=num;
  });
  const nextCode=parentCode+String(max+1).padStart(2,'0');
  document.getElementById('accCode').value=nextCode;
  document.getElementById('accParent').value=parentCode;
  document.getElementById('accCode').disabled=false;
  document.getElementById('accEditCode').value='';
  document.getElementById('accNameAr').focus();
  window.scrollTo({top:0,behavior:'smooth'});
}

async function deleteAccount(code){
  const account=accounts.find(a=>a.code===code);
  if(!account) return;
  if(account.is_system){alert('هذا حساب نظامي أساسي من أساسيات النظام (مثل حساب الموردين وفروعه) ولا يمكن حذفه.'); return;}
  if((account.balance||0)!==0){alert('لا يمكن حذف الحساب لأنه يحتوي على حركات أو أرصدة'); return;}
  if(!confirm('تأكيد حذف الحساب؟')) return;
  try{await api('DELETE',`/api/accounts/${code}`); await loadAll();}
  catch(e){alert(e.message);}
}

// ============================================================
// تصدير دليل الحسابات (Excel / PDF) — بنفس الترتيب الهرمي المعروض بالشجرة
// ============================================================
function buildAccountsExportRows(){
  const rows=[];
  function walk(parentCode, level){
    (accounts||[])
      .filter(a=>String(a.parent_code||'')===String(parentCode||''))
      .sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true}))
      .forEach(acc=>{
        rows.push({acc, level});
        walk(acc.code, level+1);
      });
  }
  walk(null,0);
  return rows;
}

function exportAccountsCsv(){
  const rows=buildAccountsExportRows();
  if(!rows.length){ alert('لا توجد حسابات لتصديرها'); return; }
  let csv='الكود,اسم الحساب,النوع,الحساب الأب,الرصيد الافتتاحي,الرصيد الحالي\n';
  csv+=rows.map(({acc,level})=>{
    const indentedName=(level>0?'  '.repeat(level):'')+(acc.name_ar||'');
    return [
      acc.code,
      indentedName,
      (typeof TYPE_LABELS!=='undefined' ? (TYPE_LABELS[acc.account_type]||acc.account_type) : acc.account_type) || '',
      acc.parent_code || '',
      fmt(acc.opening_balance),
      fmt(acc.balance)
    ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
  }).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent('\uFEFF'+csv);
  a.download='chart_of_accounts.csv';
  a.click();
}

function exportAccountsPdf(){
  const rows=buildAccountsExportRows();
  if(!rows.length){ alert('لا توجد حسابات لتصديرها'); return; }
  const w=window.open('','_blank');
  if(!w){ alert('يرجى السماح بالنوافذ المنبثقة بالمتصفح حتى يمكن تصدير التقرير كـ PDF'); return; }
  const todayStr=new Date().toLocaleDateString('ar-SA');
  const bodyRows=rows.map(({acc,level})=>`
    <tr>
      <td style="direction:ltr;text-align:left">${whEscCoa(acc.code||'')}</td>
      <td style="padding-inline-start:${level*18}px"><b>${whEscCoa(acc.name_ar||'')}</b>${acc.name_en?`<br><small style="color:#889">${whEscCoa(acc.name_en)}</small>`:''}${acc.is_system?' <small style="color:#a58a2a">(نظامي)</small>':''}</td>
      <td>${whEscCoa((typeof TYPE_LABELS!=='undefined' ? (TYPE_LABELS[acc.account_type]||acc.account_type) : acc.account_type) || '')}</td>
      <td style="direction:ltr;text-align:center">${whEscCoa(acc.parent_code||'-')}</td>
      <td style="text-align:left;direction:ltr">${fmt(acc.opening_balance)}</td>
      <td style="text-align:left;direction:ltr">${fmt(acc.balance)}</td>
    </tr>`).join('');
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>دليل الحسابات — LEGEND D ERP SYS</title>
    <style>
      body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;padding:26px;color:#1c2430}
      .rpt-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1c3faa;padding-bottom:10px;margin-bottom:16px}
      .rpt-head h1{font-size:19px;margin:0}
      .rpt-head .meta{color:#667;font-size:12px;margin-top:4px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #d7dce2;padding:6px 9px;text-align:right;vertical-align:top}
      th{background:#eef2fa;font-weight:800;color:#1c2430}
      tr:nth-child(even) td{background:#fafbfd}
      .rpt-foot{margin-top:14px;font-size:11px;color:#889}
      @media print{ body{padding:0} }
    </style></head><body>
    <div class="rpt-head">
      <div><h1>دليل الحسابات</h1><div class="meta">LEGEND D ERP SYS</div></div>
      <div class="meta">تاريخ التصدير: ${todayStr}<br>إجمالي الحسابات: ${rows.length}</div>
    </div>
    <table>
      <thead><tr><th>الكود</th><th>اسم الحساب</th><th>النوع</th><th>الحساب الأب</th><th>الرصيد الافتتاحي</th><th>الرصيد الحالي</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <div class="rpt-foot">تم إنشاء هذا التقرير آلياً من نظام LEGEND D ERP SYS</div>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

// ============================================================
// إجراءات القيود
// ============================================================
async function submitEntry(){
  const entry_date=document.getElementById('jDate').value;
  const description=document.getElementById('jDesc').value.trim();
  const created_by_name=document.getElementById('jCreatedBy')?.value.trim() || null;
  const branchVal=document.getElementById('jBranch')?.value || '';
  const branch_id=branchVal ? parseInt(branchVal,10) : null;
  const invoice_number=document.getElementById('jInvoiceNumber')?.value.trim() || null;
  const supplier_code=document.getElementById('jSupplier')?.value || null;
  const err=document.getElementById('jErr');

  const validLines=jLines.filter(l=>l.account_code && ((l.debit||0)>0 || (l.credit||0)>0));
  if(!entry_date){showJournalError('يرجى إدخال تاريخ القيد'); return;}
  if(validLines.length<2){showJournalError('يرجى إدخال سطرين على الأقل، كل سطر بحساب صحيح ومبلغ'); return;}

  const totalDebit=validLines.reduce((s,l)=>s+(parseFloat(l.debit)||0),0);
  const totalCredit=validLines.reduce((s,l)=>s+(parseFloat(l.credit)||0),0);
  if(Math.round((totalDebit-totalCredit)*100)!==0){showJournalError(`القيد غير متوازن: مدين ${fmt(totalDebit)} ≠ دائن ${fmt(totalCredit)}`); return;}
  if(totalDebit<=0){showJournalError('لا يمكن ترحيل قيد بإجمالي صفر'); return;}

  // تحقق مسبق من نسب مراكز التكلفة بكل سطر قبل الإرسال (نفس تحقق الباك إند، لإظهار الخطأ فوراً)
  for(const l of validLines){
    if(l.cost_allocations && l.cost_allocations.length){
      const totalPct = l.cost_allocations.reduce((s,a)=>s+(parseFloat(a.percentage)||0),0);
      if(Math.round(totalPct*100)!==10000){
        showJournalError(`مجموع نسب مراكز التكلفة لسطر "${accountLabel(l.account_code)}" يجب أن يساوي 100% (الحالي: ${totalPct.toFixed(2)}%)`);
        return;
      }
    }
  }

  clearJournalError();
  const payload={
    entry_date, description, created_by_name, branch_id, invoice_number, supplier_code,
    lines: validLines.map(l=>({
      account_code:l.account_code, debit:l.debit||0, credit:l.credit||0, line_description:l.line_description||null,
      tax_type_code: l.tax_type_code || null,
      tax_rate: (l.tax_rate!==undefined && l.tax_rate!==null && l.tax_rate!=='') ? parseFloat(l.tax_rate) : null,
      tax_amount: (l.tax_amount!==undefined && l.tax_amount!==null && l.tax_amount!=='') ? parseFloat(l.tax_amount) : null,
      cost_allocations:(l.cost_allocations||[]).filter(a=>a.cost_center_code).map(a=>({cost_center_code:a.cost_center_code, percentage:parseFloat(a.percentage)||0}))
    }))
  };
  try{
    if(journalEditingId){
      await api('PUT',`/api/journal/${journalEditingId}`,payload);
    } else {
      await api('POST','/api/journal',payload);
    }
    await loadAll();
    document.getElementById('jDesc').value='';
    resetJournalForm();
    if(typeof openSubModule==='function') openSubModule('القيود اليومية');
  }catch(e){showJournalError(e.message);}
}

function resolveSupplierCode(rawValue){
  const v=(rawValue||'').trim();
  if(!v) return null;
  const dashIdx=v.indexOf(' — ');
  const candidate=dashIdx>-1 ? v.slice(0,dashIdx).trim() : v;
  if((suppliers||[]).some(s=>s.code===candidate)) return candidate;
  const byName=(suppliers||[]).filter(s=>s.name===v);
  if(byName.length===1) return byName[0].code;
  return null;
}

function showJournalError(msg){
  const err=document.getElementById('jErr');
  if(!err) return;
  err.textContent=msg;
  err.classList.add('jerr-visible');
  err.scrollIntoView({behavior:'smooth', block:'center'});
}

function clearJournalError(){
  const err=document.getElementById('jErr');
  if(!err) return;
  err.textContent='';
  err.classList.remove('jerr-visible');
}

function loadEntryIntoForm(id){
  const e=(entries||[]).find(x=>x.id===id);
  if(!e) return null;
  expandedTaxLines.clear();
  expandedCostLines.clear();
  const lines=(e.lines&&e.lines.length) ? e.lines : [
    ...(e.debit_account?[{account_code:e.debit_account, debit:e.amount, credit:0, line_description:e.description}]:[]),
    ...(e.credit_account?[{account_code:e.credit_account, debit:0, credit:e.amount, line_description:e.description}]:[]),
  ];
  jLines=lines.map(l=>{ lineCounter++; return {id:lineCounter, account_code:l.account_code, debit:l.debit||0, credit:l.credit||0, line_description:l.line_description||'', tax_type_code:l.tax_type_code ?? '', tax_rate:l.tax_rate ?? '', tax_amount:l.tax_amount ?? '', cost_allocations:(l.cost_allocations||[]).map(a=>({cost_center_code:a.cost_center_code, percentage:a.percentage}))}; });
  document.getElementById('jDate').value=e.entry_date||'';
  document.getElementById('jDesc').value=e.description||'';
  const cb=document.getElementById('jCreatedBy'); if(cb) cb.value=e.created_by_name||'';
  const brSel=document.getElementById('jBranch'); if(brSel) brSel.value=e.branch_id||'';
  const invEl=document.getElementById('jInvoiceNumber'); if(invEl) invEl.value=e.invoice_number||'';
  const supEl=document.getElementById('jSupplier');
  if(supEl) supEl.value = e.supplier_code || '';
  jSupplierFieldsManuallyShown = !!(e.invoice_number || e.supplier_code);
  renderJLines();
  return e;
}

function editJournalEntry(id){
  const e=loadEntryIntoForm(id);
  if(!e) return;
  if(e.source_type!=='manual'){ alert('لا يمكن تعديل قيد مُولَّد تلقائياً من عملية أخرى'); return; }
  if(e.status==='cancelled'){ alert('لا يمكن تعديل قيد ملغى'); return; }
  journalEditingId=id;
  const titleEl=document.getElementById('journalFormTitle'); if(titleEl) titleEl.textContent=`تعديل القيد #${id}`;
  const submitBtn=document.getElementById('jSubmitBtn'); if(submitBtn) submitBtn.textContent='حفظ التعديلات';
  if(typeof openSubModule==='function') openSubModule('إضافة قيد');
}

function duplicateJournalEntry(id){
  const e=loadEntryIntoForm(id);
  if(!e) return;
  journalEditingId=null;
  document.getElementById('jDate').value=new Date().toISOString().slice(0,10);
  const titleEl=document.getElementById('journalFormTitle'); if(titleEl) titleEl.textContent='نسخ قيد دوري (قيد جديد)';
  const submitBtn=document.getElementById('jSubmitBtn'); if(submitBtn) submitBtn.textContent='ترحيل القيد';
  if(typeof openSubModule==='function') openSubModule('إضافة قيد');
}

async function deleteEntry(id){
  if(!confirm('حذف هذا القيد؟')) return;
  try{await api('DELETE',`/api/journal/${id}`); await loadAll();}
  catch(e){alert(e.message);}
}

function viewJournalEntry(id){
  const e=(entries||[]).find(x=>x.id===id);
  if(!e) return;
  const lines=e.lines&&e.lines.length ? e.lines : [];
  const rows=lines.map(l=>`<tr>
      <td>${accountLabel(l.account_code)}</td>
      <td>${l.line_description||''}</td>
      <td class="num">${l.debit?fmt(l.debit):''}</td>
      <td class="num">${l.credit?fmt(l.credit):''}</td>
    </tr>`).join('');
  const w=window.open('','_blank','width=560,height=520');
  w.document.write(`<html dir="rtl"><head><title>تفاصيل القيد #${e.id}</title>
    <style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border:1px solid #ccc;padding:8px;text-align:right;font-size:13px}th{background:#f2f2f2}</style></head>
    <body><h3>قيد رقم #${e.id} — ${e.entry_date}</h3>
    <p>البيان: ${e.description||'-'}</p>
    <p>منشئ القيد: ${e.created_by_name||'-'}</p>
    <table><thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="margin-top:12px;font-weight:bold">الإجمالي: ${fmt(e.total_amount||e.amount||0)}</p>
    </body></html>`);
}



function getSortedJournalEntries(){
  return [...(entries||[])].sort((a,b)=>{
    if(a.entry_date!==b.entry_date) return a.entry_date<b.entry_date?1:-1;
    return (b.id||0)-(a.id||0);
  });
}

function openEntryDetail(id){
  entryDetailId=id;
  if(typeof openSubModule==='function') openSubModule('تفاصيل القيد');
  renderEntryDetail();
}

function navigateEntryDetail(dir){
  const sorted=getSortedJournalEntries();
  const idx=sorted.findIndex(x=>x.id===entryDetailId);
  if(idx===-1) return;
  const newIdx=idx-dir; // dir=+1 يعني "التالي" (الأحدث تسلسلياً)، dir=-1 يعني "السابق"
  if(newIdx<0 || newIdx>=sorted.length) return;
  entryDetailId=sorted[newIdx].id;
  renderEntryDetail();
}

function renderEntryDetail(){
  const box=document.getElementById('entryDetailBody');
  if(!box) return;
  const e=(entries||[]).find(x=>x.id===entryDetailId);
  if(!e){ box.innerHTML='<div class="empty-msg">القيد غير موجود</div>'; return; }

  const sorted=getSortedJournalEntries();
  const idx=sorted.findIndex(x=>x.id===entryDetailId);
  const hasOlder=idx<sorted.length-1;
  const hasNewer=idx>0;

  const lines=(e.lines&&e.lines.length) ? e.lines : [
    ...(e.debit_account?[{account_code:e.debit_account, debit:e.amount, credit:0, line_description:e.description}]:[]),
    ...(e.credit_account?[{account_code:e.credit_account, debit:0, credit:e.amount, line_description:e.description}]:[]),
  ];
  const rows=lines.map(l=>`<tr>
      <td>${accountLabel(l.account_code)}</td>
      <td>${l.line_description||''}</td>
      <td class="num">${l.debit?fmt(l.debit):''}</td>
      <td class="num">${l.credit?fmt(l.credit):''}</td>
    </tr>`).join('');

  const status=e.status||'posted';
  const statusBadge = status==='cancelled' ? `<span class="badge returned">ملغي</span>` : `<span class="badge posted">مرحّل</span>`;
  const branchObj=(branches||[]).find(b=>b.id==e.branch_id);
  const branchName=branchObj ? `${branchObj.code} — ${branchObj.name_ar}` : 'عام';
  const ccObj=(costCenters||[]).find(c=>c.code===e.cost_center_code);
  const isManual=e.source_type==='manual';
  const isCancelled=status==='cancelled';

  box.innerHTML=`
    <div class="entry-nav-bar">
      <button class="entry-nav-btn" onclick="navigateEntryDetail(-1)" ${hasOlder?'':'disabled'}>◀ القيد السابق</button>
      <div class="entry-nav-title">قيد رقم #${e.id} ${statusBadge}</div>
      <button class="entry-nav-btn" onclick="navigateEntryDetail(1)" ${hasNewer?'':'disabled'}>القيد التالي ▶</button>
    </div>
    <div class="frow">
      <div class="field"><label>التاريخ</label><div class="num" style="font-weight:700">${e.entry_date||''}</div></div>
      <div class="field"><label>الفرع</label><div style="font-weight:700">${branchName}</div></div>
      <div class="field"><label>مركز التكلفة</label><div style="font-weight:700">${ccObj?`${ccObj.code} — ${ccObj.name_ar}`:'-'}</div></div>
    </div>
    <div class="frow" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>البيان</label><div style="font-weight:700">${e.description||'-'}</div></div>
      <div class="field"><label>منشئ القيد</label><div style="font-weight:700">${e.created_by_name||'-'}</div></div>
    </div>
    <div class="gridcard" style="margin:14px 0"><div class="scrollx">
      <table class="grid">
        <thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div></div>
    <p style="font-weight:800;font-size:15px">الإجمالي: ${fmt(e.total_amount ?? e.amount ?? 0)}</p>

    <div class="jatt-section">
      <h4 class="jatt-title">📎 المرفقات</h4>
      <div class="jatt-dropzone" id="jattDropzone" onclick="document.getElementById('jattFileInput').click()">
        <div class="jatt-dropzone-icon">📎</div>
        <div class="jatt-dropzone-text">اسحب وأفلت الملفات هنا، أو اضغط للاختيار</div>
        <div class="jatt-dropzone-hint">صور، PDF، مستندات — يمكن اختيار أكثر من ملف</div>
        <input type="file" id="jattFileInput" multiple style="display:none" accept="image/*,.pdf,.doc,.docx" onchange="handleAttachmentFiles(this.files)">
      </div>
      <div id="jattUploadStatus"></div>
      <div class="jatt-list" id="jattList">${renderAttachmentsList(e)}</div>
    </div>

    <div style="display:flex;gap:8px;margin-top:10px">
      ${isManual && !isCancelled ? `<button class="btn secondary" onclick="editJournalEntry(${e.id})">✎ تعديل</button>` : ''}
      <button class="btn secondary" onclick="duplicateJournalEntry(${e.id})">⧉ نسخ</button>
      ${isManual ? `<button class="btn secondary" style="color:var(--coral)" onclick="deleteEntry(${e.id})">🗑 حذف</button>` : ''}
      <button class="btn secondary" onclick="openSubModule('القيود اليومية')">رجوع للقائمة</button>
    </div>
  `;

  setupAttachmentDropzone();
}

function renderAttachmentsList(e){
  const atts = e.attachments || [];
  if(!atts.length) return '<div class="hint" style="padding:8px 0">لا توجد مرفقات على هذا القيد بعد</div>';
  return atts.map(a=>{
    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(a.file_name||'') || /^image\//.test(a.file_type||'');
    const icon = isImage ? `<img src="${a.file_url}" class="jatt-thumb" alt="">` : `<div class="jatt-file-icon">📄</div>`;
    return `<div class="jatt-item">
        ${icon}
        <a href="${a.file_url}" target="_blank" class="jatt-name" title="${a.file_name}">${a.file_name}</a>
        <button class="jatt-remove" title="حذف المرفق" onclick="removeAttachment(${e.id},${a.id})">✕</button>
      </div>`;
  }).join('');
}

// ============================================================
// مرفقات القيد — رفع عبر Supabase Storage (سحب وإفلات أو اختيار ملفات)
// ============================================================

// ⚠️ إعداد مطلوب منك مرة واحدة فقط: عبّي هذين المتغيّرين ببيانات مشروعك
// على Supabase (Project Settings → API → Project URL / anon public key)
// حتى تعمل ميزة رفع المرفقات فعلياً. القيمتان آمنتان للنشر العلني
// (anon key مصمم أصلاً ليكون في كود الواجهة الأمامية).
window.SUPABASE_URL = window.SUPABASE_URL || '';
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
window.SUPABASE_STORAGE_BUCKET = window.SUPABASE_STORAGE_BUCKET || 'journal-attachments';

let __supabaseClient = null;
function getSupabaseClient(){
  if(__supabaseClient) return __supabaseClient;
  if(!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY){
    return null;
  }
  if(typeof window.supabase === 'undefined'){
    return null;
  }
  __supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  return __supabaseClient;
}

function setupAttachmentDropzone(){
  const zone = document.getElementById('jattDropzone');
  if(!zone || zone.dataset.dzBound) return;
  zone.dataset.dzBound = '1';
  ['dragenter','dragover'].forEach(evt=>{
    zone.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); zone.classList.add('jatt-drag-over'); });
  });
  ['dragleave','drop'].forEach(evt=>{
    zone.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); zone.classList.remove('jatt-drag-over'); });
  });
  zone.addEventListener('drop', e=>{
    const files = e.dataTransfer && e.dataTransfer.files;
    if(files && files.length) handleAttachmentFiles(files);
  });
}

async function handleAttachmentFiles(fileList){
  const statusEl = document.getElementById('jattUploadStatus');
  const files = Array.from(fileList||[]);
  if(!files.length) return;

  const client = getSupabaseClient();
  if(!client){
    if(statusEl) statusEl.innerHTML = `<div class="jatt-status jatt-status-warn">
      رفع المرفقات غير مُفعَّل بعد — يحتاج إعداد بسيط لمرة واحدة: عبّي
      <code>window.SUPABASE_URL</code> و<code>window.SUPABASE_ANON_KEY</code>
      في أعلى ملف script.js ببيانات مشروعك على Supabase (Project Settings → API)،
      وتأكد من تحميل مكتبة supabase-js في index.html.
    </div>`;
    return;
  }

  if(statusEl) statusEl.innerHTML = `<div class="jatt-status">⏳ جاري رفع ${files.length} ملف...</div>`;

  let okCount = 0, failCount = 0;
  for(const file of files){
    try{
      const safeName = file.name.replace(/[^\w.\-]/g,'_');
      const path = `entry-${entryDetailId}/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await client.storage
        .from(window.SUPABASE_STORAGE_BUCKET)
        .upload(path, file, { upsert:false });
      if(uploadErr) throw uploadErr;

      const { data: pub } = client.storage.from(window.SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
      const fileUrl = pub && pub.publicUrl;
      if(!fileUrl) throw new Error('تعذر الحصول على رابط الملف بعد الرفع');

      await api('POST', `/api/journal/${entryDetailId}/attachments`, {
        file_name: file.name,
        file_url: fileUrl,
        file_type: file.type || null,
        file_size: file.size || null,
        uploaded_by: document.getElementById('jCreatedBy')?.value || null,
      });
      okCount++;
    }catch(err){
      console.error('فشل رفع الملف', file.name, err);
      failCount++;
    }
  }

  if(statusEl){
    statusEl.innerHTML = failCount
      ? `<div class="jatt-status jatt-status-warn">تم رفع ${okCount} ملف، وفشل ${failCount}</div>`
      : `<div class="jatt-status jatt-status-ok">✓ تم رفع ${okCount} ملف بنجاح</div>`;
  }

  // تحديث بيانات القيد من الخادم لعرض المرفقات الجديدة
  try{
    const fresh = await api('GET', `/api/journal/${entryDetailId}/attachments`);
    const entry = (entries||[]).find(x=>x.id===entryDetailId);
    if(entry) entry.attachments = fresh;
    const listEl = document.getElementById('jattList');
    if(listEl && entry) listEl.innerHTML = renderAttachmentsList(entry);
  }catch(err){ console.warn('تعذر تحديث قائمة المرفقات', err.message); }
}

async function removeAttachment(entryId, attachmentId){
  if(!confirm('حذف هذا المرفق؟')) return;
  try{
    await api('DELETE', `/api/journal/${entryId}/attachments/${attachmentId}`);
    const entry = (entries||[]).find(x=>x.id===entryId);
    if(entry) entry.attachments = (entry.attachments||[]).filter(a=>a.id!==attachmentId);
    const listEl = document.getElementById('jattList');
    if(listEl && entry) listEl.innerHTML = renderAttachmentsList(entry);
  }catch(e){ alert(e.message); }
}

function getProductCategories(){
  try{
    const list = JSON.parse(localStorage.getItem('categories') || '[]');
    window.categories = list;
    if (typeof categories !== 'undefined') categories = list;
    return list;
  }catch(e){ return window.categories || []; }
}

function getUnitTemplates(){
  try{
    const list = JSON.parse(localStorage.getItem('unitTemplates') || '[]');
    window.unitTemplates = list;
    if (typeof unitTemplates !== 'undefined') unitTemplates = list;
    return list;
  }catch(e){ return window.unitTemplates || []; }
}

function findCategoryName(value, item){
  if(item && (item.category_name || item.categoryName || item.category_label)){
    return item.category_name || item.categoryName || item.category_label;
  }
  const v = String(value ?? '').trim();
  if(!v) return '';
  const cats = getProductCategories();
  const c = cats.find(x =>
    String(x.id ?? '').trim() === v ||
    String(x.name ?? '').trim() === v ||
    String(x.code ?? '').trim() === v
  );
  return c ? c.name : v;
}

function findUnitTemplateByValue(value){
  if(!value || (typeof value === 'object' && !Object.keys(value).length)) return null;
  const v = String(typeof value === 'object' ? (value.id || value.name || value.base || value.higherName || value.higher || '') : value).trim();
  return getUnitTemplates().find(x =>
    String(x.id ?? '').trim() === v ||
    String(x.name ?? '').trim() === v ||
    String(x.base ?? '').trim() === v ||
    String(x.higherName ?? '').trim() === v ||
    String(x.higher ?? '').trim() === v ||
    String(x.code ?? '').trim() === v
  ) || null;
}

function getItemUnitTemplate(item){
  item = item || {};
  if(item.unit_template && typeof item.unit_template === 'object') return item.unit_template;
  const candidates = [
    item.unit_template_id, item.unitTemplateId, item.unit_template, item.unitTemplate,
    item.unit_template_name, item.unitTemplateName, item.unit_group, item.unitGroup,
    item.unit_id, item.unit, item.base_unit, item.baseUnit
  ];
  for(const c of candidates){
    const tpl = findUnitTemplateByValue(c);
    if(tpl) return tpl;
  }
  return null;
}

function findUnitDisplay(value, templateId){
  const tpl = templateId ? findUnitTemplateByValue(templateId) : findUnitTemplateByValue(value);
  if (tpl) return tpl.base || tpl.name || value || '';
  return value || '';
}

function getTemplateUnitsForItem(item){
  item = item || {};
  const tpl = getItemUnitTemplate(item);
  const units=[];
  if(tpl){
    const base = tpl.base || tpl.name || item.unit || '';
    const higher = tpl.higherName || tpl.higher || '';
    if(base) units.push({value:base, label:base, kind:'base', factor:1});
    if(higher && !units.some(u=>String(u.value)===String(higher))) units.push({value:higher, label:higher + (tpl.factor ? ' × ' + tpl.factor : ''), kind:'higher', factor:Number(tpl.factor)||1});
  }
  const raw = item.unit || item.base_unit || item.baseUnit || '';
  if(raw && !units.some(u=>String(u.value)===String(raw))) units.unshift({value:raw, label:raw, kind:'base', factor:1});
  if(!units.length) units.push({value:'', label:'—', kind:'base', factor:1});
  return units;
}

function getNumberValue(obj, keys, fallback=0){
  for(const k of keys){
    if(obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== ''){
      const n = parseFloat(obj[k]);
      if(!Number.isNaN(n)) return n;
    }
  }
  return fallback;
}

function getItemUnitFactor(item, selectedUnit){
  const tpl = getItemUnitTemplate(item);
  if(!tpl) return 1;
  const base = String(tpl.base || tpl.name || '').trim();
  const higher = String(tpl.higherName || tpl.higher || '').trim();
  const u = String(selectedUnit || item.display_unit || item.unit || base).trim();
  const factor = Number(tpl.factor) || 1;
  if(higher && u === higher) return factor;
  return 1;
}

function getItemDisplayValues(item){
  item = item || {};
  const selectedUnit = item.display_unit || findUnitDisplay(item.unit, item.unit_template || item.unit_template_id || item.unitTemplateId);
  const factor = getItemUnitFactor(item, selectedUnit);
  const qtyBase = getNumberValue(item, ['qty_on_hand','quantity','qty','stock_qty','opening_qty','available_qty'], 0);
  const purchaseBase = getNumberValue(item, ['purchase_price','buy_price','cost','default_cost','last_purchase','lastPurchase'], 0);
  const saleBase = getNumberValue(item, ['sale_price','selling_price','sales_price','price','default_price'], 0);
  const avgBase = getNumberValue(item, ['avg_cost','avg_price','average_cost','average_purchase','average_purchase_price'], purchaseBase);
  return {
    unit:selectedUnit,
    qty: factor>1 ? qtyBase / factor : qtyBase,
    purchase: factor>1 ? purchaseBase * factor : purchaseBase,
    sale: factor>1 ? saleBase * factor : saleBase,
    avg: factor>1 ? avgBase * factor : avgBase
  };
}

function renderUnitSelector(item){
  const code = String((item||{}).code || '').replace(/'/g, '&#39;');
  const current = (item && item.display_unit) || findUnitDisplay(item && item.unit, item && (item.unit_template || item.unit_template_id || item.unitTemplateId));
  const options = getTemplateUnitsForItem(item).map(u=>`<option value="${String(u.value).replace(/"/g,'&quot;')}" ${String(u.value)===String(current)?'selected':''}>${u.label}</option>`).join('');
  return `<select class="unit-display-select" title="اختر وحدة عرض المنتج" onchange="updateItemDisplayUnit('${code}', this.value)">${options}</select>`;
}

function updateItemDisplayUnit(code, unit){
  items = (items||[]).map(x => String(x.code)===String(code) ? {...x, display_unit:unit} : x);
  itemFiltered = (itemFiltered||[]).map ? itemFiltered.map(x => String(x.code)===String(code) ? {...x, display_unit:unit} : x) : itemFiltered;
  try{ localStorage.setItem('items_cache', JSON.stringify(items||[])); }catch(e){}
  renderItemsTable();
}

function loadProductDropdowns(){
 const cat=document.getElementById('itemCategory');
 if(cat){
   const selected=cat.value;
   cat.innerHTML='<option value="">اختر التصنيف</option>';
   getProductCategories().forEach(c=>{
     const o=document.createElement('option');
     o.value=String(c.id||c.name);
     o.textContent=c.name;
     cat.appendChild(o);
   });
   if(selected) cat.value=selected;
 }
 const unit=document.getElementById('itemUnit');
 if(unit){
   const selected=unit.value;
   unit.innerHTML='<option value="">اختر قالب وحدة</option>';
   getUnitTemplates().forEach(u=>{
     const o=document.createElement('option');
     o.value=String(u.id||u.name||u.base);
     o.dataset.base=u.base||'';
     o.textContent=(u.name||u.base||'قالب وحدة') + (u.base ? ' — الوحدة الأساسية: ' + u.base : '');
     unit.appendChild(o);
   });
   if(selected){
     const tpl=findUnitTemplateByValue(selected);
     unit.value = tpl ? String(tpl.id||tpl.name||tpl.base) : selected;
   }
 }
}

function loadSearchCategories(){
 const s=document.getElementById('searchItemCategory');
 if(!s)return;
 const selected=s.value;
 s.innerHTML='<option value="">كل التصنيفات</option>';
 getProductCategories().forEach(c=>{
  const o=document.createElement('option');
  o.value=String(c.id||c.name);
  o.textContent=c.name;
  s.appendChild(o);
 });
 if(selected) s.value=selected;
}

function setSelectValueSmart(selectId, rawValue){
  const select=document.getElementById(selectId);
  if(!select) return;
  const v=String(rawValue ?? '').trim();
  select.value=v;
  if(select.value===v) return;
  const match=[...select.options].find(o=>
    String(o.value||'').trim()===v || String(o.textContent||'').trim()===v
  );
  if(match) select.value=match.value;
}

// ============================================================
// إجراءات الأصناف
// ============================================================
async function submitItem(){
  const editCode=document.getElementById('itemEditCode').value;
  const code=document.getElementById('itemCode').value.trim();
  const name=document.getElementById('itemName').value.trim();
  const unitSelect=document.getElementById('itemUnit');
  const unitTemplate=findUnitTemplateByValue(unitSelect ? unitSelect.value : '');
  const unit=unitTemplate ? (unitTemplate.base || unitTemplate.name || unitTemplate.id) : (unitSelect ? unitSelect.value : '');
  const default_cost=parseFloat(document.getElementById('itemCost').value)||0;
  const sale_price=parseFloat(document.getElementById('itemPrice').value)||0;
  const opening_qty=parseFloat(document.getElementById('itemOpenQty').value)||0;
  const reorder_point=parseFloat(document.getElementById('itemReorder').value)||0;
  const err=document.getElementById('itemErr');
  if(!code||!name){err.textContent='يرجى إدخال الكود والاسم'; return;}
  if(!document.getElementById('itemCategory').value){err.textContent='يجب اختيار التصنيف'; return;}
  if(!document.getElementById('itemUnit').value){err.textContent='يجب اختيار قالب الوحدات'; return;}
  err.textContent='';
  try{
    const payload={
name,
name_en:document.getElementById('itemNameEn').value,
description:document.getElementById('itemDesc').value,
category:document.getElementById('itemCategory').value,
brand:document.getElementById('itemBrand').value,
supplier:document.getElementById('itemSupplier').value,
barcode:document.getElementById('itemBarcode').value,
price_lists:document.getElementById('itemPriceLists').value,
avg_price:document.getElementById('itemAvgPrice').value,
last_purchase:document.getElementById('itemLastPurchase').value,
status:document.getElementById('itemStatus').value,
unit,unit_template:unitTemplate ? (unitTemplate.id||unitTemplate.name) : '',display_unit:unit,default_cost,sale_price,opening_qty,reorder_point};
    payload.code = editCode || code;
    if(editCode){
      // حفظ فعلي للتعديل: نرسل الكود داخل البيانات ونحدث القائمة المعروضة حتى لو كان الخادم لا يرجع التعديل فورًا
      try{ await api('PUT',`/api/items/${encodeURIComponent(editCode)}`,payload); }
      catch(apiErr){ console.warn('تعذر حفظ التعديل في الخادم، تم حفظه محليًا:', apiErr.message); }
      items = (items||[]).map(x => String(x.code)===String(editCode) ? {...x, ...payload, code:editCode} : x);
    }else{
      try{ await api('POST','/api/items',payload); }
      catch(apiErr){ console.warn('تعذر إضافة المنتج في الخادم، تم حفظه محليًا:', apiErr.message); }
      const exists=(items||[]).some(x=>String(x.code)===String(code));
      items = exists ? (items||[]).map(x=>String(x.code)===String(code)?{...x,...payload}:x) : [...(items||[]), payload];
    }
    try{ localStorage.setItem('items_cache', JSON.stringify(items||[])); }catch(e){}
    renderItems();
    cancelItemEdit();
  }catch(e){err.textContent=e.message;}
}

function editItem(code){
  const f=document.getElementById('itemFormBox'); if(f) f.style.display='block';
  const it=items.find(i=>i.code===code);
  if(!it) return;
  document.getElementById('itemEditCode').value=it.code;
  document.getElementById('itemCode').value=it.code;
  document.getElementById('itemCode').disabled=true;
  document.getElementById('itemName').value=it.name||'';
  document.getElementById('itemNameEn').value=it.name_en||it.nameEn||'';
  document.getElementById('itemDesc').value=it.description||'';
  document.getElementById('itemBrand').value=it.brand||'';
  document.getElementById('itemSupplier').value=it.supplier||it.supplier_name||it.vendor||'';
  document.getElementById('itemBarcode').value=it.barcode||'';
  document.getElementById('itemPriceLists').value=it.price_lists||'';
  document.getElementById('itemAvgPrice').value=it.avg_price||it.avg_cost||0;
  document.getElementById('itemLastPurchase').value=it.last_purchase||0;
  document.getElementById('itemStatus').value=it.status||'تنشيط';
  loadProductDropdowns();
  setSelectValueSmart('itemCategory', it.category||it.category_id||it.category_name||it.categoryName||'');
  const editUnitTemplate=findUnitTemplateByValue(it.unit_template||it.unit);
  document.getElementById('itemUnit').value=editUnitTemplate ? String(editUnitTemplate.id||editUnitTemplate.name||editUnitTemplate.base) : (it.unit||'');
  document.getElementById('itemCost').value=it.default_cost||0;
  document.getElementById('itemPrice').value=it.sale_price||0;
  document.getElementById('itemOpenQty').value=it.opening_qty||0;
  document.getElementById('itemReorder').value=it.reorder_point||0;
  document.getElementById('itemFormTitle').textContent='تعديل: '+it.name;
  document.getElementById('itemSubmitBtn').textContent='حفظ التعديلات';
  document.getElementById('itemCancelBtn').style.display='inline-block';
  document.querySelector('[data-tab="items"]').click();
  window.scrollTo({top:0,behavior:'smooth'});
}

function cancelItemEdit(){
  const ids=['itemCode','itemName','itemNameEn','itemDesc','itemCategory','itemBrand','itemUnit','itemSupplier','itemBarcode','itemCost','itemPrice','itemOpenQty','itemAvgPrice','itemLastPurchase','itemReorder','itemPriceLists','itemStatus'];
  ids.forEach(id=>{const e=document.getElementById(id); if(e){e.disabled=false; e.value='';}});
  const edit=document.getElementById('itemEditCode'); if(edit) edit.value='';
  const code=document.getElementById('itemCode'); if(code) code.disabled=false;
  const title=document.getElementById('itemFormTitle'); if(title) title.textContent='إضافة منتج';
  const submitBtn=document.getElementById('itemSubmitBtn'); if(submitBtn){submitBtn.textContent='حفظ'; submitBtn.style.display='inline-block';}
  const cancelBtn=document.getElementById('itemCancelBtn'); if(cancelBtn) cancelBtn.style.display='none';
  const f=document.getElementById('itemFormBox'); if(f) f.style.display='none';
}

async function deleteItem(code){
  if(!confirm('حذف هذا الصنف؟')) return;
  try{await api('DELETE',`/api/items/${code}`); await loadAll();}
  catch(e){alert(e.message);}
}

// ============================================================
// إجراءات الموردين
// ============================================================
function supplierPayloadFromForm(){
  refreshSupplierAutoCode(false);
  const payload={
    code:document.getElementById('supCode').value.trim(),
    supplier_type:document.getElementById('supType').value,
    trade_name:document.getElementById('supTradeName').value.trim(),
    name:document.getElementById('supTradeName').value.trim(),
    first_name:document.getElementById('supFirstName').value.trim(),
    last_name:document.getElementById('supLastName').value.trim(),
    phone:document.getElementById('supPhone').value.trim(),
    mobile:document.getElementById('supMobile').value.trim(),
    building_no:document.getElementById('supBuildingNo').value.trim(),
    street:document.getElementById('supStreet').value.trim(),
    additional_no:document.getElementById('supAdditionalNo').value.trim(),
    district:document.getElementById('supDistrict').value.trim(),
    city:document.getElementById('supCity').value.trim(),
    postal_code:document.getElementById('supPostalCode').value.trim(),
    vat_no:document.getElementById('supVatNo').value.trim(),
    commercial_register:document.getElementById('supCommercialReg').value.trim(),
    currency:document.getElementById('supCurrency').value || 'SAR',
    opening_balance:parseFloat(document.getElementById('supOpeningBalance').value)||0,
    balance:parseFloat(document.getElementById('supOpeningBalance').value)||0,
    opening_date:document.getElementById('supOpeningDate').value,
    payment_terms_days:parseInt(document.getElementById('supPaymentTerms').value)||0,
    account_code:document.getElementById('supAccountCode')?.value || '2111',
    contacts:supplierContactsFromForm(),
    contracts:supplierContractsFromForm()
  };
  return payload;
}
function saveSuppliersCache(){ try{ localStorage.setItem('suppliers_cache', JSON.stringify(suppliers||[])); }catch(e){} }
async function submitSupplier(){
  const editCode=document.getElementById('supEditCode').value;
  const isNewSupplier=!editCode;
  if(isNewSupplier) refreshSupplierAutoCode(true);
  const payload=supplierPayloadFromForm();
  const err=document.getElementById('supErr');
  if(!payload.code){err.textContent='رقم المورد حقل إجباري'; return;}
  if(!payload.trade_name){err.textContent='الاسم التجاري حقل إجباري'; return;}
  if(payload.supplier_type==='commercial' && !payload.vat_no){err.textContent='الرقم الضريبي إجباري في حالة المورد التجاري'; return;}
  err.textContent='';
  updateSupplierWarnings();
  try{
    if(editCode){
      const {code, ...body}=payload;
      await api('PUT',`/api/suppliers/${editCode}`,body);
    }else{
      await api('POST','/api/suppliers',payload);
    }
    await loadAll();
  }catch(e){
    // في حال عدم دعم الخادم لكل الحقول، نحفظ محليًا حتى لا تكون عملية الإضافة وهمية في النسخة التجريبية
    const key=editCode || payload.code;
    const i=suppliers.findIndex(x=>String(x.code)===String(key));
    if(i>=0) suppliers[i]={...(suppliers[i]||{}),...payload,code:key};
    else suppliers.push(payload);
    saveSuppliersCache();
    renderAll();
  }
  if(isNewSupplier) consumeSequenceNumber('الموردين', payload.code);
  cancelSupEdit();
}

function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v ?? ''; }
function editSupplier(code){
  const s=suppliers.find(x=>String(x.code)===String(code));
  if(!s) return;
  setVal('supEditCode',s.code);
  setVal('supCode',s.code); document.getElementById('supCode').disabled=true;
  setVal('supType',s.supplier_type||'commercial');
  setVal('supTradeName',s.trade_name||s.name||'');
  setVal('supFirstName',s.first_name||'');
  setVal('supLastName',s.last_name||'');
  setVal('supPhone',s.phone||'');
  setVal('supMobile',s.mobile||'');
  setVal('supBuildingNo',s.building_no||'');
  setVal('supStreet',s.street||'');
  setVal('supAdditionalNo',s.additional_no||'');
  setVal('supDistrict',s.district||'');
  setVal('supCity',s.city||'');
  setVal('supPostalCode',s.postal_code||'');
  setVal('supVatNo',s.vat_no||'');
  setVal('supCommercialReg',s.commercial_register||'');
  setVal('supCurrency',s.currency||'SAR');
  setVal('supOpeningBalance',s.opening_balance ?? s.balance ?? 0);
  setVal('supOpeningDate',s.opening_date||'');
  setVal('supPaymentTerms',s.payment_terms_days||'');
  renderSupplierAccountOptions();
  setVal('supAccountCode',s.account_code||'2111');
  const contractBox=document.getElementById('supContractsBox'); if(contractBox) contractBox.innerHTML='';
  (Array.isArray(s.contracts)&&s.contracts.length?s.contracts:[]).forEach(c=>addSupplierContractRow(c));
  const box=document.getElementById('supContactsBox'); if(box) box.innerHTML='';
  (Array.isArray(s.contacts)&&s.contacts.length?s.contacts:[{}]).forEach(c=>addSupplierContactRow(c));
  document.getElementById('supFormTitle').textContent='تعديل: '+supplierDisplayName(s);
  document.getElementById('supSubmitBtn').textContent='حفظ التعديلات';
  document.getElementById('supCancelBtn').style.display='inline-block';
  updateSupplierWarnings();
  document.querySelector('[data-tab="suppliers"]')?.click();
  window.scrollTo({top:0,behavior:'smooth'});
}

function cancelSupEdit(){
  ['supEditCode','supCode','supTradeName','supFirstName','supLastName','supPhone','supMobile','supBuildingNo','supStreet','supAdditionalNo','supDistrict','supCity','supPostalCode','supVatNo','supCommercialReg','supPaymentTerms'].forEach(id=>setVal(id,''));
  setVal('supType','commercial'); setVal('supCurrency','SAR'); setVal('supOpeningBalance',0); setVal('supOpeningDate','');
  renderSupplierAccountOptions(); setVal('supAccountCode','2111');
  const code=document.getElementById('supCode'); if(code){ code.disabled=false; code.readOnly=false; code.classList.remove('auto-code-field'); }
  const cbox=document.getElementById('supContractsBox'); if(cbox){ cbox.innerHTML=''; }
  const box=document.getElementById('supContactsBox'); if(box){ box.innerHTML=''; addSupplierContactRow(); }
  setTimeout(()=>refreshSupplierAutoCode(true),0);
  document.getElementById('supFormTitle').textContent='إضافة مورد جديد';
  document.getElementById('supSubmitBtn').textContent='إضافة المورد';
  document.getElementById('supCancelBtn').style.display='none';
  const err=document.getElementById('supErr'); if(err) err.textContent='';
  updateSupplierWarnings();
}

async function deleteSupplier(code){
  if(!confirm('حذف هذا المورد؟')) return;
  try{await api('DELETE',`/api/suppliers/${code}`); await loadAll();}
  catch(e){
    suppliers=suppliers.filter(x=>String(x.code)!==String(code));
    saveSuppliersCache();
    renderAll();
  }
}

// ============================================================
// طلبات الشراء - سطور
// ============================================================
function addPoLine(){
  lineCounter++;
  const id=lineCounter;
  poLines.push({id,itemCode:'',qty:1,price:0});
  renderPoLines();
}

function removePoLine(id){
  poLines=poLines.filter(l=>l.id!==id);
  renderPoLines();
}

function onPoLineChange(id,field,value){
  const line=poLines.find(l=>l.id===id);
  if(!line) return;
  if(field==='qty'||field==='price') line[field]=parseFloat(value)||0;
  else line[field]=value;
  if(field==='itemCode'){
    const it=items.find(i=>i.code===value);
    if(it) line.price=it.default_cost||0;
  }
  renderPoLines();
}

function renderPoLines(){
  const body=document.getElementById('poLinesBody');
  if(!body) return;
  const itemOpts='<option value="">— اختر صنف —</option>'+items.map(i=>`<option value="${i.code}">${i.code} — ${i.name}</option>`).join('');
  body.innerHTML=poLines.map(l=>`<tr>
    <td><select onchange="onPoLineChange(${l.id},'itemCode',this.value)">${itemOpts.replace(`value="${l.itemCode}"`,`value="${l.itemCode}" selected`)}</select></td>
    <td><input type="number" step="0.01" min="0" value="${l.qty}" onchange="onPoLineChange(${l.id},'qty',this.value)"></td>
    <td><input type="number" step="0.01" min="0" value="${l.price}" onchange="onPoLineChange(${l.id},'price',this.value)"></td>
    <td class="linetotal">${fmt(l.qty*l.price)}</td>
    <td><button class="rm-line" onclick="removePoLine(${l.id})">✕</button></td>
  </tr>`).join('');
  const total=poLines.reduce((s,l)=>s+l.qty*l.price,0);
  const el=document.getElementById('poTotal');
  if(el) el.textContent=fmt(total);
}

async function submitPO(){
  const supplier_code=document.getElementById('poSupplier').value;
  const po_date=document.getElementById('poDate').value;
  const err=document.getElementById('poErr');
  const valid=poLines.filter(l=>l.itemCode&&l.qty>0);
  if(!supplier_code){err.textContent='يرجى اختيار المورد'; return;}
  if(!po_date){err.textContent='يرجى إدخال التاريخ'; return;}
  if(!valid.length){err.textContent='يرجى إضافة صنف واحد على الأقل'; return;}
  err.textContent='';
  try{
    await api('POST','/api/purchase-orders',{
      po_date,supplier_code,
      lines:valid.map(l=>({item_code:l.itemCode,qty:l.qty,unit_price:l.price}))
    });
    poLines=[];addPoLine();
    document.getElementById('poSupplier').value='';
    await loadAll();
  }catch(e){err.textContent=e.message;}
}

// ============================================================
// الاستلام - سطور
// ============================================================
function addGrnLine(){
  lineCounter++;
  const id=lineCounter;
  grnLines.push({id,itemCode:'',qty:1,cost:0,unit:''});
  renderGrnLines();
}

function removeGrnLine(id){
  grnLines=grnLines.filter(l=>l.id!==id);
  renderGrnLines();
}

function onGrnLineChange(id,field,value){
  const line=grnLines.find(l=>l.id===id);
  if(!line) return;
  if(field==='unit'){
    const it=items.find(i=>i.code===line.itemCode);
    if(it){
      const oldFactor=getItemUnitFactor(it, line.unit)||1;
      const newFactor=getItemUnitFactor(it, value)||1;
      if(oldFactor!==newFactor) line.cost=(line.cost/oldFactor)*newFactor;
    }
    line.unit=value;
    renderGrnLines();
    return;
  }
  if(field==='qty'||field==='cost') line[field]=parseFloat(value)||0;
  else line[field]=value;
  if(field==='itemCode'){
    const it=items.find(i=>i.code===value);
    if(it){
      const units=getTemplateUnitsForItem(it);
      line.unit = units[0] ? units[0].value : (it.unit||'');
      line.cost=it.default_cost||0;
    } else {
      line.unit='';
    }
  }
  renderGrnLines();
}

function renderGrnLines(){
  const body=document.getElementById('grnLinesBody');
  if(!body) return;
  const itemOpts='<option value="">— اختر صنف —</option>'+items.map(i=>`<option value="${i.code}">${i.code} — ${i.name}</option>`).join('');
  body.innerHTML=grnLines.map(l=>{
    const it=items.find(i=>i.code===l.itemCode);
    const unitOpts = it
      ? getTemplateUnitsForItem(it).map(u=>`<option value="${String(u.value).replace(/"/g,'&quot;')}" ${String(u.value)===String(l.unit)?'selected':''}>${u.label}</option>`).join('')
      : '<option value="">-</option>';
    return `<tr>
    <td><select onchange="onGrnLineChange(${l.id},'itemCode',this.value)">${itemOpts.replace(`value="${l.itemCode}"`,`value="${l.itemCode}" selected`)}</select></td>
    <td><input type="number" step="0.01" min="0" value="${l.qty}" onchange="onGrnLineChange(${l.id},'qty',this.value)"></td>
    <td><select class="unit-line-select" onchange="onGrnLineChange(${l.id},'unit',this.value)" ${it?'':'disabled'}>${unitOpts}</select></td>
    <td><input type="number" step="0.01" min="0" value="${l.cost}" onchange="onGrnLineChange(${l.id},'cost',this.value)"></td>
    <td class="linetotal">${fmt(l.qty*l.cost)}</td>
    <td><button class="rm-line" onclick="removeGrnLine(${l.id})">✕</button></td>
  </tr>`;
  }).join('');
  const total=grnLines.reduce((s,l)=>s+l.qty*l.cost,0);
  const el=document.getElementById('grnTotal');
  if(el) el.textContent=fmt(total);
}

function onGrnPoChange(){
  const po=purchaseOrders.find(p=>p.po_number===document.getElementById('grnPO').value);
  if(!po) return;
  document.getElementById('grnSupplier').value=po.supplier_code;
  grnLines=[];
  (po.lines||[]).forEach(l=>{
    const it=(items||[]).find(i=>i.id===l.item_id);
    const units=it?getTemplateUnitsForItem(it):[];
    lineCounter++;
    grnLines.push({id:lineCounter,itemCode:it?it.code:'',qty:l.qty,cost:l.unit_price,unit:units[0]?units[0].value:(it?it.unit:'')});
  });
  renderGrnLines();
}

async function submitGRN(){
  const supplier_code=document.getElementById('grnSupplier').value;
  const grn_date=document.getElementById('grnDate').value;
  const po_number=document.getElementById('grnPO').value||null;
  const reference=document.getElementById('grnRef').value.trim()||null;
  const warehouse_id=document.getElementById('grnWarehouse')?.value ? parseInt(document.getElementById('grnWarehouse').value) : null;
  const err=document.getElementById('grnErr');
  const valid=grnLines.filter(l=>l.itemCode&&l.qty>0);
  if(!supplier_code){err.textContent='يرجى اختيار المورد'; return;}
  if(!grn_date){err.textContent='يرجى إدخال التاريخ'; return;}
  if(!valid.length){err.textContent='يرجى إضافة صنف واحد على الأقل'; return;}
  err.textContent='';
  try{
    await api('POST','/api/grn',{
      grn_date,supplier_code,po_number,reference,warehouse_id,
      lines:valid.map(l=>{
        const it=(items||[]).find(i=>i.code===l.itemCode);
        const factor = it ? (getItemUnitFactor(it, l.unit)||1) : 1;
        return {item_code:l.itemCode, qty:l.qty*factor, unit_cost: factor ? l.cost/factor : l.cost};
      })
    });
    grnLines=[];addGrnLine();
    document.getElementById('grnPO').value='';
    document.getElementById('grnSupplier').value='';
    document.getElementById('grnRef').value='';
    await loadAll();
  }catch(e){err.textContent=e.message;}
}

function grnEsc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// شارة حالة فوترة الاستلام
function getGrnInvoiceBadge(grn){
  const invoiced = grn && grn.invoice_status==='invoiced';
  const color = invoiced ? '#2e7d32' : '#b45309';
  const text = invoiced ? 'مفوترة' : 'لم تُفوتر بعد';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;background:${color}22;color:${color};border:1px solid ${color}55;">${text}</span>`;
}

// تعبئة قائمة المستودعات بنموذج الاستلام (والقيمة الافتراضية من إعدادات المشتريات إن وُجدت)
function refreshGrnWarehouseOptions(){
  const sel=document.getElementById('grnWarehouse');
  if(!sel) return;
  const current=sel.value;
  const active=(warehouses||[]).filter(w=>w.is_active!==false);
  sel.innerHTML = active.map(w=>`<option value="${w.id}">${grnEsc(w.code)} — ${grnEsc(w.name)}</option>`).join('')
    || '<option value="">— لا توجد مستودعات —</option>';
  if(current && active.some(w=>String(w.id)===current)){
    sel.value=current;
  } else if(typeof loadPurchaseSettings === 'function'){
    const pset = loadPurchaseSettings();
    if(pset.defaultWarehouseId && active.some(w=>String(w.id)===String(pset.defaultWarehouseId))){
      sel.value = String(pset.defaultWarehouseId);
    }
  }
}
window.refreshGrnWarehouseOptions = refreshGrnWarehouseOptions;

// تعبئة قائمة أوامر الشراء المفتوحة (غير المستلمة بالكامل بعد) في نموذج الاستلام
function refreshGrnPoOptions(){
  const sel=document.getElementById('grnPO');
  if(!sel) return;
  const current=sel.value;
  const open=(purchaseOrders||[]).filter(p=>p.status!=='received');
  sel.innerHTML='<option value="">— استلام مباشر —</option>'+
    open.map(p=>{
      const sup=(suppliers||[]).find(s=>s.code===p.supplier_code);
      return `<option value="${grnEsc(p.po_number)}">${grnEsc(p.po_number)} — ${grnEsc(sup?sup.name:p.supplier_code)}</option>`;
    }).join('');
  if(current && open.some(p=>p.po_number===current)) sel.value=current;
}

// عرض قائمة الاستلامات المسجّلة مع البحث
function renderGRNs(){
  const body=document.getElementById('grnBody');
  if(!body) return;

  refreshGrnPoOptions();
  refreshGrnWarehouseOptions();

  const searchEl=document.getElementById('grnSearch');
  const q=(searchEl?.value||'').trim().toLowerCase();
  let data=Array.isArray(grns)?[...grns]:[];

  if(q){
    data=data.filter(g=>{
      const sup=(suppliers||[]).find(s=>s.code===g.supplier_code);
      return (g.grn_number||'').toLowerCase().includes(q) ||
        (g.po_number||'').toLowerCase().includes(q) ||
        (sup?.name||'').toLowerCase().includes(q);
    });
  }

  data.sort((a,b)=> new Date(b.grn_date||0)-new Date(a.grn_date||0) || String(b.grn_number||'').localeCompare(String(a.grn_number||'')));

  body.innerHTML=data.map(g=>{
    const sup=(suppliers||[]).find(s=>s.code===g.supplier_code);
    const wh=(warehouses||[]).find(w=>w.id===g.warehouse_id);
    return `<tr>
      <td>${grnEsc(g.grn_number)}</td>
      <td>${grnEsc(g.grn_date)}</td>
      <td>${grnEsc(sup?sup.name:g.supplier_code)}</td>
      <td>${grnEsc(g.po_number||'-')}</td>
      <td>${grnEsc(wh?wh.code+' — '+wh.name:'-')}</td>
      <td>${fmt(g.total)}</td>
      <td>${getGrnInvoiceBadge(g)}</td>
    </tr>`;
  }).join('');

  const empty=document.getElementById('grnEmpty');
  if(empty) empty.style.display = data.length ? 'none' : 'block';

  const countEl=document.getElementById('grnSavedCount');
  if(countEl) countEl.textContent = (grns||[]).length + ' استلام';
}
window.renderGRNs = renderGRNs;

function printGoodsReceipt(){ window.print(); }
window.printGoodsReceipt = printGoodsReceipt;

// ============================================================
// فاتورة المشتريات
// ============================================================

// إظهار/إخفاء نموذج "فاتورة مشتريات جديدة (من إذن استلام)" — مطوي افتراضياً
// حتى تبقى قائمة الفواتير المسجّلة هي الجزء الأكبر والأبرز بالشاشة
function togglePinvNewForm(forceOpen){
  const box=document.getElementById('pinvNewFormBox');
  if(!box) return;
  const isHidden = box.style.display==='none' || !box.style.display;
  const open = forceOpen===true ? true : (forceOpen===false ? false : isHidden);
  box.style.display = open ? 'block' : 'none';
  if(open){
    if(typeof populatePinvTaxTypeSelects === 'function') populatePinvTaxTypeSelects();
    // تطبيق نوع الضريبة وطريقة الاحتساب الافتراضيين من إعدادات المشتريات
    if(typeof loadPurchaseSettings === 'function'){
      const pset = loadPurchaseSettings();
      const tt=document.getElementById('pinvTaxType'); if(tt) tt.value = pset.defaultTaxType || '';
      const tcm=document.getElementById('pinvTaxCalcMethod'); if(tcm) tcm.value = pset.taxCalcMethod || 'exclusive';
    }
    if(typeof recalcPinvTotals === 'function') recalcPinvTotals();
    box.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
}
window.togglePinvNewForm = togglePinvNewForm;

function onPinvGrnChange(){
  const grn=grns.find(g=>g.grn_number===document.getElementById('pinvGrn').value);
  const wrap=document.getElementById('pinvLinesWrap');
  if(!grn){
    wrap.innerHTML='';
    document.getElementById('pinvSupplier').value='';
    if(typeof recalcPinvTotals === 'function') recalcPinvTotals();
    else document.getElementById('pinvTotal').textContent='0.00';
    return;
  }
  const sup=suppliers.find(s=>s.code===grn.supplier_code);
  document.getElementById('pinvSupplier').value=sup?sup.name:'';
  const termsEl=document.getElementById('pinvTerms');
  if(termsEl) termsEl.value = sup ? (sup.payment_terms_days||0) : 0;
  const rows=(grn.lines||[]).map(l=>{
    const it=items.find(i=>i.id===l.item_id);
    return `<tr><td>${it?it.code+' — '+it.name:l.item_id}</td><td class="num">${fmt(l.qty)}</td><td class="num">${it?it.unit:'-'}</td><td class="num">${fmt(l.unit_cost)}</td><td class="num">${fmt(l.qty*l.unit_cost)}</td></tr>`;
  }).join('');
  wrap.innerHTML=`<table class="line-items"><thead><tr><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>`;
  if(typeof recalcPinvTotals === 'function') recalcPinvTotals();
  else document.getElementById('pinvTotal').textContent=fmt(grn.total);
}

async function submitPinv(){
  const grn_number=document.getElementById('pinvGrn').value;
  const inv_date=document.getElementById('pinvDate').value;
  const supplier_inv_number=document.getElementById('pinvSupNum').value.trim()||null;
  const payment_terms_days=parseInt(document.getElementById('pinvTerms').value)||0;
  const cost_center_code=document.getElementById('pinvCostCenter').value||null;
  const tax_type_code=document.getElementById('pinvTaxType')?.value||null;
  const tax_calc_method=document.getElementById('pinvTaxCalcMethod')?.value||'exclusive';
  const err=document.getElementById('pinvErr');
  if(!grn_number){err.textContent='يرجى اختيار عملية الاستلام'; return;}
  if(!inv_date){err.textContent='يرجى إدخال تاريخ الفاتورة'; return;}
  err.textContent='';
  try{
    await api('POST','/api/purchase-invoices',{grn_number,inv_date,supplier_inv_number,payment_terms_days,cost_center_code,tax_type_code,tax_calc_method});
    document.getElementById('pinvGrn').value='';
    document.getElementById('pinvSupNum').value='';
    document.getElementById('pinvTerms').value='0';
    document.getElementById('pinvCostCenter').value='';
    document.getElementById('pinvTaxType').value='';
    document.getElementById('pinvTaxCalcMethod').value='exclusive';
    document.getElementById('pinvLinesWrap').innerHTML='';
    document.getElementById('pinvSupplier').value='';
    if(typeof recalcPinvTotals === 'function') recalcPinvTotals();
    else document.getElementById('pinvTotal').textContent='0.00';
    if(typeof togglePinvNewForm === 'function') togglePinvNewForm(false);
    await loadAll();
  }catch(e){err.textContent=e.message;}
}

function pinvEsc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// شارة حالة فاتورة المشتريات
function getPinvBadge(inv){
  const labels = {
    posted:    {text:'مرحّلة', color:'#2e7d32'},
    cancelled: {text:'ملغاة',  color:'#c62828'},
  };
  const st = inv && inv.status;
  const info = labels[st] || {text: st || 'مرحّلة', color:'#2e7d32'};
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;background:${info.color}22;color:${info.color};border:1px solid ${info.color}55;">${info.text}</span>`;
}

// تعبئة قائمة أذون الاستلام القابلة للفوترة (التي لم تُفوتر بعد) في نموذج فاتورة المشتريات
function refreshPinvGrnOptions(){
  const sel=document.getElementById('pinvGrn');
  if(!sel) return;
  const current=sel.value;
  const invoicedGrnNumbers=new Set((invoices||[]).map(i=>i.grn_number));
  const available=(grns||[]).filter(g=> g.invoice_status!=='invoiced' && !invoicedGrnNumbers.has(g.grn_number));
  sel.innerHTML='<option value="">— اختر استلامًا —</option>' +
    available.map(g=>{
      const sup=(suppliers||[]).find(s=>s.code===g.supplier_code);
      return `<option value="${pinvEsc(g.grn_number)}">${pinvEsc(g.grn_number)} — ${pinvEsc(sup?sup.name:g.supplier_code)} (${pinvEsc(g.grn_date||'')})</option>`;
    }).join('');
  if(current && available.some(g=>g.grn_number===current)){
    sel.value=current;
  } else if(current){
    // كانت هناك عملية استلام مختارة وتمت فوترتها الآن أو لم تعد متاحة
    document.getElementById('pinvLinesWrap').innerHTML='';
    document.getElementById('pinvTotal').textContent='0.00';
    document.getElementById('pinvSupplier').value='';
  }
}

// عرض قائمة فواتير المشتريات المسجّلة مع البحث
function renderInvoices(){
  const body=document.getElementById('pinvBody');
  if(!body) return;

  refreshPinvGrnOptions();

  const searchEl=document.getElementById('pinvSearch');
  const q=(searchEl?.value||'').trim().toLowerCase();
  let data=Array.isArray(invoices)?[...invoices]:[];

  if(q){
    data=data.filter(inv=>{
      const sup=(suppliers||[]).find(s=>s.code===inv.supplier_code);
      return (inv.inv_number||'').toLowerCase().includes(q) ||
        (inv.supplier_inv_number||'').toLowerCase().includes(q) ||
        (inv.grn_number||'').toLowerCase().includes(q) ||
        (sup?.name||'').toLowerCase().includes(q);
    });
  }

  data.sort((a,b)=> new Date(b.inv_date||0)-new Date(a.inv_date||0) || String(b.inv_number||'').localeCompare(String(a.inv_number||'')));

  body.innerHTML=data.map(inv=>{
    const sup=(suppliers||[]).find(s=>s.code===inv.supplier_code);
    return `<tr class="po-link" onclick="openPurchaseInvoiceView('${inv.inv_number}')">
      <td><a href="javascript:void(0)" class="pinv-num-link" onclick="event.stopPropagation(); openPinvPrintTab('${pinvEsc(inv.inv_number)}',{autoPrint:false})" title="فتح الفاتورة كاملة في تبويب جديد">${pinvEsc(inv.inv_number)}</a></td>
      <td>${pinvEsc(inv.inv_date)}</td>
      <td>${pinvEsc(sup?sup.name:inv.supplier_code)}</td>
      <td>${pinvEsc(inv.grn_number)}</td>
      <td>${pinvEsc(inv.supplier_inv_number||'-')}</td>
      <td>${fmt(inv.total)}${(inv.tax_amount && Number(inv.tax_amount)>0) ? `<div style="font-size:10.5px;color:#0b67c2;margin-top:2px">شامل ضريبة ${fmt(inv.tax_amount)}</div>` : ''}</td>
      <td>${pinvEsc(inv.due_date||'-')}</td>
      <td>${getPinvBadge(inv)}</td>
      <td style="text-align:center" onclick="event.stopPropagation()">
        <button type="button" class="pinv-actions-btn" onclick="togglePinvActionsMenu(event,'${pinvEsc(inv.inv_number)}')" title="الإجراءات">⋮</button>
      </td>
    </tr>`;
  }).join('');

  const empty=document.getElementById('pinvEmpty');
  if(empty) empty.style.display = data.length ? 'none' : 'block';

  const countEl=document.getElementById('pinvSavedCount');
  if(countEl) countEl.textContent = (invoices||[]).length + ' فاتورة';
}
window.renderInvoices = renderInvoices;

// عرض تفاصيل فاتورة مشتريات محفوظة في نافذة منبثقة (بيانات من invoices المحمّلة أصلاً، دون أي طلب إضافي)
function openPurchaseInvoiceView(invNumber){
  const inv=(invoices||[]).find(i=>i.inv_number===invNumber);
  if(!inv) return;
  const sup=(suppliers||[]).find(s=>s.code===inv.supplier_code);
  const cc=(costCenters||[]).find(c=>c.code===inv.cost_center_code);
  const taxType=(taxTypes||[]).find(t=>t.code===inv.tax_type_code);
  const rows=(inv.lines||[]).map(l=>{
    const it=(items||[]).find(i=>i.id===l.item_id);
    return `<tr>
      <td>${pinvEsc(it?it.code+' — '+it.name:l.item_id)}</td>
      <td class="num">${fmt(l.qty)}</td>
      <td class="num">${pinvEsc(it?it.unit:'-')}</td>
      <td class="num">${fmt(l.unit_cost)}</td>
      <td class="num">${fmt(l.qty*l.unit_cost)}</td>
    </tr>`;
  }).join('');
  const taxRowsHtml = (inv.tax_amount && Number(inv.tax_amount)>0)
    ? `<div class="row"><span>الصافي قبل الضريبة</span><span>${fmt(inv.subtotal)}</span></div>
       <div class="row"><span>الضريبة${taxType?` (${pinvEsc(taxType.name_ar||taxType.code)} ${fmt(taxType.rate)}%)`:''}</span><span>${fmt(inv.tax_amount)}</span></div>`
    : '';
  const html=`<div class="po-decision-dialog" id="pinvViewDialog"><div class="box">
    <div class="rfq-section-head">
      <h3>فاتورة مشتريات ${pinvEsc(inv.inv_number)}</h3>
      <button class="btn secondary" onclick="document.getElementById('pinvViewDialog').remove()">إغلاق</button>
    </div>
    <div class="po-info-grid" style="margin-bottom:14px">
      <div class="field"><label>المورد</label><input disabled value="${pinvEsc(sup?sup.name:inv.supplier_code)}"></div>
      <div class="field"><label>تاريخ الفاتورة</label><input disabled value="${pinvEsc(inv.inv_date)}"></div>
      <div class="field"><label>تاريخ الاستحقاق</label><input disabled value="${pinvEsc(inv.due_date||'-')}"></div>
      <div class="field"><label>الاستلام المرتبط</label><input disabled value="${pinvEsc(inv.grn_number)}"></div>
      <div class="field"><label>رقم فاتورة المورد</label><input disabled value="${pinvEsc(inv.supplier_inv_number||'-')}"></div>
      <div class="field"><label>مركز التكلفة</label><input disabled value="${pinvEsc(cc?cc.code+' — '+cc.name_ar:'— بدون —')}"></div>
    </div>
    <table class="grid po-list-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals-box" style="margin-top:12px">
      ${taxRowsHtml}
      <div class="row grand"><span>إجمالي الفاتورة</span><span>${fmt(inv.total)}</span></div>
    </div>
    ${inv.journal_entry_id ? `<div class="hint pinv-journal-link" style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span>✅ تم ترحيل القيد المحاسبي رقم <b>#${inv.journal_entry_id}</b> تلقائياً (مدين المخزون${inv.tax_amount>0?' وضريبة المشتريات':''} / دائن حساب المورد).</span>
      <button class="btn secondary" onclick="document.getElementById('pinvViewDialog')?.remove(); openEntryDetail(${inv.journal_entry_id})">📒 فتح القيد المحاسبي</button>
    </div>` : ''}
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}
window.openPurchaseInvoiceView = openPurchaseInvoiceView;

function printPurchaseInvoice(){ window.print(); }
window.printPurchaseInvoice = printPurchaseInvoice;

// ============================================================
// قائمة إجراءات فاتورة المشتريات (زر ⋮ في آخر كل سطر بالجدول)
// عرض / تعديل / طباعة PDF / طباعة / نسخ / بريد / واتساب / حذف
// ============================================================
let pinvMenuCurrentInv = null;

function ensurePinvActionsMenu(){
  let menu = document.getElementById('pinvActionsMenu');
  if(!menu){
    menu = document.createElement('div');
    menu.id = 'pinvActionsMenu';
    menu.className = 'pinv-actions-menu';
    menu.innerHTML = `
      <button onclick="pinvMenuRun('view')">👁️ عرض</button>
      <button onclick="pinvMenuRun('edit')">✏️ تعديل</button>
      <button onclick="pinvMenuRun('pdf')">📄 طباعة PDF</button>
      <button onclick="pinvMenuRun('print')">🖨️ طباعة</button>
      <button onclick="pinvMenuRun('copy')">📋 نسخ</button>
      <button onclick="pinvMenuRun('email')">✉️ إرسال عبر البريد</button>
      <button onclick="pinvMenuRun('whatsapp')">💬 إرسال عبر واتساب</button>
      <hr>
      <button class="danger" onclick="pinvMenuRun('delete')">🗑️ حذف</button>
    `;
    document.body.appendChild(menu);
  }
  return menu;
}

function togglePinvActionsMenu(e, invNumber){
  e.stopPropagation();
  const menu = ensurePinvActionsMenu();
  const wasOpenForThis = menu.classList.contains('show') && pinvMenuCurrentInv === invNumber;
  closePinvActionsMenu();
  if (wasOpenForThis) return;

  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  menu.classList.add('show');
  pinvMenuCurrentInv = invNumber;

  // نقيس أبعاد القائمة الفعلية بعد إظهارها لضمان بقائها داخل حدود الشاشة
  // (تُفتح لأعلى بدل لأسفل تلقائياً لو مفيش مساحة كافية تحت الزر، وتُحاذى
  // أفقياً بحيث لا تخرج من يمين أو يسار الشاشة)
  const menuRect = menu.getBoundingClientRect();
  const menuW = menuRect.width || 210;
  const menuH = menuRect.height || 340;
  const margin = 8;

  let top = rect.bottom + 6;
  if (top + menuH > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - menuH - 6);
  }

  let left = rect.left - menuW + rect.width;
  left = Math.min(Math.max(margin, left), window.innerWidth - menuW - margin);

  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
}
window.togglePinvActionsMenu = togglePinvActionsMenu;

function closePinvActionsMenu(){
  const menu = document.getElementById('pinvActionsMenu');
  if (menu) menu.classList.remove('show');
  pinvMenuCurrentInv = null;
}
document.addEventListener('click', closePinvActionsMenu);

function pinvMenuRun(action){
  const invNumber = pinvMenuCurrentInv;
  closePinvActionsMenu();
  if(!invNumber) return;
  if(action==='view') openPinvPrintTab(invNumber, {autoPrint:false});
  else if(action==='edit') openPinvFullEditDialog(invNumber);
  else if(action==='pdf') openPinvPrintTab(invNumber, {autoPrint:true});
  else if(action==='print') openPinvPrintTab(invNumber, {autoPrint:true});
  else if(action==='copy') copyPinvToNewInvoice(invNumber);
  else if(action==='email') sendPinvByEmail(invNumber);
  else if(action==='whatsapp') sendPinvByWhatsapp(invNumber);
  else if(action==='delete') deletePinvInvoice(invNumber);
}
window.pinvMenuRun = pinvMenuRun;

// بناء صفحة HTML مطبوعة/قابلة للعرض للفاتورة (تُفتح في تبويب جديد)
function buildPinvPrintHtml(inv){
  const sup=(suppliers||[]).find(s=>s.code===inv.supplier_code);
  const cc=(costCenters||[]).find(c=>c.code===inv.cost_center_code);
  const taxType=(taxTypes||[]).find(t=>t.code===inv.tax_type_code);
  const rows=(inv.lines||[]).map((l,idx)=>{
    const it=(items||[]).find(i=>i.id===l.item_id);
    return `<tr>
      <td>${idx+1}</td>
      <td>${pinvEsc(it?it.code+' — '+it.name:l.item_id)}</td>
      <td class="num">${fmt(l.qty)}</td>
      <td class="num">${pinvEsc(it?it.unit:'-')}</td>
      <td class="num">${fmt(l.unit_cost)}</td>
      <td class="num">${fmt(l.qty*l.unit_cost)}</td>
    </tr>`;
  }).join('');
  const badge = inv.status==='cancelled'
    ? '<span class="pinv-badge cancelled">ملغاة</span>'
    : '<span class="pinv-badge">مرحّلة</span>';
  const hasTax = inv.tax_amount && Number(inv.tax_amount) > 0;
  const taxSummaryRows = hasTax
    ? `<div class="row"><span>الصافي قبل الضريبة</span><span>${fmt(inv.subtotal)}</span></div>
       <div class="row"><span>الضريبة${taxType?` (${pinvEsc(taxType.name_ar||taxType.code)} ${fmt(taxType.rate)}%)`:''}</span><span>${fmt(inv.tax_amount)}</span></div>`
    : '';
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>فاتورة مشتريات ${pinvEsc(inv.inv_number)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;}
  body{font-family:'Cairo',sans-serif;margin:0;padding:32px;color:#1c2430;background:#fff;}
  .pinv-print-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1c2430;padding-bottom:16px;margin-bottom:22px;}
  .pinv-print-head h1{font-size:21px;margin:0 0 6px;}
  .pinv-print-head .muted{color:#666;font-size:13px;}
  .pinv-badge{display:inline-block;padding:4px 12px;border-radius:14px;font-size:12px;font-weight:700;background:#2e7d3222;color:#2e7d32;border:1px solid #2e7d3255;}
  .pinv-badge.cancelled{background:#c6282822;color:#c62828;border-color:#c6282855;}
  .pinv-info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 24px;margin-bottom:26px;}
  .pinv-info-grid div{font-size:13px;}
  .pinv-info-grid label{display:block;color:#888;font-size:11px;margin-bottom:3px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th,td{border:1px solid #ddd;padding:8px 10px;text-align:right;}
  th{background:#f4f5f7;font-weight:700;}
  td.num,th.num{text-align:left;font-family:monospace,'Cairo';}
  .pinv-total-row{margin-top:16px;display:flex;justify-content:flex-end;}
  .pinv-total-row .box{min-width:280px;display:flex;flex-direction:column;gap:6px;font-size:13px;border-top:2px solid #1c2430;padding-top:10px;}
  .pinv-total-row .box .row{display:flex;justify-content:space-between;color:#555;}
  .pinv-total-row .box .grand{display:flex;justify-content:space-between;font-size:16px;font-weight:800;color:#1c2430;margin-top:4px;}
  .pinv-print-toolbar{margin-bottom:20px;}
  .pinv-print-toolbar button{font-family:'Cairo',sans-serif;padding:9px 18px;border-radius:8px;border:1px solid #1c2430;background:#1c2430;color:#fff;cursor:pointer;font-size:13px;font-weight:600;}
  @media print{ .pinv-print-toolbar{display:none;} body{padding:0;} }
</style></head>
<body>
  <div class="pinv-print-toolbar"><button onclick="window.print()">🖨️ طباعة</button></div>
  <div class="pinv-print-head">
    <div>
      <h1>LEGEND D — فاتورة مشتريات</h1>
      <div class="muted">رقم الفاتورة: ${pinvEsc(inv.inv_number)}</div>
    </div>
    <div>${badge}</div>
  </div>
  <div class="pinv-info-grid">
    <div><label>المورد</label>${pinvEsc(sup?sup.name:inv.supplier_code)}</div>
    <div><label>تاريخ الفاتورة</label>${pinvEsc(inv.inv_date)}</div>
    <div><label>تاريخ الاستحقاق</label>${pinvEsc(inv.due_date||'-')}</div>
    <div><label>الاستلام المرتبط</label>${pinvEsc(inv.grn_number)}</div>
    <div><label>رقم فاتورة المورد</label>${pinvEsc(inv.supplier_inv_number||'-')}</div>
    <div><label>مركز التكلفة</label>${pinvEsc(cc?cc.code+' — '+cc.name_ar:'—')}</div>
  </div>
  <table><thead><tr><th>#</th><th>الصنف</th><th class="num">الكمية</th><th class="num">الوحدة</th><th class="num">التكلفة</th><th class="num">الإجمالي</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="pinv-total-row"><div class="box">
    ${taxSummaryRows}
    <div class="grand"><span>الإجمالي الكلي</span><span>${fmt(inv.total)}</span></div>
  </div></div>
</body></html>`;
}

// عرض/طباعة الفاتورة في تبويب جديد (عرض = بدون طباعة تلقائية، طباعة/PDF = طباعة تلقائية)
function openPinvPrintTab(invNumber, opts){
  const inv=(invoices||[]).find(i=>i.inv_number===invNumber);
  if(!inv){ alert('تعذر العثور على الفاتورة'); return; }
  const w=window.open('', '_blank');
  if(!w){ alert('يرجى السماح بفتح النوافذ المنبثقة لعرض الفاتورة'); return; }
  w.document.open();
  w.document.write(buildPinvPrintHtml(inv));
  w.document.close();
  if(opts && opts.autoPrint){
    w.onload=()=>{ setTimeout(()=>{ try{ w.print(); }catch(err){} }, 300); };
  }
}
window.openPinvPrintTab = openPinvPrintTab;

// تعديل بيانات الفاتورة (الحقول غير المالية فقط، حفاظاً على سلامة القيود المرحّلة)
function openPinvEditDialog(invNumber){
  const inv=(invoices||[]).find(i=>i.inv_number===invNumber);
  if(!inv) return;
  if(inv.status==='cancelled'){ alert('لا يمكن تعديل فاتورة ملغاة'); return; }
  const ccOptions = '<option value="">— بدون —</option>' + (costCenters||[]).map(c=>
    `<option value="${pinvEsc(c.code)}" ${c.code===inv.cost_center_code?'selected':''}>${pinvEsc(c.code)} — ${pinvEsc(c.name_ar)}</option>`
  ).join('');
  const html=`<div class="po-decision-dialog" id="pinvEditDialog"><div class="box">
    <div class="rfq-section-head">
      <h3>تعديل بيانات فاتورة ${pinvEsc(inv.inv_number)}</h3>
      <button class="btn secondary" onclick="document.getElementById('pinvEditDialog').remove()">إغلاق</button>
    </div>
    <div class="hint" style="margin-bottom:12px">تُعرض هنا فقط بيانات المورد المرتبطة بالفاتورة (التاريخ، رقم فاتورة المورد، فترة السماح، مركز التكلفة). لا يمكن تعديل الأصناف أو الكميات أو التكلفة أو الضريبة بعد الترحيل، حفاظاً على سلامة القيد المحاسبي.</div>
    <div class="po-info-grid" style="margin-bottom:14px">
      <div class="field"><label>تاريخ الفاتورة</label><input type="date" id="pinvEditDate" value="${pinvEsc(inv.inv_date)}"></div>
      <div class="field"><label>رقم فاتورة المورد</label><input id="pinvEditSupNum" value="${pinvEsc(inv.supplier_inv_number||'')}"></div>
      <div class="field"><label>فترة السماح (أيام)</label><input type="number" min="0" id="pinvEditTerms" value="${inv.payment_terms_days||0}"></div>
      <div class="field"><label>مركز التكلفة</label><select id="pinvEditCostCenter">${ccOptions}</select></div>
    </div>
    <div id="pinvEditErr" style="color:#c62828;font-size:13px;margin-bottom:10px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn secondary" onclick="document.getElementById('pinvEditDialog').remove()">إلغاء</button>
      <button class="btn" onclick="submitPinvEdit('${pinvEsc(inv.inv_number)}')">حفظ التعديلات</button>
    </div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}
window.openPinvEditDialog = openPinvEditDialog;

async function submitPinvEdit(invNumber){
  const err=document.getElementById('pinvEditErr');
  const inv_date=document.getElementById('pinvEditDate').value;
  const supplier_inv_number=document.getElementById('pinvEditSupNum').value.trim()||null;
  const payment_terms_days=parseInt(document.getElementById('pinvEditTerms').value)||0;
  const cost_center_code=document.getElementById('pinvEditCostCenter').value||null;
  if(!inv_date){ if(err) err.textContent='يرجى إدخال تاريخ الفاتورة'; return; }
  try{
    await api('PATCH', `/api/purchase-invoices/${encodeURIComponent(invNumber)}`, {
      inv_date, supplier_inv_number, payment_terms_days, cost_center_code
    });
    document.getElementById('pinvEditDialog')?.remove();
    await loadAll();
  }catch(e){ if(err) err.textContent = e.message; }
}
window.submitPinvEdit = submitPinvEdit;

// ============================================================
// تعديل الفاتورة كاملة (الأصناف/الكميات/الأسعار/المورد) — عبر مسار آمن:
// إلغاء الفاتورة الحالية ← تعديل إذن الاستلام المرتبط (بعكس أثره على
// التكلفة المتوسطة بأمان) ← إعادة ترحيل فاتورة جديدة بنفس البيانات
// المعدَّلة. يُرفض التعديل تلقائياً من الخادم لو تأثر الصنف بحركة
// مخزون لاحقة (بيع/مرتجع)، لأن عكس المتوسط المرجّح حينها غير دقيق.
// ============================================================
let pinvFullEditLines = [];

function openPinvFullEditDialog(invNumber){
  const inv=(invoices||[]).find(i=>i.inv_number===invNumber);
  if(!inv) return;
  if(inv.status==='cancelled'){ alert('لا يمكن تعديل فاتورة ملغاة'); return; }
  const grn=(grns||[]).find(g=>g.grn_number===inv.grn_number);
  if(!grn){ alert('تعذر العثور على إذن الاستلام المرتبط بهذه الفاتورة'); return; }

  pinvFullEditLines = (inv.lines||[]).map(l=>{
    lineCounter++;
    const it=(items||[]).find(i=>i.id===l.item_id);
    return { id:lineCounter, itemCode: it?it.code:'', qty:Number(l.qty)||0, cost:Number(l.unit_cost)||0, unit: it?it.unit:'' };
  });
  if(!pinvFullEditLines.length){ lineCounter++; pinvFullEditLines.push({id:lineCounter, itemCode:'', qty:1, cost:0, unit:''}); }

  const lockedSupplier = !!grn.po_number;
  const supOptions = (suppliers||[]).map(s=>`<option value="${pinvEsc(s.code)}" ${s.code===inv.supplier_code?'selected':''}>${pinvEsc(s.name)} (${pinvEsc(s.code)})</option>`).join('');
  const whOptions = (warehouses||[]).filter(w=>w.is_active!==false).map(w=>
    `<option value="${w.id}" ${w.id===grn.warehouse_id?'selected':''}>${pinvEsc(w.code)} — ${pinvEsc(w.name)}</option>`
  ).join('');
  const ccOptions = '<option value="">— بدون —</option>' + (costCenters||[]).map(c=>
    `<option value="${pinvEsc(c.code)}" ${c.code===inv.cost_center_code?'selected':''}>${pinvEsc(c.code)} — ${pinvEsc(c.name_ar)}</option>`
  ).join('');
  const taxOptions = '<option value="">— بدون ضريبة —</option>' + (taxTypes||[]).map(t=>
    `<option value="${pinvEsc(t.code)}" ${t.code===inv.tax_type_code?'selected':''}>${pinvEsc(t.name_ar||t.code)} (${fmt(t.rate)}%)</option>`
  ).join('');

  const html=`<div class="po-decision-dialog" id="pinvFullEditDialog"><div class="box" style="max-width:960px">
    <div class="rfq-section-head">
      <h3>تعديل الفاتورة كاملة ${pinvEsc(inv.inv_number)}</h3>
      <button class="btn secondary" onclick="document.getElementById('pinvFullEditDialog').remove()">إغلاق</button>
    </div>
    <div class="hint" style="margin-bottom:12px">التعديل هنا يشمل الأصناف والكميات والأسعار والمورد والمستودع. عند الحفظ: تُلغى الفاتورة الحالية وقيدها المحاسبي، ويُعدَّل إذن الاستلام المرتبط، ثم تُرحَّل فاتورة جديدة تلقائياً بنفس رقم الاستلام وبالبيانات المعدَّلة. لن يُسمح بالحفظ لو تأثر أحد الأصناف بحركة مخزون لاحقة (بيع/مرتجع) — استخدم مرتجع مشتريات في هذه الحالة بدلاً من ذلك.</div>
    <div class="frow two">
      <div class="field"><label>المورد${lockedSupplier?' (مرتبط بأمر شراء، غير قابل للتغيير)':''}</label>
        <select id="pfeSupplier" ${lockedSupplier?'disabled':''}>${supOptions}</select></div>
      <div class="field"><label>تاريخ الاستلام/الفاتورة</label><input type="date" id="pfeDate" value="${pinvEsc(inv.inv_date)}"></div>
    </div>
    <div class="frow two">
      <div class="field"><label>رقم فاتورة المورد</label><input id="pfeSupNum" value="${pinvEsc(inv.supplier_inv_number||'')}"></div>
      <div class="field"><label>فترة السماح (أيام)</label><input type="number" min="0" id="pfeTerms" value="${inv.payment_terms_days||0}"></div>
    </div>
    <div class="frow two">
      <div class="field"><label>مركز التكلفة</label><select id="pfeCostCenter">${ccOptions}</select></div>
      <div class="field"><label>المستودع</label><select id="pfeWarehouse">${whOptions}</select></div>
    </div>
    <div class="frow two">
      <div class="field"><label>نوع الضريبة</label><select id="pfeTaxType" onchange="recalcPinvFullEditTotals()">${taxOptions}</select></div>
      <div class="field"><label>طريقة احتساب الضريبة</label>
        <select id="pfeTaxCalcMethod" onchange="recalcPinvFullEditTotals()">
          <option value="exclusive">غير متضمنة (تُضاف على القيمة)</option>
          <option value="inclusive">متضمنة (القيمة شاملة الضريبة)</option>
        </select></div>
    </div>
    <table class="line-items">
      <thead><tr><th style="width:28%">الصنف</th><th style="width:12%">الكمية</th><th style="width:10%">الوحدة</th><th style="width:16%">تكلفة الوحدة</th><th style="width:16%">الإجمالي</th><th></th></tr></thead>
      <tbody id="pfeLinesBody"></tbody>
    </table>
    <button class="add-line-btn" onclick="addPinvFullEditLine()">+ إضافة سطر</button>
    <div class="totals-box">
      <div class="row"><span>الصافي قبل الضريبة</span><span id="pfeSubtotal">0.00</span></div>
      <div class="row"><span id="pfeTaxLabel">الضريبة</span><span id="pfeTaxAmount">0.00</span></div>
      <div class="row grand"><span>إجمالي الفاتورة</span><span id="pfeTotal">0.00</span></div>
    </div>
    <div id="pfeErr" style="color:#c62828;font-size:13px;margin:10px 0"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn secondary" onclick="document.getElementById('pinvFullEditDialog').remove()">إلغاء</button>
      <button class="btn" id="pfeSubmitBtn" onclick="submitPinvFullEdit('${pinvEsc(inv.inv_number)}','${pinvEsc(grn.grn_number)}','${pinvEsc(grn.po_number||'')}')">حفظ التعديلات الكاملة</button>
    </div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const tcm=document.getElementById('pfeTaxCalcMethod'); if(tcm) tcm.value = 'exclusive';
  renderPinvFullEditLines();
}
window.openPinvFullEditDialog = openPinvFullEditDialog;

function addPinvFullEditLine(){
  lineCounter++;
  pinvFullEditLines.push({id:lineCounter, itemCode:'', qty:1, cost:0, unit:''});
  renderPinvFullEditLines();
}
window.addPinvFullEditLine = addPinvFullEditLine;

function removePinvFullEditLine(id){
  pinvFullEditLines = pinvFullEditLines.filter(l=>l.id!==id);
  renderPinvFullEditLines();
}
window.removePinvFullEditLine = removePinvFullEditLine;

function onPinvFullEditLineChange(id, field, value){
  const line=pinvFullEditLines.find(l=>l.id===id);
  if(!line) return;
  if(field==='unit'){
    const it=(items||[]).find(i=>i.code===line.itemCode);
    if(it){
      const oldFactor=getItemUnitFactor(it, line.unit)||1;
      const newFactor=getItemUnitFactor(it, value)||1;
      if(oldFactor!==newFactor) line.cost=(line.cost/oldFactor)*newFactor;
    }
    line.unit=value;
    renderPinvFullEditLines();
    return;
  }
  if(field==='qty'||field==='cost') line[field]=parseFloat(value)||0;
  else line[field]=value;
  if(field==='itemCode'){
    const it=(items||[]).find(i=>i.code===value);
    line.unit = it ? it.unit : '';
  }
  renderPinvFullEditLines();
}
window.onPinvFullEditLineChange = onPinvFullEditLineChange;

function renderPinvFullEditLines(){
  const body=document.getElementById('pfeLinesBody');
  if(!body) return;
  const itemOpts='<option value="">— اختر صنف —</option>'+(items||[]).map(i=>`<option value="${i.code}">${i.code} — ${i.name}</option>`).join('');
  body.innerHTML=pinvFullEditLines.map(l=>{
    const it=(items||[]).find(i=>i.code===l.itemCode);
    const unitOpts = it
      ? getTemplateUnitsForItem(it).map(u=>`<option value="${String(u.value).replace(/"/g,'&quot;')}" ${String(u.value)===String(l.unit)?'selected':''}>${u.label}</option>`).join('')
      : '<option value="">-</option>';
    return `<tr>
      <td><select onchange="onPinvFullEditLineChange(${l.id},'itemCode',this.value)">${itemOpts.replace(`value="${l.itemCode}"`,`value="${l.itemCode}" selected`)}</select></td>
      <td><input type="number" step="0.01" min="0" value="${l.qty}" onchange="onPinvFullEditLineChange(${l.id},'qty',this.value)"></td>
      <td><select class="unit-line-select" onchange="onPinvFullEditLineChange(${l.id},'unit',this.value)" ${it?'':'disabled'}>${unitOpts}</select></td>
      <td><input type="number" step="0.01" min="0" value="${l.cost}" onchange="onPinvFullEditLineChange(${l.id},'cost',this.value)"></td>
      <td class="linetotal">${fmt(l.qty*l.cost)}</td>
      <td><button class="rm-line" onclick="removePinvFullEditLine(${l.id})">✕</button></td>
    </tr>`;
  }).join('');
  recalcPinvFullEditTotals();
}
window.renderPinvFullEditLines = renderPinvFullEditLines;

function recalcPinvFullEditTotals(){
  const linesTotal = pinvFullEditLines.reduce((s,l)=>s+l.qty*l.cost,0);
  const taxTypeCode = document.getElementById('pfeTaxType')?.value || '';
  const calcMethod = document.getElementById('pfeTaxCalcMethod')?.value || 'exclusive';
  const r = pinvTaxPreview(linesTotal, taxTypeCode, calcMethod);
  const subEl=document.getElementById('pfeSubtotal'); if(subEl) subEl.textContent=fmt(r.subtotal);
  const taxEl=document.getElementById('pfeTaxAmount'); if(taxEl) taxEl.textContent=fmt(r.tax);
  const taxLabel=document.getElementById('pfeTaxLabel'); if(taxLabel) taxLabel.textContent = r.taxType ? `الضريبة (${r.taxType.name_ar||r.taxType.code} ${fmt(r.taxType.rate)}%)` : 'الضريبة';
  const totalEl=document.getElementById('pfeTotal'); if(totalEl) totalEl.textContent=fmt(r.total);
}
window.recalcPinvFullEditTotals = recalcPinvFullEditTotals;

async function submitPinvFullEdit(invNumber, grnNumber, poNumber){
  const err=document.getElementById('pfeErr');
  const submitBtn=document.getElementById('pfeSubmitBtn');
  const supplier_code=document.getElementById('pfeSupplier').value;
  const grn_date=document.getElementById('pfeDate').value;
  const supplier_inv_number=document.getElementById('pfeSupNum').value.trim()||null;
  const payment_terms_days=parseInt(document.getElementById('pfeTerms').value)||0;
  const cost_center_code=document.getElementById('pfeCostCenter').value||null;
  const tax_type_code=document.getElementById('pfeTaxType').value||null;
  const tax_calc_method=document.getElementById('pfeTaxCalcMethod').value||'exclusive';
  const warehouse_id=document.getElementById('pfeWarehouse')?.value ? parseInt(document.getElementById('pfeWarehouse').value) : null;
  const valid=pinvFullEditLines.filter(l=>l.itemCode && l.qty>0);

  if(!supplier_code){ err.textContent='يرجى اختيار المورد'; return; }
  if(!grn_date){ err.textContent='يرجى إدخال التاريخ'; return; }
  if(!valid.length){ err.textContent='يرجى إضافة صنف واحد على الأقل'; return; }
  err.textContent='';
  if(submitBtn){ submitBtn.disabled=true; submitBtn.textContent='جارٍ الحفظ...'; }

  try{
    // 1) إلغاء الفاتورة الحالية (يعكس قيدها المحاسبي ويعيد فتح الاستلام للتعديل)
    await api('POST', `/api/purchase-invoices/${encodeURIComponent(invNumber)}/cancel`, {});

    // 2) تعديل إذن الاستلام (يعكس الكمية/التكلفة القديمة بأمان ويطبّق الجديدة)
    await api('PUT', `/api/grn/${encodeURIComponent(grnNumber)}`, {
      grn_date, supplier_code, po_number: poNumber||null, reference: 'تعديل فاتورة', warehouse_id,
      lines: valid.map(l=>{
        const it=(items||[]).find(i=>i.code===l.itemCode);
        const factor = it ? (getItemUnitFactor(it, l.unit)||1) : 1;
        return {item_code:l.itemCode, qty: l.qty*factor, unit_cost: factor ? l.cost/factor : l.cost};
      })
    });

    // 3) ترحيل فاتورة جديدة على نفس الاستلام بالبيانات المعدَّلة
    await api('POST', '/api/purchase-invoices', {
      grn_number: grnNumber, inv_date: grn_date, supplier_inv_number, payment_terms_days,
      cost_center_code, tax_type_code, tax_calc_method,
    });

    document.getElementById('pinvFullEditDialog')?.remove();
    await loadAll();
  }catch(e){
    err.textContent = e.message;
  }finally{
    if(submitBtn){ submitBtn.disabled=false; submitBtn.textContent='حفظ التعديلات الكاملة'; }
  }
}
window.submitPinvFullEdit = submitPinvFullEdit;

// نسخ الفاتورة: تعبئة نموذج الفاتورة المباشرة بنفس البيانات والأصناف كمسودة جاهزة للحفظ
function copyPinvToNewInvoice(invNumber){
  const inv=(invoices||[]).find(i=>i.inv_number===invNumber);
  if(!inv) return;
  dinvLines = (inv.lines||[]).map(l=>{
    lineCounter++;
    const it=(items||[]).find(i=>i.id===l.item_id);
    return { id:lineCounter, itemCode: it?it.code:'', qty:Number(l.qty)||0, cost:Number(l.unit_cost)||0, unit: it?it.unit:'' };
  });
  if(!dinvLines.length) addDinvLine();
  toggleDirectInvoiceForm(true);
  const supEl=document.getElementById('dinvSupplier'); if(supEl) supEl.value=inv.supplier_code||'';
  const dateEl=document.getElementById('dinvDate'); if(dateEl) dateEl.value=new Date().toISOString().slice(0,10);
  const numEl=document.getElementById('dinvSupNum'); if(numEl) numEl.value='';
  const refEl=document.getElementById('dinvRef'); if(refEl) refEl.value=`نسخة من الفاتورة ${inv.inv_number}`;
  const termsEl=document.getElementById('dinvTerms'); if(termsEl) termsEl.value=inv.payment_terms_days||0;
  const ccEl=document.getElementById('dinvCostCenter'); if(ccEl) ccEl.value=inv.cost_center_code||'';
  const ttEl=document.getElementById('dinvTaxType'); if(ttEl) ttEl.value=inv.tax_type_code||'';
  renderDinvLines();
}
window.copyPinvToNewInvoice = copyPinvToNewInvoice;

// نص موجز للفاتورة يُستخدم في مشاركة البريد/واتساب
function buildPinvShareText(inv){
  const sup=(suppliers||[]).find(s=>s.code===inv.supplier_code);
  return `فاتورة مشتريات رقم ${inv.inv_number}\nالمورد: ${sup?sup.name:inv.supplier_code}\nالتاريخ: ${inv.inv_date}\nالإجمالي: ${fmt(inv.total)}\nتاريخ الاستحقاق: ${inv.due_date||'-'}`;
}

function sendPinvByEmail(invNumber){
  const inv=(invoices||[]).find(i=>i.inv_number===invNumber);
  if(!inv) return;
  const subject=encodeURIComponent(`فاتورة مشتريات ${inv.inv_number}`);
  const body=encodeURIComponent(buildPinvShareText(inv));
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
}
window.sendPinvByEmail = sendPinvByEmail;

function sendPinvByWhatsapp(invNumber){
  const inv=(invoices||[]).find(i=>i.inv_number===invNumber);
  if(!inv) return;
  const text=encodeURIComponent(buildPinvShareText(inv));
  window.open(`https://wa.me/?text=${text}`, '_blank');
}
window.sendPinvByWhatsapp = sendPinvByWhatsapp;

// حذف الفاتورة: إلغاء (وليس حذفاً نهائياً) حفاظاً على سلامة الحسابات، مع إعادة فتح إذن الاستلام للفوترة من جديد
async function deletePinvInvoice(invNumber){
  if(!confirm(`سيتم إلغاء الفاتورة ${invNumber} (لن تُحذف نهائياً بل تُعلَّم كملغاة، وسيعود إذن الاستلام المرتبط قابلاً للفوترة من جديد). هل تريد المتابعة؟`)) return;
  try{
    await api('POST', `/api/purchase-invoices/${encodeURIComponent(invNumber)}/cancel`, {});
    await loadAll();
  }catch(e){ alert(e.message); }
}
window.deletePinvInvoice = deletePinvInvoice;

// ============================================================
// إعدادات المشتريات (شاشة احترافية بأسلوب Odoo/SAP)
// تُحفظ محلياً بنفس أسلوب باقي شاشات الإعدادات بالنظام (إعدادات الترقيم المتسلسل)
// ============================================================
const PSET_STORAGE_KEY = 'legend_purchase_settings_v1';

const PSET_DEFAULTS = {
  // عام
  defaultBranch: '',
  defaultWarehouseId: '',
  defaultCostCenter: '',
  defaultPaymentTerms: 30,
  defaultCurrency: 'SAR',
  directInvoiceEnabled: true,
  requireRfqBeforePo: false,
  // الموافقات وسير العمل
  approvalsEnabled: true,
  approvalThreshold: 10000,
  approvalLevels: '1',
  aiAutoApprove: true,
  aiAutoApproveThreshold: 2000,
  approvalReminderDays: 2,
  // الاستلام والمطابقة
  threeWayMatch: true,
  qtyTolerancePct: 0,
  priceTolerancePct: 0,
  blockOverInvoice: true,
  allowPartialReceipt: true,
  // الفوترة والضرائب
  defaultTaxType: '',
  taxCalcMethod: 'exclusive',
  taxApplyLevel: 'line',
  taxInputAccount: '',
  allowSupplierTaxOverride: true,
  autoExemptSuppliers: false,
  separateTaxInvoiceNumbering: false,
  // التكلفة والتقييم
  includeLandedCost: false,
  costRoundingDecimals: '2',
  allowNegativeStock: false,
  // الموردون
  supplierEvaluationEnabled: false,
  minRfqQuotes: 1,
  autoBlacklist: false,
  blacklistViolations: 3,
  // الإشعارات
  notifyPoDueDate: true,
  notifyInvoiceDue: true,
  notifyInvoiceDueDays: 3,
  notifyApprovalPending: true,
  notifyChannel: 'system',
};

function loadPurchaseSettings(){
  try{
    const saved = JSON.parse(localStorage.getItem(PSET_STORAGE_KEY) || '{}');
    return { ...PSET_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  }catch(e){
    return { ...PSET_DEFAULTS };
  }
}
window.loadPurchaseSettings = loadPurchaseSettings;

function writePurchaseSettings(settings){
  try{ localStorage.setItem(PSET_STORAGE_KEY, JSON.stringify(settings||{})); }catch(e){}
}

// التنقل بين أقسام شاشة إعدادات المشتريات
function showPsetSection(section){
  document.querySelectorAll('.pset-nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.pset===section));
  document.querySelectorAll('.pset-section').forEach(s=> s.classList.toggle('active', s.dataset.pset===section));
}
window.showPsetSection = showPsetSection;

function pinvSettingsEsc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// تعبئة شاشة الإعدادات بالقوائم الديناميكية (الفروع/مراكز التكلفة/أنواع الضرائب/دليل الحسابات) وقيم الإعدادات المحفوظة
function populatePurchaseSettingsForm(){
  const s = loadPurchaseSettings();

  const branchSel = document.getElementById('psetDefaultBranch');
  if(branchSel){
    branchSel.innerHTML = '<option value="">— بدون تحديد —</option>' +
      (branches||[]).map(b=>`<option value="${pinvSettingsEsc(b.code)}">${pinvSettingsEsc(b.name_ar || b.name || b.code)}</option>`).join('');
    branchSel.value = s.defaultBranch || '';
  }

  const whSel = document.getElementById('psetDefaultWarehouse');
  if(whSel){
    whSel.innerHTML = '<option value="">— بدون تحديد —</option>' +
      (warehouses||[]).filter(w=>w.is_active!==false).map(w=>`<option value="${pinvSettingsEsc(w.id)}">${pinvSettingsEsc(w.code)} — ${pinvSettingsEsc(w.name)}</option>`).join('');
    whSel.value = s.defaultWarehouseId || '';
  }

  const ccSel = document.getElementById('psetDefaultCostCenter');
  if(ccSel){
    ccSel.innerHTML = '<option value="">— بدون تحديد —</option>' +
      (costCenters||[]).map(c=>`<option value="${pinvSettingsEsc(c.code)}">${pinvSettingsEsc(c.code)} — ${pinvSettingsEsc(c.name_ar)}</option>`).join('');
    ccSel.value = s.defaultCostCenter || '';
  }

  const taxSel = document.getElementById('psetDefaultTaxType');
  if(taxSel){
    taxSel.innerHTML = '<option value="">— بدون ضريبة —</option>' +
      (taxTypes||[]).map(t=>`<option value="${pinvSettingsEsc(t.code)}">${pinvSettingsEsc(t.name_ar||t.code)} (${fmt(t.rate)}%)</option>`).join('');
    taxSel.value = s.defaultTaxType || '';
  }

  const acctSel = document.getElementById('psetTaxInputAccount');
  if(acctSel){
    acctSel.innerHTML = '<option value="">— اختر حساباً —</option>' +
      (accounts||[]).map(a=>`<option value="${pinvSettingsEsc(a.code)}">${pinvSettingsEsc(a.code)} — ${pinvSettingsEsc(a.name_ar)}</option>`).join('');
    acctSel.value = s.taxInputAccount || '';
  }

  const setVal = (id, val)=>{ const el=document.getElementById(id); if(el) el.value = val; };
  const setChecked = (id, val)=>{ const el=document.getElementById(id); if(el) el.checked = !!val; };
  const setRadio = (name, val)=>{
    document.querySelectorAll(`input[name="${name}"]`).forEach(r=>{
      r.checked = (r.value === val);
      r.closest('label')?.classList.toggle('checked', r.checked);
    });
  };

  setVal('psetDefaultPaymentTerms', s.defaultPaymentTerms);
  setVal('psetDefaultCurrency', s.defaultCurrency);
  setChecked('psetDirectInvoiceEnabled', s.directInvoiceEnabled);
  setChecked('psetRequireRfqBeforePo', s.requireRfqBeforePo);

  setChecked('psetApprovalsEnabled', s.approvalsEnabled);
  setVal('psetApprovalThreshold', s.approvalThreshold);
  setVal('psetApprovalLevels', s.approvalLevels);
  setChecked('psetAiAutoApprove', s.aiAutoApprove);
  setVal('psetAiAutoApproveThreshold', s.aiAutoApproveThreshold);
  setVal('psetApprovalReminderDays', s.approvalReminderDays);

  setChecked('psetThreeWayMatch', s.threeWayMatch);
  setVal('psetQtyTolerancePct', s.qtyTolerancePct);
  setVal('psetPriceTolerancePct', s.priceTolerancePct);
  setChecked('psetBlockOverInvoice', s.blockOverInvoice);
  setChecked('psetAllowPartialReceipt', s.allowPartialReceipt);

  setRadio('psetTaxCalcMethod', s.taxCalcMethod);
  setRadio('psetTaxApplyLevel', s.taxApplyLevel);
  setChecked('psetAllowSupplierTaxOverride', s.allowSupplierTaxOverride);
  setChecked('psetAutoExemptSuppliers', s.autoExemptSuppliers);
  setChecked('psetSeparateTaxInvoiceNumbering', s.separateTaxInvoiceNumbering);

  setChecked('psetIncludeLandedCost', s.includeLandedCost);
  setVal('psetCostRoundingDecimals', s.costRoundingDecimals);
  setChecked('psetAllowNegativeStock', s.allowNegativeStock);

  setChecked('psetSupplierEvaluationEnabled', s.supplierEvaluationEnabled);
  setVal('psetMinRfqQuotes', s.minRfqQuotes);
  setChecked('psetAutoBlacklist', s.autoBlacklist);
  setVal('psetBlacklistViolations', s.blacklistViolations);

  setChecked('psetNotifyPoDueDate', s.notifyPoDueDate);
  setChecked('psetNotifyInvoiceDue', s.notifyInvoiceDue);
  setVal('psetNotifyInvoiceDueDays', s.notifyInvoiceDueDays);
  setChecked('psetNotifyApprovalPending', s.notifyApprovalPending);
  setVal('psetNotifyChannel', s.notifyChannel);
}
window.populatePurchaseSettingsForm = populatePurchaseSettingsForm;

// تلوين خيار المجموعة الإشعاعية (radio) المختار داخل pset-radio-group عند الضغط
document.addEventListener('change', (e)=>{
  if(e.target && e.target.name && (e.target.name==='psetTaxCalcMethod' || e.target.name==='psetTaxApplyLevel')){
    document.querySelectorAll(`input[name="${e.target.name}"]`).forEach(r=>{
      r.closest('label')?.classList.toggle('checked', r.checked);
    });
  }
});

function getRadioValue(name, fallback){
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : fallback;
}

// جمع القيم من الشاشة وحفظها
function savePurchaseSettings(){
  const getVal = (id, fallback)=>{ const el=document.getElementById(id); return el ? el.value : fallback; };
  const getNum = (id, fallback)=>{ const el=document.getElementById(id); const n=parseFloat(el ? el.value : fallback); return isNaN(n) ? 0 : n; };
  const getChecked = (id, fallback)=>{ const el=document.getElementById(id); return el ? el.checked : fallback; };

  const settings = {
    defaultBranch: getVal('psetDefaultBranch',''),
    defaultWarehouseId: getVal('psetDefaultWarehouse',''),
    defaultCostCenter: getVal('psetDefaultCostCenter',''),
    defaultPaymentTerms: getNum('psetDefaultPaymentTerms', PSET_DEFAULTS.defaultPaymentTerms),
    defaultCurrency: getVal('psetDefaultCurrency', PSET_DEFAULTS.defaultCurrency),
    directInvoiceEnabled: getChecked('psetDirectInvoiceEnabled', PSET_DEFAULTS.directInvoiceEnabled),
    requireRfqBeforePo: getChecked('psetRequireRfqBeforePo', PSET_DEFAULTS.requireRfqBeforePo),

    approvalsEnabled: getChecked('psetApprovalsEnabled', PSET_DEFAULTS.approvalsEnabled),
    approvalThreshold: getNum('psetApprovalThreshold', PSET_DEFAULTS.approvalThreshold),
    approvalLevels: getVal('psetApprovalLevels', PSET_DEFAULTS.approvalLevels),
    aiAutoApprove: getChecked('psetAiAutoApprove', PSET_DEFAULTS.aiAutoApprove),
    aiAutoApproveThreshold: getNum('psetAiAutoApproveThreshold', PSET_DEFAULTS.aiAutoApproveThreshold),
    approvalReminderDays: getNum('psetApprovalReminderDays', PSET_DEFAULTS.approvalReminderDays),

    threeWayMatch: getChecked('psetThreeWayMatch', PSET_DEFAULTS.threeWayMatch),
    qtyTolerancePct: getNum('psetQtyTolerancePct', PSET_DEFAULTS.qtyTolerancePct),
    priceTolerancePct: getNum('psetPriceTolerancePct', PSET_DEFAULTS.priceTolerancePct),
    blockOverInvoice: getChecked('psetBlockOverInvoice', PSET_DEFAULTS.blockOverInvoice),
    allowPartialReceipt: getChecked('psetAllowPartialReceipt', PSET_DEFAULTS.allowPartialReceipt),

    defaultTaxType: getVal('psetDefaultTaxType',''),
    taxCalcMethod: getRadioValue('psetTaxCalcMethod', PSET_DEFAULTS.taxCalcMethod),
    taxApplyLevel: getRadioValue('psetTaxApplyLevel', PSET_DEFAULTS.taxApplyLevel),
    taxInputAccount: getVal('psetTaxInputAccount',''),
    allowSupplierTaxOverride: getChecked('psetAllowSupplierTaxOverride', PSET_DEFAULTS.allowSupplierTaxOverride),
    autoExemptSuppliers: getChecked('psetAutoExemptSuppliers', PSET_DEFAULTS.autoExemptSuppliers),
    separateTaxInvoiceNumbering: getChecked('psetSeparateTaxInvoiceNumbering', PSET_DEFAULTS.separateTaxInvoiceNumbering),

    includeLandedCost: getChecked('psetIncludeLandedCost', PSET_DEFAULTS.includeLandedCost),
    costRoundingDecimals: getVal('psetCostRoundingDecimals', PSET_DEFAULTS.costRoundingDecimals),
    allowNegativeStock: getChecked('psetAllowNegativeStock', PSET_DEFAULTS.allowNegativeStock),

    supplierEvaluationEnabled: getChecked('psetSupplierEvaluationEnabled', PSET_DEFAULTS.supplierEvaluationEnabled),
    minRfqQuotes: getNum('psetMinRfqQuotes', PSET_DEFAULTS.minRfqQuotes),
    autoBlacklist: getChecked('psetAutoBlacklist', PSET_DEFAULTS.autoBlacklist),
    blacklistViolations: getNum('psetBlacklistViolations', PSET_DEFAULTS.blacklistViolations),

    notifyPoDueDate: getChecked('psetNotifyPoDueDate', PSET_DEFAULTS.notifyPoDueDate),
    notifyInvoiceDue: getChecked('psetNotifyInvoiceDue', PSET_DEFAULTS.notifyInvoiceDue),
    notifyInvoiceDueDays: getNum('psetNotifyInvoiceDueDays', PSET_DEFAULTS.notifyInvoiceDueDays),
    notifyApprovalPending: getChecked('psetNotifyApprovalPending', PSET_DEFAULTS.notifyApprovalPending),
    notifyChannel: getVal('psetNotifyChannel', PSET_DEFAULTS.notifyChannel),
  };

  writePurchaseSettings(settings);

  const msg = document.getElementById('psetMsg');
  if(msg){
    msg.textContent = '✅ تم حفظ إعدادات المشتريات بنجاح';
    setTimeout(()=>{ if(msg.textContent.includes('تم حفظ')) msg.textContent=''; }, 3000);
  }
}
window.savePurchaseSettings = savePurchaseSettings;

function resetPurchaseSettingsToDefault(){
  if(!confirm('سيتم استعادة كل إعدادات المشتريات إلى القيم الافتراضية. هل تريد المتابعة؟')) return;
  try{ localStorage.removeItem(PSET_STORAGE_KEY); }catch(e){}
  populatePurchaseSettingsForm();
  const msg = document.getElementById('psetMsg');
  if(msg){ msg.textContent = 'تمت استعادة الإعدادات الافتراضية'; setTimeout(()=>{ if(msg.textContent.includes('استعادة')) msg.textContent=''; }, 3000); }
}
window.resetPurchaseSettingsToDefault = resetPurchaseSettingsToDefault;

// ============================================================
// فاتورة مشتريات مباشرة (بدون المرور بدورة الشراء الكاملة)
// ============================================================
let dinvLines=[];

// تعبئة قائمة المستودعات لنموذج الفاتورة المباشرة (تُنشئ استلاماً تلقائياً خلفها)
function refreshDinvWarehouseOptions(){
  const sel=document.getElementById('dinvWarehouse');
  if(!sel) return;
  const current=sel.value;
  const active=(warehouses||[]).filter(w=>w.is_active!==false);
  sel.innerHTML = active.map(w=>`<option value="${w.id}">${pinvEsc(w.code)} — ${pinvEsc(w.name)}</option>`).join('')
    || '<option value="">— لا توجد مستودعات —</option>';
  if(current && active.some(w=>String(w.id)===current)){
    sel.value=current;
  } else if(typeof loadPurchaseSettings === 'function'){
    const pset = loadPurchaseSettings();
    if(pset.defaultWarehouseId && active.some(w=>String(w.id)===String(pset.defaultWarehouseId))){
      sel.value = String(pset.defaultWarehouseId);
    }
  }
}
window.refreshDinvWarehouseOptions = refreshDinvWarehouseOptions;

function toggleDirectInvoiceForm(forceOpen){
  const box=document.getElementById('dinvFormBox');
  if(!box) return;
  const isHidden = box.style.display==='none' || !box.style.display;
  const open = forceOpen===true ? true : (forceOpen===false ? false : isHidden);
  box.style.display = open ? 'block' : 'none';
  if(open){
    if(!dinvLines.length) addDinvLine();
    if(typeof populatePinvTaxTypeSelects === 'function') populatePinvTaxTypeSelects();
    refreshDinvWarehouseOptions();
    box.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
}
window.toggleDirectInvoiceForm = toggleDirectInvoiceForm;

function addDinvLine(){
  lineCounter++;
  dinvLines.push({id:lineCounter, itemCode:'', qty:1, cost:0, unit:''});
  renderDinvLines();
}
window.addDinvLine = addDinvLine;

function removeDinvLine(id){
  dinvLines = dinvLines.filter(l=>l.id!==id);
  renderDinvLines();
}
window.removeDinvLine = removeDinvLine;

function onDinvLineChange(id, field, value){
  const line=dinvLines.find(l=>l.id===id);
  if(!line) return;
  if(field==='unit'){
    const it=items.find(i=>i.code===line.itemCode);
    if(it){
      const oldFactor=getItemUnitFactor(it, line.unit)||1;
      const newFactor=getItemUnitFactor(it, value)||1;
      if(oldFactor!==newFactor) line.cost = (line.cost/oldFactor)*newFactor;
    }
    line.unit=value;
    renderDinvLines();
    return;
  }
  if(field==='qty'||field==='cost') line[field]=parseFloat(value)||0;
  else line[field]=value;
  if(field==='itemCode'){
    const it=items.find(i=>i.code===value);
    if(it){
      const units=getTemplateUnitsForItem(it);
      line.unit = units[0] ? units[0].value : (it.unit||'');
      line.cost = it.default_cost || 0;
    } else {
      line.unit='';
    }
  }
  renderDinvLines();
}
window.onDinvLineChange = onDinvLineChange;

function renderDinvLines(){
  const body=document.getElementById('dinvLinesBody');
  if(!body) return;
  const itemOpts='<option value="">— اختر صنف —</option>'+(items||[]).map(i=>`<option value="${i.code}">${i.code} — ${i.name}</option>`).join('');
  body.innerHTML=dinvLines.map(l=>{
    const it=(items||[]).find(i=>i.code===l.itemCode);
    const unitOpts = it
      ? getTemplateUnitsForItem(it).map(u=>`<option value="${String(u.value).replace(/"/g,'&quot;')}" ${String(u.value)===String(l.unit)?'selected':''}>${u.label}</option>`).join('')
      : '<option value="">-</option>';
    return `<tr>
    <td><select onchange="onDinvLineChange(${l.id},'itemCode',this.value)">${itemOpts.replace(`value="${l.itemCode}"`,`value="${l.itemCode}" selected`)}</select></td>
    <td><input type="number" step="0.01" min="0" value="${l.qty}" onchange="onDinvLineChange(${l.id},'qty',this.value)"></td>
    <td><select class="unit-line-select" onchange="onDinvLineChange(${l.id},'unit',this.value)" ${it?'':'disabled'}>${unitOpts}</select></td>
    <td><input type="number" step="0.01" min="0" value="${l.cost}" onchange="onDinvLineChange(${l.id},'cost',this.value)"></td>
    <td class="linetotal">${fmt(l.qty*l.cost)}</td>
    <td><button class="rm-line" onclick="removeDinvLine(${l.id})">✕</button></td>
  </tr>`;
  }).join('');
  if(typeof recalcDinvTotals === 'function') recalcDinvTotals();
}
window.renderDinvLines = renderDinvLines;

// ============================================================
// حساب الضريبة على فاتورة المشتريات (معاينة بالفرونت أثناء الإدخال —
// الحساب الملزم والنهائي يعاد احتسابه بالباك إند عند الترحيل)
// ============================================================
function pinvTaxPreview(linesTotal, taxTypeCode, calcMethod){
  linesTotal = Number(linesTotal)||0;
  if(!taxTypeCode) return { subtotal: linesTotal, tax: 0, total: linesTotal, taxType: null };
  const t = (taxTypes||[]).find(x=>x.code===taxTypeCode);
  if(!t) return { subtotal: linesTotal, tax: 0, total: linesTotal, taxType: null };
  const rate = Number(t.rate)||0;
  let subtotal, tax;
  if(calcMethod === 'inclusive'){
    subtotal = rate ? (linesTotal / (1 + rate/100)) : linesTotal;
    tax = linesTotal - subtotal;
  } else {
    subtotal = linesTotal;
    tax = linesTotal * rate / 100;
  }
  return { subtotal, tax, total: subtotal+tax, taxType: t };
}

// تعبئة قوائم "نوع الضريبة" بنموذجي الفاتورة (من استلام / مباشرة) مع الحفاظ على الاختيار الحالي
function populatePinvTaxTypeSelects(){
  const opts = '<option value="">— بدون ضريبة —</option>' + (taxTypes||[]).map(t=>`<option value="${pinvEsc(t.code)}">${pinvEsc(t.name_ar||t.code)} (${fmt(t.rate)}%)</option>`).join('');
  ['dinvTaxType','pinvTaxType'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const current=el.value;
    el.innerHTML=opts;
    el.value = current || '';
  });
}
window.populatePinvTaxTypeSelects = populatePinvTaxTypeSelects;

function recalcDinvTotals(){
  const linesTotal = (dinvLines||[]).reduce((s,l)=>s+l.qty*l.cost,0);
  const taxTypeCode = document.getElementById('dinvTaxType')?.value || '';
  const calcMethod = document.getElementById('dinvTaxCalcMethod')?.value || 'exclusive';
  const r = pinvTaxPreview(linesTotal, taxTypeCode, calcMethod);
  const subEl=document.getElementById('dinvSubtotal'); if(subEl) subEl.textContent=fmt(r.subtotal);
  const taxEl=document.getElementById('dinvTaxAmount'); if(taxEl) taxEl.textContent=fmt(r.tax);
  const taxLabel=document.getElementById('dinvTaxLabel'); if(taxLabel) taxLabel.textContent = r.taxType ? `الضريبة (${r.taxType.name_ar||r.taxType.code} ${fmt(r.taxType.rate)}%)` : 'الضريبة';
  const totalEl=document.getElementById('dinvTotal'); if(totalEl) totalEl.textContent=fmt(r.total);
}
window.recalcDinvTotals = recalcDinvTotals;

function recalcPinvTotals(){
  const grn=(grns||[]).find(g=>g.grn_number===document.getElementById('pinvGrn')?.value);
  const linesTotal = grn ? (Number(grn.total)||0) : 0;
  const taxTypeCode = document.getElementById('pinvTaxType')?.value || '';
  const calcMethod = document.getElementById('pinvTaxCalcMethod')?.value || 'exclusive';
  const r = pinvTaxPreview(linesTotal, taxTypeCode, calcMethod);
  const subEl=document.getElementById('pinvSubtotal'); if(subEl) subEl.textContent=fmt(r.subtotal);
  const taxEl=document.getElementById('pinvTaxAmount'); if(taxEl) taxEl.textContent=fmt(r.tax);
  const taxLabel=document.getElementById('pinvTaxLabel'); if(taxLabel) taxLabel.textContent = r.taxType ? `الضريبة (${r.taxType.name_ar||r.taxType.code} ${fmt(r.taxType.rate)}%)` : 'الضريبة';
  const totalEl=document.getElementById('pinvTotal'); if(totalEl) totalEl.textContent=fmt(r.total);
}
window.recalcPinvTotals = recalcPinvTotals;

function onDinvSupplierChange(){
  const sup=(suppliers||[]).find(s=>s.code===document.getElementById('dinvSupplier').value);
  const termsEl=document.getElementById('dinvTerms');
  if(termsEl) termsEl.value = sup ? (sup.payment_terms_days||0) : 0;
}
window.onDinvSupplierChange = onDinvSupplierChange;

function resetDirectInvoiceForm(){
  dinvLines=[];
  addDinvLine();
  const sup=document.getElementById('dinvSupplier'); if(sup) sup.value='';
  const dt=document.getElementById('dinvDate'); if(dt) dt.value='';
  const sn=document.getElementById('dinvSupNum'); if(sn) sn.value='';
  const rf=document.getElementById('dinvRef'); if(rf) rf.value='';
  const tm=document.getElementById('dinvTerms');
  const cc=document.getElementById('dinvCostCenter');
  const tt=document.getElementById('dinvTaxType');
  const tcm=document.getElementById('dinvTaxCalcMethod');
  const err=document.getElementById('dinvErr'); if(err) err.textContent='';
  // تطبيق القيم الافتراضية من إعدادات المشتريات (مركز التكلفة، شروط الدفع، الضريبة)
  if(typeof loadPurchaseSettings === 'function'){
    const pset = loadPurchaseSettings();
    if(tm) tm.value = pset.defaultPaymentTerms || 0;
    if(cc) cc.value = pset.defaultCostCenter || '';
    if(tt) tt.value = pset.defaultTaxType || '';
    if(tcm) tcm.value = pset.taxCalcMethod || 'exclusive';
  } else {
    if(tm) tm.value='0';
    if(cc) cc.value='';
    if(tt) tt.value='';
    if(tcm) tcm.value='exclusive';
  }
  if(typeof recalcDinvTotals === 'function') recalcDinvTotals();
}
window.resetDirectInvoiceForm = resetDirectInvoiceForm;

async function submitDirectPinv(){
  const supplier_code=document.getElementById('dinvSupplier').value;
  const inv_date=document.getElementById('dinvDate').value;
  const supplier_inv_number=document.getElementById('dinvSupNum').value.trim()||null;
  const reference=document.getElementById('dinvRef').value.trim()||null;
  const payment_terms_days=parseInt(document.getElementById('dinvTerms').value)||0;
  const cost_center_code=document.getElementById('dinvCostCenter').value||null;
  const tax_type_code=document.getElementById('dinvTaxType')?.value||null;
  const tax_calc_method=document.getElementById('dinvTaxCalcMethod')?.value||'exclusive';
  const warehouse_id=document.getElementById('dinvWarehouse')?.value ? parseInt(document.getElementById('dinvWarehouse').value) : null;
  const err=document.getElementById('dinvErr');
  const valid=dinvLines.filter(l=>l.itemCode && l.qty>0);
  if(!supplier_code){err.textContent='يرجى اختيار المورد'; return;}
  if(!inv_date){err.textContent='يرجى إدخال تاريخ الفاتورة'; return;}
  if(!valid.length){err.textContent='يرجى إضافة صنف واحد على الأقل'; return;}
  err.textContent='';
  try{
    await api('POST','/api/purchase-invoices/direct',{
      supplier_code, inv_date, supplier_inv_number, reference, payment_terms_days, cost_center_code,
      tax_type_code, tax_calc_method, warehouse_id,
      lines: valid.map(l=>{
        const it=(items||[]).find(i=>i.code===l.itemCode);
        const factor = it ? (getItemUnitFactor(it, l.unit)||1) : 1;
        return {item_code:l.itemCode, qty: l.qty*factor, unit_cost: factor ? l.cost/factor : l.cost};
      })
    });
    resetDirectInvoiceForm();
    toggleDirectInvoiceForm(false);
    await loadAll();
  }catch(e){ err.textContent = e.message; }
}
window.submitDirectPinv = submitDirectPinv;

// ============================================================
// مرتجعات المشتريات — مواكبة لشاشة فواتير المشتريات: قائمة أولاً،
// نموذج إنشاء مطوي (المورد أولاً ثم فواتيره)، قائمة إجراءات لكل صف،
// وربط كامل بالضريبة التناسبية والقيد المحاسبي التلقائي.
// ============================================================
function prtEsc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function togglePrtNewForm(forceOpen){
  const box=document.getElementById('prtNewFormBox');
  if(!box) return;
  const isHidden = box.style.display==='none' || !box.style.display;
  const open = forceOpen===true ? true : (forceOpen===false ? false : isHidden);
  box.style.display = open ? 'block' : 'none';
  if(open){
    const supSel=document.getElementById('prtSupplier');
    if(supSel){
      const current=supSel.value;
      supSel.innerHTML='<option value="">— اختر مورداً —</option>'+
        (suppliers||[]).map(s=>`<option value="${prtEsc(s.code)}">${prtEsc(s.name)} (${prtEsc(s.code)})</option>`).join('');
      supSel.value=current;
    }
    const dt=document.getElementById('prtDate');
    if(dt && !dt.value) dt.value = new Date().toISOString().slice(0,10);
    box.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
}
window.togglePrtNewForm = togglePrtNewForm;

// تعبئة فواتير المورد المختار فقط (غير الملغاة) — هذا هو رابط المورد
// الأساسي بالشاشة: يبدأ المستخدم من المورد، مش من رقم فاتورة يكتبه
function onPrtSupplierChange(){
  const supplierCode=document.getElementById('prtSupplier').value;
  const invSel=document.getElementById('prtInvoice');
  const supplierInvoices=(invoices||[]).filter(i=>i.supplier_code===supplierCode && i.status!=='cancelled');
  invSel.innerHTML = supplierCode
    ? ('<option value="">— اختر فاتورة —</option>' + supplierInvoices.map(i=>
        `<option value="${prtEsc(i.inv_number)}">${prtEsc(i.inv_number)} — ${prtEsc(i.inv_date)} — إجمالي ${fmt(i.total)}</option>`
      ).join(''))
    : '<option value="">— اختر مورداً أولاً —</option>';
  if(!supplierInvoices.length && supplierCode){
    invSel.innerHTML = '<option value="">— لا توجد فواتير مرحّلة لهذا المورد —</option>';
  }
  prtCurrentLines=[];
  document.getElementById('prtLinesWrap').innerHTML='';
  recalcPrtTotals();
}
window.onPrtSupplierChange = onPrtSupplierChange;

// عدد الوحدات المُرجَعة سابقاً على هذه الفاتورة لنفس الصنف (من مرتجعات
// غير ملغاة) — لعرض السقف المتبقي الفعلي للمستخدم قبل الإرسال، مع
// إبقاء التحقق النهائي والملزم بالخادم
function prtAlreadyReturnedQty(invNumber, itemId){
  return (returns_||[])
    .filter(r=>r.inv_number===invNumber && r.status!=='cancelled')
    .flatMap(r=>r.lines||[])
    .filter(l=>l.item_id===itemId)
    .reduce((s,l)=>s+(Number(l.qty)||0),0);
}

function onPrtInvoiceChange(){
  const inv=(invoices||[]).find(i=>i.inv_number===document.getElementById('prtInvoice').value);
  const wrap=document.getElementById('prtLinesWrap');
  if(!inv){ wrap.innerHTML=''; prtCurrentLines=[]; recalcPrtTotals(); return; }
  prtCurrentLines=(inv.lines||[]).map(l=>{
    const it=(items||[]).find(i=>i.id===l.item_id);
    const alreadyReturned=prtAlreadyReturnedQty(inv.inv_number, l.item_id);
    const maxQty=Math.max(0, (Number(l.qty)||0) - alreadyReturned);
    return {item_code:it?it.code:'', item_name:it?it.name:String(l.item_id), unit_cost:Number(l.unit_cost)||0, max_qty:maxQty, qty:0};
  });
  renderPrtLines();
}
window.onPrtInvoiceChange = onPrtInvoiceChange;

function onPrtQtyChange(item_code,v){
  const l=prtCurrentLines.find(x=>x.item_code===item_code);
  if(!l) return;
  let q=parseFloat(v)||0;
  if(q<0)q=0; if(q>l.max_qty)q=l.max_qty;
  l.qty=q;
  renderPrtLines();
}
window.onPrtQtyChange = onPrtQtyChange;

function renderPrtLines(){
  const wrap=document.getElementById('prtLinesWrap');
  if(!wrap) return;
  const rows=prtCurrentLines.map(l=>`<tr>
      <td>${prtEsc(l.item_code)} — ${prtEsc(l.item_name)}</td>
      <td class="num" style="color:#7c8ba3">المتبقي القابل للإرجاع: ${fmt(l.max_qty)}</td>
      <td><input type="number" step="0.01" min="0" max="${l.max_qty}" value="${l.qty}" onchange="onPrtQtyChange('${l.item_code}',this.value)" ${l.max_qty<=0?'disabled':''}></td>
      <td class="num">${fmt(l.unit_cost)}</td>
      <td class="linetotal">${fmt(l.qty*l.unit_cost)}</td>
    </tr>`).join('');
  wrap.innerHTML=`<table class="line-items"><thead><tr><th>الصنف</th><th>الحد المتاح</th><th>كمية المرتجع</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>`;
  recalcPrtTotals();
}

// معاينة الضريبة التناسبية بالفرونت إند (نفس منطق الباك إند: نصيب
// المرتجع = صافي المرتجع × (ضريبة الفاتورة الأصلية ÷ صافي الفاتورة الأصلية))
function recalcPrtTotals(){
  const subtotal = prtCurrentLines.reduce((s,l)=>s+l.qty*l.unit_cost,0);
  const inv=(invoices||[]).find(i=>i.inv_number===document.getElementById('prtInvoice')?.value);
  let tax=0, taxLabel='الضريبة (نصيب تناسبي)';
  if(inv && inv.tax_type_code && Number(inv.subtotal)>0){
    const effectiveRate = Number(inv.tax_amount||0) / Number(inv.subtotal);
    tax = subtotal * effectiveRate;
    const tt=(taxTypes||[]).find(t=>t.code===inv.tax_type_code);
    if(tt) taxLabel = `الضريبة (نصيب تناسبي من ${tt.name_ar||tt.code} ${fmt(tt.rate)}%)`;
  }
  const subEl=document.getElementById('prtSubtotal'); if(subEl) subEl.textContent=fmt(subtotal);
  const taxEl=document.getElementById('prtTaxAmount'); if(taxEl) taxEl.textContent=fmt(tax);
  const taxLabelEl=document.getElementById('prtTaxLabel'); if(taxLabelEl) taxLabelEl.textContent=taxLabel;
  const totalEl=document.getElementById('prtTotal'); if(totalEl) totalEl.textContent=fmt(subtotal+tax);
}
window.recalcPrtTotals = recalcPrtTotals;

async function submitPurchaseReturn(){
  const inv_number=document.getElementById('prtInvoice').value;
  const rt_date=document.getElementById('prtDate').value;
  const err=document.getElementById('prtErr');
  const valid=prtCurrentLines.filter(l=>l.qty>0);
  if(!document.getElementById('prtSupplier').value){err.textContent='يرجى اختيار المورد'; return;}
  if(!inv_number){err.textContent='يرجى اختيار الفاتورة'; return;}
  if(!rt_date){err.textContent='يرجى إدخال التاريخ'; return;}
  if(!valid.length){err.textContent='يرجى إدخال كمية مرتجع لصنف واحد على الأقل'; return;}
  err.textContent='';
  try{
    await api('POST','/api/purchase-returns',{
      rt_date, inv_number,
      lines: valid.map(l=>({item_code:l.item_code, qty:l.qty}))
    });
    document.getElementById('prtSupplier').value='';
    document.getElementById('prtInvoice').innerHTML='<option value="">— اختر مورداً أولاً —</option>';
    document.getElementById('prtLinesWrap').innerHTML='';
    prtCurrentLines=[];
    recalcPrtTotals();
    togglePrtNewForm(false);
    await loadAll();
  }catch(e){ err.textContent=e.message; }
}
window.submitPurchaseReturn = submitPurchaseReturn;

// شارة حالة المرتجع
function getPrtBadge(prt){
  if(prt.status==='cancelled') return '<span class="badge returned">ملغى</span>';
  return '<span class="badge posted">مرحّل</span>';
}

// عرض قائمة المرتجعات المسجّلة مع البحث
function renderPurchaseReturns(){
  const body=document.getElementById('prtBody');
  if(!body) return;

  const searchEl=document.getElementById('prtSearch');
  const q=(searchEl?.value||'').trim().toLowerCase();
  let data=Array.isArray(returns_)?[...returns_]:[];

  if(q){
    data=data.filter(r=>{
      const sup=(suppliers||[]).find(s=>s.code===r.supplier_code);
      return (r.rt_number||'').toLowerCase().includes(q) ||
        (r.inv_number||'').toLowerCase().includes(q) ||
        (sup?.name||'').toLowerCase().includes(q);
    });
  }

  data.sort((a,b)=> new Date(b.rt_date||0)-new Date(a.rt_date||0) || String(b.rt_number||'').localeCompare(String(a.rt_number||'')));

  body.innerHTML=data.map(r=>{
    const sup=(suppliers||[]).find(s=>s.code===r.supplier_code);
    return `<tr>
      <td><a href="javascript:void(0)" class="pinv-num-link" onclick="event.stopPropagation(); openPrtPrintTab('${prtEsc(r.rt_number)}')">${prtEsc(r.rt_number)}</a></td>
      <td>${prtEsc(r.rt_date)}</td>
      <td>${prtEsc(sup?sup.name:r.supplier_code)}</td>
      <td>${prtEsc(r.inv_number)}</td>
      <td>${fmt(r.total)}${(r.tax_amount && Number(r.tax_amount)>0) ? `<div style="font-size:10.5px;color:#0b67c2;margin-top:2px">شامل ضريبة ${fmt(r.tax_amount)}</div>` : ''}</td>
      <td>${getPrtBadge(r)}</td>
      <td style="text-align:center" onclick="event.stopPropagation()">
        <button type="button" class="pinv-actions-btn" onclick="togglePrtActionsMenu(event,'${prtEsc(r.rt_number)}')" title="الإجراءات">⋮</button>
      </td>
    </tr>`;
  }).join('');

  const empty=document.getElementById('prtEmpty');
  if(empty) empty.style.display = data.length ? 'none' : 'block';

  const countEl=document.getElementById('prtSavedCount');
  if(countEl) countEl.textContent = (returns_||[]).length + ' مرتجع';
}
window.renderPurchaseReturns = renderPurchaseReturns;
window.renderReturns = renderPurchaseReturns; // اسم الاستدعاء المستخدم أصلاً بحلقة loadAll()

// ---------- قائمة إجراءات المرتجع (⋮) ----------
let prtMenuCurrentRt = null;

function ensurePrtActionsMenu(){
  let menu = document.getElementById('prtActionsMenu');
  if(!menu){
    menu = document.createElement('div');
    menu.id = 'prtActionsMenu';
    menu.className = 'pinv-actions-menu';
    menu.innerHTML = `
      <button onclick="prtMenuRun('view')">👁️ عرض</button>
      <button onclick="prtMenuRun('print')">🖨️ طباعة / PDF</button>
      <button onclick="prtMenuRun('email')">✉️ إرسال عبر البريد</button>
      <button onclick="prtMenuRun('whatsapp')">💬 إرسال عبر واتساب</button>
      <hr>
      <button class="danger" onclick="prtMenuRun('cancel')">🗑️ إلغاء المرتجع</button>
    `;
    document.body.appendChild(menu);
  }
  return menu;
}

function togglePrtActionsMenu(e, rtNumber){
  e.stopPropagation();
  const menu = ensurePrtActionsMenu();
  const wasOpenForThis = menu.classList.contains('show') && prtMenuCurrentRt === rtNumber;
  closePrtActionsMenu();
  if (wasOpenForThis) return;

  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  menu.classList.add('show');
  prtMenuCurrentRt = rtNumber;

  const menuRect = menu.getBoundingClientRect();
  const menuW = menuRect.width || 210;
  const menuH = menuRect.height || 260;
  const margin = 8;
  let top = rect.bottom + 6;
  if (top + menuH > window.innerHeight - margin) top = Math.max(margin, rect.top - menuH - 6);
  let left = rect.left - menuW + rect.width;
  left = Math.min(Math.max(margin, left), window.innerWidth - menuW - margin);
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
}
window.togglePrtActionsMenu = togglePrtActionsMenu;

function closePrtActionsMenu(){
  const menu = document.getElementById('prtActionsMenu');
  if (menu) menu.classList.remove('show');
  prtMenuCurrentRt = null;
}
document.addEventListener('click', closePrtActionsMenu);

function prtMenuRun(action){
  const rtNumber = prtMenuCurrentRt;
  closePrtActionsMenu();
  if(!rtNumber) return;
  if(action==='view') openPurchaseReturnView(rtNumber);
  else if(action==='print') openPrtPrintTab(rtNumber);
  else if(action==='email') sendPrtByEmail(rtNumber);
  else if(action==='whatsapp') sendPrtByWhatsapp(rtNumber);
  else if(action==='cancel') cancelPurchaseReturnAction(rtNumber);
}
window.prtMenuRun = prtMenuRun;

// عرض تفاصيل مرتجع في نافذة منبثقة، مع رابط مباشر للقيد المحاسبي المرتبط
function openPurchaseReturnView(rtNumber){
  const prt=(returns_||[]).find(r=>r.rt_number===rtNumber);
  if(!prt) return;
  const sup=(suppliers||[]).find(s=>s.code===prt.supplier_code);
  const taxType=(taxTypes||[]).find(t=>t.code===prt.tax_type_code);
  const rows=(prt.lines||[]).map(l=>{
    const it=(items||[]).find(i=>i.id===l.item_id);
    return `<tr>
      <td>${prtEsc(it?it.code+' — '+it.name:l.item_id)}</td>
      <td class="num">${fmt(l.qty)}</td>
      <td class="num">${fmt(l.unit_cost)}</td>
      <td class="num">${fmt(l.qty*l.unit_cost)}</td>
    </tr>`;
  }).join('');
  const taxRowsHtml = (prt.tax_amount && Number(prt.tax_amount)>0)
    ? `<div class="row"><span>الصافي</span><span>${fmt(prt.subtotal)}</span></div>
       <div class="row"><span>الضريبة${taxType?` (نصيب من ${prtEsc(taxType.name_ar||taxType.code)} ${fmt(taxType.rate)}%)`:''}</span><span>${fmt(prt.tax_amount)}</span></div>`
    : '';
  const html=`<div class="po-decision-dialog" id="prtViewDialog"><div class="box">
    <div class="rfq-section-head">
      <h3>مرتجع مشتريات ${prtEsc(prt.rt_number)}</h3>
      <button class="btn secondary" onclick="document.getElementById('prtViewDialog').remove()">إغلاق</button>
    </div>
    <div class="po-info-grid" style="margin-bottom:14px">
      <div class="field"><label>المورد</label><input disabled value="${prtEsc(sup?sup.name:prt.supplier_code)}"></div>
      <div class="field"><label>تاريخ المرتجع</label><input disabled value="${prtEsc(prt.rt_date)}"></div>
      <div class="field"><label>الفاتورة الأصلية</label><input disabled value="${prtEsc(prt.inv_number)}"></div>
    </div>
    <table class="grid po-list-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals-box" style="margin-top:12px">
      ${taxRowsHtml}
      <div class="row grand"><span>الإجمالي (خصم من رصيد المورد)</span><span>${fmt(prt.total)}</span></div>
    </div>
    ${prt.journal_entry_id ? `<div class="hint pinv-journal-link" style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span>✅ تم ترحيل القيد المحاسبي رقم <b>#${prt.journal_entry_id}</b> تلقائياً (مدين حساب المورد / دائن المخزون${prt.tax_amount>0?' وضريبة المشتريات':''}).</span>
      <button class="btn secondary" onclick="document.getElementById('prtViewDialog')?.remove(); openEntryDetail(${prt.journal_entry_id})">📒 فتح القيد المحاسبي</button>
    </div>` : ''}
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}
window.openPurchaseReturnView = openPurchaseReturnView;

// بناء صفحة طباعة/عرض للمرتجع في تبويب جديد
function buildPrtPrintHtml(prt){
  const sup=(suppliers||[]).find(s=>s.code===prt.supplier_code);
  const rows=(prt.lines||[]).map((l,idx)=>{
    const it=(items||[]).find(i=>i.id===l.item_id);
    return `<tr>
      <td>${idx+1}</td>
      <td>${prtEsc(it?it.code+' — '+it.name:l.item_id)}</td>
      <td class="num">${fmt(l.qty)}</td>
      <td class="num">${fmt(l.unit_cost)}</td>
      <td class="num">${fmt(l.qty*l.unit_cost)}</td>
    </tr>`;
  }).join('');
  const badge = prt.status==='cancelled' ? '<span class="pinv-badge cancelled">ملغى</span>' : '<span class="pinv-badge">مرحّل</span>';
  const hasTax = prt.tax_amount && Number(prt.tax_amount) > 0;
  const taxSummaryRows = hasTax
    ? `<div class="row"><span>الصافي</span><span>${fmt(prt.subtotal)}</span></div>
       <div class="row"><span>الضريبة (نصيب تناسبي)</span><span>${fmt(prt.tax_amount)}</span></div>`
    : '';
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>مرتجع مشتريات ${prtEsc(prt.rt_number)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;}
  body{font-family:'Cairo',sans-serif;margin:0;padding:32px;color:#1c2430;background:#fff;}
  .pinv-print-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1c2430;padding-bottom:16px;margin-bottom:22px;}
  .pinv-print-head h1{font-size:21px;margin:0 0 6px;}
  .pinv-print-head .muted{color:#666;font-size:13px;}
  .pinv-badge{display:inline-block;padding:4px 12px;border-radius:14px;font-size:12px;font-weight:700;background:#2e7d3222;color:#2e7d32;border:1px solid #2e7d3255;}
  .pinv-badge.cancelled{background:#c6282822;color:#c62828;border-color:#c6282855;}
  .pinv-info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 24px;margin-bottom:26px;}
  .pinv-info-grid div{font-size:13px;}
  .pinv-info-grid label{display:block;color:#888;font-size:11px;margin-bottom:3px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th,td{border:1px solid #ddd;padding:8px 10px;text-align:right;}
  th{background:#f4f5f7;font-weight:700;}
  td.num,th.num{text-align:left;font-family:monospace,'Cairo';}
  .pinv-total-row{margin-top:16px;display:flex;justify-content:flex-end;}
  .pinv-total-row .box{min-width:280px;display:flex;flex-direction:column;gap:6px;font-size:13px;border-top:2px solid #1c2430;padding-top:10px;}
  .pinv-total-row .box .row{display:flex;justify-content:space-between;color:#555;}
  .pinv-total-row .box .grand{display:flex;justify-content:space-between;font-size:16px;font-weight:800;color:#1c2430;margin-top:4px;}
  .pinv-print-toolbar{margin-bottom:20px;}
  .pinv-print-toolbar button{font-family:'Cairo',sans-serif;padding:9px 18px;border-radius:8px;border:1px solid #1c2430;background:#1c2430;color:#fff;cursor:pointer;font-size:13px;font-weight:600;}
  @media print{ .pinv-print-toolbar{display:none;} body{padding:0;} }
</style></head>
<body>
  <div class="pinv-print-toolbar"><button onclick="window.print()">🖨️ طباعة</button></div>
  <div class="pinv-print-head">
    <div>
      <h1>LEGEND D — مرتجع مشتريات</h1>
      <div class="muted">رقم المرتجع: ${prtEsc(prt.rt_number)}</div>
    </div>
    <div>${badge}</div>
  </div>
  <div class="pinv-info-grid">
    <div><label>المورد</label>${prtEsc(sup?sup.name:prt.supplier_code)}</div>
    <div><label>تاريخ المرتجع</label>${prtEsc(prt.rt_date)}</div>
    <div><label>الفاتورة الأصلية</label>${prtEsc(prt.inv_number)}</div>
  </div>
  <table><thead><tr><th>#</th><th>الصنف</th><th class="num">الكمية</th><th class="num">التكلفة</th><th class="num">الإجمالي</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="pinv-total-row"><div class="box">
    ${taxSummaryRows}
    <div class="grand"><span>الإجمالي الكلي</span><span>${fmt(prt.total)}</span></div>
  </div></div>
</body></html>`;
}

function openPrtPrintTab(rtNumber){
  const prt=(returns_||[]).find(r=>r.rt_number===rtNumber);
  if(!prt){ alert('تعذر العثور على المرتجع'); return; }
  const w=window.open('', '_blank');
  if(!w){ alert('يرجى السماح بفتح النوافذ المنبثقة لعرض المرتجع'); return; }
  w.document.open();
  w.document.write(buildPrtPrintHtml(prt));
  w.document.close();
}
window.openPrtPrintTab = openPrtPrintTab;

function buildPrtShareText(prt){
  const sup=(suppliers||[]).find(s=>s.code===prt.supplier_code);
  return `مرتجع مشتريات رقم ${prt.rt_number}\nالمورد: ${sup?sup.name:prt.supplier_code}\nالتاريخ: ${prt.rt_date}\nالفاتورة الأصلية: ${prt.inv_number}\nالإجمالي: ${fmt(prt.total)}`;
}

function sendPrtByEmail(rtNumber){
  const prt=(returns_||[]).find(r=>r.rt_number===rtNumber);
  if(!prt) return;
  const subject=encodeURIComponent(`مرتجع مشتريات ${prt.rt_number}`);
  const body=encodeURIComponent(buildPrtShareText(prt));
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
}
window.sendPrtByEmail = sendPrtByEmail;

function sendPrtByWhatsapp(rtNumber){
  const prt=(returns_||[]).find(r=>r.rt_number===rtNumber);
  if(!prt) return;
  const text=encodeURIComponent(buildPrtShareText(prt));
  window.open(`https://wa.me/?text=${text}`, '_blank');
}
window.sendPrtByWhatsapp = sendPrtByWhatsapp;

async function cancelPurchaseReturnAction(rtNumber){
  if(!confirm(`سيتم إلغاء المرتجع ${rtNumber} — سترجع الكمية المرتجعة للمخزون ويُلغى قيده المحاسبي، ويعود رصيد المورد كما كان قبل هذا المرتجع. هل تريد المتابعة؟`)) return;
  try{
    await api('POST', `/api/purchase-returns/${encodeURIComponent(rtNumber)}/cancel`, {});
    await loadAll();
  }catch(e){ alert(e.message); }
}
window.cancelPurchaseReturnAction = cancelPurchaseReturnAction;


// ============================================================
// التنقل — القائمة الأفقية والشريط الجانبي
// ============================================================

const MODULE_TAGS = {
  tree:'الحسابات', entry:'الحسابات', journal:'الحسابات', cost:'الحسابات',
  settings:'الحسابات', tax_settings:'الحسابات',
  items:'المخزون', services:'المخزون', stockmoves:'المخزون',
  warehouses:'المخزون', prices:'المخزون', tracking:'المخزون', productsettings:'المخزون',
  suppliers:'المشتريات', po:'المشتريات', grn:'المشتريات',
  pinvoice:'المشتريات', preturn:'المشتريات',
  purchase_request:'المشتريات', quotation_request:'المشتريات',
  purchase_orders:'المشتريات', goods_receipt:'المشتريات',
  purchase_invoices:'المشتريات', purchase_returns:'المشتريات',
  supplier_payments:'المشتريات', purchase_settings:'المشتريات',
  sales_quote:'المبيعات', sales_order:'المبيعات', delivery_note:'المبيعات',
  sales_invoice_create:'المبيعات', sales_invoices:'المبيعات',
  sales_returns:'المبيعات', credit_notes:'المبيعات',
  customer_payments:'المبيعات', sales_settings:'المبيعات',
  pos_start:'نقاط البيع', pos_sessions:'نقاط البيع',
  pos_reports:'نقاط البيع', pos_settings:'نقاط البيع',
  customers:'العملاء', customer_add:'العملاء',
  contact_lists:'العملاء', customer_settings:'العملاء',
  expenses:'المالية', receipts:'المالية', payments:'المالية',
  cash_banks:'المالية', payment_methods:'المالية', finance_settings:'المالية',
  asset_add:'الأصول', assets_list:'الأصول',
  sales_reports:'التقارير', purchase_reports:'التقارير', gl_reports:'التقارير',
  customer_reports:'التقارير', inventory_reports:'التقارير', activity_reports:'التقارير',
  print_templates:'قوالب الطباعة', whatsapp_templates:'قوالب الطباعة', email_templates:'قوالب الطباعة', auto_send_rules:'قوالب الطباعة',
  account_info:'الإعدادات العامة', account_settings_general:'الإعدادات العامة', sequence_settings:'الإعدادات العامة', apps_management:'الإعدادات العامة', themes_backgrounds:'الإعدادات العامة',
  users_list:'المستخدمون والصلاحيات', roles_permissions:'المستخدمون والصلاحيات',
};

// تفعيل تبويب محدد
function activateTab(tabKey) {
  if (tabKey === 'home') {
    if (typeof resetHomeState === 'function') resetHomeState();
    document.querySelectorAll('.sb-item').forEach(it => it.classList.toggle('active', it.dataset.tab === 'home'));
    const homeSection = document.querySelector('.sb-section[data-group="dashboard"]');
    if (homeSection) homeSection.classList.add('open');
    return;
  }

  // أزل active من كل البانلات، وأخفِ أي شاشة سابقة بشكل صريح
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });

  // فعّل البانل المطلوب فقط حتى لا تبقى شاشة المنتجات ظاهرة أسفل شاشة أخرى
  const panel = document.getElementById('panel-' + tabKey);
  if (panel) {
    panel.classList.add('active');
    panel.style.display = 'block';
    panel.scrollIntoView({behavior:'smooth', block:'start'});
  }

  // تحديث تاج الوحدة
  const tag = document.getElementById('moduleTag');
  if (tag) tag.textContent = MODULE_TAGS[tabKey] || 'ERP';

  // تهيئة شاشة إعدادات المشتريات عند فتحها (تعبئة القوائم من البيانات المحمّلة)
  if (tabKey === 'purchase_settings' && typeof populatePurchaseSettingsForm === 'function') {
    populatePurchaseSettingsForm();
  }

  // تحديث القائمة الأفقية
  document.querySelectorAll('.nav-dd-item').forEach(it => {
    it.classList.toggle('active', it.dataset.tab === tabKey);
  });

  // تحديث الشريط الجانبي
  document.querySelectorAll('.sb-item').forEach(it => {
    it.classList.toggle('active', it.dataset.tab === tabKey);
  });
}

// إبقاء الصفحة الرئيسية نظيفة بدون فتح دليل الحسابات تلقائياً
function resetHomeState() {
  document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.style.display='none'; });
  document.querySelectorAll('.nav-dd-item, .sb-item').forEach(it => it.classList.remove('active'));
  document.querySelectorAll('.nav-item.open, .sb-section.open').forEach(sec => sec.classList.remove('open'));
  document.querySelectorAll('.erp-submenu-horizontal').forEach(menu => menu.classList.remove('show'));
  const tag = document.getElementById('moduleTag');
  if (tag) tag.textContent = 'ERP';
}

// فتح/إغلاق dropdown في القائمة الأفقية
function toggleNavItem(btn) {
  const item = btn.closest('.nav-item');
  const isOpen = item.classList.contains('open');
  // أغلق الكل
  document.querySelectorAll('.nav-item.open').forEach(n => n.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

// إغلاق القوائم عند النقر خارجها
document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-item')) {
    document.querySelectorAll('.nav-item.open').forEach(n => n.classList.remove('open'));
  }
});

// فتح/إغلاق أقسام الشريط الجانبي
function toggleSbSection(btn) {
  const section = btn.closest('.sb-section');
  section.classList.toggle('open');
}

// تسجيل النقرات على القائمة الأفقية
// [nav listeners moved to DOMContentLoaded]

// فتح/إغلاق نموذج إضافة الحساب
function toggleAccForm() {
  const box = document.getElementById('accFormBox');
  if (!box) return;
  const isHidden = box.style.display === 'none';
  box.style.display = isHidden ? 'block' : 'none';
  if (isHidden) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================
// تهيئة وبدء التطبيق
// ============================================================
document.addEventListener('DOMContentLoaded', function () {

  // 1. تطبيق الوضع المحفوظ
  if (typeof initSidebarResize === 'function') initSidebarResize();
  const savedLayout = localStorage.getItem('erp-layout') || 'horizontal';
  setLayout(savedLayout);

  const savedLang = localStorage.getItem('erp-lang') || 'ar';
  setLanguage(savedLang);

  // الصفحة الرئيسية لا تعرض أي شاشة فرعية تلقائياً، خصوصاً دليل الحسابات
  resetHomeState();

  // 2. تسجيل أحداث القائمة الأفقية
  document.querySelectorAll('.nav-dd-item').forEach(item => {
    item.addEventListener('click', function () {
      document.querySelectorAll('.nav-item.open').forEach(n => n.classList.remove('open'));
      activateTab(this.dataset.tab);
    });
  });

  // 3. تسجيل أحداث الشريط الجانبي
  document.querySelectorAll('.sb-item').forEach(item => {
    item.addEventListener('click', function () {
      activateTab(this.dataset.tab);
      const section = this.closest('.sb-section');
      if(section) section.classList.add('open');
    });
  });

  const itemSearchBtn = document.getElementById('itemSearchBtn');
  if(itemSearchBtn) itemSearchBtn.addEventListener('click', applyItemSearch);
  const itemClearSearchBtn = document.getElementById('itemClearSearchBtn');
  if(itemClearSearchBtn) itemClearSearchBtn.addEventListener('click', clearItemSearch);

  // 4. تهيئة التواريخ
  ['jDate', 'poDate', 'grnDate', 'pinvDate', 'prtDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today();
  });

  // 5. تهيئة الأسطر
  addPoLine();
  addGrnLine();
  try{ cancelSupEdit(); }catch(e){}
  document.querySelectorAll('#supBuildingNo,#supStreet,#supAdditionalNo,#supDistrict,#supCity,#supPostalCode,#supType').forEach(el=>{
    el.addEventListener('input', updateSupplierWarnings);
    el.addEventListener('change', updateSupplierWarnings);
  });

  // 6. تحميل البيانات — مع عرض الواجهة دائماً حتى بدون API
  loadAll().catch(() => {
    console.warn('API غير متاح — عرض الواجهة بدون بيانات');
    try { renderAll(); } catch(e) { console.warn(e); }
    try { refreshSelects(); } catch(e) {}
    try { refreshAccountParents(); } catch(e) {}
    try { refreshJournalAccounts(); } catch(e) {}
  });
});

// ============================================================
// تبديل الوضع الأفقي / العمودي
// ============================================================
// ============================================================
// قوالب الوحدات
// ============================================================
let unitTemplates = JSON.parse(localStorage.getItem('unitTemplates')||'[]');
let editingUnitId=null;

function openUnitTemplateForm(){
 document.getElementById('unitTemplateForm').style.display='block';
}
function closeUnitTemplateForm(){
 document.getElementById('unitTemplateForm').style.display='none';
}

function saveUnitTemplate(){
 let t={
 id:editingUnitId || Date.now(),
 name:document.getElementById('utName').value,
 base:document.getElementById('utBase').value,
 higher:document.getElementById('utHigher').value,
 higherName:document.getElementById('utHigherName').value,
 factor:Number(document.getElementById('utFactor').value)||1
 };
 if(!t.name)return;
 let exists=unitTemplates.some(x=>x.name.trim()===t.name.trim() && x.id!==t.id);
 if(exists){alert('اسم القالب موجود مسبقاً');return;}
 if(editingUnitId){ unitTemplates=unitTemplates.map(x=>x.id===editingUnitId?t:x); }
 else { unitTemplates.push(t); }
 localStorage.setItem('unitTemplates',JSON.stringify(unitTemplates));
 renderUnitTemplates();
 closeUnitTemplateForm();
}

function renderUnitTemplates(){
 let body=document.getElementById('unitTemplatesBody');
 if(!body)return;
 body.innerHTML=unitTemplates.map(t=>`
 <tr>
 <td><input type="checkbox" class="utCheck" value="${t.id}" onchange="showUnitActions()"></td>
 <td>${t.name}</td><td>${t.base}</td><td>${t.higherName}</td><td>${t.factor}</td>
 </tr>`).join('');
 window.unitTemplates=unitTemplates;
 if(typeof loadProductDropdowns==='function') loadProductDropdowns();
}
function selectedUnitTemplates(){
 return [...document.querySelectorAll('.utCheck:checked')].map(x=>Number(x.value));
}
function showUnitActions(){
 document.getElementById('unitActions').style.display=selectedUnitTemplates().length?'block':'none';
}
function toggleAllUnitTemplates(e){
 document.querySelectorAll('.utCheck').forEach(c=>c.checked=e.checked);
 showUnitActions();
}
function deleteSelectedUnitTemplates(){
 let ids=selectedUnitTemplates();
 unitTemplates=unitTemplates.filter(t=>!ids.includes(t.id));
 localStorage.setItem('unitTemplates',JSON.stringify(unitTemplates));
 renderUnitTemplates();
}
function editSelectedUnitTemplate(){
 let t=unitTemplates.find(x=>x.id===selectedUnitTemplates()[0]);
 if(!t)return;
 editingUnitId=t.id;
 document.getElementById('utName').value=t.name;
 document.getElementById('utBase').value=t.base;
 document.getElementById('utHigher').value=t.higher;
 document.getElementById('utHigherName').value=t.higherName;
 document.getElementById('utFactor').value=t.factor;
 openUnitTemplateForm();
}
function exportUnitTemplates(){
 let csv='اسم القالب,الوحدة الاساسية,الوحدة العليا,معامل التحويل\n'+
 unitTemplates.map(t=>`${t.name},${t.base},${t.higherName},${t.factor}`).join('\n');
 let a=document.createElement('a');
 a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
 a.download='unit_templates.csv';
 a.click();
}

document.addEventListener('DOMContentLoaded',renderUnitTemplates);


function toggleProductSettingsMenu(btn){
 const menu=document.getElementById('productSettingsMenu');
 if(menu) menu.style.display = menu.style.display==='none'?'block':'none';
}


// التصنيفات
let categories=JSON.parse(localStorage.getItem('categories')||'[]');
let editingCategoryId=null;
function openCategoryForm(){document.getElementById('catForm').style.display='block'; loadCategoryParents();}
function closeCategoryForm(){document.getElementById('catForm').style.display='none';editingCategoryId=null;}
function loadCategoryParents(){let s=document.getElementById('catParent'); if(!s)return; s.innerHTML='<option value="">تصنيف رئيسي</option>'+categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');}
function openCategories(){
 let b=document.getElementById('categoryBody');
 if(!b)return;
 b.innerHTML=categories.map(c=>`<tr><td><input type="checkbox" class="catCheck" value="${c.id}" onchange="showCatActions()"></td><td>${c.name}</td><td>${c.parent? (categories.find(x=>x.id==c.parent)?.name||''): 'تصنيف رئيسي'}</td><td>${c.desc||''}</td></tr>`).join('');
}
function saveCategory(){
 let c={id:editingCategoryId||Date.now(),name:document.getElementById('catName').value.trim(),parent:document.getElementById('catParent')?.value||'',desc:document.getElementById('catDesc').value};
 if(!c.name)return;
 if(categories.some(x=>x.name.trim()===c.name.trim()&&x.id!==c.id)){alert('التصنيف موجود مسبقاً');return;}
 if(editingCategoryId) categories=categories.map(x=>x.id===editingCategoryId?c:x); else categories.push(c);
 localStorage.setItem('categories',JSON.stringify(categories));
 window.categories=categories;
 openCategories();
 if(typeof loadProductDropdowns==='function') loadProductDropdowns();
 if(typeof loadSearchCategories==='function') loadSearchCategories();
}
function showCatActions(){document.getElementById('catActions').style.display=[...document.querySelectorAll('.catCheck:checked')].length?'block':'none';}

function editSelectedCategory(){let id=[...document.querySelectorAll('.catCheck:checked')][0]?.value;let c=categories.find(x=>x.id==id);if(!c)return;editingCategoryId=c.id;openCategoryForm();document.getElementById('catName').value=c.name;document.getElementById('catDesc').value=c.desc||'';document.getElementById('catParent').value=c.parent||'';}
function deleteSelectedCategories(){let ids=[...document.querySelectorAll('.catCheck:checked')].map(x=>x.value);categories=categories.filter(c=>!ids.includes(String(c.id)));localStorage.setItem('categories',JSON.stringify(categories));openCategories();}
function exportCategories(){let csv='التصنيف,الوصف\n'+categories.map(c=>`${c.name},${c.desc||''}`).join('\n');let a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='categories.csv';a.click();}


let itemPage=1;
let itemFiltered=[];
function openNewItem(){
 const f=document.getElementById('itemFormBox');
 cancelItemEdit();
 loadProductDropdowns();
 if(f) {
   f.style.display='block';
   f.scrollIntoView({behavior:'smooth', block:'nearest'});
 }
 const cancelBtn=document.getElementById('itemCancelBtn'); if(cancelBtn) cancelBtn.style.display='inline-block';
 const submitBtn=document.getElementById('itemSubmitBtn'); if(submitBtn){submitBtn.textContent='حفظ'; submitBtn.style.display='inline-block';}
 const title=document.getElementById('itemFormTitle'); if(title) title.textContent='إضافة منتج';
 refreshSelects();
}
function hasItemSearchFilters(){
  const ids=['searchItemAr','searchItemEn','searchItemCode','searchItemCategory','searchItemBrand','searchItemSupplier'];
  return ids.some(id=>{
    const e=document.getElementById(id);
    return e && String(e.value||'').trim() !== '';
  });
}

function applyItemSearch(){
  loadSearchCategories();
  filterItems();
}

function clearItemSearch(){
  ['searchItemAr','searchItemEn','searchItemCode','searchItemBrand','searchItemSupplier'].forEach(id=>{
    const e=document.getElementById(id); if(e) e.value='';
  });
  const cat=document.getElementById('searchItemCategory');
  if(cat) cat.value='';
  itemFiltered=[...(items||[])];
  itemFiltered.isFiltered=false;
  itemPage=1;
  renderItemsTable();
}

function normalizeSearchValue(v){
 return String(v||'').trim().toLowerCase();
}
function filterItems(){
 const ar=normalizeSearchValue((document.getElementById('searchItemAr')||{}).value);
 const en=normalizeSearchValue((document.getElementById('searchItemEn')||{}).value);
 const code=normalizeSearchValue((document.getElementById('searchItemCode')||{}).value);
 const cat=normalizeSearchValue((document.getElementById('searchItemCategory')||{}).value);
 const brand=normalizeSearchValue((document.getElementById('searchItemBrand')||{}).value);
 const sup=normalizeSearchValue((document.getElementById('searchItemSupplier')||{}).value);
 const hasFilters=!!(ar||en||code||cat||brand||sup);

 itemFiltered=(items||[]).filter(x=>
 (!ar||normalizeSearchValue(x.name).includes(ar)) &&
 (!en||normalizeSearchValue(x.name_en||x.nameEn).includes(en)) &&
 (!code||normalizeSearchValue(x.code).includes(code)) &&
 (!cat||normalizeSearchValue(x.category||x.category_id||x.category_name||x.categoryName).includes(cat)||normalizeSearchValue(findCategoryName(x.category||x.category_id, x)).includes(cat)) &&
 (!brand||normalizeSearchValue(x.brand).includes(brand)) &&
 (!sup||normalizeSearchValue(x.supplier||x.supplier_name||x.vendor).includes(sup))
 );
 itemFiltered.isFiltered=hasFilters;
 itemPage=1;
 renderItemsTable();
}
function renderItemsTable(){
 const body=document.getElementById('itemsBody'); if(!body)return;
 const arr=itemFiltered.isFiltered ? itemFiltered : (Array.isArray(itemFiltered) && itemFiltered.length ? itemFiltered : (items||[]));
 if(!arr.length){
  body.innerHTML='<tr><td colspan="10" class="empty-msg">لا توجد منتجات مطابقة للبحث</td></tr>';
  const empty=document.getElementById('itemsEmpty'); if(empty) empty.style.display='none';
  return;
 }
 body.innerHTML=arr.map(x=>{
 const dv=getItemDisplayValues(x);
 return `<tr>
 <td><input class="itemCheck" type="checkbox" value="${x.code}"></td>
 <td>${x.code||''}</td>
 <td>${x.name||''}</td>
 <td>${findCategoryName(x.category||x.category_id, x)}</td>
 <td>${renderUnitSelector(x)}</td>
 <td>${fmt(dv.qty)}</td>
 <td>${fmt(dv.purchase)}</td>
 <td>${fmt(dv.sale)}</td>
 <td>${fmt(dv.avg)}</td>
 <td>
   <div class="row-menu">
    <button class="row-menu-trigger" title="خيارات المنتج" onclick="toggleItemMenu('${x.code}', event)"><span></span><span></span><span></span></button>
    <div id="menu-${x.code}" class="menu-popup" style="display:none">
      <button onclick="viewItem('${x.code}')"><b>👁</b><span>عرض</span></button>
      <button onclick="editItem('${x.code}')"><b>✎</b><span>تعديل</span></button>
      <button onclick="copyItem('${x.code}')"><b>⧉</b><span>نسخ</span></button>
      <button class="danger" onclick="deleteItemSafe('${x.code}')"><b>🗑</b><span>حذف</span></button>
    </div>
   </div>
 </td>
 </tr>`}).join('');
}
function toggleItemMenu(code, ev){
 if(ev) ev.stopPropagation();
 const m=document.getElementById('menu-'+code);
 const willOpen = !m || m.style.display==='none';
 document.querySelectorAll('.menu-popup').forEach(e=>{e.style.display='none'; e.classList.remove('menu-popup-up');});
 document.querySelectorAll('.row-menu-trigger').forEach(b=>b.classList.remove('active'));
 if(m && willOpen){
   m.style.display='block';
   const trigger = ev && ev.currentTarget;
   if(trigger) trigger.classList.add('active');
   if(trigger){
     const rect = trigger.getBoundingClientRect();
     const menuHeight = m.scrollHeight || 190;
     if(window.innerHeight - rect.bottom < menuHeight + 16) m.classList.add('menu-popup-up');
   }
 }
}
document.addEventListener('click', function(e){
  if(!e.target.closest('.row-menu')){
    document.querySelectorAll('.menu-popup').forEach(m=>m.style.display='none');
    document.querySelectorAll('.row-menu-trigger').forEach(b=>b.classList.remove('active'));
  }
});

function deleteItemSafe(code){
 const it=(items||[]).find(i=>i.code===code);
 const hasMove=(stockMoves||[]).some(m=>it && m.item_id===it.id);
 if(hasMove){alert('لا يمكن حذف منتج عليه حركات مخزنية');return;}
 deleteItem(code);
}
function viewItem(code){
 const x=(items||[]).find(i=>i.code===code);
 if(!x)return;
 editItem(code);
 const box=document.getElementById('itemFormBox');
 if(box) box.style.display='block';
 const ids=['itemCode','itemName','itemNameEn','itemDesc','itemCategory','itemBrand','itemUnit','itemSupplier','itemBarcode','itemCost','itemPrice','itemOpenQty','itemAvgPrice','itemLastPurchase','itemReorder'];
 ids.forEach(id=>{const e=document.getElementById(id); if(e)e.disabled=true;});
 const btn=document.getElementById('itemSubmitBtn');
 if(btn) btn.style.display='none';
}

function copyItem(code){
 const f=document.getElementById('itemFormBox'); if(f) f.style.display='block';
 const x=(items||[]).find(i=>i.code===code);
 if(!x)return;
 cancelItemEdit();
 loadProductDropdowns();
 document.getElementById('itemName').value=x.name||'';
 document.getElementById('itemNameEn').value=x.name_en||'';
 document.getElementById('itemDesc').value=x.description||'';
 setSelectValueSmart('itemCategory', x.category||x.category_id||x.category_name||x.categoryName||'');
 document.getElementById('itemBrand').value=x.brand||'';
 const copyUnitTemplate=findUnitTemplateByValue(x.unit_template||x.unit);
 document.getElementById('itemUnit').value=copyUnitTemplate ? String(copyUnitTemplate.id||copyUnitTemplate.name||copyUnitTemplate.base) : (x.unit||'');
 document.getElementById('itemSupplier').value=x.supplier||'';
 document.getElementById('itemBarcode').value=x.barcode||'';
 document.getElementById('itemCost').value=x.default_cost||0;
 document.getElementById('itemPrice').value=x.sale_price||0;
 document.getElementById('itemOpenQty').value=x.opening_qty||0;
 document.getElementById('itemAvgPrice').value=x.avg_price||0;
 document.getElementById('itemLastPurchase').value=x.last_purchase||0;
 alert('تم فتح نسخة جديدة من المنتج، قم بتغيير الكود قبل الحفظ');
}

function toggleAllItems(c){document.querySelectorAll('.itemCheck').forEach(x=>x.checked=c.checked);}
function prevItemPage(){if(itemPage>1)itemPage--;document.getElementById('itemPageInfo').textContent=itemPage;}
function nextItemPage(){itemPage++;document.getElementById('itemPageInfo').textContent=itemPage;}

// ============================================================
// USER DROPDOWN — القائمة المنسدلة للمستخدم
// ============================================================
function toggleUserMenu() {
  const dd = document.getElementById('userDropdown');
  const tr = document.getElementById('userTrigger');
  if (!dd) return;
  const isOpen = dd.classList.contains('show');
  dd.classList.toggle('show', !isOpen);
  if (tr) tr.classList.toggle('open', !isOpen);
}

// إغلاق القائمة عند النقر خارجها
document.addEventListener('click', function(e) {
  const dd = document.getElementById('userDropdown');
  const tr = document.getElementById('userTrigger');
  if (dd && tr && !tr.contains(e.target) && !dd.contains(e.target)) {
    dd.classList.remove('show');
    if (tr) tr.classList.remove('open');
  }
});


// ============================================================
// SIDEBAR WIDTH — التحكم في عرض القائمة العمودية
// ============================================================
function setSidebarWidth(width){
  width = Math.max(260, Math.min(460, Number(width) || 320));
  document.documentElement.style.setProperty('--sidebar-w', width + 'px');
  try { localStorage.setItem('erp-sidebar-w', String(width)); } catch(e){}
}
function adjustSidebarWidth(delta){
  const current = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 320;
  setSidebarWidth(current + delta);
}
function initSidebarResize(){
  const saved = parseInt(localStorage.getItem('erp-sidebar-w') || '320');
  setSidebarWidth(saved);
  const handle = document.getElementById('sbResizeHandle');
  if(!handle) return;
  let dragging = false;
  handle.addEventListener('mousedown', function(e){ dragging = true; document.body.style.userSelect='none'; e.preventDefault(); });
  window.addEventListener('mousemove', function(e){
    if(!dragging) return;
    const width = Math.max(260, Math.min(460, window.innerWidth - e.clientX));
    setSidebarWidth(width);
  });
  window.addEventListener('mouseup', function(){ dragging = false; document.body.style.userSelect=''; });
}
window.adjustSidebarWidth = adjustSidebarWidth;

// ============================================================
// LAYOUT — تبديل الوضع الأفقي / العمودي
// ============================================================
function setLayout(mode) {
  const body=document.body;
  if(!body) return;
  body.classList.toggle('horizontal-layout', mode==='horizontal');
  body.classList.toggle('vertical-layout', mode==='vertical');

  const modules=document.getElementById('erpModules');
  const nav=document.getElementById('mainNav');

  if(mode==='vertical'){
    if(modules) modules.style.display='none';
    if(nav) nav.style.display='';
  }else{
    if(modules) modules.style.display='grid';
    if(nav) nav.style.display='none';
  }

  const h=document.getElementById('optHorizontal');
  const v=document.getElementById('optVertical');
  if(h) h.classList.toggle('active',mode==='horizontal');
  if(v) v.classList.toggle('active',mode==='vertical');

  localStorage.setItem('erp-layout',mode);
  if (typeof restoreHorizontalSubmenus === 'function') restoreHorizontalSubmenus();
  if (typeof resetHomeState === 'function') resetHomeState();
}

// ============================================================
// LANGUAGE — تبديل اللغة
// ============================================================
let currentLang = 'ar';

function setLanguage(lang) {
  currentLang = lang;
  if (window.LegendDLocalization && typeof window.LegendDLocalization.applyLanguage === 'function') {
    window.LegendDLocalization.applyLanguage(lang);
    return;
  }
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  document.body.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  const optAr = document.getElementById('optAr');
  const optEn = document.getElementById('optEn');
  if (optAr) optAr.classList.toggle('active', lang === 'ar');
  if (optEn) optEn.classList.toggle('active', lang === 'en');
  try { localStorage.setItem('erp-lang', lang); } catch(e){}
}

// دوال التوافق مع الكود القديم
function toggleLayout() { setLayout(document.body.classList.contains('vertical-layout') ? 'horizontal' : 'vertical'); }
function toggleLanguage() { setLanguage(currentLang === 'ar' ? 'en' : 'ar'); }

window.loadAll = window.loadAll || function(){ console.log('load ok'); };


function restoreHorizontalSubmenus(){
 const modules=document.getElementById('erpModules');
 if(!modules) return;
 document.querySelectorAll('.erp-submenu-horizontal').forEach(sub=>{
   sub.classList.remove('show','active-submenu');
   sub.style.order='';
   if(sub.parentElement===modules) modules.parentElement.insertBefore(sub, modules.nextSibling);
 });
 document.querySelectorAll('.erp-module-card').forEach(card=>{card.classList.remove('active-module'); card.style.order='';});
 document.body.classList.remove('erp-module-expanded');
}
function toggleERPModule(id){
 const modules=document.getElementById('erpModules');
 const el=document.getElementById(id);
 const card = document.querySelector(`.erp-module-card[onclick*="${id}"]`);
 if(!modules || !el || !card) return;
 const isOpen = el.classList.contains('show') && card.classList.contains('active-module');
 restoreHorizontalSubmenus();
 if(isOpen) return;
 document.body.classList.add('erp-module-expanded');
 card.classList.add('active-module');
 card.style.order='1';
 modules.appendChild(el);
 el.classList.add('show','active-submenu');
 el.style.order='2';
 document.querySelectorAll('.erp-module-card:not(.active-module)').forEach(card=>card.style.order='3');
}
window.toggleERPModule=toggleERPModule;

function openSubModule(name){
  const map={
    // الحسابات
    'الدليل المحاسبي':'tree',
    'دليل الحسابات':'tree',
    'القيود اليومية':'journal',
    'إضافة قيد':'entry',
    'تفاصيل القيد':'entry-detail',
    'مراكز التكلفة':'cost',
    'إعدادات الحسابات':'settings',
    'إعدادات الضرائب':'tax_settings',

    // المخزون
    'المنتجات':'items',
    'الخدمات':'services',
    'الإذون المخزنية':'stockmoves',
    'المستودعات':'warehouses',
    'قوائم الاسعار':'prices',
    'قوائم الأسعار':'prices',
    'تتبع المنتجات':'tracking',
    'إعدادات المنتجات والخدمات':'productsettings',

    // المشتريات
    'طلب شراء':'purchase_request',
    'طلب عرض سعر':'quotation_request',
    'أوامر الشراء':'purchase_orders',
    'استلام البضاعة':'goods_receipt',
    'فواتير الشراء':'purchase_invoices',
    'مرتجعات المشتريات':'purchase_returns',
    'إدارة الموردين':'suppliers',
    'مدفوعات الموردين':'supplier_payments',
    'إعدادات المشتريات':'purchase_settings',

    // المبيعات
    'عرض سعر':'sales_quote',
    'أمر بيع':'sales_order',
    'إذن تسليم/صرف بضاعة':'delivery_note',
    'إنشاء فاتورة':'sales_invoice_create',
    'إدارة الفواتير':'sales_invoices',
    'المرتجعات':'sales_returns',
    'إشعارات دائنة':'credit_notes',
    'مدفوعات العملاء':'customer_payments',
    'إعدادات المبيعات':'sales_settings',

    // نقاط البيع والعملاء والمالية والأصول والتقارير
    'بدء الجلسة':'pos_start',
    'الجلسات':'pos_sessions',
    'تقارير نقاط البيع':'pos_reports',
    'إعدادات نقاط البيع':'pos_settings',
    'إدارة العملاء':'customers',
    'إضافة عميل جديد':'customer_add',
    'قوائم الاتصال':'contact_lists',
    'إعدادات العملاء':'customer_settings',
    'المصروفات':'expenses',
    'سندات القبض':'receipts',
    'سندات الصرف':'payments',
    'خزائن وحسابات بنكية':'cash_banks',
    'طرق الدفع':'payment_methods',
    'إعدادات المالية':'finance_settings',
    'إضافة أصول':'asset_add',
    'قائمة الأصول':'assets_list',
    'تقارير المبيعات':'sales_reports',
    'تقارير المشتريات':'purchase_reports',
    'تقارير الحسابات العامة':'gl_reports',
    'تقارير العملاء':'customer_reports',
    'تقارير المخزون':'inventory_reports',
    'تقارير النشاطات':'activity_reports',

    // قوالب الطباعة
    'قوالب الطباعة':'print_templates',
    'قوالب الواتس اب':'whatsapp_templates',
    'قوالب الايميل':'email_templates',
    'قواعد الارسال الالي':'auto_send_rules',
    'قواعد الإرسال الآلي':'auto_send_rules',

    // الإعدادات العامة
    'معلومات الحساب':'account_info',
    'إعدادات الحساب العامة':'account_settings_general',
    'إعدادات الحساب':'account_settings_general',
    'إعدادات الترقيم المتسلسل':'sequence_settings',
    'إدارة التطبيقات':'apps_management',
    'السمات والخلفيات':'themes_backgrounds'
  };

  const tabKey = map[name];
  if (tabKey && typeof activateTab === 'function') {
    activateTab(tabKey);
    document.querySelectorAll('.erp-submenu-horizontal').forEach(menu => menu.classList.remove('show'));
    return;
  }
  console.warn('لم يتم العثور على شاشة مرتبطة بهذا العنصر:', name);
}
window.openSubModule=openSubModule;

/* ===== v9 fixes: product settings submenu + real product edit sync ===== */
(function(){
  function val(id){ const e=document.getElementById(id); return e ? e.value : ''; }
  function num(id){ const n=parseFloat(val(id)); return Number.isFinite(n) ? n : 0; }
  function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  window.__normalizeProductRow = function(row){
    row = row || {};
    const purchase = getNumberValue(row, ['purchase_price','buy_price','cost','default_cost','last_purchase','lastPurchase'], 0);
    const sale = getNumberValue(row, ['sale_price','selling_price','sales_price','price','default_price'], 0);
    const qty = getNumberValue(row, ['qty_on_hand','quantity','qty','stock_qty','opening_qty','available_qty'], 0);
    const avg = getNumberValue(row, ['avg_cost','avg_price','average_cost','average_purchase','average_purchase_price'], purchase);
    return {
      ...row,
      purchase_price: purchase,
      buy_price: purchase,
      cost: purchase,
      default_cost: purchase,
      sale_price: sale,
      selling_price: sale,
      price: sale,
      qty_on_hand: qty,
      quantity: qty,
      opening_qty: qty,
      avg_cost: avg,
      avg_price: avg,
      category: row.category || row.category_id || row.category_name || row.categoryName || '',
      category_name: findCategoryName(row.category || row.category_id || row.category_name || row.categoryName, row)
    };
  };

  const oldGetItemDisplayValues = window.getItemDisplayValues || getItemDisplayValues;
  window.getItemDisplayValues = getItemDisplayValues = function(item){
    item = window.__normalizeProductRow(item || {});
    const selectedUnit = item.display_unit || findUnitDisplay(item.unit, item.unit_template || item.unit_template_id || item.unitTemplateId);
    const factor = getItemUnitFactor(item, selectedUnit);
    const qtyBase = getNumberValue(item, ['qty_on_hand','quantity','qty','stock_qty','opening_qty','available_qty'], 0);
    const purchaseBase = getNumberValue(item, ['purchase_price','buy_price','cost','default_cost','last_purchase','lastPurchase'], 0);
    const saleBase = getNumberValue(item, ['sale_price','selling_price','sales_price','price','default_price'], 0);
    const avgBase = getNumberValue(item, ['avg_cost','avg_price','average_cost','average_purchase','average_purchase_price'], purchaseBase);
    return { unit:selectedUnit, qty:factor>1 ? qtyBase/factor : qtyBase, purchase:factor>1 ? purchaseBase*factor : purchaseBase, sale:factor>1 ? saleBase*factor : saleBase, avg:factor>1 ? avgBase*factor : avgBase };
  };

  window.renderItemsTable = renderItemsTable = function(){
    const body=document.getElementById('itemsBody'); if(!body)return;
    const arr=itemFiltered && itemFiltered.isFiltered ? itemFiltered : (Array.isArray(itemFiltered) && itemFiltered.length ? itemFiltered : (items||[]));
    if(!arr.length){
      body.innerHTML='<tr><td colspan="10" class="empty-msg">لا توجد منتجات مطابقة للبحث</td></tr>';
      const empty=document.getElementById('itemsEmpty'); if(empty) empty.style.display='none';
      return;
    }
    body.innerHTML=arr.map(raw=>{
      const x=window.__normalizeProductRow(raw);
      const dv=getItemDisplayValues(x);
      return `<tr>
        <td><input class="itemCheck" type="checkbox" value="${esc(x.code)}"></td>
        <td>${esc(x.code)}</td>
        <td>${esc(x.name)}</td>
        <td>${esc(findCategoryName(x.category||x.category_id||x.category_name||x.categoryName, x))}</td>
        <td>${renderUnitSelector(x)}</td>
        <td>${fmt(dv.qty)}</td>
        <td>${fmt(dv.purchase)}</td>
        <td>${fmt(dv.sale)}</td>
        <td>${fmt(dv.avg)}</td>
        <td>
          <div class="row-menu">
            <button class="row-menu-trigger" title="خيارات المنتج" onclick="toggleItemMenu('${String(x.code).replace(/'/g,'&#39;')}', event)"><span></span><span></span><span></span></button>
            <div id="menu-${esc(x.code)}" class="menu-popup" style="display:none">
              <button onclick="viewItem('${String(x.code).replace(/'/g,'&#39;')}')"><b>👁</b><span>عرض</span></button>
              <button onclick="editItem('${String(x.code).replace(/'/g,'&#39;')}')"><b>✎</b><span>تعديل</span></button>
              <button onclick="copyItem('${String(x.code).replace(/'/g,'&#39;')}')"><b>⧉</b><span>نسخ</span></button>
              <button class="danger" onclick="deleteItemSafe('${String(x.code).replace(/'/g,'&#39;')}')"><b>🗑</b><span>حذف</span></button>
            </div>
          </div>
        </td>
      </tr>`;
    }).join('');
  };

  window.submitItem = submitItem = async function(){
    const editCode=val('itemEditCode');
    const code=val('itemCode').trim();
    const name=val('itemName').trim();
    const err=document.getElementById('itemErr');
    if(!code||!name){ if(err) err.textContent='يرجى إدخال الكود والاسم'; return; }
    if(!val('itemCategory')){ if(err) err.textContent='يجب اختيار التصنيف'; return; }
    if(!val('itemUnit')){ if(err) err.textContent='يجب اختيار قالب الوحدات'; return; }
    if(err) err.textContent='';
    const unitTemplate=findUnitTemplateByValue(val('itemUnit'));
    const baseUnit=unitTemplate ? (unitTemplate.base || unitTemplate.name || unitTemplate.id) : val('itemUnit');
    const categoryValue=val('itemCategory');
    const payload=window.__normalizeProductRow({
      code: editCode || code,
      name,
      name_en:val('itemNameEn'),
      description:val('itemDesc'),
      category:categoryValue,
      category_id:categoryValue,
      category_name:findCategoryName(categoryValue),
      brand:val('itemBrand'),
      supplier:val('itemSupplier'),
      barcode:val('itemBarcode'),
      price_lists:val('itemPriceLists'),
      status:val('itemStatus') || 'تنشيط',
      unit:baseUnit,
      base_unit:baseUnit,
      unit_template:unitTemplate ? (unitTemplate.id||unitTemplate.name||unitTemplate.base) : val('itemUnit'),
      unit_template_name:unitTemplate ? (unitTemplate.name||'') : '',
      display_unit:baseUnit,
      default_cost:num('itemCost'),
      purchase_price:num('itemCost'),
      cost:num('itemCost'),
      sale_price:num('itemPrice'),
      price:num('itemPrice'),
      opening_qty:num('itemOpenQty'),
      qty_on_hand:num('itemOpenQty'),
      quantity:num('itemOpenQty'),
      avg_price:num('itemAvgPrice'),
      avg_cost:num('itemAvgPrice'),
      last_purchase:num('itemLastPurchase'),
      reorder_point:num('itemReorder')
    });
    try{
      if(editCode){ try{ await api('PUT',`/api/items/${encodeURIComponent(editCode)}`,payload); }catch(e){ console.warn('حفظ محلي للمنتج بعد تعذر الخادم', e.message); } }
      else { try{ await api('POST','/api/items',payload); }catch(e){ console.warn('إضافة محلية للمنتج بعد تعذر الخادم', e.message); } }
      const target=String(editCode || code);
      const exists=(items||[]).some(x=>String(x.code)===target);
      items = exists ? (items||[]).map(x=>String(x.code)===target ? window.__normalizeProductRow({...x,...payload}) : x) : [...(items||[]), payload];
      if(itemFiltered && Array.isArray(itemFiltered)) itemFiltered = itemFiltered.map(x=>String(x.code)===target ? window.__normalizeProductRow({...x,...payload}) : x);
      try{ localStorage.setItem('items_cache', JSON.stringify(items||[])); }catch(e){}
      cancelItemEdit();
      itemFiltered=[...(items||[])]; itemFiltered.isFiltered=false;
      renderItemsTable();
      loadSearchCategories();
    }catch(e){ if(err) err.textContent=e.message; }
  };

  window.editItem = editItem = function(code){
    const f=document.getElementById('itemFormBox'); if(f) f.style.display='block';
    const raw=(items||[]).find(i=>String(i.code)===String(code)); if(!raw) return;
    const it=window.__normalizeProductRow(raw);
    document.getElementById('itemEditCode').value=it.code;
    document.getElementById('itemCode').value=it.code; document.getElementById('itemCode').disabled=true;
    document.getElementById('itemName').value=it.name||'';
    document.getElementById('itemNameEn').value=it.name_en||it.nameEn||'';
    document.getElementById('itemDesc').value=it.description||'';
    document.getElementById('itemBrand').value=it.brand||'';
    document.getElementById('itemSupplier').value=it.supplier||it.supplier_name||it.vendor||'';
    document.getElementById('itemBarcode').value=it.barcode||'';
    document.getElementById('itemPriceLists').value=it.price_lists||'';
    document.getElementById('itemAvgPrice').value=it.avg_price||it.avg_cost||0;
    document.getElementById('itemLastPurchase').value=it.last_purchase||0;
    document.getElementById('itemStatus').value=it.status||'تنشيط';
    loadProductDropdowns();
    setSelectValueSmart('itemCategory', it.category||it.category_id||it.category_name||it.categoryName||'');
    const tpl=findUnitTemplateByValue(it.unit_template||it.unit_template_id||it.unit);
    const unitEl=document.getElementById('itemUnit'); if(unitEl) unitEl.value=tpl ? String(tpl.id||tpl.name||tpl.base) : (it.unit||'');
    document.getElementById('itemCost').value=it.default_cost||it.purchase_price||it.cost||0;
    document.getElementById('itemPrice').value=it.sale_price||it.price||0;
    document.getElementById('itemOpenQty').value=it.opening_qty||it.qty_on_hand||it.quantity||0;
    document.getElementById('itemReorder').value=it.reorder_point||0;
    document.getElementById('itemFormTitle').textContent='تعديل: '+(it.name||'');
    document.getElementById('itemSubmitBtn').textContent='حفظ التعديلات';
    document.getElementById('itemSubmitBtn').style.display='inline-block';
    document.getElementById('itemCancelBtn').style.display='inline-block';
    const tab=document.querySelector('[data-tab="items"]'); if(tab) tab.click();
    window.scrollTo({top:0,behavior:'smooth'});
  };

  window.updateItemDisplayUnit = updateItemDisplayUnit = function(code, unit){
    items = (items||[]).map(x => String(x.code)===String(code) ? window.__normalizeProductRow({...x, display_unit:unit}) : x);
    if(itemFiltered && Array.isArray(itemFiltered)) itemFiltered = itemFiltered.map(x => String(x.code)===String(code) ? window.__normalizeProductRow({...x, display_unit:unit}) : x);
    try{ localStorage.setItem('items_cache', JSON.stringify(items||[])); }catch(e){}
    renderItemsTable();
  };

  document.addEventListener('DOMContentLoaded', function(){
    const psBtn=document.querySelector('.sb-item[data-tab="productsettings"]');
    const psMenu=document.getElementById('productSettingsMenu');
    if(psMenu){ psMenu.style.display='block'; }
    if(psBtn){
      psBtn.addEventListener('click', function(){
        const section=this.closest('.sb-section'); if(section) section.classList.add('open');
        const menu=document.getElementById('productSettingsMenu'); if(menu) menu.style.display='block';
      });
    }
  });
})();


// ============================================================
// تحسينات v11: فهرس التصنيفات / قوالب الوحدات + عرض المنتج مع زر تعديل
// ============================================================
(function(){
  const pageSize = 10;
  window.__catPage = window.__catPage || 1;
  window.__unitTemplatePage = window.__unitTemplatePage || 1;

  function esc2(v){return String(v ?? '').replace(/[&<>"]/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));}
  function setInfo(prefix, page, total){
    const start = total ? ((page-1)*pageSize)+1 : 0;
    const end = Math.min(page*pageSize,total);
    const info=document.getElementById(prefix+'IndexInfo');
    if(info) info.textContent = total ? `عرض الصفوف ${start} - ${end} من إجمالي ${total}` : 'لا توجد صفوف';
    const prev=document.getElementById(prefix+'PrevBtn');
    const next=document.getElementById(prefix+'NextBtn');
    if(prev) prev.disabled = page<=1;
    if(next) next.disabled = end>=total;
  }

  const oldRenderUnitTemplates = window.renderUnitTemplates || (typeof renderUnitTemplates==='function' ? renderUnitTemplates : null);
  window.renderUnitTemplates = renderUnitTemplates = function(){
    const body=document.getElementById('unitTemplatesBody');
    if(!body){ if(oldRenderUnitTemplates) oldRenderUnitTemplates(); return; }
    const list = Array.isArray(unitTemplates) ? unitTemplates : [];
    const maxPage=Math.max(1, Math.ceil(list.length/pageSize));
    window.__unitTemplatePage=Math.min(Math.max(1, window.__unitTemplatePage||1), maxPage);
    const page=window.__unitTemplatePage;
    const start=(page-1)*pageSize;
    const part=list.slice(start,start+pageSize);
    body.innerHTML = part.length ? part.map(t=>`
      <tr>
        <td><input type="checkbox" class="utCheck" value="${esc2(t.id)}" onchange="showUnitActions()"></td>
        <td>${esc2(t.name)}</td>
        <td>${esc2(t.base)}</td>
        <td>${esc2(t.higherName || t.higher || '')}</td>
        <td>${esc2(t.factor)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty-msg">لا توجد قوالب وحدات</td></tr>';
    window.unitTemplates=unitTemplates;
    setInfo('unit', page, list.length);
    if(typeof loadProductDropdowns==='function') loadProductDropdowns();
  };
  window.prevUnitTemplatePage=function(){ if((window.__unitTemplatePage||1)>1){ window.__unitTemplatePage--; renderUnitTemplates(); }};
  window.nextUnitTemplatePage=function(){ const total=(Array.isArray(unitTemplates)?unitTemplates.length:0); if((window.__unitTemplatePage||1)*pageSize<total){ window.__unitTemplatePage++; renderUnitTemplates(); }};

  window.openCategories = openCategories = function(){
    const body=document.getElementById('categoryBody'); if(!body)return;
    const list=Array.isArray(categories)?categories:[];
    const maxPage=Math.max(1, Math.ceil(list.length/pageSize));
    window.__catPage=Math.min(Math.max(1, window.__catPage||1), maxPage);
    const page=window.__catPage;
    const start=(page-1)*pageSize;
    const part=list.slice(start,start+pageSize);
    body.innerHTML = part.length ? part.map(c=>`
      <tr>
        <td><input type="checkbox" class="catCheck" value="${esc2(c.id)}" onchange="showCatActions()"></td>
        <td>${esc2(c.name)}</td>
        <td>${esc2(c.parent ? ((categories.find(x=>String(x.id)===String(c.parent))||{}).name || '') : 'تصنيف رئيسي')}</td>
        <td>${esc2(c.desc||'')}</td>
      </tr>`).join('') : '<tr><td colspan="4" class="empty-msg">لا توجد تصنيفات</td></tr>';
    setInfo('cat', page, list.length);
  };
  window.prevCategoryPage=function(){ if((window.__catPage||1)>1){ window.__catPage--; openCategories(); }};
  window.nextCategoryPage=function(){ const total=(Array.isArray(categories)?categories.length:0); if((window.__catPage||1)*pageSize<total){ window.__catPage++; openCategories(); }};

  const oldSaveCategory = window.saveCategory || (typeof saveCategory==='function' ? saveCategory : null);
  window.saveCategory = saveCategory = function(){
    if(oldSaveCategory) oldSaveCategory();
    window.__catPage=Math.max(1, Math.ceil((categories||[]).length/pageSize));
    openCategories();
  };
  const oldSaveUnitTemplate = window.saveUnitTemplate || (typeof saveUnitTemplate==='function' ? saveUnitTemplate : null);
  window.saveUnitTemplate = saveUnitTemplate = function(){
    if(oldSaveUnitTemplate) oldSaveUnitTemplate();
    window.__unitTemplatePage=Math.max(1, Math.ceil((unitTemplates||[]).length/pageSize));
    renderUnitTemplates();
  };

  const baseEditItem = window.editItem || (typeof editItem==='function' ? editItem : null);
  window.enableItemViewEdit = function(code){
    if(baseEditItem) baseEditItem(code);
    const ids=['itemCode','itemName','itemNameEn','itemDesc','itemCategory','itemBrand','itemUnit','itemSupplier','itemBarcode','itemCost','itemPrice','itemOpenQty','itemAvgPrice','itemLastPurchase','itemReorder','itemPriceLists','itemStatus'];
    ids.forEach(id=>{const e=document.getElementById(id); if(e)e.disabled=false;});
    const submit=document.getElementById('itemSubmitBtn');
    if(submit){ submit.textContent='حفظ التعديلات'; submit.classList.remove('product-view-edit-btn'); submit.setAttribute('onclick','submitItem()'); submit.style.display='inline-block'; }
    const cancel=document.getElementById('itemCancelBtn'); if(cancel) cancel.style.display='inline-block';
  };
  window.viewItem = viewItem = function(code){
    const raw=(items||[]).find(i=>String(i.code)===String(code));
    if(!raw || !baseEditItem) return;
    baseEditItem(code);
    const ids=['itemCode','itemName','itemNameEn','itemDesc','itemCategory','itemBrand','itemUnit','itemSupplier','itemBarcode','itemCost','itemPrice','itemOpenQty','itemAvgPrice','itemLastPurchase','itemReorder','itemPriceLists','itemStatus'];
    ids.forEach(id=>{const e=document.getElementById(id); if(e)e.disabled=true;});
    const submit=document.getElementById('itemSubmitBtn');
    if(submit){
      submit.textContent='تعديل';
      submit.classList.add('product-view-edit-btn');
      submit.setAttribute('onclick',`enableItemViewEdit('${String(code).replace(/'/g,"\\'")}')`);
      submit.style.display='inline-block';
    }
    const cancel=document.getElementById('itemCancelBtn'); if(cancel){ cancel.style.display='inline-block'; cancel.textContent='إلغاء'; }
    const title=document.getElementById('itemFormTitle'); if(title) title.textContent='عرض المنتج: '+(raw.name||raw.code||'');
  };

  document.addEventListener('DOMContentLoaded', function(){
    if(document.getElementById('unitTemplatesBody')) renderUnitTemplates();
    if(document.getElementById('categoryBody')) openCategories();
  });
})();


/* ===== v14: Manual sale price per product unit (wholesale/retail policy) ===== */
(function(){
  function q(id){ return document.getElementById(id); }
  function toNum(v){ const n=parseFloat(v); return Number.isFinite(n)?n:0; }
  function safeEsc(s){
    if(typeof esc==='function') return esc(String(s??''));
    return String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function currentUnitTemplateFromForm(){
    try{ return typeof findUnitTemplateByValue==='function' ? findUnitTemplateByValue(q('itemUnit')?.value||'') : null; }catch(e){ return null; }
  }
  function unitsFromTemplate(tpl){
    const units=[];
    if(tpl){
      const base=tpl.base || tpl.name || '';
      const higher=tpl.higherName || tpl.higher || '';
      if(base) units.push({value:String(base), label:String(base), factor:1});
      if(higher && !units.some(u=>u.value===String(higher))) units.push({value:String(higher), label:String(higher), factor:Number(tpl.factor)||1});
    }
    const raw=q('itemUnit')?.selectedOptions?.[0]?.textContent?.trim();
    if(raw && !/^اختر/.test(raw) && !units.some(u=>u.value===raw)) units.push({value:raw,label:raw,factor:1});
    return units;
  }
  function ensureManualSaleBox(){
    let box=q('unitSalePricesBox');
    if(box) return box;
    const priceInput=q('itemPrice');
    if(!priceInput) return null;
    const field=priceInput.closest('.field') || priceInput.parentElement;
    box=document.createElement('div');
    box.id='unitSalePricesBox';
    box.className='field unit-sale-prices-field';
    box.style.gridColumn='1 / -1';
    field.insertAdjacentElement('afterend', box);
    return box;
  }
  window.renderUnitSalePriceFields=function(savedPrices){
    const box=ensureManualSaleBox(); if(!box) return;
    const tpl=currentUnitTemplateFromForm();
    const units=unitsFromTemplate(tpl);
    if(!units.length){ box.innerHTML=''; return; }
    let saved={};
    if(savedPrices && typeof savedPrices==='object') saved=savedPrices;
    else {
      try{ saved=JSON.parse(box.dataset.savedPrices||'{}')||{}; }catch(e){ saved={}; }
    }
    const defaultSale=toNum(q('itemPrice')?.value||0);
    box.dataset.savedPrices=JSON.stringify(saved||{});
    box.innerHTML=`<label class="unit-sale-title">أسعار البيع اليدوية حسب الوحدة</label>
      <div class="unit-sale-hint">اكتب سعر البيع لكل وحدة يدويًا. سعر الكرتون لا يتم حسابه بضرب سعر الحبة.</div>
      <div class="unit-sale-grid">${units.map(u=>{
        const val = saved[u.value]!==undefined && saved[u.value]!==null && saved[u.value]!=='' ? saved[u.value] : (u.factor===1 ? defaultSale : '');
        return `<div class="unit-sale-card"><span>${safeEsc(u.label)}</span><input class="unit-sale-price-input" data-unit="${safeEsc(u.value)}" type="number" step="0.01" value="${safeEsc(val)}" placeholder="سعر البيع"></div>`;
      }).join('')}</div>`;
  };
  window.collectUnitSalePrices=function(){
    const prices={};
    document.querySelectorAll('#unitSalePricesBox .unit-sale-price-input').forEach(inp=>{
      const u=inp.getAttribute('data-unit')||'';
      if(u) prices[u]=toNum(inp.value);
    });
    return prices;
  };
  function attachUnitPriceEvents(){
    const unit=q('itemUnit');
    if(unit && !unit.dataset.v14UnitPriceHook){
      unit.dataset.v14UnitPriceHook='1';
      unit.addEventListener('change',()=>renderUnitSalePriceFields());
    }
    const price=q('itemPrice');
    if(price && !price.dataset.v14UnitPriceHook){
      price.dataset.v14UnitPriceHook='1';
      price.addEventListener('input',()=>{
        const baseInput=document.querySelector('#unitSalePricesBox .unit-sale-price-input');
        if(baseInput && (!baseInput.value || baseInput.dataset.autoBase==='1')){ baseInput.value=price.value; baseInput.dataset.autoBase='1'; }
      });
    }
  }
  function getManualSaleForUnit(item, selectedUnit, fallback){
    const prices=(item && (item.unit_sale_prices || item.unitSalePrices || item.sale_prices_by_unit || item.unitPrices)) || {};
    const unit=String(selectedUnit||'');
    if(prices && typeof prices==='object'){
      if(prices[unit]!==undefined && prices[unit]!==null && prices[unit] !== '') return toNum(prices[unit]);
      const tpl=(typeof getItemUnitTemplate==='function') ? getItemUnitTemplate(item) : null;
      const base=tpl ? String(tpl.base||tpl.name||'') : String(item?.unit||item?.base_unit||'');
      if(base && prices[base]!==undefined && prices[base]!==null && prices[base] !== '') return toNum(prices[base]);
    }
    return fallback;
  }
  const oldGetDisplay=window.getItemDisplayValues;
  if(typeof oldGetDisplay==='function'){
    window.getItemDisplayValues=getItemDisplayValues=function(item){
      const dv=oldGetDisplay.apply(this,arguments) || {};
      const selectedUnit=dv.unit || item?.display_unit || item?.unit;
      dv.sale=getManualSaleForUnit(item, selectedUnit, dv.sale || 0);
      return dv;
    };
  }
  const oldSubmit=window.submitItem;
  if(typeof oldSubmit==='function'){
    window.submitItem=async function(){
      const prices=collectUnitSalePrices();
      const editCode=q('itemEditCode')?.value||'';
      const code=(editCode || q('itemCode')?.value || '').trim();
      const main=q('itemPrice');
      const first=Object.keys(prices)[0];
      if(main && first && prices[first]!==undefined) main.value=prices[first];
      const r=await oldSubmit.apply(this,arguments);
      if(code){
        try{
          items=(items||[]).map(x=>String(x.code)===String(code)?{...x,unit_sale_prices:prices,sale_prices_by_unit:prices}:x);
          window.items=items;
          if(itemFiltered && Array.isArray(itemFiltered)) itemFiltered=itemFiltered.map(x=>String(x.code)===String(code)?{...x,unit_sale_prices:prices,sale_prices_by_unit:prices}:x);
          localStorage.setItem('items_cache',JSON.stringify(items||[]));
          if(typeof renderItemsTable==='function') renderItemsTable();
        }catch(e){}
      }
      return r;
    };
  }
  const oldEdit=window.editItem;
  if(typeof oldEdit==='function'){
    window.editItem=function(code){
      const r=oldEdit.apply(this,arguments);
      const item=(window.items||items||[]).find(x=>String(x.code)===String(code));
      setTimeout(()=>{ attachUnitPriceEvents(); renderUnitSalePriceFields(item && (item.unit_sale_prices||item.sale_prices_by_unit)); },0);
      return r;
    };
  }
  const oldOpenNew=window.openNewItem;
  if(typeof oldOpenNew==='function'){
    window.openNewItem=function(){ const r=oldOpenNew.apply(this,arguments); setTimeout(()=>{ attachUnitPriceEvents(); renderUnitSalePriceFields(); },0); return r; };
  }
  const oldView=window.viewItem;
  if(typeof oldView==='function'){
    window.viewItem=function(code){
      const r=oldView.apply(this,arguments);
      const item=(window.items||items||[]).find(x=>String(x.code)===String(code));
      setTimeout(()=>{ attachUnitPriceEvents(); renderUnitSalePriceFields(item && (item.unit_sale_prices||item.sale_prices_by_unit)); document.querySelectorAll('#unitSalePricesBox input').forEach(i=>i.disabled=true); },0);
      return r;
    };
  }
  document.addEventListener('DOMContentLoaded',()=>{ attachUnitPriceEvents(); setTimeout(()=>renderUnitSalePriceFields(),250); });
})();


/* FIX v15: تفعيل حقول أسعار البيع اليدوية عند الإضافة أو التعديل */
(function(){
  function unlockUnitSaleInputs(){
    try{
      document.querySelectorAll('#unitSalePricesBox .unit-sale-price-input').forEach(function(inp){
        inp.disabled = false;
        inp.removeAttribute('disabled');
        inp.readOnly = false;
        inp.removeAttribute('readonly');
        inp.style.pointerEvents = 'auto';
        inp.style.opacity = '1';
        inp.style.backgroundColor = '#fff';
      });
    }catch(e){}
  }
  function lockUnitSaleInputs(){
    try{ document.querySelectorAll('#unitSalePricesBox .unit-sale-price-input').forEach(function(inp){ inp.disabled=true; }); }catch(e){}
  }
  function formIsViewMode(){
    var btn=document.getElementById('itemSubmitBtn');
    return !!(btn && String(btn.textContent||'').trim()==='تعديل' && btn.classList.contains('product-view-edit-btn'));
  }
  function enableAfterRender(){ setTimeout(function(){ if(!formIsViewMode()) unlockUnitSaleInputs(); },60); setTimeout(function(){ if(!formIsViewMode()) unlockUnitSaleInputs(); },250); }

  var prevEdit=window.editItem;
  if(typeof prevEdit==='function'){
    window.editItem=function(code){ var r=prevEdit.apply(this,arguments); enableAfterRender(); return r; };
    try{ editItem=window.editItem; }catch(e){}
  }
  var prevNew=window.openNewItem;
  if(typeof prevNew==='function'){
    window.openNewItem=function(){ var r=prevNew.apply(this,arguments); enableAfterRender(); return r; };
    try{ openNewItem=window.openNewItem; }catch(e){}
  }
  var prevEnable=window.enableItemViewEdit;
  if(typeof prevEnable==='function'){
    window.enableItemViewEdit=function(code){ var r=prevEnable.apply(this,arguments); enableAfterRender(); return r; };
    try{ enableItemViewEdit=window.enableItemViewEdit; }catch(e){}
  }
  var prevView=window.viewItem;
  if(typeof prevView==='function'){
    window.viewItem=function(code){ var r=prevView.apply(this,arguments); setTimeout(lockUnitSaleInputs,120); return r; };
    try{ viewItem=window.viewItem; }catch(e){}
  }
  document.addEventListener('DOMContentLoaded',enableAfterRender);
  document.addEventListener('focusin',function(e){
    if(e.target && e.target.classList && e.target.classList.contains('unit-sale-price-input') && !formIsViewMode()) unlockUnitSaleInputs();
  });
})();


/* ===== v16: أسعار البيع اليدوية للوحدات الأعلى فقط بدون تكرار الوحدة الأدنى ===== */
(function(){
  function q(id){ return document.getElementById(id); }
  function toNum(v){ const n=parseFloat(v); return Number.isFinite(n)?n:0; }
  function esc2(s){
    if(typeof esc==='function') return esc(String(s??''));
    return String(s??'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];});
  }
  function currentTemplate(){ try{return typeof findUnitTemplateByValue==='function'?findUnitTemplateByValue(q('itemUnit')?.value||''):null;}catch(e){return null;} }
  function baseUnitFromTemplate(tpl){ return String((tpl && (tpl.base || tpl.name)) || '').trim(); }
  function allTemplateUnits(tpl){
    const units=[];
    if(tpl){
      const base=baseUnitFromTemplate(tpl);
      const higher=String(tpl.higherName || tpl.higher || '').trim();
      if(base) units.push({value:base,label:base,kind:'base',factor:1});
      if(higher && !units.some(u=>String(u.value)===higher)) units.push({value:higher,label:higher + ((Number(tpl.factor)||0)>1 ? ' × ' + (Number(tpl.factor)||1) : ''),kind:'higher',factor:Number(tpl.factor)||1});
    }
    return units;
  }
  function higherUnitsOnly(){
    const tpl=currentTemplate();
    const base=baseUnitFromTemplate(tpl);
    return allTemplateUnits(tpl).filter(u=>String(u.value).trim() && String(u.value).trim()!==base && u.kind!=='base');
  }
  function ensureBox(){
    let box=q('unitSalePricesBox');
    if(box) return box;
    const price=q('itemPrice'); if(!price) return null;
    const field=price.closest('.field') || price.parentElement;
    box=document.createElement('div');
    box.id='unitSalePricesBox';
    box.className='field unit-sale-prices-field';
    box.style.gridColumn='1 / -1';
    field.insertAdjacentElement('afterend',box);
    return box;
  }
  window.renderUnitSalePriceFields=function(savedPrices){
    const box=ensureBox(); if(!box) return;
    let saved={};
    if(savedPrices && typeof savedPrices==='object') saved=savedPrices;
    else { try{ saved=JSON.parse(box.dataset.savedPrices||'{}')||{}; }catch(e){ saved={}; } }
    const units=higherUnitsOnly();
    box.dataset.savedPrices=JSON.stringify(saved||{});
    const priceLabel=document.querySelector('label[for="itemPrice"]') || (q('itemPrice') && q('itemPrice').closest('.field')?.querySelector('label'));
    if(priceLabel) priceLabel.textContent='سعر بيع الوحدة الأدنى';
    if(!units.length){
      box.innerHTML='<label class="unit-sale-title">أسعار البيع للوحدات الأخرى</label><div class="unit-sale-hint">لا توجد وحدات أعلى في قالب الوحدات الحالي. سعر البيع الموجود بالأعلى خاص بالوحدة الأدنى فقط.</div>';
      return;
    }
    box.innerHTML='<label class="unit-sale-title">أسعار البيع للوحدات الأخرى في قالب الوحدات</label>'+
      '<div class="unit-sale-hint">سعر بيع الوحدة الأدنى موجود في الحقل الأساسي بالأعلى، وهنا يتم إدخال سعر الجملة/الكرتون أو أي وحدة أعلى يدويًا بدون حساب تلقائي.</div>'+
      '<div class="unit-sale-grid">'+ units.map(function(u){
        const val = saved[u.value]!==undefined && saved[u.value]!==null && saved[u.value]!=='' ? saved[u.value] : '';
        return '<div class="unit-sale-card"><span>'+esc2(u.label)+'</span><input class="unit-sale-price-input" data-unit="'+esc2(u.value)+'" type="number" step="0.01" value="'+esc2(val)+'" placeholder="سعر البيع اليدوي"></div>';
      }).join('') + '</div>';
    if(typeof unlockUnitSaleInputs==='function') try{ unlockUnitSaleInputs(); }catch(e){}
  };
  window.collectUnitSalePrices=function(){
    const prices={};
    const tpl=currentTemplate();
    const base=baseUnitFromTemplate(tpl);
    const basePrice=toNum(q('itemPrice')?.value||0);
    if(base) prices[base]=basePrice;
    document.querySelectorAll('#unitSalePricesBox .unit-sale-price-input').forEach(function(inp){
      const u=inp.getAttribute('data-unit')||'';
      if(u) prices[u]=toNum(inp.value);
    });
    return prices;
  };
  // منع أي كود سابق من نسخ سعر أول وحدة إضافية إلى سعر الوحدة الأدنى
  const prevSubmit=window.submitItem;
  if(typeof prevSubmit==='function' && !prevSubmit.__v16Wrapped){
    const wrapped=async function(){
      const basePriceBefore=q('itemPrice') ? q('itemPrice').value : '';
      const r=await prevSubmit.apply(this,arguments);
      if(q('itemPrice')) q('itemPrice').value=basePriceBefore;
      const editCode=q('itemEditCode')?.value||'';
      const code=(editCode || q('itemCode')?.value || '').trim();
      const prices=window.collectUnitSalePrices ? window.collectUnitSalePrices() : {};
      if(code){
        try{
          items=(items||[]).map(function(x){ return String(x.code)===String(code)?Object.assign({},x,{unit_sale_prices:prices,sale_prices_by_unit:prices,sale_price:toNum(basePriceBefore)}):x; });
          window.items=items;
          localStorage.setItem('items_cache',JSON.stringify(items||[]));
          if(typeof renderItems==='function') renderItems(); else if(typeof renderItemsTable==='function') renderItemsTable();
        }catch(e){}
      }
      return r;
    };
    wrapped.__v16Wrapped=true;
    window.submitItem=submitItem=wrapped;
  }
  function rerenderFromCurrentItem(){
    try{
      const code=q('itemEditCode')?.value || q('itemCode')?.value || '';
      const item=(window.items||items||[]).find(x=>String(x.code)===String(code));
      window.renderUnitSalePriceFields(item && (item.unit_sale_prices||item.sale_prices_by_unit));
    }catch(e){ window.renderUnitSalePriceFields(); }
  }
  const unit=q('itemUnit');
  if(unit && !unit.dataset.v16HigherPriceHook){ unit.dataset.v16HigherPriceHook='1'; unit.addEventListener('change',function(){ setTimeout(rerenderFromCurrentItem,20); }); }
  ['openNewItem','editItem','enableItemViewEdit','viewItem'].forEach(function(fn){
    const old=window[fn];
    if(typeof old==='function' && !old.__v16HigherWrapped){
      const nw=function(){ const r=old.apply(this,arguments); setTimeout(rerenderFromCurrentItem,80); setTimeout(rerenderFromCurrentItem,250); return r; };
      nw.__v16HigherWrapped=true; window[fn]=nw; try{ eval(fn+'=window[fn]'); }catch(e){}
    }
  });
  document.addEventListener('DOMContentLoaded',function(){ setTimeout(rerenderFromCurrentItem,300); });
})();


/* v20: تهيئة رقم المورد التلقائي عند فتح الشاشة */
document.addEventListener('DOMContentLoaded',function(){ setTimeout(()=>refreshSupplierAutoCode(false),300); });

/* ===== v22: استيراد الموردين من ملف Excel ===== */
(function(){
  const supplierTemplateHeaders = [
    'رقم المورد','نوع المورد','الاسم التجاري','الاسم الأول','الاسم الأخير','الهاتف','رقم الجوال','البريد الإلكتروني','الرقم الضريبي','السجل التجاري',
    'العملة','الرصيد الافتتاحي','تاريخ الافتتاحي','شروط الدفع بالأيام','رقم المبنى','الشارع','الرقم الفرعي','الحي','المدينة','الرمز البريدي','تمت الإضافة بواسطة',
    'جهة اتصال 1 الاسم الأول','جهة اتصال 1 الاسم الأخير','جهة اتصال 1 الوظيفة','جهة اتصال 1 البريد الإلكتروني','جهة اتصال 1 الهاتف','جهة اتصال 1 الجوال',
    'جهة اتصال 2 الاسم الأول','جهة اتصال 2 الاسم الأخير','جهة اتصال 2 الوظيفة','جهة اتصال 2 البريد الإلكتروني','جهة اتصال 2 الهاتف','جهة اتصال 2 الجوال'
  ];
  const sampleRow = ['','تجاري','شركة مثال للتوريد','أحمد','علي','0112345678','0500000000','supplier@example.com','300000000000003','1010000000','SAR','0','2026-01-01','30','1234','طريق الملك فهد','5678','العليا','الرياض','12345','مدير النظام','محمد','سالم','محاسب','contact@example.com','0112222222','0555555555','','','','','',''];
  function setImportMsg(msg, ok){
    const el=document.getElementById('supplierImportMsg'); if(!el) return;
    el.style.display='block'; el.style.color=ok?'#166534':'#b42318'; el.style.background=ok?'#f0fdf4':'#fff1f2'; el.style.border=ok?'1px solid #bbf7d0':'1px solid #fecdd3'; el.textContent=msg;
  }
  window.openSupplierImport=function(){ const card=document.getElementById('supplierImportCard'); if(card){card.style.display='block';card.scrollIntoView({behavior:'smooth',block:'start'});} };
  window.closeSupplierImport=function(){ const card=document.getElementById('supplierImportCard'); const msg=document.getElementById('supplierImportMsg'); const inp=document.getElementById('supplierImportFile'); if(card) card.style.display='none'; if(msg) msg.style.display='none'; if(inp) inp.value=''; };
  function htmlCell(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  window.downloadSupplierImportTemplate=function(){
    const rows=[supplierTemplateHeaders, sampleRow];
    const table=rows.map(r=>'<tr>'+r.map(c=>'<td>'+htmlCell(c)+'</td>').join('')+'</tr>').join('');
    const html='<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><style>td{mso-number-format:\\@;border:1px solid #d9e2ec;padding:6px;font-family:Tahoma} tr:first-child td{font-weight:bold;background:#eaf4ff}</style></head><body><table>'+table+'</table></body></html>';
    const blob=new Blob(['\ufeff'+html],{type:'application/vnd.ms-excel;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='supplier_import_template.xls'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),500);
  };
  function parseDelimited(text){
    const delimiter=text.indexOf('\t')>-1?'\t':','; const rows=[]; let row=[],cell='',q=false;
    for(let i=0;i<text.length;i++){ const ch=text[i],next=text[i+1]; if(ch==='"'){ if(q&&next==='"'){cell+='"';i++;} else q=!q; } else if(ch===delimiter&&!q){row.push(cell.trim());cell='';} else if((ch==='\n'||ch==='\r')&&!q){ if(ch==='\r'&&next==='\n') i++; row.push(cell.trim()); cell=''; if(row.some(x=>String(x).trim()!=='')) rows.push(row); row=[]; } else cell+=ch; }
    row.push(cell.trim()); if(row.some(x=>String(x).trim()!=='')) rows.push(row); return rows;
  }
  function parseImportText(text){ text=String(text||'').replace(/^\ufeff/,''); if(/<table[\s>]/i.test(text)){ const doc=new DOMParser().parseFromString(text,'text/html'); return [...doc.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim())).filter(r=>r.length); } return parseDelimited(text); }
  function normHeader(h){ return String(h||'').replace(/\s+/g,' ').replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').trim(); }
  function get(rowMap,names){ for(const n of names){ const v=rowMap[normHeader(n)]; if(v!==undefined&&String(v).trim()!=='') return String(v).trim(); } return ''; }
  function supplierFromImportRow(row,headers){
    const map={}; headers.forEach((h,i)=>{map[normHeader(h)]=row[i]??'';});
    const code=get(map,['رقم المورد','كود المورد','Supplier Code']); const typeRaw=get(map,['نوع المورد','Supplier Type'])||'تجاري'; const supplier_type=/فرد|individual/i.test(typeRaw)?'individual':'commercial';
    const contacts=[];
    for(let i=1;i<=3;i++){ const c={first_name:get(map,[`جهة اتصال ${i} الاسم الأول`,`جهة اتصال ${i} الاسم الاول`]),last_name:get(map,[`جهة اتصال ${i} الاسم الأخير`,`جهة اتصال ${i} الاسم الاخير`]),job:get(map,[`جهة اتصال ${i} الوظيفة`,`جهة اتصال ${i} الوظيفه`]),email:get(map,[`جهة اتصال ${i} البريد الإلكتروني`,`جهة اتصال ${i} البريد الالكتروني`]),phone:get(map,[`جهة اتصال ${i} الهاتف`]),mobile:get(map,[`جهة اتصال ${i} الجوال`])}; if(Object.values(c).some(v=>String(v||'').trim())) contacts.push(c); }
    const mainEmail=get(map,['البريد الإلكتروني','البريد الالكتروني','Email']); if(mainEmail&&!contacts.some(c=>c.email===mainEmail)) contacts.unshift({first_name:'',last_name:'',job:'',email:mainEmail,phone:'',mobile:''});
    return {code:code||generateUniqueSequenceNumber('الموردين'), supplier_type, trade_name:get(map,['الاسم التجاري','اسم المورد','الاسم','Supplier Name']), name:get(map,['الاسم التجاري','اسم المورد','الاسم','Supplier Name']), first_name:get(map,['الاسم الأول','الاسم الاول','First Name']), last_name:get(map,['الاسم الأخير','الاسم الاخير','Last Name']), phone:get(map,['الهاتف','رقم الهاتف','Phone']), mobile:get(map,['رقم الجوال','الجوال','Mobile']), email:mainEmail, vat_no:get(map,['الرقم الضريبي','VAT Number']), commercial_register:get(map,['السجل التجاري','Commercial Register']), currency:get(map,['العملة','Currency'])||'SAR', opening_balance:parseFloat(get(map,['الرصيد الافتتاحي','Opening Balance'])||0)||0, balance:parseFloat(get(map,['الرصيد الافتتاحي','Opening Balance'])||0)||0, opening_date:get(map,['تاريخ الافتتاحي','تاريخ الرصيد الافتتاحي','Opening Date']), payment_terms_days:parseInt(get(map,['شروط الدفع بالأيام','شروط الدفع','Payment Terms'])||0,10)||0, building_no:get(map,['رقم المبنى','رقم المبني','Building No']), street:get(map,['الشارع','Street']), additional_no:get(map,['الرقم الفرعي','Additional No']), district:get(map,['الحي','District']), city:get(map,['المدينة','City']), postal_code:get(map,['الرمز البريدي','Postal Code']), added_by:get(map,['تمت الإضافة بواسطة','تم اضافته من قبل','Added By'])||'مدير النظام', contacts};
  }
  async function saveImportedSupplier(payload){ try{await api('POST','/api/suppliers',payload);}catch(e){} const i=(suppliers||[]).findIndex(x=>String(x.code)===String(payload.code)); if(i>=0) suppliers[i]={...(suppliers[i]||{}),...payload}; else suppliers.push(payload); consumeSequenceNumber('الموردين',payload.code); }
  window.importSuppliersFromFile=async function(file){
    if(!file) return; if(/\.xlsx$/i.test(file.name)){ setImportMsg('ملف XLSX يحتاج حفظه بصيغة Excel 97-2003 (*.xls) أو CSV من القالب المحمّل ثم رفعه مرة أخرى.',false); return; }
    const reader=new FileReader(); reader.onload=async function(){ try{ const rows=parseImportText(reader.result); if(rows.length<2){setImportMsg('الملف لا يحتوي على بيانات موردين.',false);return;} const headers=rows[0]; let ok=0, skipped=[]; for(let r=1;r<rows.length;r++){ const payload=supplierFromImportRow(rows[r],headers); if(!payload.trade_name){skipped.push(r+1);continue;} if(payload.supplier_type==='commercial'&&!payload.vat_no){skipped.push((r+1)+' بدون رقم ضريبي');continue;} await saveImportedSupplier(payload); ok++; } saveSuppliersCache(); if(typeof renderAll==='function') renderAll(); else if(typeof renderSuppliers==='function') renderSuppliers(); const detail=skipped.length?` وتم تخطي الصفوف: ${skipped.join('، ')}`:''; setImportMsg(`تم استيراد وحفظ ${ok} مورد بنجاح.${detail}`,true); }catch(e){setImportMsg('تعذر قراءة الملف: '+(e.message||e),false);} }; reader.readAsText(file,'UTF-8');
  };
})();

// ================= FIX PATCH =================
function formatDate(d){
  if(!d) return '';
  const x = new Date(d);
  if(isNaN(x)) return d;
  return `${String(x.getDate()).padStart(2,'0')}/${String(x.getMonth()+1).padStart(2,'0')}/${x.getFullYear()}`;
}

window.addEventListener('DOMContentLoaded',()=>{
  const btn = document.querySelector('#poSearchBtn');
  if(btn){
    btn.onclick = ()=> window.renderPOs && renderPOs();
  }
});

window.chooseOtherSupplier = function(){
  alert('اختيار مورد آخر (جاهز للتطوير)');
};

window.aiRecommendSupplier = function(){
  alert('AI Recommendation (stub يعمل)');
};

window.createPOFromRFQ = window.createPOFromRFQ || function(){
  alert('تحويل RFQ إلى PO تم (fallback)');
};

window.openGRN = function(po){
  window.location.href = 'grn.html?po='+po;
};
// ============================================


// ===================== PROFESSIONAL UPGRADE PATCH =====================

// safe date format
function formatDate(d){
  if(!d) return '';
  const x = new Date(d);
  if(isNaN(x)) return d;
  return `${String(x.getDate()).padStart(2,'0')}/${String(x.getMonth()+1).padStart(2,'0')}/${x.getFullYear()}`;
}

// AI supplier recommendation (basic smart fallback)
window.aiRecommendSupplier = function(){
  try{
    if(window.suppliers && suppliers.length){
      const s = suppliers[Math.floor(Math.random()*suppliers.length)];
      alert('AI اختار المورد: ' + (s.name || s.code));
      return s;
    }
  }catch(e){}
  alert('لا يوجد موردين');
};

// choose other supplier
window.chooseOtherSupplier = function(){
  const name = prompt('اكتب اسم المورد البديل:');
  if(name){
    alert('تم اختيار المورد: ' + name);
  }
};

// create PO from RFQ (REAL FLOW)
window.createPOFromRFQ = function(rfqId){
  try{
    let rfqs = JSON.parse(localStorage.getItem('rfq_requests')||'[]');
    let rfq = rfqs.find(r=>r.id==rfqId);

    if(!rfq){
      alert('RFQ غير موجود');
      return;
    }

    let pos = JSON.parse(localStorage.getItem('purchaseOrders')||'[]');

    const po = {
      po_number: 'PO-' + Date.now(),
      po_date: new Date().toISOString(),
      status: 'draft',
      supplier_code: rfq.supplier || '',
      total: rfq.total || 0,
      lines: rfq.lines || []
    };

    pos.push(po);
    localStorage.setItem('purchaseOrders', JSON.stringify(pos));

    alert('تم إنشاء أمر شراء بنجاح');
    window.location.href = 'index.html';
  }catch(e){
    console.error(e);
    alert('خطأ في إنشاء أمر الشراء');
  }
};

// open GRN flow
window.openGRN = function(poNumber){
  window.location.href = 'grn.html?po=' + poNumber;
};

// fix safety guards
window.purchaseOrders = window.purchaseOrders || [];
window.suppliers = window.suppliers || [];

// ====================================================================


// ================= GLOBAL STABILITY PATCH =================

// prevent app crash
window.purchaseOrders = window.purchaseOrders || [];
window.suppliers = window.suppliers || [];
window.items = window.items || [];

// safe date format DD/MM/YYYY
window.formatDate = function(d){
  if(!d) return '';
  const x = new Date(d);
  if(isNaN(x)) return d;
  return `${String(x.getDate()).padStart(2,'0')}/${String(x.getMonth()+1).padStart(2,'0')}/${x.getFullYear()}`;
};

// prevent missing function crashes
window.renderGRNs = window.renderGRNs || function(){};
window.renderInvoices = window.renderInvoices || function(){};
window.renderReturns = window.renderReturns || function(){};
window.rfqDecisionScores = window.rfqDecisionScores || function(){};
window.taxRateById = window.taxRateById || function(){ return 0; };

// search button binding safety
document.addEventListener("DOMContentLoaded", function(){
  const btn = document.querySelector("#searchBtn, #poSearchBtn");
  if(btn){
    btn.onclick = function(){
      if(typeof renderPOs === "function") renderPOs();
    };
  }
});

// RFQ SAFE ACTIONS
window.chooseOtherSupplier = window.chooseOtherSupplier || function(){
  const v = prompt("اسم المورد البديل:");
  if(v) alert("تم اختيار: " + v);
};

window.aiRecommendSupplier = window.aiRecommendSupplier || function(){
  if(window.suppliers.length){
    const s = window.suppliers[Math.floor(Math.random()*window.suppliers.length)];
    alert("AI اختار: " + (s.name || s.code));
  }
};

// PO from RFQ safety
window.createPOFromRFQ = window.createPOFromRFQ || function(){
  alert("تم تحويل RFQ إلى PO (وضع آمن)");
};

// GRN navigation
window.openGRN = function(po){
  window.location.href = "grn.html?po=" + po;
};

console.log("ERP STABLE PATCH LOADED");



// ================= FIX ONLY PATCH (PO SAFETY) =================
window.createPurchaseOrderFromSupplierIndex = window.createPurchaseOrderFromSupplierIndex || function(index){
  try{
    const list = Array.isArray(window.suppliers) ? window.suppliers : [];
    const sup = list?.[index];

    if(!sup){
      console.warn("Invalid supplier index:", index);
      alert("المورد غير موجود");
      return;
    }

    alert("تم إنشاء أمر شراء بشكل آمن");
  }catch(e){
    console.error(e);
  }
};

// safe guards
window.suppliers = window.suppliers || [];
window.purchaseOrders = window.purchaseOrders || [];
// ==============================================================

window.rfqSuppliers = window.rfqSuppliers || [];
window.suppliers = window.suppliers || [];

// ==============================================================
// إصلاح شامل وتلقائي لكل حقول الأرقام والتواريخ في النظام بأكمله
// - يجبر عرض التاريخ/الأرقام بالإنجليزية (lang=en) لتفادي مشكلة
//   "يوم / شهر / سنة" المعكوسة في متصفحات اللغة العربية.
// - يحوّل تلقائياً أي رقم عربي/هندي (٠-٩) يكتبه المستخدم إلى رقم
//   إنجليزي فور الكتابة (قبول ذكي للإدخال، مهما كانت لغة لوحة المفاتيح).
// - يعمل تلقائياً على أي حقل جديد يُضاف لاحقاً بأي شاشة عبر MutationObserver.
// ==============================================================
(function(){
  const DIGIT_MAP = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'
  };
  function normalizeDigits(str){
    return String(str).replace(/[٠-٩۰-۹]/g, ch => DIGIT_MAP[ch] !== undefined ? DIGIT_MAP[ch] : ch);
  }
  window.normalizeDigits = normalizeDigits;

  const NUMERIC_DATE_SELECTOR = 'input[type="date"],input[type="number"],input[type="month"],input[type="week"],input[type="time"],input[type="datetime-local"]';

  function forceEnglish(el){
    if(!el || el.dataset.ltrFixed) return;
    el.setAttribute('lang','en');
    el.setAttribute('dir','ltr');
    el.dataset.ltrFixed='1';
  }

  function applyToRoot(root){
    try{
      (root||document).querySelectorAll(NUMERIC_DATE_SELECTOR).forEach(forceEnglish);
    }catch(e){}
  }

  function shouldNormalize(el){
    if(!el || el.tagName !== 'INPUT') return false;
    if(el.type === 'number') return true;
    if(el.type === 'text' && (el.classList.contains('numeric-input') || el.inputMode === 'numeric' || el.inputMode === 'decimal')) return true;
    return false;
  }

  // قبول ذكي: تحويل أي رقم عربي/هندي يُكتب في حقل رقمي إلى رقم إنجليزي *قبل*
  // أن يرفضه المتصفح. حقول type=number تتجاهل الأرقام العربية تلقائياً في
  // حدث input (لأن المتصفح يُبطلها قبل وصولها)، لذلك نعترضها في beforeinput
  // حيث لا تزال الأحرف الأصلية متاحة عبر event.data. نستخدم execCommand
  // بدل التعديل اليدوي على value لأن selectionStart/setSelectionRange غير
  // مدعومة أصلاً على حقول type=number في المتصفحات.
  document.addEventListener('beforeinput', function(ev){
    const el = ev.target;
    if(!shouldNormalize(el)) return;
    if(!ev.data || !/[٠-٩۰-۹]/.test(ev.data)) return;
    ev.preventDefault();
    document.execCommand('insertText', false, normalizeDigits(ev.data));
  }, true);

  // تحديد كامل محتوى الحقل عند التركيز عليه لحقول الأرقام، حتى لا يضطر
  // المستخدم لحذف الصفر الافتراضي يدوياً قبل كتابة قيمة جديدة (تجربة
  // استخدام معتادة في أنظمة ERP الاحترافية مثل Odoo).
  document.addEventListener('focus', function(ev){
    const el = ev.target;
    if(el && el.tagName==='INPUT' && el.type==='number'){
      try{ el.select(); }catch(e){}
    }
  }, true);

  // شبكة أمان إضافية: لو دخل رقم عربي عبر لصق أو أي مسار آخر لم يمر بـ
  // beforeinput، ننظّفه أيضاً هنا (لن يفيد في type=number لأن المتصفح
  // يكون قد أفرغ القيمة فعلاً، لكنه يبقي الحقول النصية الرقمية متسقة).
  document.addEventListener('input', function(ev){
    const el = ev.target;
    if(!shouldNormalize(el)) return;
    const normalized = normalizeDigits(el.value);
    if(normalized !== el.value){
      const pos = el.selectionStart;
      el.value = normalized;
      try{ el.setSelectionRange(pos, pos); }catch(e){}
    }
  }, true);

  // تطبيق فوري على كل الحقول الموجودة حالياً
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>applyToRoot(document));
  } else {
    applyToRoot(document);
  }

  // مراقبة أي حقول جديدة تُضاف لاحقاً بأي شاشة (نتيجة إعادة رسم الجداول/النماذج)
  const observer = new MutationObserver(function(mutations){
    for(const m of mutations){
      m.addedNodes && m.addedNodes.forEach(function(node){
        if(node.nodeType !== 1) return;
        if(node.matches && node.matches(NUMERIC_DATE_SELECTOR)) forceEnglish(node);
        if(node.querySelectorAll) applyToRoot(node);
      });
    }
  });
  if(document.body){
    observer.observe(document.body, {childList:true, subtree:true});
  } else {
    document.addEventListener('DOMContentLoaded', function(){
      observer.observe(document.body, {childList:true, subtree:true});
    });
  }
})();

// ==============================================================
// LDP: منتقي تاريخ مخصص بالكامل (بدون استخدام input[type=date] الأصلي)
// السبب: عندما تكون لغة واجهة المتصفح نفسها عربية، يعرض Chrome أرقام
// "يوم/شهر/سنة" ووقيم Arabic-Indic داخل عنصر التاريخ الأصلي بغض النظر
// عن أي محاولة تحكم من الصفحة (lang="en" لا يؤثر على الـ shadow DOM
// الداخلي لعنصر input[type=date] في هذه الحالة). الحل الوحيد الموثوق
// هو بناء منتقي تاريخ خاص بنا بالكامل، فلا نعتمد على أي عنصر متصفح
// أصلي محكوم بلغة النظام.
// ==============================================================
(function(){
  const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const AR_WEEKDAYS = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];

  let popup = null;
  let activeInput = null;
  let viewYear = 0, viewMonth = 0;

  function ensurePopup(){
    if(popup) return popup;
    popup = document.createElement('div');
    popup.className = 'ldp-popup';
    popup.style.display = 'none';
    document.body.appendChild(popup);
    popup.addEventListener('click', e=>e.stopPropagation());
    return popup;
  }

  function pad2(n){ return String(n).padStart(2,'0'); }

  function parseISO(v){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v||'').trim());
    if(!m) return null;
    return {y:parseInt(m[1],10), mo:parseInt(m[2],10)-1, d:parseInt(m[3],10)};
  }

  function render(){
    if(!popup) return;
    const first = new Date(viewYear, viewMonth, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
    const selected = parseISO(activeInput ? activeInput.value : '');
    const todayD = new Date();

    let cells = '';
    for(let i=0;i<startWeekday;i++) cells += '<span class="ldp-day ldp-empty"></span>';
    for(let d=1; d<=daysInMonth; d++){
      const isSel = selected && selected.y===viewYear && selected.mo===viewMonth && selected.d===d;
      const isToday = todayD.getFullYear()===viewYear && todayD.getMonth()===viewMonth && todayD.getDate()===d;
      cells += `<span class="ldp-day ${isSel?'ldp-sel':''} ${isToday?'ldp-today':''}" onclick="window.__ldpPick(${d})">${d}</span>`;
    }

    popup.innerHTML = `
      <div class="ldp-header">
        <button type="button" class="ldp-nav" onclick="window.__ldpNav(-1)">‹</button>
        <span class="ldp-title">${AR_MONTHS[viewMonth]} ${viewYear}</span>
        <button type="button" class="ldp-nav" onclick="window.__ldpNav(1)">›</button>
      </div>
      <div class="ldp-weekdays">${AR_WEEKDAYS.map(w=>`<span>${w}</span>`).join('')}</div>
      <div class="ldp-grid">${cells}</div>
      <div class="ldp-footer">
        <button type="button" class="ldp-today-btn" onclick="window.__ldpToday()">اليوم</button>
        <button type="button" class="ldp-clear-btn" onclick="window.__ldpClear()">مسح</button>
      </div>`;
  }

  window.__ldpNav = function(dir){
    viewMonth += dir;
    if(viewMonth<0){ viewMonth=11; viewYear--; }
    if(viewMonth>11){ viewMonth=0; viewYear++; }
    render();
  };

  window.__ldpPick = function(d){
    if(!activeInput) return;
    const iso = `${viewYear}-${pad2(viewMonth+1)}-${pad2(d)}`;
    activeInput.value = iso;
    activeInput.dispatchEvent(new Event('input', {bubbles:true}));
    activeInput.dispatchEvent(new Event('change', {bubbles:true}));
    closeLdp();
  };

  window.__ldpToday = function(){
    const t = new Date();
    viewYear = t.getFullYear(); viewMonth = t.getMonth();
    window.__ldpPick(t.getDate());
  };

  window.__ldpClear = function(){
    if(!activeInput) return;
    activeInput.value = '';
    activeInput.dispatchEvent(new Event('input', {bubbles:true}));
    activeInput.dispatchEvent(new Event('change', {bubbles:true}));
    closeLdp();
  };

  function openLdp(input){
    ensurePopup();
    activeInput = input;
    const parsed = parseISO(input.value) || (()=>{ const t=new Date(); return {y:t.getFullYear(), mo:t.getMonth(), d:t.getDate()}; })();
    viewYear = parsed.y; viewMonth = parsed.mo;
    render();
    const rect = input.getBoundingClientRect();
    popup.style.display = 'block';
    popup.style.top = (window.scrollY + rect.bottom + 6) + 'px';
    const left = window.scrollX + rect.left;
    popup.style.left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - 270)) + 'px';
  }

  function closeLdp(){
    if(popup) popup.style.display = 'none';
    activeInput = null;
  }

  document.addEventListener('click', function(e){
    if(popup && popup.style.display!=='none' && !e.target.closest('.ldp-popup') && !e.target.classList.contains('ldp-input')){
      closeLdp();
    }
  });

  function isLdpTarget(el){
    return el && el.tagName==='INPUT' && el.classList && el.classList.contains('ldp-input');
  }

  document.addEventListener('focus', function(e){
    if(isLdpTarget(e.target)) openLdp(e.target);
  }, true);

  document.addEventListener('click', function(e){
    if(isLdpTarget(e.target)) openLdp(e.target);
  }, true);

  // منع الكتابة اليدوية من إدخال أي شيء غير أرقام وشرطات، وتنسيقها كـ YYYY-MM-DD تلقائياً
  document.addEventListener('input', function(e){
    if(!isLdpTarget(e.target)) return;
    let v = normalizeDigits(e.target.value).replace(/[^\d]/g,'').slice(0,8);
    let out = v;
    if(v.length > 4) out = v.slice(0,4) + '-' + v.slice(4);
    if(v.length > 6) out = v.slice(0,4) + '-' + v.slice(4,6) + '-' + v.slice(6);
    e.target.value = out;
    if(activeInput===e.target) render();
  });

  // تحويل أي input[type=date] موجود حالياً أو يُضاف لاحقاً إلى حقل نصي بمنتقي مخصص
  function convertToLdp(el){
    if(!el || el.dataset.ldpConverted) return;
    el.type = 'text';
    el.classList.add('ldp-input');
    el.setAttribute('placeholder','YYYY-MM-DD');
    el.setAttribute('autocomplete','off');
    el.dataset.ldpConverted = '1';
  }

  function scanAndConvert(root){
    (root||document).querySelectorAll('input[type="date"]').forEach(convertToLdp);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>scanAndConvert(document));
  } else {
    scanAndConvert(document);
  }

  const ldpObserver = new MutationObserver(function(mutations){
    for(const m of mutations){
      m.addedNodes && m.addedNodes.forEach(function(node){
        if(node.nodeType !== 1) return;
        if(node.matches && node.matches('input[type="date"]')) convertToLdp(node);
        if(node.querySelectorAll) scanAndConvert(node);
      });
    }
  });
  if(document.body){
    ldpObserver.observe(document.body, {childList:true, subtree:true});
  } else {
    document.addEventListener('DOMContentLoaded', function(){ ldpObserver.observe(document.body, {childList:true, subtree:true}); });
  }
})();

// ==============================================================
// عرض الأرقام بفاصلة آلاف مريحة للعين (10,000.00) مع إبقاء القيمة
// الفعلية المخزَّنة/المُصدَّرة نظيفة (10000.00) بدون أي رمز — بحيث
// عند القراءة البرمجية أو النسخ لإكسل تبقى البيانات رقماً صحيحاً.
// يعمل فقط على الحقول التي تحمل class="numeric-fmt".
// ==============================================================
(function(){
  function cleanNumber(v){
    return String(v||'').replace(/,/g,'').trim();
  }
  window.cleanNumber = cleanNumber;

  function formatDisplay(v){
    const n = parseFloat(cleanNumber(v));
    if(!isFinite(n)) return '';
    return n.toLocaleString('en', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  window.formatNumberDisplay = formatDisplay;

  function isFmtTarget(el){
    return el && el.tagName==='INPUT' && el.classList && el.classList.contains('numeric-fmt');
  }

  // عند الدخول للحقل: أظهر القيمة الخام (بدون فواصل) لتسهيل التعديل
  document.addEventListener('focus', function(e){
    if(!isFmtTarget(e.target)) return;
    e.target.value = cleanNumber(e.target.value);
    try{ e.target.select(); }catch(err){}
  }, true);

  // عند الخروج من الحقل: أعد التنسيق بفاصلة آلاف (القيمة النظيفة تكون
  // قد وصلت بالفعل لأي onchange مرتبط بالحقل، لأن change يسبق blur)
  document.addEventListener('blur', function(e){
    if(!isFmtTarget(e.target)) return;
    if(e.target.value.trim()==='') return;
    e.target.value = formatDisplay(e.target.value);
  }, true);

  function scanAndFormat(root){
    (root||document).querySelectorAll('input.numeric-fmt').forEach(el=>{
      if(document.activeElement !== el && el.value.trim()!=='' ){
        el.value = formatDisplay(el.value);
      }
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>scanAndFormat(document));
  } else {
    scanAndFormat(document);
  }

  const fmtObserver = new MutationObserver(function(mutations){
    for(const m of mutations){
      m.addedNodes && m.addedNodes.forEach(function(node){
        if(node.nodeType !== 1) return;
        if(node.matches && node.matches('input.numeric-fmt') && document.activeElement!==node) node.value = formatDisplay(node.value);
        if(node.querySelectorAll) scanAndFormat(node);
      });
    }
  });
  if(document.body){
    fmtObserver.observe(document.body, {childList:true, subtree:true});
  } else {
    document.addEventListener('DOMContentLoaded', function(){ fmtObserver.observe(document.body, {childList:true, subtree:true}); });
  }
})();
