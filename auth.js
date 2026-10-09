/* SPOOL account: sign-in (email link), session, header chip, cloud project storage.
   Needs supabase-js (UMD) loaded first. Publishable key is safe to ship in the browser. */
(function(){
  'use strict';
  const SB_URL='https://deblflfpfapfajghhufv.supabase.co';
  const SB_KEY='sb_publishable_SmsPhhRum8I32qTCfdqceQ_H6Wcwdf4';
  const ok=!!(window.supabase&&window.supabase.createClient);
  const sb=ok?window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit'}}):null;
  let user=null; const subs=[];
  const ready=(async()=>{ if(!sb) return null; try{ const {data}=await sb.auth.getSession(); user=data.session?.user||null; }catch(e){ console.warn(e); } return user; })();
  let scopeId=null; ready.then(u=>{ scopeId=u?u.id:'guest'; });
  if(sb) sb.auth.onAuthStateChange((_e,session)=>{ user=session?.user||null; subs.forEach(f=>{try{f(user)}catch(e){}}); renderChips();
    // another account (or signed out) → reload so this page only shows that account's saved work
    if(scopeId!==null && (user?user.id:'guest')!==scopeId){ scopeId=user?user.id:'guest'; setTimeout(()=>location.reload(),150); } });

  /* ---------- modal ---------- */
  const css=`.sa-back{position:fixed;inset:0;background:rgba(32,29,24,.55);display:none;align-items:center;justify-content:center;z-index:200;padding:20px;font-family:Outfit,system-ui,sans-serif}
  .sa-back.open{display:flex}.sa-card{background:#FDFDF9;color:#201D18;border-radius:22px;max-width:420px;width:100%;padding:28px;position:relative;box-shadow:0 30px 80px -30px rgba(0,0,0,.5)}
  .sa-card h2{font-size:22px;margin:0 0 6px}.sa-card p{color:#7a7566;font-size:14px;margin:0 0 14px;line-height:1.5}
  .sa-in{width:100%;box-sizing:border-box;border:1.5px solid transparent;background:#F3F1E8;border-radius:12px;padding:12px 14px;font:inherit;font-size:15px;outline:none}.sa-in:focus{border-color:#201D18;background:#fff}
  .sa-btn{width:100%;margin-top:12px;border:0;border-radius:99px;padding:13px;font:inherit;font-weight:600;font-size:15px;background:#FEE32B;color:#201D18;cursor:pointer}.sa-btn:hover{background:#201D18;color:#FEE32B}.sa-btn:disabled{opacity:.5}
  .sa-x{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;border:0;background:#F3F1E8;cursor:pointer;font-size:15px}
  .sa-err{color:#a3341d;font-size:13px;min-height:18px;margin-top:8px}.sa-small{font-size:12px;color:#7a7566;margin-top:12px}
  .sa-chip{display:inline-flex;align-items:center;gap:8px;border:1px solid #201D1822;border-radius:99px;padding:6px 12px 6px 6px;background:#FDFDF9;font:500 13px Outfit,system-ui,sans-serif;color:#201D18;cursor:pointer;position:relative;white-space:nowrap}
  .sa-chip.out{padding:8px 16px;background:#201D18;color:#FDFDF9;border-color:#201D18}
  .sa-av{width:24px;height:24px;border-radius:50%;background:#FEE32B;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px}
  .sa-menu{position:absolute;right:0;top:calc(100% + 6px);background:#FDFDF9;border:1px solid #201D1822;border-radius:14px;box-shadow:0 14px 40px -16px rgba(0,0,0,.35);padding:6px;min-width:200px;display:none;z-index:150;text-align:left}
  .sa-menu.open{display:block}.sa-menu a,.sa-menu button{display:block;width:100%;text-align:left;padding:9px 12px;border-radius:10px;border:0;background:none;font:inherit;color:#201D18;text-decoration:none;cursor:pointer}
  .sa-menu a:hover,.sa-menu button:hover{background:#FBEF9C}.sa-menu .sa-plan{font-weight:600}.sa-menu .sa-plan i{font-style:normal;font-weight:400;color:#7a7566}
  .sa-pw ul{list-style:none;padding:0;margin:4px 0 14px;display:grid;gap:8px;font-size:14.5px}.sa-pw li{display:flex;gap:10px;align-items:flex-start}.sa-pw li:before{content:"✓";font-weight:700;background:#FEE32B;border-radius:50%;width:20px;height:20px;flex:none;display:flex;align-items:center;justify-content:center;font-size:12px}
  .sa-price{font-size:30px;font-weight:700;letter-spacing:-.02em;margin:2px 0 2px}.sa-price span{font-size:14px;font-weight:500;color:#7a7566}
  .sa-btn.dark{background:#201D18;color:#FEE32B}.sa-btn.dark:hover{background:#FEE32B;color:#201D18}.sa-link{display:block;width:100%;margin-top:10px;border:0;background:none;font:inherit;font-size:14px;color:#201D18;text-decoration:underline;cursor:pointer}
  .sa-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#201D18;color:#FDFDF9;padding:12px 18px;border-radius:99px;font:500 14px Outfit,system-ui,sans-serif;z-index:300;box-shadow:0 14px 40px -16px rgba(0,0,0,.5);max-width:calc(100% - 32px)}.sa-menu small{display:block;padding:6px 12px 8px;color:#7a7566;border-bottom:1px solid #201D1414;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis}`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  let back=null, pending=[];
  function modal(reason){
    if(!back){
      back=document.createElement('div'); back.className='sa-back'; back.setAttribute('role','dialog'); back.setAttribute('aria-modal','true');
      back.innerHTML=`<form class="sa-card" novalidate><button type="button" class="sa-x" aria-label="Close">✕</button>
        <div id="saStep1"><h2>Sign in to SPOOL</h2><p id="saWhy">Save your designs and pick them up on any device.</p>
        <label for="saEmail" style="font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#7a7566">Email</label>
        <input class="sa-in" id="saEmail" type="email" autocomplete="email" placeholder="you@brand.com" style="margin-top:6px">
        <button class="sa-btn" id="saSend" type="submit">Email me a sign-in link</button><div class="sa-err" id="saErr" role="alert"></div>
        <div class="sa-small">No password needed. New here? The same link creates your account.</div>
        <div class="sa-small">By continuing you agree to our <a href="terms.html" target="_blank" style="color:inherit">Terms</a> and <a href="privacy.html" target="_blank" style="color:inherit">Privacy Policy</a>.</div></div>
        <div id="saStep2" style="display:none"><h2>Check your email</h2><p>We sent a sign-in link to <b id="saTo"></b>. Open it on this device and you'll come right back here, signed in.</p>
        <button class="sa-btn" type="button" id="saAgain" style="background:#F3F1E8">Use a different email</button></div></form>`;
      document.body.appendChild(back);
      const close=()=>{ back.classList.remove('open'); const p=pending; pending=[]; p.forEach(r=>r(user)); };
      back.querySelector('.sa-x').onclick=close; back.addEventListener('click',e=>{ if(e.target===back) close(); });
      document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&back.classList.contains('open')) close(); });
      back.querySelector('#saAgain').onclick=()=>{ back.querySelector('#saStep1').style.display=''; back.querySelector('#saStep2').style.display='none'; };
      back.querySelector('form').onsubmit=async e=>{ e.preventDefault();
        const em=back.querySelector('#saEmail').value.trim(), err=back.querySelector('#saErr'), b=back.querySelector('#saSend');
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){ err.textContent='Enter a valid email address.'; return; }
        if(!sb){ err.textContent='Sign-in is not available right now. Refresh the page and try again.'; return; }
        b.disabled=true; err.textContent='';
        const {error}=await sb.auth.signInWithOtp({email:em,options:{emailRedirectTo:location.origin+location.pathname+location.search}});
        b.disabled=false;
        if(error){ err.textContent=/rate|seconds/i.test(error.message)?'Too many emails just now. Wait a minute and try again.':error.message; return; }
        try{ localStorage.setItem('spoolEmail',em); }catch(_){}
        track('signin_sent');
        back.querySelector('#saTo').textContent=em; back.querySelector('#saStep1').style.display='none'; back.querySelector('#saStep2').style.display='';
      };
    }
    back.querySelector('#saWhy').textContent=reason||'Save your designs and pick them up on any device.';
    back.querySelector('#saStep1').style.display=''; back.querySelector('#saStep2').style.display='none'; back.querySelector('#saErr').textContent='';
    try{ back.querySelector('#saEmail').value=localStorage.getItem('spoolEmail')||''; }catch(_){}
    back.classList.add('open'); setTimeout(()=>back.querySelector('#saEmail').focus(),50);
    return new Promise(r=>pending.push(r));
  }
  subs.push(u=>{ if(u&&back&&back.classList.contains('open')){ back.classList.remove('open'); const p=pending; pending=[]; p.forEach(r=>r(u)); } });

  /* ---------- header chip ---------- */
  const chips=[];
  function renderChips(){ chips.forEach(el=>{
    if(!user){ el.innerHTML=`<button type="button" class="sa-chip out">Sign in</button>`; el.firstChild.onclick=()=>modal(); return; }
    const em=user.email||''; el.innerHTML=`<button type="button" class="sa-chip" aria-haspopup="menu"><span class="sa-av">${(em[0]||'?').toUpperCase()}</span>Account</button>
      <div class="sa-menu" role="menu"><small>${em.replace(/</g,'&lt;')}</small><button type="button" role="menuitem" class="sa-plan" data-plan>Plan: Free <i>· Upgrade</i></button><a href="editor.html#projects" role="menuitem">My projects</a><a href="studio.html" role="menuitem">Design Studio</a><button type="button" role="menuitem" data-out>Sign out</button></div>`;
    const btn=el.querySelector('.sa-chip'), menu=el.querySelector('.sa-menu'); el.style.position='relative';
    btn.onclick=e=>{ e.stopPropagation(); menu.classList.toggle('open'); if(menu.classList.contains('open')){ menu.style.left=''; menu.style.right=''; const r=menu.getBoundingClientRect(); if(r.left<8){ menu.style.right='auto'; menu.style.left='0'; } else if(r.right>innerWidth-8){ menu.style.left='auto'; menu.style.right='0'; } } };
    document.addEventListener('click',()=>menu.classList.remove('open'));
    el.querySelector('[data-out]').onclick=async()=>{ await sb.auth.signOut(); location.reload(); };
    const pb=el.querySelector('[data-plan]'); pb.onclick=()=>{ menu.classList.remove('open'); upgrade(); };
    plan().then(p=>{ if(p&&p.pro){ pb.innerHTML='SPOOL Studio <i>· Manage billing</i>'; pb.onclick=()=>{ menu.classList.remove('open'); manage(); }; } });
  }); }

  /* ---------- cloud projects (table "projects" + private bucket "projects") ---------- */
  const cloud={
    async list(){ if(!user) return []; const {data,error}=await sb.from('projects').select('id,name,thumb,updated_at').order('updated_at',{ascending:false}); if(error){ console.warn(error); return []; } return data||[]; },
    async save(p,thumb){ if(!user) return false;
      const path=`${user.id}/${p.id}.json`; const blob=new Blob([JSON.stringify(p)],{type:'application/json'});
      const up=await sb.storage.from('projects').upload(path,blob,{upsert:true,contentType:'application/json'}); if(up.error){ console.warn(up.error); return false; }
      const {error}=await sb.from('projects').upsert({id:p.id,user_id:user.id,name:p.name||'Untitled design',thumb:thumb||null,updated_at:new Date(p.updated||Date.now()).toISOString()}); if(error){ console.warn(error); return false; } return true; },
    async load(id){ if(!user) return null; const {data,error}=await sb.storage.from('projects').download(`${user.id}/${id}.json`); if(error){ console.warn(error); return null; } return JSON.parse(await data.text()); },
    async remove(id){ if(!user) return; await sb.storage.from('projects').remove([`${user.id}/${id}.json`]); await sb.from('projects').delete().eq('id',id); }
  };

  /* ---------- usage events (Supabase table "events", write-only) ---------- */
  let anon=''; try{ anon=localStorage.getItem('spoolAnon')||''; if(!anon){ anon=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem('spoolAnon',anon); } }catch(_){}
  function track(name,props){ if(!sb) return; try{ const row={name:String(name).slice(0,40),page:location.pathname.replace(/\.html$/,'')||'/',anon_id:anon,props:props||null}; if(user) row.user_id=user.id;
    sb.from('events').insert(row).then(()=>{},()=>{}); }catch(_){} }
  window.SPOOL_TRACK=track;
  /* ---------- live chat (Crisp) on every page except admin ---------- */
  if(!/admin/.test(location.pathname)){
    window.$crisp=window.$crisp||[]; window.CRISP_WEBSITE_ID='a2a225a7-bec7-4e21-9b54-6dede084dbf1'; window.CRISP_RUNTIME_CONFIG={locale:'en'};
    let noted=false; window.$crisp.push(['on','chat:opened',function(){ if(noted) return; noted=true;
      window.$crisp.push(['do','message:show',['text',"Hi! Questions about your design, samples or production? Send us a message — we'll reply as soon as we're available."]]); setTimeout(()=>window.$crisp.push(['do','message:read']),400); }]);
    const tagUser=u=>{ try{ if(u&&u.email) window.$crisp.push(['set','user:email',[u.email]]); }catch(_){} };
    ready.then(tagUser); subs.push(tagUser);
    const cs=document.createElement('script'); cs.src='https://client.crisp.chat/l.js'; cs.async=true; document.head.appendChild(cs);
  }
  /* header: make the small label under the SPOOL logo exactly as wide as the logo */
  function fitBrand(){ document.querySelectorAll('.brand').forEach(b=>{ const img=b.querySelector('img'), sp=b.querySelector('span'); if(!img||!sp||!img.offsetWidth) return;
    sp.style.display='inline-block'; sp.style.letterSpacing='0px'; sp.style.marginRight='0px'; sp.style.whiteSpace='nowrap'; const n=Math.max(1,sp.textContent.length-1), w=sp.getBoundingClientRect().width; const ls=(img.offsetWidth-w)/n;
    sp.style.letterSpacing=ls.toFixed(2)+'px'; sp.style.marginRight=(-ls).toFixed(2)+'px'; }); }
  const fitSoon=()=>requestAnimationFrame(fitBrand);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fitSoon); else fitSoon();
  addEventListener('load',fitSoon); addEventListener('resize',fitSoon); if(document.fonts&&document.fonts.ready) document.fonts.ready.then(fitSoon);
  ready.then(()=>track('page_view',{ref:document.referrer?new URL(document.referrer).hostname:null}));

  /* ---------- SPOOL Studio subscription (checkout + portal live on the Worker, Stripe) ---------- */
  const WORKER='https://spool-studio-ai.chrishwang0327.workers.dev';
  const PRICE_TXT='$29';
  async function tokenNow(){ if(!sb) return ''; const {data}=await sb.auth.getSession(); return data.session?.access_token||''; }
  async function call(task,extra){ const tk=await tokenNow(); const r=await fetch(WORKER,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tk},body:JSON.stringify({task,...(extra||{})})});
    const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||'Something went wrong. Try again.'); return j; }
  let planP=null;
  function plan(force){ return ready.then(()=>{ if(!user) return {pro:false}; if(force||!planP) planP=call('plan',force?{fresh:true}:{}).catch(e=>{ planP=null; return {pro:false,error:e.message}; }); return planP; }); }
  function toast(msg,ms){ const t=document.createElement('div'); t.className='sa-toast'; t.setAttribute('role','status'); t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),ms||4200); }
  async function manage(){ try{ const j=await call('portal'); location.href=j.url; }catch(e){ toast(e.message); } }
  let pw=null;
  async function upgrade(reason,opts){
    opts=opts||{};
    if(!(await ready)&&!user){ const u=await modal('Sign in first, then upgrade to SPOOL Studio.'); if(!u) return; }
    const p=await plan(); if(p.pro){ toast('You’re already on SPOOL Studio.'); return; }
    if(!pw){ pw=document.createElement('div'); pw.className='sa-back'; pw.setAttribute('role','dialog'); pw.setAttribute('aria-modal','true'); pw.setAttribute('aria-labelledby','saPwH'); document.body.appendChild(pw);
      pw.addEventListener('click',e=>{ if(e.target===pw) pw.classList.remove('open'); }); document.addEventListener('keydown',e=>{ if(e.key==='Escape') pw.classList.remove('open'); }); }
    pw.innerHTML=`<div class="sa-card sa-pw"><button type="button" class="sa-x" aria-label="Close">✕</button>
      <h2 id="saPwH">Upgrade to SPOOL Studio</h2><p id="saPwWhy"></p>
      <div class="sa-price">${PRICE_TXT}<span> / month · cancel anytime</span></div>
      <ul><li>Unlimited designs in the Design Studio</li><li>Unlimited tech pack PDFs</li><li>Production files — vector SVG artwork at print size</li><li>Images without the SPOOL watermark</li></ul>
      <button type="button" class="sa-btn dark" id="saPwGo">Upgrade — ${PRICE_TXT}/month</button>
      ${opts.sample?'<button type="button" class="sa-link" id="saPwSample">Or request a sample of this design instead</button>':''}
      <div class="sa-err" id="saPwErr" role="alert"></div><div class="sa-small">Secure checkout by Stripe. Manage or cancel anytime from your account menu.</div></div>`;
    pw.querySelector('#saPwWhy').textContent=reason||'Keep designing without limits and get factory-ready files.';
    pw.querySelector('.sa-x').onclick=()=>pw.classList.remove('open');
    const go=pw.querySelector('#saPwGo'); go.onclick=async()=>{ go.disabled=true; go.textContent='Opening secure checkout…'; track('checkout_start');
      try{ const j=await call('checkout'); location.href=j.url; }catch(e){ go.disabled=false; go.textContent=`Upgrade — ${PRICE_TXT}/month`; pw.querySelector('#saPwErr').textContent=e.message; } };
    const sm=pw.querySelector('#saPwSample'); if(sm) sm.onclick=()=>{ pw.classList.remove('open'); opts.sample(); };
    track('paywall_view',{reason:opts.why||null});
    pw.classList.add('open'); setTimeout(()=>go.focus(),50);
  }
  // back from Stripe Checkout
  (function(){ const q=new URLSearchParams(location.search); if(!q.has('upgraded')&&!q.has('upgrade')) return;
    const ok=q.has('upgraded'); q.delete('upgraded'); q.delete('upgrade'); history.replaceState(null,'',location.pathname+(q.toString()?'?'+q:'')+location.hash);
    if(!ok) return; ready.then(async()=>{ let p={pro:false}; for(let i=0;i<6&&!p.pro;i++){ p=await plan(true); if(!p.pro) await new Promise(r=>setTimeout(r,2500)); }
      if(p.pro){ track('upgraded'); toast('Welcome to SPOOL Studio — unlimited designs and tech packs are on.',6000); renderChips(); subs.forEach(f=>{try{f(user)}catch(e){}}); }
      else toast('Payment received. Your plan will switch on in a minute — refresh the page if it doesn’t.',7000); }); })();

  window.SPOOL_AUTH={
    sb, ready, cloud,
    get user(){ return user; },
    email(){ return user?.email||''; },
    onChange(f){ subs.push(f); },
    async requireLogin(reason){ await ready; if(user) return user; return await modal(reason); },
    scope(){ return ready.then(u=>u?u.id:'guest'); },
    async token(){ if(!sb) return ''; const {data}=await sb.auth.getSession(); return data.session?.access_token||''; },
    mount(el){ if(!el) return; chips.push(el); ready.then(renderChips); renderChips(); },
    plan, upgrade, manage, call, toast,
    signIn:modal
  };
})();
