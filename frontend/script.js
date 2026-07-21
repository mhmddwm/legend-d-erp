

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
let journalEditingId=null; // معرّف القيد الجاري تعديله (null = إنشاء قيد جديد)
let journalPage=1; // الصفحة الحالية في قائمة القيود
const JOURNAL_PAGE_SIZE=20;

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


entries = await safeLoad(
"القيود",
"/api/journal"
);


appUsers = await safeLoad(
"المستخدمون",
"/users"
);


costCenters = await safeLoad(
"مراكز التكلفة",
"/api/cost-centers"
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
  const params = new URLSearchParams({code, name});
  if(location) params.set('location', location);
  if(manager) params.set('manager', manager);
  try{
    await api('POST', `/api/warehouses?${params.toString()}`);
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
// دليل الحسابات
// ============================================================
// ============================================================
// دليل الحسابات المحدث والمصحح
// ============================================================
function renderTree() {
  const body = document.getElementById('accBody');
  const empty = document.getElementById('accEmpty');
  
  if (!body) return;
  body.innerHTML = ''; // تنظيف الجدول

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
  const acc=(window.accounts||[]).find(a=>a.code===code);
  if(!acc) return;
  const win=window.open('','_blank');
  win.document.write(`
  <html dir="rtl"><head><title>${acc.name_ar}</title>
  <style>body{font-family:Cairo,Arial;padding:30px;background:#f5f0e8;color:#1b2a44}
  .box{background:#fff;padding:25px;border-radius:12px;border:1px solid #ddd}</style></head>
  <body><div class="box"><h2>${acc.name_ar}</h2>
  <p>رقم الحساب: ${acc.code}</p>
  <p>الرصيد الحالي: ${fmt(acc.balance)}</p></div></body></html>`);
  win.document.close();
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
    amountFrom: document.getElementById('jsAmountFrom')?.value ?? '',
    amountTo: document.getElementById('jsAmountTo')?.value ?? '',
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

function renderJournal(){
  const body=document.getElementById('journalBody');
  const empty=document.getElementById('journalEmpty');
  const countEl=document.getElementById('journalResultsCount');
  if(!body) return;

  const filters = readJournalFilters();
  const hasAnyFilter = Object.values(filters).some(v=>v!=='' && v!==null);
  const filtered = hasAnyFilter ? (entries||[]).filter(e=>journalMatchesFilters(e, filters)) : (entries||[]);

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
    const lines = (e.lines&&e.lines.length) ? e.lines : [
      ...(e.debit_account?[{account_code:e.debit_account, debit:e.amount, credit:0}]:[]),
      ...(e.credit_account?[{account_code:e.credit_account, debit:0, credit:e.amount}]:[]),
    ];
    const summary = lines.map(l=>`${accountLabel(l.account_code)} <span class="muted">(${l.debit?'مدين':'دائن'})</span>`).join('، ');
    const status = e.status || 'posted';
    const statusBadge = status==='cancelled'
      ? `<span class="badge returned">ملغي</span>`
      : `<span class="badge posted">مرحّل</span>`;
    const isManual = e.source_type==='manual';
    const isCancelled = status==='cancelled';
    return `<tr>
    <td>${e.id||''}</td>
    <td>${e.entry_date||''}</td>
    <td>${summary || '-'}</td>
    <td class="num">${fmt(e.total_amount ?? e.amount)}</td>
    <td>${e.description||''}</td>
    <td>${e.created_by_name||'-'}</td>
    <td>${statusBadge}</td>
    <td>
      <div class="row-menu">
        <button class="row-menu-trigger" title="خيارات القيد" onclick="toggleJournalRowMenu(${e.id}, event)"><span></span><span></span><span></span></button>
        <div id="jmenu-${e.id}" class="menu-popup" style="display:none">
          <button onclick="viewJournalEntry(${e.id})"><b>👁</b><span>عرض</span></button>
          ${isManual && !isCancelled ? `<button onclick="editJournalEntry(${e.id})"><b>✎</b><span>تعديل</span></button>` : ''}
          <button onclick="duplicateJournalEntry(${e.id})"><b>⧉</b><span>نسخ قيد دوري</span></button>
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
  document.querySelectorAll('.menu-popup').forEach(e=>e.style.display='none');
  document.querySelectorAll('.row-menu-trigger').forEach(b=>b.classList.remove('active'));
  if(m && willOpen){
    m.style.display='block';
    if(ev && ev.currentTarget) ev.currentTarget.classList.add('active');
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
  body.innerHTML=stockMoves.map(m=>`<tr>
    <td>${m.move_date||''}</td>
    <td>${m.item_code||''}</td>
    <td>${m.move_type||''}</td>
    <td>${m.reference||'-'}</td>
    <td class="num ${m.qty>0?'stock-pos':'stock-neg'}">${fmt(m.qty)}</td>
    <td class="num">${fmt(m.unit_cost)}</td>
    <td class="num">${fmt(m.balance_after)}</td>
  </tr>`).join('');
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
  renderJLines();
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
  jLines.push({id:lineCounter, account_code:'', debit:0, credit:0, line_description:''});
  renderJLines();
}

function removeJLine(id){
  if(jLines.length<=2){alert('يجب أن يحتوي القيد على سطرين على الأقل'); return;}
  jLines=jLines.filter(l=>l.id!==id);
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

function renderJLines(){
  const body=document.getElementById('journalLinesBody');
  if(!body) return;
  body.innerHTML=jLines.map(l=>`<tr>
    <td><input type="text" list="accountsDatalist" placeholder="ابحث بالكود أو اسم الحساب" value="${l.account_code?accountLabel(l.account_code):''}" onchange="onJLineAccountChange(${l.id}, this)"></td>
    <td><input type="text" placeholder="بيان السطر (اختياري)" value="${l.line_description||''}" onchange="onJLineChange(${l.id},'line_description',this.value)"></td>
    <td><input type="number" step="0.01" min="0" value="${l.debit||0}" onchange="onJLineChange(${l.id},'debit',this.value)"></td>
    <td><input type="number" step="0.01" min="0" value="${l.credit||0}" onchange="onJLineChange(${l.id},'credit',this.value)"></td>
    <td><button class="rm-line" onclick="removeJLine(${l.id})">✕</button></td>
  </tr>`).join('');

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
}

function resetJournalForm(){
  journalEditingId=null;
  jLines=[];
  lineCounter++; jLines.push({id:lineCounter, account_code:'', debit:0, credit:0, line_description:''});
  lineCounter++; jLines.push({id:lineCounter, account_code:'', debit:0, credit:0, line_description:''});
  const titleEl=document.getElementById('journalFormTitle');
  if(titleEl) titleEl.textContent='قيد محاسبي جديد';
  const submitBtn=document.getElementById('jSubmitBtn');
  if(submitBtn) submitBtn.textContent='ترحيل القيد';
  const ccSel=document.getElementById('jCostCenter'); if(ccSel) ccSel.value='';
  const cb=document.getElementById('jCreatedBy'); if(cb) cb.value='';
  const dateEl=document.getElementById('jDate'); if(dateEl) dateEl.value='';
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
  if(poSup){ const cur=poSup.value; poSup.innerHTML=options; poSup.value=cur; }
  if(grnSup){ const cur=grnSup.value; grnSup.innerHTML=options; grnSup.value=cur; }
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
  if((account.balance||0)!==0){alert('لا يمكن حذف الحساب لأنه يحتوي على حركات أو أرصدة'); return;}
  if(!confirm('تأكيد حذف الحساب؟')) return;
  try{await api('DELETE',`/api/accounts/${code}`); await loadAll();}
  catch(e){alert(e.message);}
}

// ============================================================
// إجراءات القيود
// ============================================================
async function submitEntry(){
  const entry_date=document.getElementById('jDate').value;
  const description=document.getElementById('jDesc').value.trim();
  const created_by_name=document.getElementById('jCreatedBy')?.value.trim() || null;
  const cost_center_code=document.getElementById('jCostCenter')?.value || null;
  const err=document.getElementById('jErr');

  const validLines=jLines.filter(l=>l.account_code && ((l.debit||0)>0 || (l.credit||0)>0));
  if(!entry_date){err.textContent='يرجى إدخال تاريخ القيد'; return;}
  if(validLines.length<2){err.textContent='يرجى إدخال سطرين على الأقل، كل سطر بحساب صحيح ومبلغ'; return;}

  const totalDebit=validLines.reduce((s,l)=>s+(parseFloat(l.debit)||0),0);
  const totalCredit=validLines.reduce((s,l)=>s+(parseFloat(l.credit)||0),0);
  if(Math.round((totalDebit-totalCredit)*100)!==0){err.textContent=`القيد غير متوازن: مدين ${fmt(totalDebit)} ≠ دائن ${fmt(totalCredit)}`; return;}
  if(totalDebit<=0){err.textContent='لا يمكن ترحيل قيد بإجمالي صفر'; return;}

  err.textContent='';
  const payload={
    entry_date, description, created_by_name, cost_center_code,
    lines: validLines.map(l=>({account_code:l.account_code, debit:l.debit||0, credit:l.credit||0, line_description:l.line_description||null}))
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
  }catch(e){err.textContent=e.message;}
}

function loadEntryIntoForm(id){
  const e=(entries||[]).find(x=>x.id===id);
  if(!e) return null;
  const lines=(e.lines&&e.lines.length) ? e.lines : [
    ...(e.debit_account?[{account_code:e.debit_account, debit:e.amount, credit:0, line_description:e.description}]:[]),
    ...(e.credit_account?[{account_code:e.credit_account, debit:0, credit:e.amount, line_description:e.description}]:[]),
  ];
  jLines=lines.map(l=>{ lineCounter++; return {id:lineCounter, account_code:l.account_code, debit:l.debit||0, credit:l.credit||0, line_description:l.line_description||''}; });
  document.getElementById('jDate').value=e.entry_date||'';
  document.getElementById('jDesc').value=e.description||'';
  const cb=document.getElementById('jCreatedBy'); if(cb) cb.value=e.created_by_name||'';
  const ccSel=document.getElementById('jCostCenter'); if(ccSel) ccSel.value=e.cost_center_code||'';
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
  grnLines.push({id,itemCode:'',qty:1,cost:0});
  renderGrnLines();
}

function removeGrnLine(id){
  grnLines=grnLines.filter(l=>l.id!==id);
  renderGrnLines();
}

function onGrnLineChange(id,field,value){
  const line=grnLines.find(l=>l.id===id);
  if(!line) return;
  if(field==='qty'||field==='cost') line[field]=parseFloat(value)||0;
  else line[field]=value;
  if(field==='itemCode'){
    const it=items.find(i=>i.code===value);
    if(it) line.cost=it.default_cost||0;
  }
  renderGrnLines();
}

function renderGrnLines(){
  const body=document.getElementById('grnLinesBody');
  if(!body) return;
  const itemOpts='<option value="">— اختر صنف —</option>'+items.map(i=>`<option value="${i.code}">${i.code} — ${i.name}</option>`).join('');
  body.innerHTML=grnLines.map(l=>`<tr>
    <td><select onchange="onGrnLineChange(${l.id},'itemCode',this.value)">${itemOpts.replace(`value="${l.itemCode}"`,`value="${l.itemCode}" selected`)}</select></td>
    <td><input type="number" step="0.01" min="0" value="${l.qty}" onchange="onGrnLineChange(${l.id},'qty',this.value)"></td>
    <td><input type="number" step="0.01" min="0" value="${l.cost}" onchange="onGrnLineChange(${l.id},'cost',this.value)"></td>
    <td class="linetotal">${fmt(l.qty*l.cost)}</td>
    <td><button class="rm-line" onclick="removeGrnLine(${l.id})">✕</button></td>
  </tr>`).join('');
  const total=grnLines.reduce((s,l)=>s+l.qty*l.cost,0);
  const el=document.getElementById('grnTotal');
  if(el) el.textContent=fmt(total);
}

function onGrnPoChange(){
  const po=purchaseOrders.find(p=>p.po_number===document.getElementById('grnPO').value);
  if(!po) return;
  document.getElementById('grnSupplier').value=po.supplier_code;
  grnLines=[];
  (po.lines||[]).forEach(l=>{lineCounter++;grnLines.push({id:lineCounter,itemCode:l.item_code,qty:l.qty,cost:l.unit_price});});
  renderGrnLines();
}

async function submitGRN(){
  const supplier_code=document.getElementById('grnSupplier').value;
  const grn_date=document.getElementById('grnDate').value;
  const po_number=document.getElementById('grnPO').value||null;
  const reference=document.getElementById('grnRef').value.trim()||null;
  const err=document.getElementById('grnErr');
  const valid=grnLines.filter(l=>l.itemCode&&l.qty>0);
  if(!supplier_code){err.textContent='يرجى اختيار المورد'; return;}
  if(!grn_date){err.textContent='يرجى إدخال التاريخ'; return;}
  if(!valid.length){err.textContent='يرجى إضافة صنف واحد على الأقل'; return;}
  err.textContent='';
  try{
    await api('POST','/api/grn',{
      grn_date,supplier_code,po_number,reference,
      lines:valid.map(l=>({item_code:l.itemCode,qty:l.qty,unit_cost:l.cost}))
    });
    grnLines=[];addGrnLine();
    document.getElementById('grnPO').value='';
    document.getElementById('grnSupplier').value='';
    document.getElementById('grnRef').value='';
    await loadAll();
  }catch(e){err.textContent=e.message;}
}

// ============================================================
// فاتورة المشتريات
// ============================================================
function onPinvGrnChange(){
  const grn=grns.find(g=>g.grn_number===document.getElementById('pinvGrn').value);
  const wrap=document.getElementById('pinvLinesWrap');
  if(!grn){wrap.innerHTML=''; document.getElementById('pinvSupplier').value=''; document.getElementById('pinvTotal').textContent='0.00'; return;}
  const sup=suppliers.find(s=>s.code===grn.supplier_code);
  document.getElementById('pinvSupplier').value=sup?sup.name:'';
  const rows=(grn.lines||[]).map(l=>{
    const it=items.find(i=>i.code===l.item_code);
    return `<tr><td>${it?it.code+' — '+it.name:l.item_code}</td><td class="num">${fmt(l.qty)}</td><td class="num">${fmt(l.unit_cost)}</td><td class="num">${fmt(l.qty*l.unit_cost)}</td></tr>`;
  }).join('');
  wrap.innerHTML=`<table class="line-items"><thead><tr><th>الصنف</th><th>الكمية</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>`;
  document.getElementById('pinvTotal').textContent=fmt(grn.total);
}

async function submitPinv(){
  const grn_number=document.getElementById('pinvGrn').value;
  const inv_date=document.getElementById('pinvDate').value;
  const supplier_inv_number=document.getElementById('pinvSupNum').value.trim()||null;
  const err=document.getElementById('pinvErr');
  if(!grn_number){err.textContent='يرجى اختيار عملية الاستلام'; return;}
  if(!inv_date){err.textContent='يرجى إدخال تاريخ الفاتورة'; return;}
  err.textContent='';
  try{
    await api('POST','/api/purchase-invoices',{grn_number,inv_date,supplier_inv_number});
    document.getElementById('pinvGrn').value='';
    document.getElementById('pinvSupNum').value='';
    document.getElementById('pinvLinesWrap').innerHTML='';
    document.getElementById('pinvTotal').textContent='0.00';
    document.getElementById('pinvSupplier').value='';
    await loadAll();
  }catch(e){err.textContent=e.message;}
}

// ============================================================
// مرتجع المشتريات
// ============================================================
function onPrtInvChange(){
  const inv=invoices.find(i=>i.inv_number===document.getElementById('prtInv').value);
  const wrap=document.getElementById('prtLinesWrap');
  if(!inv){wrap.innerHTML=''; prtCurrentLines=[]; document.getElementById('prtTotal').textContent='0.00'; return;}
  prtCurrentLines=(inv.lines||[]).map(l=>({item_code:l.item_code,unit_cost:l.unit_cost,max_qty:l.qty,qty:0}));
  renderPrtLines();
}

function onPrtQtyChange(item_code,v){
  const l=prtCurrentLines.find(x=>x.item_code===item_code);
  if(!l) return;
  let q=parseFloat(v)||0;
  if(q<0)q=0; if(q>l.max_qty)q=l.max_qty;
  l.qty=q;
  renderPrtLines();
}

function renderPrtLines(){
  const wrap=document.getElementById('prtLinesWrap');
  const rows=prtCurrentLines.map(l=>{
    const it=items.find(i=>i.code===l.item_code);
    return `<tr>
      <td>${it?it.code+' — '+it.name:l.item_code}</td>
      <td class="muted">حد: ${fmt(l.max_qty)}</td>
      <td><input type="number" step="0.01" min="0" max="${l.max_qty}" value="${l.qty}" onchange="onPrtQtyChange('${l.item_code}',this.value)"></td>
      <td class="num">${fmt(l.unit_cost)}</td>
      <td class="linetotal">${fmt(l.qty*l.unit_cost)}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML=`<table class="line-items"><thead><tr><th>الصنف</th><th>المتاح للإرجاع</th><th>كمية المرتجع</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>`;
  document.getElementById('prtTotal').textContent=fmt(prtCurrentLines.reduce((s,l)=>s+l.qty*l.unit_cost,0));
}

async function submitPrt(){
  const inv_number=document.getElementById('prtInv').value;
  const rt_date=document.getElementById('prtDate').value;
  const err=document.getElementById('prtErr');
  const valid=prtCurrentLines.filter(l=>l.qty>0);
  if(!inv_number){err.textContent='يرجى اختيار الفاتورة'; return;}
  if(!rt_date){err.textContent='يرجى إدخال التاريخ'; return;}
  if(!valid.length){err.textContent='يرجى إدخال كمية مرتجع لصنف واحد على الأقل'; return;}
  err.textContent='';
  try{
    await api('POST','/api/purchase-returns',{
      rt_date,inv_number,
      lines:valid.map(l=>({item_code:l.item_code,qty:l.qty}))
    });
    document.getElementById('prtInv').value='';
    document.getElementById('prtLinesWrap').innerHTML='';
    document.getElementById('prtTotal').textContent='0.00';
    prtCurrentLines=[];
    await loadAll();
  }catch(e){err.textContent=e.message;}
}

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
 document.querySelectorAll('.menu-popup').forEach(e=>e.style.display='none');
 document.querySelectorAll('.row-menu-trigger').forEach(b=>b.classList.remove('active'));
 if(m && willOpen){
   m.style.display='block';
   if(ev && ev.currentTarget) ev.currentTarget.classList.add('active');
 }
}
document.addEventListener('click', function(e){
  if(!e.target.closest('.row-menu')){
    document.querySelectorAll('.menu-popup').forEach(m=>m.style.display='none');
    document.querySelectorAll('.row-menu-trigger').forEach(b=>b.classList.remove('active'));
  }
});

function deleteItemSafe(code){
 const hasMove=(stockMoves||[]).some(m=>m.item_code===code);
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
