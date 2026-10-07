/* SPOOL sample request form. Needs auth.js first.
   SPOOL_SAMPLE.open({ design:{name, body, color, wash, distress, trims, graphics:[], idea}, images:{front:dataURL|null, back:dataURL|null} })
   Saves to Supabase (table "sample_requests" + private bucket "samples"), then the Worker emails it to SPOOL. */
(function(){
  'use strict';
  const WORKER='https://spool-studio-ai.chrishwang0327.workers.dev';
  const css=`.sr-back{position:fixed;inset:0;background:rgba(32,29,24,.55);display:none;align-items:flex-start;justify-content:center;z-index:210;padding:24px 16px;overflow:auto;font-family:Outfit,system-ui,sans-serif}
  .sr-back.open{display:flex}.sr-card{background:#FDFDF9;color:#201D18;border-radius:22px;max-width:620px;width:100%;padding:26px 26px 22px;position:relative;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);margin:auto 0}
  .sr-card h2{font-size:22px;margin:0 0 4px}.sr-sub{color:#7a7566;font-size:13.5px;margin:0 0 16px;line-height:1.45}
  .sr-x{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;border:0;background:#F3F1E8;cursor:pointer;font-size:15px}
  .sr-design{display:flex;gap:12px;align-items:center;background:#F3F1E8;border-radius:16px;padding:10px;margin-bottom:16px}
  .sr-design img{width:64px;height:64px;object-fit:cover;border-radius:10px;background:#fff}.sr-design div{font-size:12.5px;color:#7a7566;line-height:1.4;min-width:0}.sr-design b{display:block;color:#201D18;font-size:14px}
  .sr-sec{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7a7566;font-weight:600;margin:16px 0 8px}
  .sr-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sr-grid .full{grid-column:1/-1}
  .sr-f label{display:block;font-size:12px;font-weight:600;margin-bottom:4px}.sr-f label i{font-style:normal;color:#7a7566;font-weight:400}
  .sr-in{width:100%;box-sizing:border-box;border:1.5px solid transparent;background:#F3F1E8;border-radius:12px;padding:10px 12px;font:inherit;font-size:14px;outline:none;color:#201D18}
  .sr-in:focus{border-color:#201D18;background:#fff}textarea.sr-in{resize:vertical;min-height:64px}
  .sr-chips{display:flex;flex-wrap:wrap;gap:6px}.sr-chip{border:1px solid #201D1822;border-radius:99px;padding:6px 12px;font:inherit;font-size:12.5px;background:#FDFDF9;cursor:pointer;color:#201D18}
  .sr-chip.on{background:#201D18;color:#FDFDF9;border-color:#201D18}
  .sr-check{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.45;margin-top:16px}.sr-check input{margin-top:3px;width:16px;height:16px}
  .sr-btn{width:100%;margin-top:16px;border:0;border-radius:99px;padding:14px;font:inherit;font-weight:600;font-size:15px;background:#FEE32B;color:#201D18;cursor:pointer}.sr-btn:hover{background:#201D18;color:#FEE32B}.sr-btn:disabled{opacity:.5;cursor:wait}
  .sr-err{color:#a3341d;font-size:13px;min-height:18px;margin-top:8px}.sr-small{font-size:12px;color:#7a7566;margin-top:8px;text-align:center}
  .sr-done{text-align:center;padding:24px 6px 8px}.sr-done .ok{width:56px;height:56px;border-radius:50%;background:#FEE32B;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px}
  @media (max-width:560px){.sr-grid{grid-template-columns:1fr}.sr-card{padding:22px 18px}}`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const SIZES=['XS','S','M','L','XL','2XL','3XL'], QTY=['Under 50','50–150','150–300','300–1,000','1,000+'];
  let back=null, cur=null;

  function toJpeg(src,max=1600){ return new Promise(res=>{ if(!src) return res(null); const i=new Image(); i.crossOrigin='anonymous';
    i.onload=()=>{ const s=Math.min(1,max/Math.max(i.width,i.height)); const c=document.createElement('canvas'); c.width=Math.round(i.width*s); c.height=Math.round(i.height*s);
      const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(i,0,0,c.width,c.height); c.toBlob(b=>res(b),'image/jpeg',.9); };
    i.onerror=()=>res(null); i.src=src; }); }
  const fileURL=f=>new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.onerror=()=>r(null); fr.readAsDataURL(f); });
  const uuid=()=>crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});

  function build(){
    back=document.createElement('div'); back.className='sr-back'; back.setAttribute('role','dialog'); back.setAttribute('aria-modal','true');
    back.innerHTML=`<form class="sr-card" novalidate><button type="button" class="sr-x" aria-label="Close">✕</button><div id="srBody"></div></form>`;
    document.body.appendChild(back);
    back.querySelector('.sr-x').onclick=close; back.addEventListener('click',e=>{ if(e.target===back) close(); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&back.classList.contains('open')) close(); });
  }
  function close(){ back.classList.remove('open'); document.body.style.overflow=''; }
  function chips(name,list,val){ return `<div class="sr-chips" data-chips="${name}">${list.map(v=>`<button type="button" class="sr-chip${v===val?' on':''}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>`; }

  function renderForm(){
    const d=cur.design||{}, img=cur.images||{}, saved=(()=>{ try{ return JSON.parse(localStorage.getItem('spoolSampleContact')||'{}'); }catch(_){ return {}; } })();
    const email=window.SPOOL_AUTH?.email()||saved.email||'';
    const summary=[d.body,d.color,d.wash,d.trims].filter(Boolean).join(' · ');
    back.querySelector('#srBody').innerHTML=`
      <h2>Request a sample</h2>
      <p class="sr-sub">Tell us how you want it made. We'll reply with a quote within 1–2 business days — no payment now.</p>
      <div class="sr-design">${img.front?`<img src="${img.front}" alt="Front">`:''}${img.back?`<img src="${img.back}" alt="Back">`:''}<div><b>${esc(d.name||'Your design')}</b>${esc(summary||'Design details are sent with your request.')}</div></div>
      <div class="sr-sec">Contact</div>
      <div class="sr-grid">
        <div class="sr-f"><label for="srName">Name</label><input class="sr-in" id="srName" autocomplete="name" value="${esc(saved.name||'')}"></div>
        <div class="sr-f"><label for="srBrand">Brand / company <i>(optional)</i></label><input class="sr-in" id="srBrand" autocomplete="organization" value="${esc(saved.brand||'')}"></div>
        <div class="sr-f"><label for="srEmail">Email</label><input class="sr-in" id="srEmail" type="email" autocomplete="email" value="${esc(email)}"></div>
        <div class="sr-f"><label for="srPhone">Phone <i>(optional)</i></label><input class="sr-in" id="srPhone" type="tel" autocomplete="tel" value="${esc(saved.phone||'')}"></div>
      </div>
      <div class="sr-sec">Ship sample to</div>
      <div class="sr-grid">
        <div class="sr-f"><label for="srCity">City</label><input class="sr-in" id="srCity" autocomplete="address-level2" value="${esc(saved.city||'')}"></div>
        <div class="sr-f"><label for="srState">State</label><input class="sr-in" id="srState" autocomplete="address-level1" value="${esc(saved.state||'')}"></div>
        <div class="sr-f"><label for="srZip">ZIP code</label><input class="sr-in" id="srZip" autocomplete="postal-code" value="${esc(saved.zip||'')}"></div>
        <div class="sr-f"><label for="srCountry">Country</label><input class="sr-in" id="srCountry" autocomplete="country-name" value="${esc(saved.country||'United States')}"></div>
      </div>
      <div class="sr-sec">Sample</div>
      <div class="sr-f"><label>Sample size</label>${chips('size',SIZES,'M')}</div>
      <div class="sr-f" style="margin-top:12px"><label>How many samples</label>${chips('sqty',['1','2','3'],'1')}</div>
      <div class="sr-sec">Production plan</div>
      <div class="sr-f"><label>Estimated production quantity</label>${chips('pqty',QTY,'')}</div>
      <div class="sr-grid" style="margin-top:12px">
        <div class="sr-f"><label for="srNeed">Needed by <i>(optional)</i></label><input class="sr-in" id="srNeed" type="date"></div>
        <div class="sr-f"><label for="srPrice">Target price per unit <i>(optional)</i></label><input class="sr-in" id="srPrice" placeholder="e.g. $18"></div>
        <div class="sr-f full"><label for="srFabric">Fabric / weight <i>(optional)</i></label><input class="sr-in" id="srFabric" placeholder="e.g. 100% cotton fleece, 400 GSM"></div>
        <div class="sr-f full"><label for="srNotes">Notes <i>(optional)</i></label><textarea class="sr-in" id="srNotes" placeholder="Anything else we should know — labels, packaging, changes from the design"></textarea></div>
        <div class="sr-f full"><label for="srFiles">Extra files <i>(optional, up to 2 images)</i></label><input class="sr-in" id="srFiles" type="file" accept="image/*" multiple></div>
      </div>
      <label class="sr-check"><input type="checkbox" id="srRights"><span>I own or have permission to use the artwork, logos and references in this design.</span></label>
      <button class="sr-btn" type="submit" id="srSend">Send request</button>
      <div class="sr-err" id="srErr" role="alert"></div>
      <div class="sr-small">We'll email you at the address above. See our <a href="privacy.html" target="_blank" style="color:inherit">Privacy Policy</a>.</div>`;
    back.querySelectorAll('[data-chips]').forEach(g=>g.addEventListener('click',e=>{ const b=e.target.closest('.sr-chip'); if(!b) return; g.querySelectorAll('.sr-chip').forEach(x=>x.classList.toggle('on',x===b)); }));
    back.querySelector('form').onsubmit=submit;
  }
  const val=id=>(back.querySelector('#'+id)?.value||'').trim();
  const pick=n=>back.querySelector(`[data-chips="${n}"] .sr-chip.on`)?.dataset.v||'';

  async function submit(e){
    e.preventDefault();
    const err=back.querySelector('#srErr'), btn=back.querySelector('#srSend'); err.textContent='';
    const f={name:val('srName'),brand:val('srBrand'),email:val('srEmail'),phone:val('srPhone'),city:val('srCity'),state:val('srState'),zip:val('srZip'),country:val('srCountry'),
      sample_size:pick('size'),sample_qty:parseInt(pick('sqty'),10)||1,production_qty:pick('pqty'),needed_by:val('srNeed')||null,target_price:val('srPrice'),fabric:val('srFabric'),notes:val('srNotes'),
      rights:back.querySelector('#srRights').checked};
    if(!f.name) return err.textContent='Enter your name.';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return err.textContent='Enter a valid email.';
    if(!f.city||!f.zip) return err.textContent='Add a city and ZIP code so we can quote shipping.';
    if(!f.production_qty) return err.textContent='Pick an estimated production quantity.';
    if(!f.rights) return err.textContent='Please confirm you have the rights to the artwork.';
    const A=window.SPOOL_AUTH; const u=await A?.requireLogin?.('Sign in to request a sample.'); if(!u) return err.textContent='Sign in to send your request.';
    btn.disabled=true; btn.textContent='Sending…';
    try{
      try{ localStorage.setItem('spoolSampleContact',JSON.stringify({name:f.name,brand:f.brand,phone:f.phone,city:f.city,state:f.state,zip:f.zip,country:f.country,email:f.email})); }catch(_){}
      const id=uuid(), uid=u.id||A.user?.id, images={};
      const add=async(label,src)=>{ const blob=await toJpeg(src); if(!blob) return; const path=`${uid}/${id}/${label}.jpg`;
        const {error}=await A.sb.storage.from('samples').upload(path,blob,{contentType:'image/jpeg',upsert:false}); if(error) throw error; images[label]=path; };
      await add('front',cur.images?.front); await add('back',cur.images?.back);
      const files=[...(back.querySelector('#srFiles').files||[])].slice(0,2);
      for(let i=0;i<files.length;i++) await add('extra-'+(i+1),await fileURL(files[i]));
      const {error}=await A.sb.from('sample_requests').insert({id,user_id:uid,...f,design:cur.design||null,images});
      if(error) throw error;
      let mailed=true;
      try{ const tk=await A.token(); const r=await fetch(WORKER,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tk},body:JSON.stringify({task:'sample',id})}); if(!r.ok) mailed=false; }catch(_){ mailed=false; }
      window.SPOOL_TRACK?.('sample_sent',{qty:f.production_qty,mailed});
      back.querySelector('#srBody').innerHTML=`<div class="sr-done"><div class="ok">✓</div><h2>Request sent</h2>
        <p class="sr-sub" style="margin:8px auto 0;max-width:380px">Thanks, ${esc(f.name.split(' ')[0])}. We'll review your design and email a quote to <b>${esc(f.email)}</b> within 1–2 business days.${mailed?'':' (If you don\'t hear from us, email info@spoolnyc.com.)'}</p>
        <button type="button" class="sr-btn" style="max-width:240px" id="srOk">Done</button></div>`;
      back.querySelector('#srOk').onclick=close;
    }catch(e2){ console.error(e2); err.textContent='Could not send: '+(e2.message||e2)+'. Try again, or email info@spoolnyc.com.'; btn.disabled=false; btn.textContent='Send request'; }
  }

  window.SPOOL_SAMPLE={ async open(opts){
    if(!back) build(); cur=opts||{}; renderForm(); back.classList.add('open'); document.body.style.overflow='hidden'; back.scrollTop=0;
    window.SPOOL_TRACK?.('sample_open');
    setTimeout(()=>back.querySelector('#srName')?.focus(),60);
  }};
})();
