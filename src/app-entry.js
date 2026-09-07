import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App } from "@capacitor/app";

const PHDVoice = registerPlugin("PHDVoice");
const PHDPrint = registerPlugin("PHDPrint");

(()=>{
const C=window.PHD_CONFIG||{};
const K_SESSION="phd_session_v1";
const K_PROFILE="phd_profile_v3";
const CACHE_PREFIX="phd_cache_v3_";
const QUEUE_PREFIX="phd_queue_v3_";
const ALERT_PREFIX="phd_alert_prefs_v1_";

let token=localStorage.getItem(K_SESSION)||"";
let profile=null;
let items=[];
let projectCode="";
let syncing=false;
let voiceBusy=false;
let networkFailed=false;

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const okCfg=()=>/^https:\/\//.test(C.SUPABASE_URL||"")&&(C.SUPABASE_ANON_KEY||"").length>20;
const safeParse=(raw,fallback)=>{try{return raw?JSON.parse(raw):fallback}catch{return fallback}};
const cacheKey=id=>CACHE_PREFIX+id;
const queueKey=id=>QUEUE_PREFIX+id;
const isLocalId=id=>String(id||"").startsWith("local-");
const localId=()=>`local-${crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)}`;
const nowISO=()=>new Date().toISOString();

function msg(t){$("authMessage").textContent=t;$("authMessage").classList.remove("hidden")}
function clr(){$("authMessage").classList.add("hidden")}
function toast(t){const e=$("toast");e.textContent=t;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2600)}
function view(id){["startView","codeForm","registerForm","loginForm"].forEach(x=>$(x).classList.toggle("hidden",x!==id));clr()}
function today(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function fdate(x){if(!x)return"Sem data";const[y,m,d]=x.split("-");return`${d}/${m}/${y}`}
function wday(x){if(!x)return"";const[y,m,d]=x.split("-").map(Number);return new Intl.DateTimeFormat("pt-BR",{weekday:"long",timeZone:"UTC"}).format(new Date(Date.UTC(y,m-1,d)))}
function bucket(r){if(r.status==="done")return"done";if(!r.due_date)return"future";if(r.due_date<today())return"late";if(r.due_date===today())return"today";return"future"}
function size(t,p=false){const n=(t||"").length;if(p){if(n>160)return"5.6pt";if(n>110)return"6.2pt";if(n>70)return"6.8pt";return"7.6pt"}if(n>260)return"12px";if(n>180)return"13px";if(n>110)return"14px";return"15px"}
function capFirst(s){const t=String(s||"").trim();return t?t.charAt(0).toLocaleUpperCase("pt-BR")+t.slice(1):t}
function normItem(r={}){return{
  id:String(r.id||localId()),
  text:String(r.text||"").trim(),
  due_date:r.due_date||r.due||null,
  due_time:(r.due_time||r.dueTime||null),
  priority:["Alta","Média","Baixa"].includes(r.priority)?r.priority:"Média",
  status:r.status==="done"?"done":"open",
  created_at:r.created_at||r.createdAt||nowISO(),
  completed_at:r.completed_at||r.completedAt||null,
  notify_enabled:r.notify_enabled===true||r.notifyEnabled===true,
  wake_screen:r.wake_screen===true||r.wakeScreen===true
}}
function friendlyError(er){
  if(er?.network)return"Sem conexão com a internet.";
  return er?.message||"Ocorreu um erro.";
}

async function rpc(fn,b={}){
  if(!okCfg())throw Error("Configuração do Supabase pendente.");
  let r;
  try{
    r=await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/${fn}`,{
      method:"POST",
      headers:{apikey:C.SUPABASE_ANON_KEY,"Content-Type":"application/json"},
      body:JSON.stringify(b)
    });
    networkFailed=false;
  }catch(cause){
    networkFailed=true;
    const er=new Error("Sem conexão com a internet.");
    er.network=true;er.cause=cause;
    throw er;
  }
  const tx=await r.text();let d;
  try{d=tx?JSON.parse(tx):null}catch{d=tx}
  if(!r.ok){
    const er=new Error(d?.message||d?.hint||d?.details||`Erro ${r.status}`);
    er.status=r.status;throw er;
  }
  return d;
}

function loadCachedProfile(){return safeParse(localStorage.getItem(K_PROFILE),null)}
function saveCachedProfile(){if(profile?.id)localStorage.setItem(K_PROFILE,JSON.stringify(profile))}
function loadCache(id){return safeParse(localStorage.getItem(cacheKey(id)),[]).map(normItem).filter(x=>x.text)}
function saveCache(){if(profile?.id)localStorage.setItem(cacheKey(profile.id),JSON.stringify(items))}
function getQueue(){return profile?.id?safeParse(localStorage.getItem(queueKey(profile.id)),[]):[]}
function setQueue(q){if(profile?.id)localStorage.setItem(queueKey(profile.id),JSON.stringify(q));updateSyncStatus()}

function alertKey(){return profile?.id?ALERT_PREFIX+profile.id:""}
function loadAlertPrefs(){return profile?.id?safeParse(localStorage.getItem(alertKey()),{}):{}}
function setAlertPref(id,pref){
  if(!profile?.id||!id)return;
  const map=loadAlertPrefs();
  map[String(id)]={notify_enabled:!!pref.notify_enabled,wake_screen:!!pref.wake_screen};
  localStorage.setItem(alertKey(),JSON.stringify(map));
}
function getAlertPref(id,defaultOn=true){
  const map=loadAlertPrefs();
  const key=String(id);
  if(!Object.prototype.hasOwnProperty.call(map,key)){
    return {notify_enabled:!!defaultOn,wake_screen:!!defaultOn};
  }
  const p=map[key]||{};
  return {notify_enabled:!!p.notify_enabled,wake_screen:!!p.wake_screen};
}
function deleteAlertPref(id){
  if(!profile?.id||!id)return;
  const map=loadAlertPrefs();
  delete map[String(id)];
  localStorage.setItem(alertKey(),JSON.stringify(map));
}
function moveAlertPref(oldId,newId){
  if(!profile?.id||!oldId||!newId)return;
  const map=loadAlertPrefs();
  if(map[String(oldId)]){
    map[String(newId)]=map[String(oldId)];
    delete map[String(oldId)];
    localStorage.setItem(alertKey(),JSON.stringify(map));
  }
}
function syncAlertControls(){
  const notify=$("remNotify"),wake=$("remWakeScreen");
  if(!notify||!wake)return;
  wake.disabled=!notify.checked;
  if(!notify.checked)wake.checked=false;
}


function isNativeApp(){
  try{return Capacitor.isNativePlatform()}catch{return false}
}
function localNotificationsApi(){
  return isNativeApp()&&Capacitor.isPluginAvailable("LocalNotifications")?LocalNotifications:null;
}
function appInfoApi(){
  return isNativeApp()&&Capacitor.isPluginAvailable("App")?App:null;
}

const ALERT_CHANNEL_WAKE="phd_alert_wake_v16";
const ALERT_CHANNEL_NORMAL="phd_alert_normal_v16";

function notificationId(reminderId){
  const s=`${profile?.id||"anon"}:${String(reminderId||"")}`;
  let h=0x811c9dc5;
  for(let i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=Math.imul(h,0x01000193);
  }
  const n=h&0x7fffffff;
  return n||1;
}
function alarmWhenMs(row){
  if(!row?.due_date||!row?.due_time)return null;
  const d=String(row.due_date).split("-").map(Number);
  const t=String(row.due_time).slice(0,5).split(":").map(Number);
  if(d.length!==3||t.length!==2||d.some(Number.isNaN)||t.some(Number.isNaN))return null;
  const dt=new Date(d[0],d[1]-1,d[2],t[0],t[1],0,0);
  const ms=dt.getTime();
  return Number.isFinite(ms)?ms:null;
}
function setAlertRuntimeStatus(text,kind=""){
  const el=$("alertRuntimeStatus");
  if(!el)return;
  el.textContent=text;
  el.className=`alert-runtime-status${kind?` ${kind}`:""}`;
}
async function ensureNotificationChannels(){
  const api=localNotificationsApi();
  if(!api||!isNativeApp())return false;
  await api.createChannel({
    id:ALERT_CHANNEL_WAKE,
    name:"Lembretes PHD — destaque",
    description:"Lembretes com destaque na tela e som do PHD.",
    sound:"phd_alert.wav",
    importance:5,
    visibility:1,
    lights:true,
    vibration:false
  });
  await api.createChannel({
    id:ALERT_CHANNEL_NORMAL,
    name:"Lembretes PHD",
    description:"Lembretes com som do PHD.",
    sound:"phd_alert.wav",
    importance:3,
    visibility:1,
    lights:false,
    vibration:false
  });
  return true;
}
async function prepareNativeAlertPermissions(promptUser=false){
  const api=localNotificationsApi();
  if(!api||!isNativeApp())return {ok:false,reason:"not-native"};
  try{
    await ensureNotificationChannels();
    let p=await api.checkPermissions();
    if(p?.display!=="granted"&&promptUser)p=await api.requestPermissions();
    if(p?.display!=="granted"){
      return {ok:false,reason:"notifications",message:"As notificações do PHD não estão permitidas no Android."};
    }
    let exact=null;
    try{exact=await api.checkExactNotificationSetting()}catch{}
    if(exact?.exact_alarm&&exact.exact_alarm!=="granted"){
      return {ok:false,reason:"exact",message:"O Android não liberou o agendamento exato para o PHD."};
    }
    return {ok:true};
  }catch(er){
    return {ok:false,reason:"plugin",message:er?.message||"Falha ao preparar o sistema de avisos."};
  }
}
async function cancelNativeAlarm(reminderId){
  const api=localNotificationsApi();
  if(!api||!isNativeApp()||!profile?.id||!reminderId)return;
  try{await api.cancel({notifications:[{id:notificationId(reminderId)}]})}catch{}
}
async function pendingNativeAlarm(row){
  const api=localNotificationsApi();
  if(!api||!isNativeApp()||!row)return null;
  try{
    const id=notificationId(row.id);
    const pending=await api.getPending();
    return (pending?.notifications||[]).find(n=>Number(n.id)===id)||null;
  }catch{return null}
}
async function updateAlertRuntimeStatus(row){
  if(!row){
    setAlertRuntimeStatus("Defina um horário futuro. O Android confirmará o aviso ao salvar.");
    return;
  }
  const pref=getAlertPref(row.id,true);
  if(!pref.notify_enabled){
    setAlertRuntimeStatus("Aviso desativado para este lembrete.","warn");
    return;
  }
  if(!isNativeApp()){
    setAlertRuntimeStatus("No navegador, o aviso não é garantido. Use o aplicativo Android.","warn");
    return;
  }
  const p=await pendingNativeAlarm(row);
  if(p){
    setAlertRuntimeStatus("Aviso confirmado no Android.","ok");
  }else{
    const whenMs=alarmWhenMs(row);
    if(whenMs&&whenMs>Date.now())setAlertRuntimeStatus("Aviso ainda não confirmado no Android.","error");
    else setAlertRuntimeStatus("Horário já passou; não há aviso pendente.","warn");
  }
}
async function syncNativeAlarm(row,promptPermission=false){
  const api=localNotificationsApi();
  if(!row||!profile?.id)return {ok:false,reason:"invalid"};
  const pref=getAlertPref(row.id,true);
  const whenMs=alarmWhenMs(row);

  if(!pref.notify_enabled||row.status==="done"||!whenMs||whenMs<=Date.now()){
    if(api&&isNativeApp())await cancelNativeAlarm(row.id);
    return {ok:true,scheduled:false};
  }

  if(!api||!isNativeApp()){
    if(promptPermission)setAlertRuntimeStatus("No navegador, o aviso não é garantido. Use o aplicativo Android.","warn");
    return {ok:false,reason:"not-native",message:"O aviso no horário exige o aplicativo Android."};
  }

  const permission=await prepareNativeAlertPermissions(promptPermission);
  if(!permission.ok){
    if(promptPermission)setAlertRuntimeStatus(permission.message||"Aviso não autorizado no Android.","error");
    return permission;
  }

  const id=notificationId(row.id);
  try{
    await api.cancel({notifications:[{id}]});
    const result=await api.schedule({
      notifications:[{
        id,
        title:"PHD | Lembrete",
        body:row.text,
        largeBody:row.text,
        channelId:pref.wake_screen?ALERT_CHANNEL_WAKE:ALERT_CHANNEL_NORMAL,
        autoCancel:true,
        foreground:true,
        isExactNotification:true,
        isExactMandatory:true,
        schedule:{
          at:new Date(whenMs),
          allowWhileIdle:true
        },
        extra:{
          phdApp:"PHD-Bloco-de-Notas",
          userId:String(profile.id),
          reminderId:String(row.id),
          whenMs
        }
      }]
    });

    if(result?.warning){
      const m=result.warning.message||"O Android converteu o aviso para um horário não exato.";
      if(promptPermission)setAlertRuntimeStatus(m,"error");
      return {ok:false,reason:"warning",message:m};
    }

    const pending=await api.getPending();
    const confirmed=(pending?.notifications||[]).some(n=>Number(n.id)===id);
    if(!confirmed){
      const m="O Android não confirmou o agendamento deste aviso.";
      if(promptPermission)setAlertRuntimeStatus(m,"error");
      return {ok:false,reason:"not-pending",message:m};
    }

    if(promptPermission)setAlertRuntimeStatus("Aviso confirmado no Android.","ok");
    return {ok:true,scheduled:true};
  }catch(er){
    const code=er?.code?` (${er.code})`:"";
    const m=`${er?.message||"Não foi possível programar o aviso."}${code}`;
    if(promptPermission)setAlertRuntimeStatus(m,"error");
    return {ok:false,reason:"schedule",message:m,code:er?.code};
  }
}
async function syncAllNativeAlarms(){
  const api=localNotificationsApi();
  if(!api||!isNativeApp()||!profile?.id)return;

  const permission=await prepareNativeAlertPermissions(false);
  if(!permission.ok)return;

  let pending=[];
  try{pending=(await api.getPending())?.notifications||[]}catch{}

  const desired=new Map();
  for(const row of items){
    const pref=getAlertPref(row.id,true);
    const whenMs=alarmWhenMs(row);
    if(pref.notify_enabled&&row.status!=="done"&&whenMs&&whenMs>Date.now()){
      desired.set(notificationId(row.id),{row,pref,whenMs});
    }
  }

  const cancel=[];
  for(const n of pending){
    const extra=n?.extra||{};
    if(extra?.phdApp!=="PHD-Bloco-de-Notas")continue;
    const id=Number(n.id);
    if(String(extra.userId)!==String(profile.id)||!desired.has(id)){
      cancel.push({id});
    }
  }
  if(cancel.length)try{await api.cancel({notifications:cancel})}catch{}

  const pendingMap=new Map((pending||[]).map(n=>[Number(n.id),n]));
  for(const [id,d] of desired){
    const p=pendingMap.get(id);
    const pendingWhen=p?.schedule?.at?new Date(p.schedule.at).getTime():Number(p?.extra?.whenMs||0);
    const same=!!p&&pendingWhen===d.whenMs&&String(p.body||"")===String(d.row.text||"");
    if(!same)await syncNativeAlarm(d.row,false);
  }
}
async function showInstalledVersion(){
  const el=$("appVersion");
  if(!el)return;
  if(!isNativeApp()){
    el.textContent="Versão Web";
    return;
  }
  const api=appInfoApi();
  if(!api){
    el.textContent="Android — versão não identificada";
    return;
  }
  try{
    const info=await api.getInfo();
    const alerts=Capacitor.isPluginAvailable("LocalNotifications")?"avisos nativos ativos":"avisos nativos indisponíveis";
    el.textContent=`Android ${info.version} • build ${info.build} • ${alerts}`;
  }catch{
    el.textContent="Android";
  }
}

function updateSyncStatus(){
  const bar=$("syncBar"), text=$("syncText");
  if(!bar||!text||!profile?.id)return;
  const pending=getQueue().length;
  bar.className="sync-bar";
  const offline=!navigator.onLine||networkFailed;
  if(offline){
    bar.classList.add("offline");
    text.textContent=pending?`Sem internet — ${pending} alteração(ões) aguardando sincronização.`:"Sem internet — usando os dados salvos neste aparelho.";
  }else if(syncing){
    bar.classList.add("syncing");
    text.textContent=pending?`Sincronizando ${pending} alteração(ões)...`:"Atualizando...";
  }else if(pending){
    bar.classList.add("pending");
    text.textContent=`Online — ${pending} alteração(ões) aguardando sincronização.`;
  }else{
    text.textContent="Tudo sincronizado.";
  }
}

function showWorkspace(){
  $("auth").classList.add("hidden");
  $("workspace").classList.remove("hidden");
  $("welcome").textContent=`Olá, ${profile.name}`;
  $("todayLabel").textContent=new Intl.DateTimeFormat("pt-BR",{dateStyle:"full"}).format(new Date());
  render();
  updateSyncStatus();
  showInstalledVersion().catch(()=>{});
  if(isNativeApp()){
    prepareNativeAlertPermissions(true)
      .then(r=>{if(r?.ok)return syncAllNativeAlarms()})
      .catch(()=>{});
  }
}

async function refreshFromServer(){
  const remote=await rpc("list_reminders",{p_token:token})||[];
  items=remote.map(normItem);
  saveCache();render();updateSyncStatus();
  await syncAllNativeAlarms();
}

function enqueueSave(item){
  const q=getQueue();
  const data={text:item.text,due_date:item.due_date||null,due_time:item.due_time||null,priority:item.priority};
  const existing=q.find(x=>x.type==="save"&&x.id===item.id);
  if(existing)existing.data=data;
  else q.push({op:localId(),type:"save",id:item.id,data});
  setQueue(q);
}
function enqueueToggle(id){
  const q=getQueue();
  const i=q.findIndex(x=>x.type==="toggle"&&x.id===id);
  if(i>=0)q.splice(i,1);
  else q.push({op:localId(),type:"toggle",id});
  setQueue(q);
}
function enqueueDelete(id){
  let q=getQueue();
  if(isLocalId(id)){
    q=q.filter(x=>x.id!==id);
  }else{
    q=q.filter(x=>x.id!==id);
    q.push({op:localId(),type:"delete",id});
  }
  setQueue(q);
}
function replaceQueuedId(oldId,newId,q){
  q.forEach(x=>{if(x.id===oldId)x.id=String(newId)});
}

async function syncQueue(){
  if(syncing||!token||!profile?.id||!navigator.onLine)return;
  syncing=true;networkFailed=false;updateSyncStatus();
  try{
    let q=getQueue();
    while(q.length){
      const op=q[0];
      if(op.type==="save"){
        const serverId=await rpc("save_reminder",{
          p_token:token,
          p_id:isLocalId(op.id)?null:op.id,
          p_text:op.data.text,
          p_due_date:op.data.due_date||null,
          p_due_time:op.data.due_time||null,
          p_priority:op.data.priority
        });
        const oldId=op.id;
        q.shift();
        if(isLocalId(oldId)){
          const found=items.find(x=>x.id===oldId);
          if(found)found.id=String(serverId);
          replaceQueuedId(oldId,String(serverId),q);
          moveAlertPref(oldId,String(serverId));
          await cancelNativeAlarm(oldId);
          if(found)await syncNativeAlarm(found,false);
          saveCache();
        }
        setQueue(q);
      }else if(op.type==="toggle"){
        await rpc("toggle_reminder",{p_token:token,p_id:op.id});
        q.shift();setQueue(q);
      }else if(op.type==="delete"){
        await rpc("delete_reminder",{p_token:token,p_id:op.id});
        q.shift();setQueue(q);
      }else{
        q.shift();setQueue(q);
      }
      q=getQueue();
    }
    await refreshFromServer();
  }catch(er){
    if(!er.network){
      const m=String(er.message||"");
      if(/sessão inválida/i.test(m))toast("Sua sessão expirou. Entre novamente para sincronizar.");
      else toast(`Sincronização pendente: ${friendlyError(er)}`);
    }
  }finally{
    syncing=false;updateSyncStatus();
  }
}

async function boot(){
  const cached=loadCachedProfile();
  if(!token)throw Error("Sessão inválida");
  if(navigator.onLine){
    try{
      const p=await rpc("current_profile",{p_token:token});
      profile=Array.isArray(p)?p[0]:p;
      if(!profile?.id)throw Error("Sessão inválida");
      saveCachedProfile();
    }catch(er){
      if(er.network&&cached?.id)profile=cached;
      else throw er;
    }
  }else{
    networkFailed=true;
    profile=cached;
  }
  if(!profile?.id)throw Error("Abra o aplicativo com internet pelo menos uma vez para habilitar o modo offline.");
  items=loadCache(profile.id);
  showWorkspace();
  if(navigator.onLine){
    if(getQueue().length)await syncQueue();
    else{
      try{await refreshFromServer()}catch(er){if(!er.network)throw er}
    }
  }
  updateSyncStatus();
}

function sort(a){
  const p={Alta:0,Média:1,Baixa:2};
  return a.sort((x,y)=>{
    const dc=(x.due_date||"9999").localeCompare(y.due_date||"9999");
    if(dc)return dc;
    const tc=(x.due_time||"99:99").localeCompare(y.due_time||"99:99");
    if(tc)return tc;
    return (p[x.priority]??9)-(p[y.priority]??9);
  });
}
function note(r){return`<article class="note priority-${esc(r.priority)}" data-id="${esc(r.id)}"><div class="date">${esc(fdate(r.due_date))}</div><div class="weekday">${esc(wday(r.due_date))}</div><div class="time">${esc(r.due_time?r.due_time.slice(0,5):"—")}</div><div class="text" style="font-size:${size(r.text)}">${esc(r.text)}</div></article>`}
function fill(id,a){$(id).innerHTML=a.length?a.map(note).join(""):'<div class="empty">Nenhum lembrete.</div>'}
function render(){
  const g={late:[],today:[],future:[],done:[]};
  items.forEach(r=>g[bucket(r)].push(r));Object.values(g).forEach(sort);
  fill("lateGrid",g.late);fill("todayGrid",g.today);fill("futureGrid",g.future);fill("doneGrid",g.done);
  $("lateSection").classList.toggle("hidden",!g.late.length);
  [["lateCount","mLate",g.late.length],["todayCount","mToday",g.today.length],["futureCount","mFuture",g.future.length],["doneCount","mDone",g.done.length]].forEach(([a,b,n])=>{$(a).textContent=n;$(b).textContent=n});
  document.querySelectorAll(".note").forEach(e=>e.addEventListener("click",()=>edit(e.dataset.id)));
  buildPrint(g);
}

function showReminderDialog(){
  const d=$("dialog"),f=$("remForm");
  d.showModal();
  requestAnimationFrame(()=>{if(f)f.scrollTop=0});
}

function openNew(){
  $("dialogTitle").textContent="Novo lembrete";$("remId").value="";$("remText").value="";$("remDate").value=today();$("remTime").value="";$("remPriority").value="Média";
  $("remNotify").checked=true;$("remWakeScreen").checked=true;syncAlertControls();
  setAlertRuntimeStatus("O Android confirmará o aviso ao salvar.");
  $("deleteBtn").classList.add("hidden");$("doneBtn").classList.add("hidden");showReminderDialog();
}
function edit(id){
  const r=items.find(x=>x.id===id);if(!r)return;
  $("dialogTitle").textContent="Editar lembrete";$("remId").value=r.id;$("remText").value=r.text;$("remDate").value=r.due_date||"";$("remTime").value=r.due_time?r.due_time.slice(0,5):"";$("remPriority").value=r.priority;
  const alertPref=getAlertPref(r.id,true);$("remNotify").checked=alertPref.notify_enabled;$("remWakeScreen").checked=alertPref.wake_screen;syncAlertControls();
  setAlertRuntimeStatus("Verificando aviso no Android...");
  $("deleteBtn").classList.remove("hidden");$("doneBtn").classList.remove("hidden");$("doneBtn").textContent=r.status==="done"?"Reabrir":"Concluir";showReminderDialog();
  updateAlertRuntimeStatus(r).catch(()=>{});

}

function initVoice(){
  const btn=$("micBtn"),status=$("voiceStatus");
  if(!btn)return;

  btn.onclick=async()=>{
    if(voiceBusy)return;
    if(!isNativeApp()||!Capacitor.isPluginAvailable("PHDVoice")){
      toast("No navegador, use o microfone do teclado. No Android, o PHD usa o ditado nativo.");
      return;
    }

    voiceBusy=true;
    btn.disabled=true;
    btn.classList.add("listening");
    if(status)status.textContent="Abrindo o ditado do Android...";

    try{
      const result=await PHDVoice.listen({language:"pt-BR",prompt:"Fale o lembrete"});
      const spoken=String(result?.text||"").trim();
      if(!spoken){toast("Nenhuma fala foi reconhecida.");return}

      const target=$("remText");
      const base=target.value.trim();
      const finalText=base?`${base} ${spoken}`:capFirst(spoken);
      target.value=finalText.slice(0,600);
      target.dispatchEvent(new Event("input",{bubbles:true}));
    }catch(er){
      const code=String(er?.code||"");
      if(code!=="CANCELED")toast(er?.message||"Não foi possível usar o ditado do Android.");
    }finally{
      voiceBusy=false;
      btn.disabled=false;
      btn.classList.remove("listening");
      if(status)status.textContent="";
    }
  };
}

async function save(){
  const t=capFirst($("remText").value);
  if(!t){toast("Digite o lembrete.");return}
  if($("remNotify").checked&&(!$("remDate").value||!$("remTime").value)){toast("Para usar o aviso, informe data e hora.");return}
  if($("remNotify").checked){
    const testMs=alarmWhenMs({due_date:$("remDate").value,due_time:$("remTime").value});
    if(!testMs||testMs<=Date.now()){
      toast("Escolha um horário futuro, pelo menos no próximo minuto.");
      return;
    }
  }
  const id=$("remId").value||localId();
  const existing=items.find(x=>x.id===id);
  const row=existing||normItem({id,text:t,status:"open"});
  row.text=t;row.due_date=$("remDate").value||null;row.due_time=$("remTime").value||null;row.priority=$("remPriority").value;
  if(!existing)items.unshift(row);
  setAlertPref(id,{notify_enabled:$("remNotify").checked,wake_screen:$("remWakeScreen").checked});
  saveCache();enqueueSave(row);render();

  const wantsAlert=$("remNotify").checked;
  const alarmResult=await syncNativeAlarm(row,true);

  if(navigator.onLine)syncQueue();

  if(wantsAlert&&isNativeApp()&&!alarmResult.ok){
    const detail=alarmResult.message||"O Android não confirmou o alarme.";
    alert(`O lembrete foi salvo, mas o AVISO NÃO FOI CONFIRMADO.

${detail}

O PHD não vai fingir que o alarme está funcionando.`);
    return;
  }

  $("dialog").close();
  if(navigator.onLine){
    toast(wantsAlert&&isNativeApp()?"Lembrete salvo e aviso confirmado.":"Lembrete salvo.");
  }else{
    toast(wantsAlert&&isNativeApp()?"Salvo no aparelho e aviso confirmado.":"Salvo no aparelho. Vai sincronizar quando a internet voltar.");
  }
}
async function del(){
  const id=$("remId").value;if(!id||!confirm("Excluir este lembrete?"))return;
  await cancelNativeAlarm(id);
  items=items.filter(x=>x.id!==id);deleteAlertPref(id);saveCache();enqueueDelete(id);render();$("dialog").close();
  if(navigator.onLine)syncQueue();else toast("Exclusão salva no aparelho.");
}
async function toggle(){
  const id=$("remId").value;if(!id)return;
  const row=items.find(x=>x.id===id);if(!row)return;
  row.status=row.status==="done"?"open":"done";row.completed_at=row.status==="done"?nowISO():null;
  saveCache();enqueueToggle(id);render();$("dialog").close();
  await syncNativeAlarm(row,false);
  if(navigator.onLine)syncQueue();else toast("Alteração salva no aparelho.");
}


function downloadBackup(){
  if(!profile?.id){toast("Entre no aplicativo antes de fazer o backup.");return}
  const payload={
    app:"PHD | Bloco de Notas",
    version:5,
    exported_at:nowISO(),
    user:{name:profile.name||"",username:profile.username||""},
    items:items.map(r=>({
      id:r.id,
      text:r.text,
      due_date:r.due_date||null,
      due_time:r.due_time||null,
      priority:r.priority,
      status:r.status,
      created_at:r.created_at||null,
      completed_at:r.completed_at||null,
      notify_enabled:getAlertPref(r.id).notify_enabled,
      wake_screen:getAlertPref(r.id).wake_screen
    }))
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const safeName=String(profile.name||"usuario")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-zA-Z0-9_-]+/g,"_");
  a.href=url;
  a.download=`PHD_Backup_${safeName}_${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast(`Backup criado com ${items.length} lembrete(s).`);
}

async function importBackup(file){
  try{
    const raw=JSON.parse(await file.text());
    const incoming=Array.isArray(raw)?raw:(raw?.items||raw?.tasks||raw?.reminders);
    if(!Array.isArray(incoming))throw Error("Backup inválido.");
    const normalized=incoming.map(normItem).filter(x=>x.text);
    if(!normalized.length)throw Error("O backup não contém lembretes.");
    if(!confirm(`Importar ${normalized.length} lembrete(s) para ${profile.name}?`))return;

    const signature=x=>[x.text.trim().toLocaleLowerCase("pt-BR"),x.due_date||"",String(x.due_time||"").slice(0,5),x.priority,x.status].join("|");
    const existing=new Set(items.map(signature));
    let added=0;
    let q=getQueue();

    for(const src of normalized){
      src.text=capFirst(src.text);
      if(existing.has(signature(src)))continue;
      const row={...src,id:localId()};
      items.push(row);existing.add(signature(row));added++;
      setAlertPref(row.id,{notify_enabled:!!src.notify_enabled,wake_screen:!!src.wake_screen});
      q.push({op:localId(),type:"save",id:row.id,data:{text:row.text,due_date:row.due_date||null,due_time:row.due_time||null,priority:row.priority}});
      if(row.status==="done")q.push({op:localId(),type:"toggle",id:row.id});
    }
    saveCache();setQueue(q);render();
    await syncAllNativeAlarms();
    toast(added?`${added} lembrete(s) importado(s).`:"Nenhum lembrete novo para importar.");
    if(added&&navigator.onLine)syncQueue();
  }catch(er){
    alert(er.message||"Backup inválido.");
  }finally{
    $("importFile").value="";
  }
}

function pnote(r){return`<div class="print-note"><div class="print-date">${esc(fdate(r.due_date))}</div><div class="print-weekday">${esc(wday(r.due_date))}</div><div class="print-time">${esc(r.due_time?r.due_time.slice(0,5):"—")}</div><div class="print-text" style="font-size:${size(r.text,true)}">${esc(r.text)}</div></div>`}
function psec(t,a,l){a=a.slice(0,l);return a.length?`<section class="print-section"><h3>${t}</h3><div class="print-grid">${a.map(pnote).join("")}</div></section>`:""}
function buildPrint(g){
  const ll=Math.min(10,g.late.length),tl=Math.min(10,g.today.length),fl=Math.min(g.late.length?10:20,g.future.length);
  let h=`<div class="print-page"><div class="print-title">PHD | Bloco de Notas</div>${psec("ATRASADOS",g.late,ll)}${psec("PARA HOJE",g.today,tl)}${psec("FUTUROS",g.future,fl)}</div>`;
  const r=[...g.late.slice(ll),...g.today.slice(tl),...g.future.slice(fl)];
  for(let i=0;i<r.length;i+=30)h+=`<div class="print-page"><div class="print-title">PHD | Bloco de Notas</div><section class="print-section"><h3>CONTINUAÇÃO</h3><div class="print-grid">${r.slice(i,i+30).map(pnote).join("")}</div></section></div>`;
  $("printStage").innerHTML=h;
}

async function logout(){
  const pending=getQueue().length;
  if(pending&&!confirm(`Existem ${pending} alteração(ões) ainda não sincronizadas. Sair mesmo assim?`))return;
  try{
    const api=localNotificationsApi();
    if(api&&isNativeApp())await api.cancelAll();
  }catch{}
  try{if(token&&navigator.onLine)await rpc("logout_user",{p_token:token})}catch{}
  localStorage.removeItem(K_SESSION);localStorage.removeItem(K_PROFILE);token="";profile=null;items=[];
  $("workspace").classList.add("hidden");$("auth").classList.remove("hidden");view("startView");
}

$("newUserPath").onclick=()=>view("codeForm");
$("userPath").onclick=()=>view("loginForm");
document.querySelectorAll(".back").forEach(b=>b.onclick=()=>view("startView"));

$("codeForm").onsubmit=async e=>{
  e.preventDefault();clr();
  try{
    const c=$("projectCode").value.trim();
    if(await rpc("validate_project_code",{p_code:c})===true){projectCode=c;view("registerForm")}
    else msg("Código do projeto inválido.");
  }catch(er){msg(er.network?"Sem internet. O cadastro inicial precisa de conexão.":friendlyError(er))}
};

$("registerForm").onsubmit=async e=>{
  e.preventDefault();clr();
  const p=$("regPin").value;if(p!==$("regPin2").value){msg("Os PINs não conferem.");return}
  try{
    const d=await rpc("register_user",{p_project_code:projectCode,p_name:$("regName").value.trim(),p_username:$("regUser").value.trim().toLowerCase(),p_pin:p});
    const r=Array.isArray(d)?d[0]:d;if(!r?.success)throw Error(r?.message||"Não foi possível criar o usuário.");
    token=r.session_token;localStorage.setItem(K_SESSION,token);projectCode="";await boot();
  }catch(er){msg(er.network?"Sem internet. O cadastro inicial precisa de conexão.":friendlyError(er))}
};

$("loginForm").onsubmit=async e=>{
  e.preventDefault();clr();
  try{
    const d=await rpc("login_user",{p_username:$("loginUser").value.trim().toLowerCase(),p_pin:$("loginPin").value});
    const r=Array.isArray(d)?d[0]:d;if(!r?.success)throw Error(r?.message||"Login inválido.");
    token=r.session_token;localStorage.setItem(K_SESSION,token);await boot();
  }catch(er){msg(er.network?"Sem internet. Para entrar pela primeira vez neste aparelho, conecte-se à internet.":friendlyError(er))}
};

initVoice();
$("newBtn").onclick=openNew;
$("remNotify").onchange=()=>{
  syncAlertControls();
  if($("remNotify").checked){
    setAlertRuntimeStatus("O Android confirmará o aviso ao salvar.");
    prepareNativeAlertPermissions(true).catch(()=>{});
  }else{
    setAlertRuntimeStatus("Aviso desativado para este lembrete.","warn");
  }
};
$("remWakeScreen").onchange=()=>{
  if($("remNotify").checked)setAlertRuntimeStatus("O Android confirmará o aviso ao salvar.");
};
$("printBtn").onclick=async()=>{
  if(isNativeApp()){
    try{
      await PHDPrint.print();
    }catch(er){
      console.error("Falha na impressão nativa",er);
      toast("Não foi possível abrir a impressão no Android.");
    }
  }else{
    window.print();
  }
};
$("logoutBtn").onclick=logout;
$("restoreBackupBtn").onclick=()=>$("importFile").click();
$("backupBtn").onclick=downloadBackup;
$("importFile").onchange=e=>{const f=e.target.files?.[0];if(f)importBackup(f)};
$("closeDialog").onclick=()=>$("dialog").close();
$("cancelBtn").onclick=()=>$("dialog").close();
$("remForm").onsubmit=e=>{e.preventDefault();save().catch(er=>toast(friendlyError(er)))};
$("deleteBtn").onclick=()=>del().catch(er=>toast(friendlyError(er)));
$("doneBtn").onclick=()=>toggle().catch(er=>toast(friendlyError(er)));

window.addEventListener("online",()=>{networkFailed=false;updateSyncStatus();syncQueue()});
window.addEventListener("offline",()=>{networkFailed=true;updateSyncStatus()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&navigator.onLine)syncQueue()});
setInterval(()=>{if(profile?.id&&navigator.onLine)syncQueue()},30000);

if(isNativeApp()){
  window.addEventListener("load",async()=>{
    try{
      if("serviceWorker"in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
      }
      if(window.caches){
        const keys=await caches.keys();
        await Promise.all(keys.map(k=>caches.delete(k)));
      }
    }catch{}
  });
}else if("serviceWorker"in navigator){
  let reloadingForUpdate=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(reloadingForUpdate)return;
    reloadingForUpdate=true;
    window.location.reload();
  });

  window.addEventListener("load",async()=>{
    try{
      const reg=await navigator.serviceWorker.register("./service-worker.js",{updateViaCache:"none"});
      await reg.update();
      setInterval(()=>reg.update().catch(()=>{}),15*60*1000);
      window.addEventListener("focus",()=>reg.update().catch(()=>{}));
      document.addEventListener("visibilitychange",()=>{
        if(!document.hidden)reg.update().catch(()=>{});
      });
    }catch{}
  });
}

(async()=>{
  showInstalledVersion().catch(()=>{});
  if(!okCfg()){msg("Próxima etapa: configurar o Supabase no arquivo config.js.");return}
  if(token){
    try{await boot();return}
    catch(er){
      if(er.network){msg("Sem internet e ainda não há dados salvos neste aparelho.");return}
      localStorage.removeItem(K_SESSION);localStorage.removeItem(K_PROFILE);token="";
    }
  }
  view("startView");
})();
})();