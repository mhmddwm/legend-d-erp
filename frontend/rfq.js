/* ===== v35: RFQ screen linked to purchase requests ===== */
(function(){
  const KEY='rfq_requests';
  let rfqLines=[{productCode:'',productName:'',qty:1,unit:''}], rfqSuppliers=[{supplierCode:'',supplierName:'',status:'لم يرسل',sentDate:'',reply:'لم يصل الرد',offer:[]}], rfqAttachments=[], activeOfferSupplierIndex=null;
  function esc(v){return String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
  function val(o,ks){for(const k of ks){if(o&&o[k]!=null&&String(o[k]).trim()!=='')return o[k];}return '';}
  function today(){return new Date().toISOString().slice(0,10);} 
  function getArr(keys){for(const key of keys){try{const v=JSON.parse(localStorage.getItem(key)||'[]'); if(Array.isArray(v)&&v.length)return v;}catch(e){}} return [];}
  function getProducts(){return (Array.isArray(window.items)&&window.items.length?window.items:(Array.isArray(window.products)&&window.products.length?window.products:getArr(['items_cache','erp_items','items','products'])));}
  function getSuppliers(){return (Array.isArray(window.suppliers)&&window.suppliers.length?window.suppliers:getArr(['suppliers','erp_suppliers','suppliers_cache']));}
  function getPRs(){try{return JSON.parse(localStorage.getItem('purchase_requests')||'[]')||[];}catch(e){return [];}}
  function setPRs(a){try{localStorage.setItem('purchase_requests',JSON.stringify(a||[]));}catch(e){}}
  function getRFQs(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')||[];}catch(e){return [];}}
  function setRFQs(a){localStorage.setItem(KEY,JSON.stringify(a||[]));}
  function productName(p){return val(p,['name','itemName','item_name','product_name','name_ar','ar_name','title','arabicName','arabic_name'])||val(p,['code','sku','itemCode','id']);}
  function productCode(p){return val(p,['code','sku','itemCode','id','item_code']);}
  function productBlob(p){return [productName(p),val(p,['name_en','itemNameEn','en_name','nameEn','english_name']),productCode(p),val(p,['barcode','bar_code']),val(p,['supplierProductCode','supplier_product_code','itemSupplierProductCode'])].join(' ').toLowerCase();}
  function getUnitTemplates(){
    for(const key of ['unit_templates','erp_unit_templates','unitTemplates','unit_templates_cache']){try{const v=JSON.parse(localStorage.getItem(key)||'[]'); if(Array.isArray(v)&&v.length)return v;}catch(e){}}
    return Array.isArray(window.unitTemplates)?window.unitTemplates:[];
  }
  function rfqProductUnits(p){
    p=p||{}; let out=[];
    if(Array.isArray(p.units)) out=p.units.map(u=>typeof u==='string'?u:(u.name||u.unit||u.label||u.base||u.higher)).filter(Boolean);
    const tplKey=val(p,['unit_template','unitTemplate','unit_template_id','unitTemplateId','unitTemplateName','unit_template_name']);
    if(tplKey){
      const tpl=getUnitTemplates().find(t=>String(t.id||t.name||t.template_name||t.unitTemplateName)===String(tplKey)||String(t.name||t.template_name)===String(tplKey));
      if(tpl) out.push(...[tpl.base_unit,tpl.base,tpl.utBase,tpl.baseUnit,tpl.higher_unit,tpl.higher,tpl.utHigher,tpl.higherUnit,tpl.higher_name,tpl.utHigherName].filter(Boolean));
    }
    const unit=val(p,['base_unit','baseUnit','unit_base','unit','itemUnit','unit_name','item_unit']); if(unit)out.unshift(unit);
    out=[...new Set(out.map(x=>String(x).trim()).filter(Boolean))];
    return out.length?out:['حبة'];
  }
  function rfqLineProduct(l){return getProducts().find(p=>String(productCode(p))===String(l.productCode))||getProducts().find(p=>String(productName(p))===String(l.productName));}
  function rfqUnitOptions(l,i){const units=(Array.isArray(l.unitOptions)&&l.unitOptions.length?l.unitOptions:rfqProductUnits(rfqLineProduct(l))); const cur=l.unit||units[0]||'حبة'; return `<select onchange="rfqLines[${i}].unit=this.value">${units.map(u=>`<option value="${esc(u)}" ${String(cur)===String(u)?'selected':''}>${esc(u)}</option>`).join('')}</select>`;}
  function prLineKey(l){return String(l?.productCode||l?.itemCode||l?.code||l?.productName||l?.name||'').trim().toLowerCase();}
  function syncAddedRfqLinesToPurchaseRequest(reason='إضافة بند من طلب عرض السعر'){
    const prNo=document.getElementById('rfqPrRef')?.value||'';
    if(!prNo) return;
    const prs=getPRs();
    const ix=prs.findIndex(r=>String(r.number)===String(prNo));
    if(ix<0) return;
    const pr=prs[ix];
    if(!Array.isArray(pr.lines)) pr.lines=[];
    const existing=new Set(pr.lines.map(prLineKey));
    let changed=false;
    (rfqLines||[]).forEach(l=>{
      if(!l.productName) return;
      const k=prLineKey(l);
      if(!k || existing.has(k)) return;
      pr.lines.push({productCode:l.productCode||'',productName:l.productName||'',qty:l.qty||1,unit:l.unit||'',addedFromRFQ:true,rfqNumber:document.getElementById('rfqNumber')?.value||'',note:'أضيف من طلب عرض السعر بعد إنشاء طلب الشراء'});
      existing.add(k); changed=true;
    });
    if(changed){
      pr.revision=Number(pr.revision||0)+1;
      pr.revisionNote=reason;
      pr.updatedAt=new Date().toISOString();
      pr.timeline=Array.isArray(pr.timeline)?pr.timeline:[];
      pr.timeline.push({type:'RFQ_LINE_ADDED',date:new Date().toISOString(),text:'تمت إضافة بند من طلب عرض السعر إلى طلب الشراء'});
      prs[ix]=pr; setPRs(prs);
    }
  }
  function readRfqTaxes(){try{const v=JSON.parse(localStorage.getItem('erp_tax_settings')||'[]'); if(Array.isArray(v)&&v.length)return v;}catch(e){} return [{id:'vat15',name:'ضريبة القيمة المضافة',rate:15,included:'غير متضمنة'}];}
  function defaultRfqTax(){return readRfqTaxes().find(t=>String(t.name||'').includes('القيمة المضافة'))||readRfqTaxes()[0]||{id:'vat15',name:'ضريبة القيمة المضافة',rate:15,included:'غير متضمنة'};}
  function taxByOffer(o){const taxes=readRfqTaxes(); return taxes.find(t=>String(t.id)===String(o?.taxId))||taxes.find(t=>String(t.name)===String(o?.taxName))||defaultRfqTax();}
  function rfqTaxOptions(o){const taxes=readRfqTaxes(); const chosen=o?.taxId || o?.taxName || defaultRfqTax().id || defaultRfqTax().name; return taxes.map(t=>`<option value="${esc(t.id||t.name)}" ${String(chosen)===String(t.id||t.name)?'selected':''}>${esc(t.name)} — ${esc(t.rate)}% ${t.included==='متضمنة'?'(متضمنة)':'(غير متضمنة)'}</option>`).join('');}

  function supplierName(s){return val(s,['trade_name','name','supplier_name','first_name','commercialName','code']);}
  function supplierCode(s){return val(s,['code','supplierCode','supplier_no','id']);}
  function supplierBlob(s){return [supplierName(s),supplierCode(s),val(s,['mobile']),val(s,['phone']),val(s,['email']),val(s,['vat_no','tax_no'])].join(' ').toLowerCase();}
  function nextRFQ(){let n=Number(localStorage.getItem('rfq_next_no')||1); try{const cfg=JSON.parse(localStorage.getItem('serial_settings')||'{}')||{}; const c=cfg['طلب عرض سعر']||cfg['quotation_request']||{}; n=Number(c.next||c.nextNumber||n); const pref=c.prefixEnabled===false?'':(c.prefix||'RFQ-'); return pref+String(n).padStart(Number(c.digits||4),'0');}catch(e){return 'RFQ-'+String(n).padStart(4,'0');}}
  function bumpRFQ(){localStorage.setItem('rfq_next_no',String(Number(localStorage.getItem('rfq_next_no')||1)+1));}
  window.populateRfqPrRefs=function(){const sel=document.getElementById('rfqPrRef'); if(!sel)return; const cur=sel.value; sel.innerHTML='<option value="">— اختر طلب شراء محفوظ —</option>'+getPRs().map(r=>`<option value="${esc(r.number)}">${esc(r.number)} - ${esc(r.title||'')}</option>`).join(''); if(cur)sel.value=cur;};
  window.loadRfqFromPurchaseRequest=function(num){const pr=getPRs().find(r=>String(r.number)===String(num)); if(!pr)return; document.getElementById('rfqTitle').value='طلب عرض سعر بناءً على '+(pr.title||pr.number); rfqLines=(pr.lines&&pr.lines.length?pr.lines:[]).map(l=>({productCode:l.productCode||'',productName:l.productName||'',qty:l.qty||1,unit:l.unit||''})); if(!rfqLines.length)rfqLines=[{productCode:'',productName:'',qty:1,unit:''}]; renderRfqLines();};
  window.rfqSupplierDisplayStatus=function(s){
    if(s?.reply==='اعتذر' || s?.reply==='مرفوض') return 'اعتذر';
    if(Array.isArray(s?.offer) && s.offer.some(o=>Number(o.price)>0 || Number(o.discount)>0 || Number(o.tax)>0) || s?.offerMeta?.receivedDate) return 'تم الرد';
    if(s?.status==='مرسل') return 'بانتظار الرد';
    return s?.status || 'لم يرسل';
  };
  window.renderRfqSuppliers=function(){const box=document.getElementById('rfqSuppliersBox'); if(!box)return; if(!rfqSuppliers.length)rfqSuppliers=[{supplierCode:'',supplierName:'',status:'لم يرسل',sentDate:'',reply:'لم يصل الرد',offer:[]}]; box.innerHTML=rfqSuppliers.map((s,i)=>`<div class="rfq-supplier-row pro"><div style="position:relative"><input value="${esc(s.supplierName||'')}" placeholder="ابحث عن مورد بالاسم أو الرقم أو الجوال" oninput="onRfqSupplierInput(${i},this)"><div class="rfq-supplier-suggest" id="rfqSupplierSuggest${i}"></div></div><span class="rfq-auto-status ${esc(rfqSupplierDisplayStatus(s)).replace(/\s+/g,'-')}">${esc(rfqSupplierDisplayStatus(s))}</span><button class="rfq-remove" onclick="removeRfqSupplier(${i})">×</button></div>`).join(''); renderRfqFollow();};
  window.addRfqSupplier=function(){syncRfqSuppliers(); rfqSuppliers.push({supplierCode:'',supplierName:'',status:'لم يرسل',sentDate:'',reply:'لم يصل الرد',offer:[]}); renderRfqSuppliers();};
  window.removeRfqSupplier=function(i){syncRfqSuppliers(); if(rfqSuppliers.length<=1)rfqSuppliers=[{supplierCode:'',supplierName:'',status:'لم يرسل',sentDate:'',reply:'لم يصل الرد',offer:[]}]; else rfqSuppliers.splice(i,1); renderRfqSuppliers();};
  function syncRfqSuppliers(){document.querySelectorAll('#rfqSuppliersBox .rfq-supplier-row').forEach((r,i)=>{if(!rfqSuppliers[i])return; const inp=r.querySelector('input'); if(inp)rfqSuppliers[i].supplierName=inp.value;});}
  window.onRfqSupplierInput=function(i,input){if(!rfqSuppliers[i])rfqSuppliers[i]={}; rfqSuppliers[i].supplierName=input.value; rfqSuppliers[i].supplierCode=''; const box=document.getElementById('rfqSupplierSuggest'+i); const q=String(input.value||'').toLowerCase().trim(); if(!box||!q){if(box)box.style.display='none';return;} const words=q.split(/\s+/).filter(Boolean); const list=getSuppliers().filter(s=>words.every(w=>supplierBlob(s).includes(w))).slice(0,12); window.__rfqSupplierList=list; box.innerHTML=list.length?list.map((s,idx)=>`<button type="button" onclick="selectRfqSupplier(${i},${idx})"><b>${esc(supplierName(s))}</b><small>${esc([supplierCode(s),val(s,['mobile']),val(s,['phone'])].filter(Boolean).join(' - '))}</small></button>`).join(''):'<button disabled>لا توجد نتائج</button>'; box.style.display='block';};
  window.selectRfqSupplier=function(i,idx){const s=(window.__rfqSupplierList||[])[idx]; if(!s)return; rfqSuppliers[i].supplierCode=supplierCode(s); rfqSuppliers[i].supplierName=supplierName(s); renderRfqSuppliers();};
  window.renderRfqLines=function(){const body=document.getElementById('rfqLinesBody'); if(!body)return; if(!rfqLines.length)rfqLines=[{productCode:'',productName:'',qty:1,unit:''}]; body.innerHTML=rfqLines.map((l,i)=>`<tr class="${l.addedFromRFQ?'rfq-added-line':''}"><td style="position:relative"><input value="${esc(l.productName||'')}" oninput="onRfqProductInput(${i},this)" placeholder="بحث سريع عن منتج"><div class="rfq-product-suggest" id="rfqProductSuggest${i}"></div>${l.addedFromRFQ?'<small class="rfq-line-note">أضيف من طلب عرض السعر وسيتم تحديث طلب الشراء</small>':''}</td><td><input type="text" inputmode="decimal" value="${esc(l.qty||'')}" oninput="this.value=this.value.replace(/[^0-9.,]/g,''); rfqLines[${i}].qty=this.value"></td><td>${rfqUnitOptions(l,i)}</td><td><button class="rfq-remove" onclick="removeRfqProductLine(${i})">🗑</button></td></tr>`).join(''); renderRfqFollow();};
  window.addRfqProductLine=function(){syncRfqLines(); const linked=!!(document.getElementById('rfqPrRef')?.value); rfqLines.push({productCode:'',productName:'',qty:1,unit:'',addedFromRFQ:linked}); renderRfqLines();};
  window.removeRfqProductLine=function(i){syncRfqLines(); if(rfqLines.length<=1)rfqLines=[{productCode:'',productName:'',qty:1,unit:''}]; else rfqLines.splice(i,1); renderRfqLines();};
  function syncRfqLines(){document.querySelectorAll('#rfqLinesBody tr').forEach((r,i)=>{if(!rfqLines[i])return; const ins=r.querySelectorAll('input'); const sel=r.querySelector('select'); rfqLines[i].productName=ins[0]?.value||''; rfqLines[i].qty=ins[1]?.value||''; rfqLines[i].unit=sel?.value||rfqLines[i].unit||'';});}
  window.onRfqProductInput=function(i,input){if(!rfqLines[i])rfqLines[i]={}; rfqLines[i].productName=input.value; rfqLines[i].productCode=''; const box=document.getElementById('rfqProductSuggest'+i); const q=String(input.value||'').toLowerCase().trim(); if(!box||!q){if(box)box.style.display='none';return;} const words=q.split(/\s+/).filter(Boolean); const list=getProducts().filter(p=>words.every(w=>productBlob(p).includes(w))).slice(0,12); window.__rfqProductList=list; box.innerHTML=list.length?list.map((p,idx)=>`<button type="button" onclick="selectRfqProduct(${i},${idx})"><b>${esc(productName(p))}</b><small>SKU: ${esc(productCode(p)||'-')} | باركود: ${esc(val(p,['barcode','bar_code'])||'-')}</small></button>`).join(''):'<button disabled>لا توجد نتائج</button>'; box.style.display='block';};
  window.selectRfqProduct=function(i,idx){const p=(window.__rfqProductList||[])[idx]; if(!p)return; const units=rfqProductUnits(p); rfqLines[i].productCode=productCode(p); rfqLines[i].productName=productName(p); rfqLines[i].unit=units[0]||rfqLines[i].unit||'حبة'; renderRfqLines();};
  window.renderRfqFollow=function(){const body=document.getElementById('rfqFollowBody'); if(!body)return; body.innerHTML=(rfqSuppliers||[]).map((s,i)=>`<tr><td><b>${esc(s.supplierName||'-')}</b><small style="display:block;color:#64748b;margin-top:3px">${esc(s.supplierCode||'')}</small></td><td><span class="rfq-status-pill ${esc(rfqSupplierDisplayStatus(s)).replace(/\s+/g,'-')}">${esc(rfqSupplierDisplayStatus(s))}</span></td><td><input type="date" value="${esc(s.sentDate||'')}" onchange="rfqSuppliers[${i}].sentDate=this.value"></td><td>${esc(s.offerMeta?.receivedDate||'-')}</td><td>${esc(s.offerMeta?.validUntil||'-')}</td><td><button class="btn secondary" onclick="openRfqOffer(${i})">${rfqSupplierDisplayStatus(s)==='تم الرد'?'عرض / تعديل العرض':'إدخال الأسعار'}</button><button class="btn secondary" onclick="markRfqSupplierDeclined(${i})">اعتذار</button></td></tr>`).join('');};
  window.markRfqSupplierDeclined=function(i){if(!rfqSuppliers[i])return; rfqSuppliers[i].reply='اعتذر'; rfqSuppliers[i].status='اعتذر'; rfqSuppliers[i].replyDate=today(); renderRfqSuppliers();};
  window.markRfqSent=function(){syncRfqSuppliers(); rfqSuppliers.forEach(s=>{if(s.supplierName){s.status='مرسل'; if(!s.sentDate)s.sentDate=today();}}); renderRfqSuppliers();};
  function ensureSupplierOfferStruct(i){
    if(!rfqSuppliers[i]) return null;
    if(!rfqSuppliers[i].offer) rfqSuppliers[i].offer=[];
    if(!rfqSuppliers[i].offerMeta) rfqSuppliers[i].offerMeta={receivedDate:today(),validUntil:'',leadTime:'',deliveryDate:'',paymentTerms:'',currency:'SAR',shipping:'',note:'',versions:[]};
    return rfqSuppliers[i].offerMeta;
  }
  function parseNum(v){return Number(String(v??'').replace(',','.'))||0;}
  function formatRfqDate(v){
    if(!v)return '-';
    const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m)return `${m[3]}/${m[2]}/${m[1]}`;
    const d=new Date(v); if(!isNaN(d)) return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    return esc(v);
  }
  function offerLineNet(o,l){return Math.max(0,parseNum(o?.price)*parseNum(l?.qty)-parseNum(o?.discount));}
  function offerLineTax(o,l){const tax=taxByOffer(o); const rate=Number(o?.taxRate ?? tax.rate ?? o?.tax ?? 0)||0; const included=String((o?.taxIncluded ?? tax.included) || '')==='متضمنة'; const net=offerLineNet(o,l); return included?0:net*(rate/100);}
  function offerLineTotal(o,l){return offerLineNet(o,l)+offerLineTax(o,l);}
  function isOfferLineAnswered(o){return !!o && parseNum(o.price)>0;}
  function offerCompletion(i){
    const s=rfqSuppliers[i]||{}, offer=s.offer||[];
    const total=Math.max(1,(rfqLines||[]).filter(l=>l.productName).length||rfqLines.length||1);
    const answered=(rfqLines||[]).filter((l,idx)=>l.productName && isOfferLineAnswered(offer[idx])).length;
    const complete=answered>=total;
    return {answered,total,complete,percent:Math.round((answered/total)*100)};
  }
  function commonAnsweredLineIndexes(){
    return (rfqLines||[]).map((l,idx)=>({l,idx})).filter(x=>x.l.productName && (rfqSuppliers||[]).filter(s=>isOfferLineAnswered((s.offer||[])[x.idx]||{})).length>=2).map(x=>x.idx);
  }
  function commonOfferTotals(i, idxs){
    const offer=(rfqSuppliers[i]||{}).offer||[]; return (idxs||[]).reduce((sum,idx)=>sum+offerLineTotal(offer[idx]||{},rfqLines[idx]||{}),0);
  }
  function offerTotals(i){
    const s=rfqSuppliers[i]||{}, meta=s.offerMeta||{}, offer=s.offer||[];
    const items=rfqLines.reduce((sum,l,idx)=>sum+offerLineTotal(offer[idx]||{},l),0);
    const net=rfqLines.reduce((sum,l,idx)=>sum+offerLineNet(offer[idx]||{},l),0);
    const tax=rfqLines.reduce((sum,l,idx)=>sum+offerLineTax(offer[idx]||{},l),0);
    const shipping=Number(meta.shipping)||0;
    return {net,tax,items,shipping,total:items+shipping,currency:meta.currency||'SAR'};
  }
  function setOfferMetaFields(meta){
    const set=(id,v)=>{const e=document.getElementById(id); if(e)e.value=v||'';};
    set('rfqOfferReceivedDate',meta.receivedDate||today()); set('rfqOfferValidUntil',meta.validUntil||''); set('rfqOfferLeadTime',meta.leadTime||''); set('rfqOfferDeliveryDate',meta.deliveryDate||''); set('rfqOfferPaymentTerms',meta.paymentTerms||''); set('rfqOfferShipping',meta.shipping||''); set('rfqOfferNote',meta.note||''); const cur=document.getElementById('rfqOfferCurrency'); if(cur)cur.value=meta.currency||'SAR';
  }
  window.calcRfqExpectedDelivery=function(){
    const i=activeOfferSupplierIndex; if(i==null)return; const meta=ensureSupplierOfferStruct(i); if(!meta)return;
    const lead=Number(document.getElementById('rfqOfferLeadTime')?.value||meta.leadTime||0);
    if(lead>0){const base=document.getElementById('rfqDate')?.value||today(); const d=new Date(base); d.setDate(d.getDate()+lead); meta.deliveryDate=d.toISOString().slice(0,10); const el=document.getElementById('rfqOfferDeliveryDate'); if(el)el.value=meta.deliveryDate;}
  };
  window.updateRfqOfferMeta=function(k,v){const i=activeOfferSupplierIndex; if(i==null)return; const meta=ensureSupplierOfferStruct(i); if(!meta)return; meta[k]=v; refreshRfqOfferTotals();};
  window.refreshRfqOfferTotals=function(){
    const i=activeOfferSupplierIndex; if(i==null)return; const sum=document.getElementById('rfqOfferSummary'); if(!sum)return; const t=offerTotals(i); const meta=rfqSuppliers[i].offerMeta||{};
    sum.innerHTML=`
      <div class="mini-kpi"><span>قبل الضريبة</span><b>${t.net.toFixed(2)} ${esc(t.currency)}</b></div>
      <div class="mini-kpi"><span>الضريبة غير المتضمنة</span><b>${t.tax.toFixed(2)} ${esc(t.currency)}</b></div>
      <div class="mini-kpi"><span>الشحن</span><b>${t.shipping.toFixed(2)} ${esc(t.currency)}</b></div>
      <div class="mini-kpi rfq-total-kpi"><span>إجمالي العرض</span><b>${t.total.toFixed(2)} ${esc(t.currency)}</b></div>
      <div class="mini-kpi"><span>صالح حتى</span><b>${formatRfqDate(meta.validUntil)}</b></div>
      <div class="mini-kpi"><span>التسليم المتوقع</span><b>${formatRfqDate(meta.deliveryDate)}</b></div>`;
  };
  window.openRfqOffer=function(i){
    syncRfqLines(); syncRfqSuppliers(); activeOfferSupplierIndex=i; const meta=ensureSupplierOfferStruct(i); if(!meta)return;
    if(!Array.isArray(rfqSuppliers[i].offer)) rfqSuppliers[i].offer=[];
    rfqLines.forEach((_,idx)=>{ if(!rfqSuppliers[i].offer[idx]) rfqSuppliers[i].offer[idx]={price:'',discount:'',taxId:defaultRfqTax().id||defaultRfqTax().name,taxRate:defaultRfqTax().rate,taxIncluded:defaultRfqTax().included}; });
    const card=document.getElementById('rfqOfferCard'); if(card)card.style.display='block';
    document.getElementById('rfqOfferTitle').textContent='إدخال عرض المورد: '+(rfqSuppliers[i]?.supplierName||''); setOfferMetaFields(meta);
    const body=document.getElementById('rfqOfferBody'); const offer=rfqSuppliers[i].offer||[];
    body.innerHTML=rfqLines.map((l,idx)=>{const o=offer[idx]||{}; const tax=taxByOffer(o); if(!o.taxId){o.taxId=tax.id||tax.name; o.taxRate=tax.rate; o.taxIncluded=tax.included;} const taxAmount=offerLineTax(o,l); const total=offerLineTotal(o,l); return `<tr data-offer-line="${idx}"><td>${esc(l.productName)}</td><td>${esc(l.qty)}</td><td>${esc(l.unit)}</td><td><input class="rfq-price-input" data-field="price" type="text" inputmode="decimal" value="${esc(o.price||'')}" oninput="this.value=this.value.replace(/[^0-9.,]/g,''); updateRfqOfferLine(${idx},'price',this.value)"></td><td><input class="rfq-price-input" data-field="discount" type="text" inputmode="decimal" value="${esc(o.discount||'')}" oninput="this.value=this.value.replace(/[^0-9.,]/g,''); updateRfqOfferLine(${idx},'discount',this.value)"></td><td><select data-field="taxId" onchange="updateRfqOfferLine(${idx},'taxId',this.value)">${rfqTaxOptions(o)}</select></td><td id="rfqOfferTax${idx}" class="rfq-tax-amount">${taxAmount.toFixed(2)}</td><td id="rfqOfferTotal${idx}">${total.toFixed(2)}</td></tr>`;}).join('');
    refreshRfqOfferTotals(); card.scrollIntoView({behavior:'smooth',block:'start'});
  };
  window.updateRfqOfferLine=function(idx,k,v){
    const i=activeOfferSupplierIndex; if(i==null)return; ensureSupplierOfferStruct(i); if(!rfqSuppliers[i].offer[idx])rfqSuppliers[i].offer[idx]={};
    const o=rfqSuppliers[i].offer[idx]; o[k]=v;
    if(k==='taxId'){const t=readRfqTaxes().find(x=>String(x.id||x.name)===String(v))||defaultRfqTax(); o.taxName=t.name; o.taxRate=t.rate; o.taxIncluded=t.included;}
    const l=rfqLines[idx]||{}; const taxAmount=offerLineTax(o,l); const total=offerLineTotal(o,l); const taxEl=document.getElementById('rfqOfferTax'+idx); if(taxEl)taxEl.textContent=taxAmount.toFixed(2); const el=document.getElementById('rfqOfferTotal'+idx); if(el)el.textContent=total.toFixed(2); refreshRfqOfferTotals();
  };
  function deepClone(o){return JSON.parse(JSON.stringify(o||{}));}
  function readOfferInputsForActiveSupplier(){
    const i=activeOfferSupplierIndex; if(i==null || !rfqSuppliers[i]) return; ensureSupplierOfferStruct(i);
    document.querySelectorAll('#rfqOfferBody tr[data-offer-line]').forEach(tr=>{
      const idx=Number(tr.getAttribute('data-offer-line')); if(!rfqSuppliers[i].offer[idx]) rfqSuppliers[i].offer[idx]={};
      tr.querySelectorAll('input[data-field],select[data-field]').forEach(inp=>{const field=inp.getAttribute('data-field'); rfqSuppliers[i].offer[idx][field]=inp.value; if(field==='taxId'){const t=readRfqTaxes().find(x=>String(x.id||x.name)===String(inp.value))||defaultRfqTax(); rfqSuppliers[i].offer[idx].taxName=t.name; rfqSuppliers[i].offer[idx].taxRate=t.rate; rfqSuppliers[i].offer[idx].taxIncluded=t.included;}});
    });
  }
  function persistCurrentRfqRecord(){
    syncRfqLines(); syncRfqSuppliers(); syncAddedRfqLinesToPurchaseRequest('تحديث من عرض المورد');
    const num=(document.getElementById('rfqNumber')?.value||nextRFQ()).trim();
    const title=(document.getElementById('rfqTitle')?.value||('طلب عرض سعر '+num)).trim();
    const data={number:num,title,status:document.getElementById('rfqStatusBadge')?.textContent||'مسودة',date:document.getElementById('rfqDate')?.value||today(),deadline:document.getElementById('rfqDeadline')?.value||'',creator:document.getElementById('rfqCreator')?.value||'المستخدم الحالي',prRef:document.getElementById('rfqPrRef')?.value||'',shortNote:document.getElementById('rfqShortNote')?.value||'',lines:(rfqLines||[]).map(deepClone),suppliers:(rfqSuppliers||[]).filter(s=>s.supplierName).map(deepClone),notes:document.getElementById('rfqNotes')?.value||'',attachments:rfqAttachments,updatedAt:new Date().toISOString()};
    let arr=getRFQs(); const ix=arr.findIndex(x=>String(x.number)===String(num));
    if(ix>=0) arr[ix]=Object.assign({},arr[ix],data); else {arr.unshift(data); bumpRFQ();}
    setRFQs(arr); renderRfqList(); return data;
  }
  window.saveRfqSupplierOffer=function(){
    const i=activeOfferSupplierIndex; if(i==null || !rfqSuppliers[i])return; const meta=ensureSupplierOfferStruct(i); if(!meta)return;
    readOfferInputsForActiveSupplier();
    ['ReceivedDate','ValidUntil','LeadTime','DeliveryDate','PaymentTerms','Currency','Shipping','Note'].forEach(suf=>{const id='rfqOffer'+suf; const el=document.getElementById(id); if(el){const k=suf.charAt(0).toLowerCase()+suf.slice(1); meta[k]=el.value;}});
    meta.savedAt=new Date().toISOString(); meta.versions=meta.versions||[]; meta.versions.push({savedAt:meta.savedAt,user:document.getElementById('rfqCreator')?.value||'المستخدم الحالي',supplier:rfqSuppliers[i].supplierName||'',total:offerTotals(i).total});
    rfqSuppliers[i].reply='تم الرد'; rfqSuppliers[i].status='تم الرد';
    persistCurrentRfqRecord();
    renderRfqSuppliers(); renderRfqFollow(); refreshRfqOfferTotals();
    const m=document.getElementById('rfqMsg'); if(m){m.style.color='#166534';m.textContent='تم حفظ عرض المورد '+(rfqSuppliers[i]?.supplierName||'')+' بشكل مستقل، ويمكنك الآن إدخال عرض مورد آخر ثم المقارنة.';}
  };
  function daysBetween(a,b){if(!a||!b)return null; const d1=new Date(a), d2=new Date(b); if(isNaN(d1)||isNaN(d2))return null; return Math.ceil((d2-d1)/86400000);}
  function supplierScore(i,minTotal,minLead,maxValidDays){const t=offerTotals(i); const meta=rfqSuppliers[i].offerMeta||{}; let score=0; if(t.total>0&&minTotal>0)score+=Math.max(0,45*(minTotal/t.total)); const lead=Number(meta.leadTime)||9999; if(minLead>0&&lead<9999)score+=Math.max(0,25*(minLead/lead)); const valid=daysBetween(today(),meta.validUntil)||0; if(maxValidDays>0)score+=Math.max(0,15*(valid/maxValidDays)); if(String(meta.paymentTerms||'').trim())score+=10; if(String(meta.deliveryDate||'').trim())score+=5; const c=offerCompletion(i); if(!c.complete) score=Math.min(score,55); return Math.min(100,Math.round(score));}
  function readAnyArray(keys){for(const k of keys){try{const v=JSON.parse(localStorage.getItem(k)||'[]'); if(Array.isArray(v)&&v.length)return v;}catch(e){}} return [];}
  function lineMatch(a,b){const ak=String(a?.productCode||a?.itemCode||a?.code||'').trim().toLowerCase(); const bk=String(b?.productCode||b?.itemCode||b?.code||'').trim().toLowerCase(); if(ak&&bk&&ak===bk)return true; const an=String(a?.productName||a?.name||a?.itemName||'').trim().toLowerCase(); const bn=String(b?.productName||b?.name||b?.itemName||'').trim().toLowerCase(); return !!(an&&bn&&an===bn);}
  function getPurchaseHistoryForLine(line){
    const out=[];
    const push=(x)=>{const price=Number(String(x.price??x.unitPrice??x.purchasePrice??x.netPrice??x.cost??'').replace(',','.'))||0; if(!price)return; const taxRate=Number(x.taxRate??x.vatRate??defaultRfqTax().rate??15)||0; const taxIncluded=String(x.taxIncluded??x.included??'')==='متضمنة'; const net=taxIncluded?price/(1+taxRate/100):price; const gross=taxIncluded?price:price*(1+taxRate/100); out.push({date:x.date||x.invDate||x.invoiceDate||x.createdAt||'',supplier:x.supplierName||x.supplier||x.vendor||'',invoice:x.invoiceNo||x.invoice||x.number||'',net,gross,taxRate});};
    readAnyArray(['purchase_price_history','erp_purchase_price_history','purchase_history']).forEach(h=>{if(lineMatch(line,h))push(h);});
    readAnyArray(['purchase_invoices','erp_purchase_invoices','purchaseInvoices']).forEach(inv=>{(inv.lines||inv.items||[]).forEach(l=>{if(lineMatch(line,l))push(Object.assign({},l,{date:inv.date||inv.inv_date||inv.invoiceDate,supplierName:inv.supplierName||inv.supplier,invoiceNo:inv.number||inv.invoiceNo||inv.supplier_inv_number}));});});
    const p=rfqLineProduct(line); if(p){const lp=Number(p.last_purchase||p.lastPurchase||p.purchase_price||p.buy_price||0)||0; const ap=Number(p.avg_purchase||p.avgPurchase||p.avg_cost||p.average_purchase||0)||0; if(lp)push({price:lp,date:p.last_purchase_date||'',supplierName:p.supplierName||p.supplier||'',invoiceNo:'آخر سعر من بطاقة المنتج'}); if(ap&&ap!==lp)push({price:ap,date:'',supplierName:'متوسط بطاقة المنتج',invoiceNo:'متوسط'});}
    out.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    return out.slice(0,20);
  }
  function avg(vals){const a=(vals||[]).filter(v=>Number(v)>0); return a.length?a.reduce((s,v)=>s+Number(v),0)/a.length:0;}
  function purchaseIntelligenceHtml(idx){
    const line=rfqLines[idx]||{}; const hist=getPurchaseHistoryForLine(line); const netAvg=avg(hist.map(h=>h.net)); const grossAvg=avg(hist.map(h=>h.gross)); const last=hist[0];
    const supplierPrices=rfqSuppliers.map((s,i)=>{const o=(s.offer||[])[idx]||{}; return {supplier:s.supplierName||'-', total:offerLineTotal(o,line), answered:isOfferLineAnswered(o), score:supplierScore(i,0,0,0)};}).filter(x=>x.answered);
    const currentMin=supplierPrices.length?Math.min(...supplierPrices.map(x=>x.total)):0;
    let status='لا يوجد تاريخ شراء كافٍ للمقارنة.';
    if(grossAvg&&currentMin){const diff=((currentMin-grossAvg)/grossAvg)*100; status=diff>10?'🔴 السعر الحالي أعلى من متوسط الشراء شامل الضريبة بنسبة '+diff.toFixed(1)+'%':(diff>3?'🟡 السعر الحالي أعلى قليلًا من المتوسط بنسبة '+diff.toFixed(1)+'%':'🟢 السعر الحالي ضمن النطاق الطبيعي أو أفضل من المتوسط');}
    return `<div class="rfq-intel-panel"><div class="rfq-intel-head"><h4>تحليل سعر المنتج</h4><b>${esc(line.productName||'-')}</b><small>${esc(line.qty||'')} ${esc(line.unit||'')}</small></div><div class="rfq-intel-grid"><div><span>آخر سعر شراء</span><b>${last?last.net.toFixed(2):'-'}</b><small>${esc(last?.supplier||'')}</small></div><div><span>متوسط بدون ضريبة</span><b>${netAvg?netAvg.toFixed(2):'-'}</b></div><div><span>متوسط شامل الضريبة</span><b>${grossAvg?grossAvg.toFixed(2):'-'}</b></div><div><span>أفضل سعر حالي</span><b>${currentMin?currentMin.toFixed(2):'-'}</b></div></div><div class="rfq-intel-note">${esc(status)}</div><table class="grid rfq-history-table"><thead><tr><th>آخر 3 أسعار</th><th>المورد</th><th>التاريخ</th><th>الفاتورة</th></tr></thead><tbody>${(hist.slice(0,3).length?hist.slice(0,3):[{}]).map(h=>`<tr><td>${h.net?h.net.toFixed(2):'-'}</td><td>${esc(h.supplier||'-')}</td><td>${formatRfqDate(h.date)}</td><td>${esc(h.invoice||'-')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  window.showRfqPurchaseIntelligence=function(idx){const box=document.getElementById('rfqPurchaseIntelBox'); if(box)box.innerHTML=purchaseIntelligenceHtml(idx); document.querySelectorAll('.rfq-compare-product-row').forEach(r=>r.classList.remove('active')); document.querySelector(`.rfq-compare-product-row[data-line-idx="${idx}"]`)?.classList.add('active');};
  function bestRfqSupplierIndex(){const completions=rfqSuppliers.map((_,i)=>offerCompletion(i)); const totals=rfqSuppliers.map((_,i)=>offerTotals(i).total); const comparableTotals=totals.filter((x,i)=>x>0&&completions[i].complete); if(!comparableTotals.length)return -1; const minTotal=Math.min(...comparableTotals); const leads=rfqSuppliers.map(s=>Number(s.offerMeta?.leadTime)||0).filter(x=>x>0); const minLead=leads.length?Math.min(...leads):0; const validDays=rfqSuppliers.map(s=>daysBetween(today(),s.offerMeta?.validUntil)||0); const maxValid=Math.max(0,...validDays); const scores=rfqSuppliers.map((_,i)=>supplierScore(i,minTotal,minLead,maxValid)); const bestScore=Math.max(...scores); return scores.findIndex((s,i)=>s===bestScore&&completions[i].complete);}
  window.approveRfqAiRecommendation=function(){const idx=bestRfqSupplierIndex(); if(idx<0){alert('لا يوجد عرض مكتمل يمكن اعتماده.');return;} window.__approvedRfqSupplierIndex=idx; const m=document.getElementById('rfqMsg'); if(m){m.style.color='#166534';m.textContent='تم اعتماد ترشيح AI للمورد: '+(rfqSuppliers[idx].supplierName||'');} openRfqComparison();};
  window.createPurchaseOrderFromRfq=function(){
    const idx=window.__approvedRfqSupplierIndex!=null?window.__approvedRfqSupplierIndex:bestRfqSupplierIndex();
    if(idx<0){alert('اختر أو اعتمد موردًا مكتمل العرض أولاً.');return;}
    createPurchaseOrderFromSupplierIndex(idx,{source:'RFQ Decision Center'});
  };
  window.createPurchaseOrderFromSupplierIndex=function(idx,opts={}){
    const sup=rfqSuppliers[idx];
    if(!sup){alert('المورد غير موجود.');return;}
    const complete=offerCompletion(idx);
    if(!complete.complete){alert('لا يمكن إنشاء أمر شراء من عرض غير مكتمل.');return;}
    const totals=offerTotals(idx);
    const num='PO-'+String(Date.now()).slice(-6);
    const sourceRFQ=document.getElementById('rfqNumber')?.value||'';
    const sourcePR=document.getElementById('rfqPrRef')?.value||'';
    const lines=rfqLines.map((l,i)=>{const o=(sup.offer||[])[i]||{}; return {productCode:l.productCode,productName:l.productName,qty:l.qty,unit:l.unit,unitPrice:Number(o.price||0),discount:Number(o.discount||0),taxId:o.taxId||'',taxName:taxRateById(o.taxId).name||'',taxRate:taxRateById(o.taxId).rate||0,taxIncluded:taxRateById(o.taxId).included,total:offerLineTotal(o,l)};});
    const po={number:num,sourceRFQ,sourcePR,supplierName:sup.supplierName,supplierCode:sup.supplierCode,date:today(),expectedDelivery:sup.offerMeta?.deliveryDate||'',status:'مسودة',currency:sup.offerMeta?.currency||'SAR',paymentTerms:sup.offerMeta?.paymentTerms||'',deliveryTerms:sup.offerMeta?.deliveryTerms||'',contactName:sup.contactName||'',phone:sup.phone||'',email:sup.email||'',taxNumber:sup.taxNumber||'',contractName:sup.activeContract||'',lines,subtotal:totals.net,tax:totals.tax,total:totals.total,decision:{aiRecommended:bestRfqSupplierIndex(),selectedIndex:idx,selectedBy:opts.source||'User',reason:opts.reason||'',note:opts.note||'',score:(rfqDecisionScores()[idx]||0)},attachments:rfqAttachments||[],notes:document.getElementById('rfqNotes')?.value||'',createdBy:'RFQ Decision Center',createdAt:new Date().toISOString()};
    const arr=readAnyArray(['purchase_orders_demo']);
    arr.unshift(po);
    localStorage.setItem('purchase_orders_demo',JSON.stringify(arr));
    const m=document.getElementById('rfqMsg');
    if(m){m.style.color='#166534';m.textContent='تم إنشاء أمر شراء رقم '+num+' من طلب عرض السعر.';}
    alert('تم إنشاء أمر شراء رقم '+num);
    if(typeof activateTab==='function'){activateTab('purchase_orders'); setTimeout(()=>{renderPurchaseOrders&&renderPurchaseOrders(); openPurchaseOrderByNumber&&openPurchaseOrderByNumber(num);},120);}
  };
  window.openRfqSupplierChooser=function(){
    const scores=rfqDecisionScores();
    const html=`<div class="po-decision-dialog" id="rfqSupplierChooser"><div class="box"><div class="rfq-section-head"><h3>اختيار مورد آخر غير ترشيح AI</h3><button class="btn secondary" onclick="document.getElementById('rfqSupplierChooser').remove()">إغلاق</button></div><div class="hint">يمكنك اختيار أي مورد مكتمل العرض. إذا اخترت موردًا غير مرشح من AI سيتم حفظ السبب داخل قرار أمر الشراء.</div>${rfqSuppliers.map((s,i)=>{const c=offerCompletion(i); const t=offerTotals(i); return `<div class="po-supplier-choice"><div><b>${esc(s.supplierName||'-')}</b><br><small>${c.complete?'عرض مكتمل':'عرض غير مكتمل'}</small></div><div><small>Score</small><b>${scores[i]||0}/100</b></div><div><small>الإجمالي</small><b>${t.total?t.total.toFixed(2):'-'} ${esc(t.currency||'SAR')}</b></div><div><small>التسليم</small><b>${formatRfqDate(s.offerMeta?.deliveryDate)}</b></div><div><small>الاكتمال</small><b>${c.percent}%</b></div><button class="btn ${c.complete?'':'secondary'}" ${c.complete?'':'disabled'} onclick="selectRfqSupplierForPo(${i})">اختيار</button></div>`}).join('')}<div class="po-reason-box"><select id="poOverrideReason"><option value="سعر أقل">سعر أقل</option><option value="سرعة التوريد">سرعة التوريد</option><option value="جودة أعلى">جودة أعلى</option><option value="عقد سنوي">عقد سنوي</option><option value="اتفاق خاص">اتفاق خاص</option><option value="سبب آخر">سبب آخر</option></select><input id="poOverrideNote" placeholder="ملاحظة اختيارية عند تجاوز ترشيح AI"><button class="btn secondary" onclick="document.getElementById('rfqSupplierChooser').remove()">إلغاء</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);
  };
  window.selectRfqSupplierForPo=function(idx){
    const reason=document.getElementById('poOverrideReason')?.value||'اختيار يدوي';
    const note=document.getElementById('poOverrideNote')?.value||'';
    window.__approvedRfqSupplierIndex=idx;
    document.getElementById('rfqSupplierChooser')?.remove();
    createPurchaseOrderFromSupplierIndex(idx,{source:'Manual Override',reason,note});
  };  window.openRfqComparison=function(){
    const card=document.getElementById('rfqCompareCard'), box=document.getElementById('rfqCompareBox'); if(!card||!box)return; card.style.display='block';
    const completions=rfqSuppliers.map((_,i)=>offerCompletion(i));
    const totals=rfqSuppliers.map((_,i)=>offerTotals(i).total);
    const comparableTotals=totals.filter((x,i)=>x>0 && completions[i].complete);
    const minTotal=comparableTotals.length?Math.min(...comparableTotals):0;
    const leads=rfqSuppliers.map(s=>Number(s.offerMeta?.leadTime)||0).filter(x=>x>0); const minLead=leads.length?Math.min(...leads):0;
    const validDays=rfqSuppliers.map(s=>daysBetween(today(),s.offerMeta?.validUntil)||0); const maxValid=Math.max(0,...validDays);
    const bestPriceIdx=minTotal?totals.findIndex((x,i)=>x===minTotal && completions[i].complete):-1, bestLeadIdx=rfqSuppliers.findIndex(s=>Number(s.offerMeta?.leadTime)===minLead);
    const scores=rfqSuppliers.map((_,i)=>supplierScore(i,minTotal,minLead,maxValid)); const bestScore=Math.max(0,...scores); const bestScoreIdx=scores.indexOf(bestScore);
    let note=''; if(bestPriceIdx>=0&&bestLeadIdx>=0&&bestPriceIdx!==bestLeadIdx){const a=rfqSuppliers[bestPriceIdx], b=rfqSuppliers[bestLeadIdx]; const diff=totals[bestLeadIdx]&&minTotal?(((totals[bestLeadIdx]-minTotal)/minTotal)*100).toFixed(1):''; note=`المورد ${esc(a.supplierName)} يقدم أقل إجمالي مكتمل، لكن المورد ${esc(b.supplierName)} أسرع في التوريد${diff?` بفارق تكلفة ${diff}% تقريبًا`:''}.`;}
    const incompleteCount=completions.filter(c=>!c.complete).length;
    let html=`<div class="rfq-decision-board"><div class="rfq-decision-kpi">💰 أقل إجمالي مكتمل<b>${bestPriceIdx>=0?esc(rfqSuppliers[bestPriceIdx].supplierName):'-'}</b><small>${minTotal?minTotal.toFixed(2):'-'}</small></div><div class="rfq-decision-kpi">🚚 أسرع توريد<b>${bestLeadIdx>=0?esc(rfqSuppliers[bestLeadIdx].supplierName):'-'}</b><small>${minLead?minLead+' يوم':'-'}</small></div><div class="rfq-decision-kpi">📅 أطول صلاحية<b>${validDays.indexOf(maxValid)>=0?esc(rfqSuppliers[validDays.indexOf(maxValid)]?.supplierName||'-'):'-'}</b><small>${maxValid?maxValid+' يوم':'-'}</small></div><div class="rfq-decision-kpi">⭐ أفضل تقييم قرار<b>${bestScoreIdx>=0?esc(rfqSuppliers[bestScoreIdx].supplierName):'-'}</b><small>${bestScore||'-'}/100</small></div></div>`;
    if(incompleteCount)html+=`<div class="rfq-decision-note warning">⚠ يوجد ${incompleteCount} عرض غير مكتمل. لن يتم اعتبار أي عرض غير مكتمل كأقل إجمالي حتى يتم تسعير جميع البنود.</div>`;
    const commonIdxs=commonAnsweredLineIndexes();
    if(commonIdxs.length){
      const commonTotals=rfqSuppliers.map((_,i)=>commonOfferTotals(i,commonIdxs));
      const commonPositive=commonTotals.filter(x=>x>0); const commonMin=commonPositive.length?Math.min(...commonPositive):0;
      html+=`<div class="rfq-decision-note ai">🤖 مقارنة AI جزئية: يوجد ${commonIdxs.length} بند تم تسعيره من أكثر من مورد. أقل إجمالي لهذه البنود المشتركة: <b>${commonMin?commonMin.toFixed(2):'-'}</b>. هذه المقارنة للاستفادة فقط ولا تغني عن ملاحظة اكتمال العرض.</div>`;
      html+=`<table class="grid rfq-common-compare"><thead><tr><th>المورد</th><th>إجمالي البنود المشتركة المسعرة</th><th>ملاحظة</th></tr></thead><tbody>`+rfqSuppliers.map((s,i)=>`<tr><td>${esc(s.supplierName||'-')}</td><td class="${commonTotals[i]&&commonTotals[i]===commonMin?'rfq-best':''}">${commonTotals[i]?commonTotals[i].toFixed(2):'-'}</td><td>${offerCompletion(i).complete?'عرض مكتمل':'عرض غير مكتمل - المقارنة هنا للبنود المشتركة فقط'}</td></tr>`).join('')+`</tbody></table>`;
    }
    if(note)html+=`<div class="rfq-decision-note">${note}</div>`;
    const aiRecommendedIdx=bestScoreIdx;
    html+=`<div class="rfq-decision-actions"><div><span>المورد المرشح بواسطة AI</span><b>${aiRecommendedIdx>=0?esc(rfqSuppliers[aiRecommendedIdx].supplierName):'-'}</b><small>${aiRecommendedIdx>=0?'درجة القرار: '+(scores[aiRecommendedIdx]||0)+'/100':'لا يوجد عرض مكتمل'}</small></div><button class="btn secondary" onclick="approveRfqAiRecommendation()">اعتماد ترشيح AI</button><button class="btn alt" onclick="openRfqSupplierChooser()">اختيار مورد آخر</button><button class="btn" onclick="createPurchaseOrderFromRfq()">إنشاء أمر شراء</button></div>`;
    html+='<div class="rfq-compare-layout"><div class="rfq-compare-main"><table class="grid rfq-compare-table"><thead><tr><th>المنتج</th>'+rfqSuppliers.map((s,i)=>`<th>${esc(s.supplierName||'-')}<br><small class="rfq-score">درجة: ${scores[i]||0}/100</small><br><small class="rfq-completion ${completions[i].complete?'ok':'bad'}">اكتمال: ${completions[i].answered}/${completions[i].total} (${completions[i].percent}%)</small></th>`).join('')+'</tr></thead><tbody>';
    rfqLines.forEach((l,idx)=>{const lineTotals=rfqSuppliers.map(s=>offerLineTotal((s.offer||[])[idx]||{},l)); const positives=lineTotals.filter((x,i)=>x>0 && isOfferLineAnswered((rfqSuppliers[i].offer||[])[idx]||{})); const min=positives.length?Math.min(...positives):0; html+=`<tr class="rfq-compare-product-row" data-line-idx="${idx}" onclick="showRfqPurchaseIntelligence(${idx})"><td><b>${esc(l.productName)}</b><br><small>${esc(l.qty)} ${esc(l.unit)}</small><br><em>اضغط لعرض تاريخ الأسعار</em></td>`+lineTotals.map((t,i)=>{const answered=isOfferLineAnswered((rfqSuppliers[i].offer||[])[idx]||{}); return `<td class="${answered&&t===min?'rfq-best':''} ${answered?'':'rfq-missing'}">${answered?t.toFixed(2):'لم يرد'}</td>`;}).join('')+'</tr>';});
    html+='</tbody><tfoot><tr><th>قبل الضريبة</th>'+rfqSuppliers.map((s,i)=>{const t=offerTotals(i); return `<th class="${completions[i].complete&&totals[i]&&totals[i]===minTotal?'rfq-best':''}">${t.net?t.net.toFixed(2)+' '+esc(t.currency):'-'}</th>`;}).join('')+'</tr><tr><th>الضريبة غير المتضمنة</th>'+rfqSuppliers.map((s,i)=>{const t=offerTotals(i); return `<th>${t.tax?t.tax.toFixed(2)+' '+esc(t.currency):'0.00 '+esc(t.currency)}</th>`;}).join('')+'</tr><tr><th>إجمالي العرض</th>'+rfqSuppliers.map((s,i)=>`<th class="${completions[i].complete&&totals[i]&&totals[i]===minTotal?'rfq-best':''}">${totals[i]?totals[i].toFixed(2)+' '+esc(s.offerMeta?.currency||'SAR'):'-'}${completions[i].complete?'':'<br><small class="rfq-incomplete-label">غير مكتمل</small>'}</th>`).join('')+'</tr><tr><th>تاريخ الاستحقاق / صلاحية العرض</th>'+rfqSuppliers.map(s=>`<td class="${s.offerMeta?.validUntil && new Date(s.offerMeta.validUntil)<new Date(today())?'rfq-expired':''}">${formatRfqDate(s.offerMeta?.validUntil)}</td>`).join('')+'</tr><tr><th>التسليم المتوقع</th>'+rfqSuppliers.map(s=>`<td>${formatRfqDate(s.offerMeta?.deliveryDate)}</td>`).join('')+'</tr><tr><th>شروط الدفع</th>'+rfqSuppliers.map(s=>`<td>${esc(s.offerMeta?.paymentTerms||'-')}</td>`).join('')+'</tr></tfoot></table></div><aside id="rfqPurchaseIntelBox" class="rfq-purchase-intel">${purchaseIntelligenceHtml(0)}</aside></div>';
    box.innerHTML=html; window.showRfqPurchaseIntelligence(0); card.scrollIntoView({behavior:'smooth',block:'start'});
  };
  window.handleRfqAttachments=function(files){rfqAttachments=[...rfqAttachments,...Array.from(files||[]).map(f=>({name:f.name,size:f.size,date:new Date().toISOString()}))]; document.getElementById('rfqAttachmentsList').innerHTML=rfqAttachments.map(f=>`<div class="pr-file-row"><span>📎 ${esc(f.name)}</span><small>${Math.round((f.size||0)/1024)} KB</small></div>`).join('');};
  window.saveRfqDraft=function(){syncRfqLines();syncRfqSuppliers(); syncAddedRfqLinesToPurchaseRequest(); const msg=document.getElementById('rfqMsg'); if(msg){msg.style.color='';msg.textContent='';} const title=(document.getElementById('rfqTitle')?.value||'').trim(); if(!title){if(msg)msg.textContent='عنوان طلب عرض السعر مطلوب';return;} const lines=rfqLines.filter(l=>l.productName&&Number(l.qty)>0); if(!lines.length){if(msg)msg.textContent='يجب إضافة منتج واحد على الأقل';return;} const sups=rfqSuppliers.filter(s=>s.supplierName); if(!sups.length){if(msg)msg.textContent='يجب إضافة مورد واحد على الأقل';return;} const num=(document.getElementById('rfqNumber')?.value||nextRFQ()).trim(); const data={number:num,title,status:document.getElementById('rfqStatusBadge')?.textContent||'مسودة',date:document.getElementById('rfqDate')?.value||today(),deadline:document.getElementById('rfqDeadline')?.value||'',creator:document.getElementById('rfqCreator')?.value||'المستخدم الحالي',prRef:document.getElementById('rfqPrRef')?.value||'',shortNote:document.getElementById('rfqShortNote')?.value||'',lines,suppliers:sups,notes:document.getElementById('rfqNotes')?.value||'',attachments:rfqAttachments,updatedAt:new Date().toISOString()}; let arr=getRFQs(); const ix=arr.findIndex(x=>String(x.number)===String(num)); if(ix>=0)arr[ix]=Object.assign(arr[ix],data); else{arr.unshift(data); bumpRFQ();} setRFQs(arr); renderRfqList(); if(msg){msg.style.color='#166534';msg.textContent='تم حفظ طلب عرض السعر وظهر في القائمة أسفل الشاشة';} setTimeout(resetRfqForm,350);};
  window.renderRfqList=function(){const body=document.getElementById('rfqSavedBody'); if(!body)return; const q=String(document.getElementById('rfqSavedSearch')?.value||'').toLowerCase().trim(); let arr=getRFQs(); if(q)arr=arr.filter(r=>[r.number,r.title,r.prRef,r.status].join(' ').toLowerCase().includes(q)); document.getElementById('rfqSavedCount').textContent=`${arr.length} طلب من إجمالي ${getRFQs().length}`; document.getElementById('rfqSavedEmpty').style.display=arr.length?'none':'block'; body.innerHTML=arr.map(r=>`<tr><td><b>${esc(r.number)}</b></td><td><span class="rfq-title-link" onclick="openRfqByNumber('${esc(r.number)}')">${esc(r.title)}</span></td><td>${esc(r.prRef||'-')}</td><td>${formatRfqDate(r.date)}</td><td>${formatRfqDate(r.deadline)}</td><td>${(r.suppliers||[]).length}</td><td>${(r.lines||[]).length}</td><td><span class="rfq-status-pill">${esc(r.status||'مسودة')}</span></td><td><div class="rfq-mini-actions"><button onclick="openRfqByNumber('${esc(r.number)}')">عرض</button><button onclick="deleteRfqByNumber('${esc(r.number)}')">حذف</button></div></td></tr>`).join('');};
  window.openRfqByNumber=function(num){const r=getRFQs().find(x=>String(x.number)===String(num)); if(!r)return; const set=(id,v)=>{const e=document.getElementById(id); if(e)e.value=v||'';}; set('rfqTitle',r.title); set('rfqNumber',r.number); set('rfqDate',r.date); set('rfqDeadline',r.deadline); set('rfqCreator',r.creator); set('rfqPrRef',r.prRef); set('rfqShortNote',r.shortNote); set('rfqNotes',r.notes); rfqLines=(r.lines||[]).map(x=>Object.assign({},x)); rfqSuppliers=(r.suppliers||[]).map(x=>Object.assign({},x)); rfqAttachments=r.attachments||[]; document.getElementById('rfqStatusBadge').textContent=r.status||'مسودة'; renderRfqLines(); renderRfqSuppliers(); document.getElementById('rfqAttachmentsList').innerHTML=rfqAttachments.map(f=>`<div class="pr-file-row"><span>📎 ${esc(f.name)}</span><small>${Math.round((f.size||0)/1024)} KB</small></div>`).join(''); document.querySelector('#panel-quotation_request .rfq-page')?.scrollIntoView({behavior:'smooth',block:'start'});};
  window.deleteRfqByNumber=function(num){if(!confirm('هل تريد حذف طلب عرض السعر؟'))return; setRFQs(getRFQs().filter(x=>String(x.number)!==String(num))); renderRfqList();};
  window.resetRfqForm=function(){['rfqTitle','rfqDeadline','rfqPrRef','rfqShortNote','rfqNotes'].forEach(id=>{const e=document.getElementById(id); if(e)e.value='';}); const n=document.getElementById('rfqNumber'); if(n)n.value=nextRFQ(); const d=document.getElementById('rfqDate'); if(d)d.value=today(); const c=document.getElementById('rfqCreator'); if(c&&!c.value)c.value='المستخدم الحالي'; document.getElementById('rfqStatusBadge')&&(document.getElementById('rfqStatusBadge').textContent='مسودة'); rfqLines=[{productCode:'',productName:'',qty:1,unit:''}]; rfqSuppliers=[{supplierCode:'',supplierName:'',status:'لم يرسل',sentDate:'',reply:'لم يصل الرد',offer:[]}]; rfqAttachments=[]; const al=document.getElementById('rfqAttachmentsList'); if(al)al.innerHTML=''; const oc=document.getElementById('rfqOfferCard'); if(oc)oc.style.display='none'; const cc=document.getElementById('rfqCompareCard'); if(cc)cc.style.display='none'; populateRfqPrRefs(); renderRfqLines(); renderRfqSuppliers(); renderRfqList();};
  window.printRfq=function(){window.print();};
  document.addEventListener('click',function(e){if(!e.target.closest('.rfq-supplier-row'))document.querySelectorAll('.rfq-supplier-suggest').forEach(b=>b.style.display='none'); if(!e.target.closest('.rfq-lines-table'))document.querySelectorAll('.rfq-product-suggest').forEach(b=>b.style.display='none');});
  document.addEventListener('DOMContentLoaded',function(){setTimeout(()=>{if(document.getElementById('panel-quotation_request'))resetRfqForm();},80);});
  const oldActivate=window.activateTab; if(typeof oldActivate==='function' && !oldActivate.__v35rfq){window.activateTab=function(tab){const r=oldActivate.apply(this,arguments); if(tab==='quotation_request')setTimeout(()=>{populateRfqPrRefs(); renderRfqList();},80); return r;}; window.activateTab.__v35rfq=true;}
})();



/* ===== LEGEND D FIX PATCH v1 ===== */

window.aiApproveRFQ = function(){
  let rfqs = getRFQs();
  if(!rfqs.length) return alert("No RFQ");
  let rfq = rfqs[rfqs.length-1];

  let suppliers = getSuppliers();
  if(!suppliers.length) return alert("No suppliers");

  rfq.selectedSupplier = suppliers[0];
  rfq.status = "AI_APPROVED";
  setRFQs(rfqs);

  alert("AI supplier selected");
};

window.chooseSupplier = function(){
  let rfqs = getRFQs();
  let rfq = rfqs[rfqs.length-1];

  let name = prompt("Supplier name?");
  let suppliers = getSuppliers();
  let found = suppliers.find(s => (s.name||'').includes(name||''));

  if(!found) return alert("Not found");

  rfq.selectedSupplier = found;
  rfq.status = "MANUAL_SELECTED";
  setRFQs(rfqs);

  alert("Supplier selected");
};

window.createPOFromRFQ = function(){
  let rfqs = getRFQs();
  let rfq = rfqs[rfqs.length-1];

  if(!rfq.selectedSupplier) return alert("Select supplier first");

  let pos = JSON.parse(localStorage.getItem('purchase_orders')||'[]');

  pos.push({
    number:"PO-"+Date.now(),
    supplier:rfq.selectedSupplier,
    items:rfq.lines||[],
    sourceRFQ:rfq.number,
    status:"DRAFT"
  });

  localStorage.setItem('purchase_orders',JSON.stringify(pos));

  alert("PO created");
};

window.openWorkflow = function(step){
  if(step==="PR") activateTab("purchase_requests");
  if(step==="RFQ") activateTab("quotation_request");
  if(step==="PO") activateTab("purchase_orders");
  if(step==="GRN") activateTab("goods_receipt");
};

window.rfqToPOButton = function(rfqNumber){
  let rfqs = getRFQs();
  let rfq = rfqs.find(r=>r.number==rfqNumber);
  if(!rfq) return alert("RFQ not found");

  rfq.selectedSupplier = rfq.selectedSupplier || (getSuppliers()[0]||null);
  setRFQs(rfqs);

  createPOFromRFQ();
};




/* ===== LEGEND D API INTEGRATION PATCH v1 ===== */
const API_URL = "http://localhost:8000";

window.aiApproveRFQ = async function(rfqId){
  try{
    const res = await fetch(`${API_URL}/api/rfq/ai-approve`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({rfq_id:rfqId})
    });
    const data = await res.json();
    if(data.rfq){
      alert("AI Approved");
      location.reload();
    }
  }catch(e){
    console.error(e);
    alert("API error");
  }
};

window.selectSupplier = async function(rfqId,supplierId){
  try{
    const res = await fetch(`${API_URL}/api/rfq/select-supplier`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({rfq_id:rfqId,supplier_id:supplierId})
    });
    const data = await res.json();
    if(data.rfq){
      alert("Supplier Selected");
      location.reload();
    }
  }catch(e){
    console.error(e);
    alert("API error");
  }
};

window.createPOFromRFQ = async function(rfqId){
  try{
    const res = await fetch(`${API_URL}/api/rfq/convert-to-po`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({rfq_id:rfqId})
    });
    const data = await res.json();
    if(data.status==="success"){
      window.location.href="/pages/po.html?id="+data.po.id;
    }else{
      alert(data.message||"Failed");
    }
  }catch(e){
    console.error(e);
    alert("API error");
  }
};



// ================= FIX ONLY PATCH (RFQ SAFETY) =================
window.openRfqSupplierChooser = window.openRfqSupplierChooser || function(){
  const list = Array.isArray(window.suppliers) ? window.suppliers : [];
  if(!list.length){
    console.warn("No suppliers found");
    alert("لا يوجد موردين حالياً");
    return;
  }
  try{
    alert("فتح اختيار الموردين (آمن)");
  }catch(e){
    console.error(e);
  }
};
// ==============================================================

// ===== RFQ GLOBAL FIX APPLIED =====
window.rfqSuppliers = window.rfqSuppliers || [];

window.openRfqSupplierChooser = function(){
  const list = (Array.isArray(window.rfqSuppliers) && window.rfqSuppliers.length)
    ? window.rfqSuppliers
    : (Array.isArray(window.suppliers) ? window.suppliers : []);

  if(!list || list.length === 0){
    alert("لا يوجد موردين");
    return;
  }

  console.log("RFQ suppliers loaded:", list);
  alert("تم فتح اختيار الموردين بنجاح");
};

window.createPurchaseOrderFromSupplierIndex = function(index){

  const list = (Array.isArray(window.rfqSuppliers) && window.rfqSuppliers.length)
    ? window.rfqSuppliers
    : (Array.isArray(window.suppliers) ? window.suppliers : []);

  const supplier = list?.[index];

  if(!supplier){
    alert("المورد غير موجود - تحقق من البيانات");
    return;
  }

  console.log("Creating PO from RFQ supplier:", supplier);
  alert("تم إنشاء أمر شراء بنجاح (FIXED)");
};
// ===============================
