/* Conexão com o servidor próprio (backend Node.js + PostgreSQL).
   Oferece ao script.js a mesma interface de banco usada no modo local:
   db.collection(c).add/doc(id).get/set/update/delete/onSnapshot e db.doc("c/id").
   Se a página não estiver sendo servida pelo backend (ex.: arquivo aberto direto), retorna null
   e o script.js segue no modo local. */
let telaAtiva=false;
const API_H={"X-ERP3D":"1","Content-Type":"application/json"};
async function api(metodo,caminho,corpo){
 let r;
 try{r=await fetch(caminho,{method:metodo,credentials:"same-origin",headers:API_H,body:corpo===undefined?undefined:JSON.stringify(corpo)})}
 catch(e){throw new Error("sem conexão com o servidor")}
 let j=null;try{j=await r.json()}catch(e){}
 if(r.status===401&&!caminho.startsWith("/api/auth/login")){telaLogin("Sua sessão expirou. Entre novamente.");throw new Error("sessão expirada")}
 if(!r.ok)throw new Error(j&&j.erro||("erro "+r.status));
 return j}

function remoteDb(){
 const cache={},carregado={},ouvintes={},cp=o=>o==null?o:JSON.parse(JSON.stringify(o));
 const avisar=c=>(ouvintes[c]||new Set()).forEach(f=>{try{f()}catch(e){console.error(e)}});
 const aplicar=(c,id,data)=>{cache[c]=cache[c]||new Map();if(data==null)cache[c].delete(id);else cache[c].set(id,data);avisar(c)};
 async function carregar(c,forcar){
  if(carregado[c]&&!forcar)return carregado[c];
  carregado[c]=api("GET","/api/docs/"+c).then(l=>{cache[c]=new Map(l.map(x=>[x.id,x.data]));avisar(c)}).catch(e=>{carregado[c]=null;throw e});
  return carregado[c]}
 function ouvir(c,f,erro){
  (ouvintes[c]=ouvintes[c]||new Set()).add(f);
  carregar(c).then(()=>f()).catch(e=>erro&&erro(e));
  return()=>ouvintes[c].delete(f)}
 const snapDoc=(c,id)=>{const d=cache[c]&&cache[c].get(id);return{id,exists:d!==undefined,data:()=>cp(d),metadata:{fromCache:false,hasPendingWrites:false}}};
 const novoId=()=>"d"+Date.now().toString(36)+Math.random().toString(36).slice(2,9);
 const docRef=(c,id)=>({id,path:c+"/"+id,
  get:async()=>{await carregar(c);return snapDoc(c,id)},
  set:async d=>{const r=await api("PUT",`/api/docs/${c}/${id}`,{data:d});aplicar(c,id,r.data)},
  update:async d=>{const r=await api("PATCH",`/api/docs/${c}/${id}`,{data:d});aplicar(c,id,r.data)},
  delete:async()=>{await api("DELETE",`/api/docs/${c}/${id}`);aplicar(c,id,null)},
  onSnapshot:(next,erro)=>ouvir(c,()=>next(snapDoc(c,id)),erro)});
 const colRef=c=>({path:c,doc:id=>docRef(c,id||novoId()),
  add:async d=>{const r=await api("POST","/api/docs/"+c,{data:d});aplicar(c,r.id,r.data);return docRef(c,r.id)},
  onSnapshot:(next,erro)=>ouvir(c,()=>{const docs=[...(cache[c]||new Map()).keys()].map(id=>snapDoc(c,id));next({docs,size:docs.length,empty:!docs.length})},erro)});

 // Atualizações feitas pelo outro sócio chegam por Server-Sent Events.
 let es=null,caiu=false;
 function conectar(){
  es=new EventSource("/api/stream");
  es.addEventListener("ready",()=>{if(caiu){caiu=false;toast("Conexão com o servidor restabelecida.");Object.keys(carregado).forEach(c=>carregar(c,true).catch(()=>{}))}});
  es.addEventListener("change",ev=>{try{const m=JSON.parse(ev.data);if(carregado[m.col])aplicar(m.col,m.id,m.data)}catch(e){}});
  es.addEventListener("sessao",()=>{es.close();telaLogin("Sua sessão foi encerrada. Entre novamente.")});
  es.onerror=()=>{
   if(!caiu){caiu=true;toast("Sem conexão com o servidor. Tentando reconectar…")}
   if(es.readyState===EventSource.CLOSED){
    // Fechado de vez (ex.: 401). Confere a sessão antes de tentar de novo.
    setTimeout(()=>api("GET","/api/auth/me").then(conectar).catch(()=>{}),5000)}}}
 conectar();
 const pathRef=p=>{const [c,id]=p.split("/");return docRef(c,id)};
 return{doc:pathRef,collection:colRef}}

function telaLogin(msg){
 if(telaAtiva)return;telaAtiva=true;
 const nav=document.querySelector("nav");if(nav)nav.style.display="none";
 const ub=document.querySelector(".ub");if(ub)ub.remove();
 const m=document.querySelector("#m");
 m.innerHTML=`<div class="card login"><h2 style="margin-top:0">Entrar</h2>
 ${msg?`<p class="k">${esc(msg)}</p>`:""}
 <form id="lf" autocomplete="on"><div style="margin-bottom:10px"><label for="lu">Usuário</label><input id="lu" name="username" autocomplete="username" autocapitalize="none" required></div>
 <div style="margin-bottom:14px"><label for="ls">Senha</label><input id="ls" name="password" type="password" autocomplete="current-password" required></div>
 <button class="b" id="lb" style="width:100%">Entrar</button><p id="le" class="low" role="alert"></p></form></div>`;
 const f=m.querySelector("#lf");m.querySelector("#lu").focus();
 f.onsubmit=async e=>{e.preventDefault();const b=m.querySelector("#lb");b.disabled=true;m.querySelector("#le").textContent="";
  try{await api("POST","/api/auth/login",{login:m.querySelector("#lu").value.trim(),senha:m.querySelector("#ls").value});location.reload()}
  catch(er){m.querySelector("#le").textContent=er.message;b.disabled=false}}}

function barraUsuario(me){
 const h=document.querySelector("header"),d=document.createElement("div");d.className="ub";
 const emp=me.empresas.length>1?`<select id="ue" aria-label="Empresa">${me.empresas.map(e=>`<option value="${esc(e.id)}"${e.id===me.empresa.id?" selected":""}>${esc(e.nome)}</option>`).join("")}</select>`:`<span>${esc(me.empresa.nome)}</span>`;
 d.innerHTML=`<span>${esc(me.usuario.nome)}${me.empresa.papel==="leitura"?" (somente leitura)":""}</span>${emp}<button id="us">Senha</button><button id="ux">Sair</button>`;
 h.appendChild(d);
 const sel=d.querySelector("#ue");if(sel)sel.onchange=async()=>{try{await api("POST","/api/auth/empresa",{empresaId:sel.value});location.reload()}catch(e){toast(e.message)}};
 d.querySelector("#ux").onclick=async()=>{if(!await sure("Sair do ERP neste dispositivo?","Sair"))return;try{await api("POST","/api/auth/logout",{})}catch(e){}location.reload()};
 d.querySelector("#us").onclick=async()=>{
  const r=await dlg("Trocar senha",[{label:"Senha atual",type:"password"},{label:"Nova senha (mínimo 10 caracteres)",type:"password"},{label:"Repita a nova senha",type:"password"}],"Trocar");
  if(!r)return;if(r[1]!==r[2])return toast("As senhas novas não conferem.");
  try{await api("POST","/api/auth/senha",{atual:r[0],nova:r[1]});toast("Senha alterada. Outros dispositivos foram desconectados.")}catch(e){toast(e.message)}}}

/* Retorna {db, me} quando a página é servida pelo backend; null quando não há backend (modo local). */
async function conectarServidor(){
 for(;;){
  let r;
  try{r=await fetch("/api/auth/me",{credentials:"same-origin",headers:{"X-ERP3D":"1"}})}catch(e){return null}
  const json=(r.headers.get("content-type")||"").includes("application/json");
  if(r.status===401){telaLogin();return new Promise(()=>{})}
  if(r.ok&&json){const me=await r.json();
   if(!me.empresa){telaLogin("Seu usuário não tem acesso a nenhuma empresa. Fale com o administrador.");return new Promise(()=>{})}
   barraUsuario(me);return{db:remoteDb(),me}}
  if(r.status===404&&!json)return null;
  // Backend ou banco fora do ar (502/503/504): não cair para o modo local, para não gravar dados só no navegador.
  document.querySelector("#m").innerHTML='<div class="em">Servidor indisponível no momento. Tentando de novo a cada 5 segundos…</div>';telaAtiva=true;
  await new Promise(res=>setTimeout(res,5000));telaAtiva=false}}
