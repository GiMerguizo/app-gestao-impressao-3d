const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const R=n=>(+n||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const G=n=>(+n||0).toLocaleString("pt-BR",{maximumFractionDigits:1})+" g";
const num=v=>parseFloat(String(v).replace(",","."))||0;
let tab="p",fil=[],mov=[],prod=[],orc=[],ped=[],cmp=[],fin=[],soc=[],cfg={kwh:0.9,watts:100,depr:1,mo:15},db=null,ready=false,calc={};
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");setTimeout(()=>e.classList.remove("on"),2600)}
function wr(p){return p.catch(e=>toast("Não foi possível salvar: "+(e&&e.message||"erro")))}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{tab=b.dataset.t;document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));draw()});
function cpg(f){return f.peso0>0?f.preco/f.peso0:0}
function draw(){
 const a=$("#m"),fo=document.activeElement;if(fo&&a.contains(fo)&&tab!=="p"&&(fo.tagName==="INPUT"||(fo.tagName==="SELECT"&&fo.closest(".keep"))))return;
 if(!ready){a.innerHTML='<div class="em">Carregando dados…</div>';return}
 a.innerHTML={p:painel,f:filamentos,c:calculadora,r:produtos,o:orcamentos,v:pedidos,k:compras,n:financeiro}[tab]();
 if(tab==="c")bindCalc()}
function painel(){
 const est=fil.reduce((s,f)=>s+f.atual,0),val=fil.reduce((s,f)=>s+f.atual*cpg(f),0);
 const cons=mov.filter(x=>x.tipo==="consumo"||x.tipo==="falha"),g=cons.reduce((s,x)=>s+x.g,0),cu=cons.reduce((s,x)=>s+x.custo,0);
 const fl=mov.filter(x=>x.tipo==="falha").reduce((s,x)=>s+x.custo,0),bx=fil.filter(f=>f.atual<=f.min);
 const at=ped.filter(p=>p.status!=="Cancelado"),fat=at.reduce((s,p)=>s+p.total,0),rec=at.reduce((s,p)=>s+pago(p),0),lb=at.reduce((s,p)=>s+p.total-p.custo,0),op=orc.filter(o=>["Novo","Em análise","Aguardando aprovação"].includes(o.status)).length;
 return `${topo()}<div class="grid">
 <div class="card"><div class="k">Filamento em estoque</div><div class="v">${G(est)}</div></div>
 <div class="card"><div class="k">Valor em estoque</div><div class="v">${R(val)}</div></div>
 <div class="card"><div class="k">Filamento consumido</div><div class="v">${G(g)}</div></div>
 <div class="card"><div class="k">Custo do material consumido</div><div class="v">${R(cu)}</div></div>
 <div class="card"><div class="k">Perda por falhas</div><div class="v">${R(fl)}</div></div>
 <div class="card"><div class="k">Produtos cadastrados</div><div class="v">${prod.length}</div></div>
 <div class="card"><div class="k">Faturamento (vendas)</div><div class="v">${R(fat)}</div></div>
 <div class="card"><div class="k">Recebido</div><div class="v" style="color:var(--ok)">${R(rec)}</div></div>
 <div class="card"><div class="k">A receber</div><div class="v" style="color:var(--wn)">${R(fat-rec)}</div></div>
 <div class="card"><div class="k">Lucro bruto estimado</div><div class="v">${R(lb)}</div></div>
 <div class="card"><div class="k">Orçamentos pendentes</div><div class="v">${op}</div></div>
 <div class="card"><div class="k">Pedidos ativos</div><div class="v">${at.filter(p=>p.status!=="Entregue").length}</div></div>${cardsFin()}</div>
 <h2>Alertas de estoque baixo</h2><div class="card">${bx.length?bx.map(f=>`<div class="low">${esc(f.nome)} (${esc(f.cor)}): ${G(f.atual)} restantes, mínimo ${G(f.min)}</div>`).join(""):'<div class="em">Nenhum rolo abaixo do estoque mínimo.</div>'}</div>
 <p class="k">Produção e relatórios ainda não estão nesta versão. O lucro bruto considera o custo de fabricação dos produtos salvos. Os dados são compartilhados com quem tiver acesso à página.</p>`}
function filamentos(){
 return `<h2>Novo rolo</h2><div class="card"><div class="f">
 <div><label>Nome</label><input id="n" placeholder="PLA Basic"></div><div><label>Marca</label><input id="mc"></div>
 <div><label>Material</label><select id="mt"><option>PLA</option><option>PLA+</option><option>PETG</option><option>ABS</option><option>TPU</option><option>Outro</option></select></div>
 <div><label>Cor</label><input id="cr" placeholder="Preto"></div><div><label>Hex</label><input id="hx" type="color" value="#222222"></div>
 <div><label>Peso inicial (g)</label><input id="p0" inputmode="decimal" value="1000"></div><div><label>Preço pago (R$)</label><input id="pr" inputmode="decimal"></div>
 <div><label>Estoque mínimo (g)</label><input id="mn" inputmode="decimal" value="150"></div><div><label>Fornecedor</label><input id="fo"></div></div>
 <p><button class="b" onclick="addFil()">Cadastrar rolo</button></p></div>
 <h2>Estoque</h2><div class="card tw">${fil.length?`<table><tr><th>Rolo</th><th>Material</th><th>Disponível</th><th></th><th>Custo/g</th><th>Valor restante</th><th></th></tr>`+fil.map(f=>`<tr><td><span class="dot" style="background:${esc(f.hex)}"></span>${esc(f.nome)} · ${esc(f.cor)}<div class="k">${esc(f.marca)}</div></td><td>${esc(f.mat)}</td>
 <td class="${f.atual<=f.min?"low":""}">${G(f.atual)}</td><td><div class="bar"><i style="width:${Math.min(100,100*f.atual/(f.peso0||1))}%"></i></div></td><td>${R(cpg(f))}</td><td>${R(f.atual*cpg(f))}</td>
 <td><button class="s" onclick="mv('${f.id}','consumo')">Consumo</button> <button class="s" onclick="mv('${f.id}','falha')">Falha</button> <button class="s" onclick="mv('${f.id}','reposicao')">Repor</button> <button class="s d" onclick="delFil('${f.id}')">Excluir</button></td></tr>`).join("")+"</table>":'<div class="em">Nenhum rolo cadastrado. Use o formulário acima.</div>'}</div>
 <h2>Histórico de movimentações</h2><div class="card tw">${mov.length?`<table><tr><th>Data</th><th>Rolo</th><th>Tipo</th><th>Gramas</th><th>Custo</th><th>Origem</th><th>Quem</th></tr>`+[...mov].sort((a,b)=>b.ts-a.ts).slice(0,60).map(x=>`<tr><td>${new Date(x.ts).toLocaleString("pt-BR")}</td><td>${esc(x.rolo)}</td><td>${esc(x.tipo)}</td><td>${G(x.g)}</td><td>${R(x.custo)}</td><td>${esc(x.ref)}</td><td>${esc(x.por)}</td></tr>`).join("")+"</table>":'<div class="em">Sem movimentações ainda.</div>'}</div>`}
async function addFil(){
 const g=i=>$("#"+i).value.trim(),p0=num(g("p0")),pr=num(g("pr"));
 if(!g("n")||!g("cr")||p0<=0||pr<=0)return toast("Preencha nome, cor, peso inicial e preço.");
 await wr(db.collection("filamentos").add({nome:g("n"),marca:g("mc"),mat:$("#mt").value,cor:g("cr"),hex:$("#hx").value,peso0:p0,atual:p0,preco:pr,min:num(g("mn")),forn:g("fo"),criado:Date.now()}));toast("Rolo cadastrado.")}
async function mv(id,tipo){
 const f=fil.find(x=>x.id===id);if(!f)return;
 const campos=[{label:`Gramas (${tipo}) — ${f.nome} ${f.cor}. Disponível: ${G(f.atual)}`,mode:"decimal"}];if(tipo!=="reposicao")campos.push({label:"Pedido ou produto de origem (ex.: Pedido 12)"});
 const rr=await dlg(tipo==="consumo"?"Registrar consumo":tipo==="falha"?"Registrar falha":"Repor estoque",campos,"Registrar");if(!rr)return;
 const g=num(rr[0]),ref=rr[1]||"";if(g<=0)return toast("Informe os gramas.");
 const d=tipo==="reposicao"?g:-g;
 if(f.atual+d<0)return toast("Estoque não pode ficar negativo.");
 await wr(db.collection("movimentos").add({fil:id,rolo:f.nome+" · "+f.cor,tipo,g,custo:g*cpg(f),ref,por:meName,ts:Date.now()}));
 await wr(db.collection("filamentos").doc(id).update({atual:f.atual+d}));toast("Movimentação registrada.")}
async function delFil(id){if(await sure("Excluir este rolo? O histórico de movimentações é mantido.","Excluir"))await wr(db.collection("filamentos").doc(id).delete())}
function calculadora(){
 const o=fil.map(f=>`<option value="${f.id}" ${calc.fil===f.id?"selected":""}>${esc(f.nome)} · ${esc(f.cor)} (${R(cpg(f))}/g)</option>`).join("");
 const v=(k,d)=>esc(calc[k]??d);
 return `<h2>Parâmetros da oficina</h2><div class="card"><div class="f">
 <div><label>Valor do kWh (R$)</label><input data-c="kwh" inputmode="decimal" value="${cfg.kwh}"></div><div><label>Potência média (W)</label><input data-c="watts" inputmode="decimal" value="${cfg.watts}"></div>
 <div><label>Depreciação por hora (R$)</label><input data-c="depr" inputmode="decimal" value="${cfg.depr}"></div><div><label>Mão de obra por hora (R$)</label><input data-c="mo" inputmode="decimal" value="${cfg.mo}"></div></div>
 <p class="k">Valores iniciais apenas ilustrativos: ajuste para a sua realidade. Salvos automaticamente.</p></div>
 <h2>Calcular peça</h2><div class="card"><div class="f">
 <div><label>Nome da peça</label><input data-k="nome" value="${v("nome","")}"></div><div><label>SKU</label><input data-k="sku" value="${v("sku","")}"></div>
 <div><label>Filamento</label><select data-k="fil"><option value="">—</option>${o}</select></div>
 <div><label>Peso (g)</label><input data-k="g" inputmode="decimal" value="${v("g","")}"></div><div><label>Tempo de impressão (h)</label><input data-k="h" inputmode="decimal" value="${v("h","")}"></div>
 <div><label>Horas de trabalho</label><input data-k="ht" inputmode="decimal" value="${v("ht","0.25")}"></div><div><label>Embalagem (R$)</label><input data-k="emb" inputmode="decimal" value="${v("emb","0")}"></div>
 <div><label>Outros custos (R$)</label><input data-k="out" inputmode="decimal" value="${v("out","0")}"></div><div><label>Margem desejada (%)</label><input data-k="mg" inputmode="decimal" value="${v("mg","40")}"></div>
 <div><label>Preço final (opcional)</label><input data-k="pf" inputmode="decimal" value="${v("pf","")}"></div></div></div>
 <div class="card" id="res" style="margin-top:12px"></div>
 <h2>Produtos salvos</h2><div class="card tw">${prod.length?`<table><tr><th>Peça</th><th>SKU</th><th>Custo</th><th>Preço</th><th>Margem</th><th></th></tr>`+prod.map(p=>`<tr><td>${esc(p.nome)}</td><td>${esc(p.sku)}</td><td>${R(p.custo)}</td><td>${R(p.preco)}</td><td>${(p.margem*100).toFixed(1)}%</td><td><button class="s d" onclick="delProd('${p.id}')">Excluir</button></td></tr>`).join("")+"</table>":'<div class="em">Nenhum produto salvo ainda.</div>'}</div>`}
function calcRes(){
 const c=calc,f=fil.find(x=>x.id===c.fil),g=num(c.g),h=num(c.h);
 const mat=f?g*cpg(f):0,en=(cfg.watts/1000)*h*cfg.kwh,de=h*cfg.depr,mo=num(c.ht??0.25)*cfg.mo,em=num(c.emb),ou=num(c.out);
 const tot=mat+en+de+mo+em+ou,m=Math.min(num(c.mg??40)/100,0.95),sug=tot/(1-m),pf=num(c.pf)||sug,mr=pf>0?(pf-tot)/pf:0;
 return {mat,en,de,mo,em,ou,tot,sug,pf,mr,lucro:pf-tot}}
function showRes(){
 const r=calcRes(),L=(a,b)=>`<div class="r"><span>${a}</span><span>${R(b)}</span></div>`;
 $("#res").innerHTML=L("Material",r.mat)+L("Energia",r.en)+L("Depreciação",r.de)+L("Mão de obra",r.mo)+L("Embalagem",r.em)+L("Outros",r.ou)+
 `<div class="r tot"><span>Custo total</span><span>${R(r.tot)}</span></div>`+L("Preço sugerido (custo ÷ (1 − margem))",r.sug)+
 `<div class="r"><span>Preço adotado</span><span>${R(r.pf)}</span></div><div class="r"><span>Lucro / margem real</span><span>${R(r.lucro)} · ${(r.mr*100).toFixed(1)}%</span></div>
 <p><button class="b" id="sv">Salvar produto</button></p>`;
 $("#sv").onclick=async()=>{if(!calc.nome)return toast("Dê um nome à peça.");const r=calcRes();
  await wr(db.collection("produtos").add({nome:calc.nome,sku:calc.sku||"",custo:r.tot,preco:r.pf,margem:r.mr,g:num(calc.g),h:num(calc.h),fil:calc.fil||"",por:meName,ts:Date.now()}));toast("Produto salvo.")}}
function bindCalc(){
 document.querySelectorAll("[data-k]").forEach(e=>{e.oninput=e.onchange=()=>{calc[e.dataset.k]=e.value;showRes()}});
 document.querySelectorAll("[data-c]").forEach(e=>e.onchange=()=>{cfg[e.dataset.c]=num(e.value);wr(db.doc("config/custos").set(cfg));showRes()});showRes()}
async function delProd(id){if(await sure("Excluir este produto?","Excluir"))await wr(db.collection("produtos").doc(id).delete())}
const ST_O=["Novo","Em análise","Aguardando aprovação","Aprovado","Recusado","Expirado"],ST_P=["Aguardando pagamento","Aguardando produção","Em produção","Em acabamento","Pronto para entrega","Entregue","Cancelado"];
const pago=p=>(p.pags||[]).reduce((s,x)=>s+x.valor,0);
const opts=(l,v)=>l.map(x=>`<option ${x===v?"selected":""}>${x}</option>`).join("");
function orcamentos(){
 const po=prod.filter(p=>p.ativo!==false).map(p=>`<option value="${p.id}">${esc(p.nome)} (${R(p.preco)})</option>`).join("");
 return `<h2>Novo orçamento</h2><div class="card"><div class="f">
 <div><label>Cliente</label><input id="oc"></div><div><label>WhatsApp</label><input id="ow" inputmode="tel"></div>
 <div><label>Produto salvo</label><select id="op"><option value="">Outro (descrever)</option>${po}</select></div><div><label>Descrição (se não for produto salvo)</label><input id="od"></div>
 <div><label>Quantidade</label><input id="oq" inputmode="numeric" value="1"></div><div><label>Preço unitário (R$)</label><input id="ou" inputmode="decimal" placeholder="vazio = preço do produto"></div>
 <div><label>Prazo (dias)</label><input id="oz" inputmode="numeric"></div><div><label>Observações</label><input id="ob"></div></div>
 <p><button class="b" onclick="addOrc()">Registrar orçamento</button></p></div>
 <h2>Orçamentos</h2><div class="card tw">${orc.length?`<table><tr><th>Nº</th><th>Cliente</th><th>Item</th><th>Total</th><th>Prazo</th><th>Status</th><th></th></tr>`+[...orc].sort((a,b)=>b.num-a.num).map(o=>`<tr><td>#${o.num}</td><td>${esc(o.cliente)}<div class="k">${esc(o.tel)}</div></td><td>${o.qtd}× ${esc(o.item)}</td><td>${R(o.total)}</td><td>${o.prazo?esc(o.prazo)+" d":"—"}</td><td><select onchange="setOrc('${o.id}',this.value)">${opts(ST_O,o.status)}</select></td><td>${o.pedido?`Pedido #${o.pedido}`:o.status==="Aprovado"?`<button class="s" onclick="virarPed('${o.id}')">Virar pedido</button>`:""}</td></tr>`).join("")+"</table>":'<div class="em">Nenhum orçamento ainda. Registre o primeiro acima.</div>'}</div>`}
async function addOrc(){
 const g=i=>$("#"+i).value.trim(),p=prod.find(x=>x.id===$("#op").value),q=Math.max(1,Math.floor(num(g("oq")))),u=num(g("ou"))||(p?p.preco:0),nome=p?p.nome:g("od");
 if(!g("oc")||!nome||u<=0)return toast("Informe cliente, produto e preço.");
 const n=orc.reduce((m,o)=>Math.max(m,o.num),0)+1;
 await wr(db.collection("orcamentos").add({num:n,cliente:g("oc"),tel:g("ow"),item:nome,prodId:p?p.id:"",qtd:q,unit:u,total:q*u,custo:p?q*p.custo:0,prazo:g("oz"),obs:g("ob"),status:"Novo",por:meName,ts:Date.now()}));toast("Orçamento registrado.")}
const setOrc=(id,s)=>wr(db.collection("orcamentos").doc(id).update({status:s}));
async function virarPed(id){
 const o=orc.find(x=>x.id===id);if(!o||o.pedido)return;
 const n=ped.reduce((m,p)=>Math.max(m,p.num),0)+1;
 const r=await wr(db.collection("pedidos").add({num:n,orcId:id,cliente:o.cliente,item:o.item,qtd:o.qtd,total:o.total,custo:o.custo,status:"Aguardando pagamento",pags:[],por:meName,ts:Date.now()}));
 if(r){await wr(db.collection("orcamentos").doc(id).update({pedido:n}));toast("Pedido #"+n+" criado.")}}
function pedidos(){
 return `<h2>Pedidos e vendas</h2><div class="card tw">${ped.length?`<table><tr><th>Nº</th><th>Cliente</th><th>Item</th><th>Total</th><th>Recebido</th><th>A receber</th><th>Lucro est.</th><th>Status</th><th></th></tr>`+[...ped].sort((a,b)=>b.num-a.num).map(p=>{const pg=pago(p),c=p.status==="Cancelado";return `<tr><td>#${p.num}</td><td>${esc(p.cliente)}</td><td>${p.qtd}× ${esc(p.item)}</td><td>${R(p.total)}</td><td>${R(pg)}</td><td>${c?"—":R(p.total-pg)}</td><td>${c?"—":R(p.total-p.custo)}</td><td><select onchange="setPed('${p.id}',this.value)">${opts(ST_P,p.status)}</select></td><td>${!c&&p.total-pg>0.005?`<button class="s" onclick="pagar('${p.id}')">Pagamento</button>`:""}</td></tr>`}).join("")+"</table>":'<div class="em">Nenhum pedido. Aprove um orçamento e use “Virar pedido”.</div>'}</div>`}
async function setPed(id,s){if(s==="Cancelado"&&!await sure("Cancelar este pedido? O histórico e os pagamentos já registrados são mantidos.","Cancelar pedido"))return draw();await wr(db.collection("pedidos").doc(id).update({status:s}))}
async function pagar(id){
 const p=ped.find(x=>x.id===id),pend=p.total-pago(p);
 const rr=await dlg("Registrar pagamento",[{label:`Valor recebido (pendente: ${R(pend)})`,mode:"decimal",value:pend.toFixed(2).replace(".",",")},{label:"Forma",options:FORMAS}],"Registrar");if(!rr)return;
 const v=num(rr[0]),f=rr[1];if(v<=0)return toast("Informe o valor.");
 if(v>pend+0.005)return toast("Valor maior que o pendente.");
 await wr(db.collection("pedidos").doc(id).update({pags:[...(p.pags||[]),{valor:v,forma:f,por:meName,ts:Date.now()}]}));toast("Pagamento registrado.")}
let pe=null,pq="",pst="";
function listProd(){
 const l=prod.filter(p=>(!pq||(p.nome+" "+(p.sku||"")).toLowerCase().includes(pq))&&(!pst||(pst==="a"?p.ativo!==false:p.ativo===false)));
 return l.length?`<table><tr><th>Peça</th><th>SKU</th><th>Categoria</th><th>Material</th><th>Peso</th><th>Tempo</th><th>Custo</th><th>Preço</th><th>Margem</th><th>Status</th><th></th></tr>`+l.map(p=>`<tr><td>${esc(p.nome)}<div class="k">${esc(p.cor)} ${esc(p.descr)}</div></td><td>${esc(p.sku)}</td><td>${esc(p.cat)}</td><td>${esc((fil.find(f=>f.id===p.fil)||{}).mat||"—")}</td><td>${p.g?G(p.g):"—"}</td><td>${p.h?p.h+" h":"—"}</td><td>${R(p.custo)}</td><td>${R(p.preco)}</td><td>${((p.margem||0)*100).toFixed(1)}%</td><td class="${p.ativo===false?"k":""}">${p.ativo===false?"Inativo":"Ativo"}</td>
 <td><button class="s" onclick="pe='${p.id}';draw();scrollTo(0,0)">Editar</button> <button class="s" onclick="togProd('${p.id}',${p.ativo===false})">${p.ativo===false?"Ativar":"Inativar"}</button> <button class="s d" onclick="delProd('${p.id}')">Excluir</button></td></tr>`).join("")+"</table>":'<div class="em">Nenhum produto encontrado. Cadastre o primeiro acima.</div>'}
function produtos(){
 const e=prod.find(x=>x.id===pe)||{},cats=[...new Set(prod.map(p=>p.cat).filter(Boolean))];
 const fo=fil.map(f=>`<option value="${f.id}" ${e.fil===f.id?"selected":""}>${esc(f.nome)} · ${esc(f.cor)}</option>`).join("");
 return `<h2>${pe?"Editar produto":"Novo produto"}</h2><div class="card"><div class="f">
 <div><label>Nome da peça</label><input id="pn" value="${esc(e.nome)}"></div><div><label>SKU</label><input id="ps" value="${esc(e.sku)}"></div>
 <div><label>Categoria</label><input id="pc" list="cl" value="${esc(e.cat)}"><datalist id="cl">${cats.map(c=>`<option>${esc(c)}</option>`).join("")}</datalist></div>
 <div><label>Filamento padrão</label><select id="pf"><option value="">—</option>${fo}</select></div><div><label>Cor</label><input id="pr" value="${esc(e.cor)}"></div>
 <div><label>Peso (g)</label><input id="pg" inputmode="decimal" value="${esc(e.g)}"></div><div><label>Tempo de impressão (h)</label><input id="ph" inputmode="decimal" value="${esc(e.h)}"></div>
 <div><label>Custo de fabricação (R$)</label><input id="pk" inputmode="decimal" value="${esc(e.custo)}"></div><div><label>Preço de venda (R$)</label><input id="pp" inputmode="decimal" value="${esc(e.preco)}"></div>
 <div><label>Status</label><select id="pa"><option value="1">Ativo</option><option value="0" ${e.ativo===false?"selected":""}>Inativo</option></select></div></div>
 <div style="margin-top:10px"><label>Descrição</label><input id="pd" value="${esc(e.descr)}"></div>
 <p><button class="b" onclick="saveProd()">${pe?"Salvar alterações":"Cadastrar produto"}</button> ${pe?`<button class="s" onclick="pe=null;draw()">Cancelar edição</button>`:""}</p>
 <p class="k">Dica: calcule o custo na aba Calculadora e salve ali para preencher custo e preço automaticamente. A margem é calculada sobre o preço de venda.</p></div>
 <h2>Catálogo</h2><div class="card"><div class="f" style="margin-bottom:10px"><div><label>Buscar</label><input value="${esc(pq)}" placeholder="Nome ou SKU" oninput="pq=this.value.toLowerCase();$('#pl').innerHTML=listProd()"></div>
 <div><label>Status</label><select onchange="pst=this.value;draw()"><option value="">Todos</option><option value="a" ${pst==="a"?"selected":""}>Ativos</option><option value="i" ${pst==="i"?"selected":""}>Inativos</option></select></div></div>
 <div class="tw" id="pl">${listProd()}</div></div>`}
async function saveProd(){
 const g=i=>$("#"+i).value.trim(),k=num(g("pk")),p=num(g("pp"));
 if(!g("pn"))return toast("Informe o nome da peça.");
 if(p<=0)return toast("Informe o preço de venda.");
 if(g("ps")&&prod.some(x=>x.sku===g("ps")&&x.id!==pe))return toast("Já existe um produto com este SKU.");
 const d={nome:g("pn"),sku:g("ps"),cat:g("pc"),fil:$("#pf").value,cor:g("pr"),g:num(g("pg")),h:num(g("ph")),custo:k,preco:p,margem:(p-k)/p,ativo:$("#pa").value==="1",descr:g("pd")};
 if(pe){await wr(db.collection("produtos").doc(pe).update(d));pe=null}else await wr(db.collection("produtos").add({...d,por:meName,ts:Date.now()}));
 toast("Produto salvo.");draw()}
async function togProd(id,ativar){await wr(db.collection("produtos").doc(id).update({ativo:ativar}))}
let imp={},ams={};
const ST_I={"Livre":"var(--ok)","Em uso":"var(--wn)","Desligada":"var(--mu)"};
function topo(){
 const st=imp.status||"Livre",c=ST_I[st]||"var(--mu)";
 const slots=[1,2,3,4].map(n=>{const f=fil.find(x=>x.id===ams["s"+n]);
  return `<div class="card" style="text-align:center;padding:10px"><div class="k">Posição ${n}</div>
  ${f?`<div style="width:46px;height:46px;border-radius:50%;background:${esc(f.hex)};border:2px solid var(--ln);margin:8px auto"></div><div><b>${esc(f.cor)}</b></div><div class="k">${esc(f.mat)} · ${esc(f.nome)}</div><div class="${f.atual<=f.min?"low":"k"}">${G(f.atual)}${f.atual<=f.min?" · baixo":""}</div>`:`<div style="width:46px;height:46px;border-radius:50%;border:2px dashed var(--ln);margin:8px auto"></div><div class="k">Vazio</div>`}
  <select onchange="setSlot(${n},this.value)" style="margin-top:6px"><option value="">Vazio</option>${fil.map(x=>`<option value="${x.id}" ${f&&f.id===x.id?"selected":""}>${esc(x.nome)} · ${esc(x.cor)}</option>`).join("")}</select></div>`}).join("");
 return `<div class="card" style="margin-bottom:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap"><span style="width:16px;height:16px;border-radius:50%;background:${c}"></span><div style="flex:1"><div class="k">Bambu Lab A1</div><div class="v" style="color:${c}">${esc(st)}</div><div class="k">${imp.ts?"Atualizado em "+new Date(imp.ts).toLocaleString("pt-BR")+" por "+esc(imp.por):"Ainda não informado"}</div></div>
 <select onchange="setImp(this.value)" style="width:auto">${opts(Object.keys(ST_I),st)}</select></div>
 <h2 style="margin-top:0">AMS</h2><div class="grid" style="margin-bottom:8px">${slots}</div><p class="k">Status e posições do AMS são informados manualmente: não há conexão com a impressora.</p>`}
async function setImp(s){await wr(db.doc("config/impressora").set({status:s,ts:Date.now(),por:meName}))}
async function setSlot(n,id){await wr(db.doc("config/ams").set({...ams,["s"+n]:id}))}
const FORMAS=["Pix","Dinheiro","Cartão","Transferência","Outros"];
const CATS=["Filamentos","Peças e acessórios da impressora","Ferramentas","Equipamentos","Embalagens","Manutenção","Energia elétrica","Marketing","Transporte","Outros"];
const TIPOS=["Estoque","Investimento","Despesa operacional"];
const TIPO_CAT={"Filamentos":"Estoque","Embalagens":"Estoque","Ferramentas":"Investimento","Equipamentos":"Investimento"};
const PER=[["tudo","Todo o período"],["7","Últimos 7 dias"],["30","Últimos 30 dias"],["90","Últimos 3 meses"],["180","Últimos 6 meses"],["ano","Este ano"],["pers","Personalizado"]];
const TN={aporte:"Aporte",retirada:"Retirada",receita:"Outra receita",estorno:"Devolução a cliente"};
const hoje=()=>new Date().toLocaleDateString("sv-SE");
const fd=s=>s?String(s).split("-").reverse().join("/"):"—";
const dts=s=>new Date(s+"T12:00:00").getTime();
const nf=s=>/^https:\/\//.test(s||"")?`<a href="${esc(s)}" target="_blank" rel="noopener">abrir</a>`:esc(s);
const sm=(l,f)=>l.reduce((s,x)=>s+f(x),0);
let per="tudo",pde="",pate="";
const lock=new Set();
/* Diálogos próprios: prompt() e confirm() são bloqueados no quadro da página. */
function dlg(title,fields,ok="Confirmar"){return new Promise(res=>{
 const o=document.createElement("div");o.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:20;padding:16px";
 o.innerHTML=`<div class="card" style="max-width:420px;width:100%"><h2 style="margin-top:0">${esc(title)}</h2>${fields.map((f,i)=>f.type==="msg"?`<p>${esc(f.text)}</p>`:`<div style="margin-bottom:10px"><label>${esc(f.label)}</label>${f.options?`<select data-i="${i}">${f.options.map(x=>`<option>${esc(x)}</option>`).join("")}</select>`:`<input data-i="${i}" type="${f.type||"text"}" inputmode="${f.mode||"text"}" value="${esc(f.value??"")}">`}</div>`).join("")}<p style="display:flex;gap:8px;justify-content:flex-end;margin:0"><button class="s" id="dn">Cancelar</button><button class="b" id="dy">${esc(ok)}</button></p></div>`;
 document.body.appendChild(o);
 const fim=v=>{o.remove();res(v)};
 o.querySelector("#dn").onclick=()=>fim(null);
 o.querySelector("#dy").onclick=()=>fim([...o.querySelectorAll("[data-i]")].map(e=>e.value.trim()));
 const p=o.querySelector("[data-i]");if(p)p.focus();
 o.addEventListener("keydown",e=>{if(e.key==="Escape")fim(null);if(e.key==="Enter"&&e.target.tagName==="INPUT")o.querySelector("#dy").click()})})}
const sure=(msg,ok="Confirmar")=>dlg("Confirmação",[{type:"msg",text:msg}],ok).then(r=>r!==null);
function rng(){const n=new Date(),d=new Date(n.getFullYear(),n.getMonth(),n.getDate()),DAY=864e5,fim=d.getTime()+DAY-1;
 if(per==="7")return[d.getTime()-6*DAY,fim];if(per==="30")return[d.getTime()-29*DAY,fim];
 if(per==="90")return[new Date(n.getFullYear(),n.getMonth()-3,n.getDate()).getTime(),fim];
 if(per==="180")return[new Date(n.getFullYear(),n.getMonth()-6,n.getDate()).getTime(),fim];
 if(per==="ano")return[new Date(n.getFullYear(),0,1).getTime(),fim];
 if(per==="pers")return[pde?dts(pde)-432e5:0,pate?dts(pate)+432e5-1:Infinity];
 return[0,Infinity]}
function resumo(a,b){
 const inr=t=>t>=a&&t<=b,cp=cmp.filter(c=>c.status==="Comprado"&&inr(dts(c.data)));
 const estq=sm(cp.filter(c=>c.tipo==="Estoque"),c=>c.total),inv=sm(cp.filter(c=>c.tipo==="Investimento"),c=>c.total),opx=sm(cp.filter(c=>c.tipo==="Despesa operacional"),c=>c.total);
 const at=ped.filter(p=>p.status!=="Cancelado"&&inr(p.ts)),fat=sm(at,p=>p.total),cpv=sm(at,p=>p.custo),areceber=sm(at,p=>p.total-pago(p));
 const rec=sm(ped,p=>sm((p.pags||[]).filter(x=>inr(x.ts)),x=>x.valor));
 const F=t=>fin.filter(x=>!x.cancelado&&x.tipo===t&&inr(dts(x.data)));
 const ap=sm(F("aporte"),x=>x.valor),rt=sm(F("retirada"),x=>x.valor),outr=sm(F("receita"),x=>x.valor),dev=sm(F("estorno"),x=>x.valor);
 const perdas=sm(mov.filter(x=>x.tipo==="falha"&&inr(x.ts)),x=>x.custo);
 const lb=fat-cpv,liq=lb+outr-opx-perdas,ent=ap+rec+outr,sai=estq+inv+opx+rt+dev;
 return{estq,inv,opx,fat,cpv,areceber,rec,ap,rt,outr,dev,perdas,lb,liq,marg:fat>0?liq/fat:null,ent,sai,saldo:ent-sai}}
function cardsFin(){const t=resumo(0,Infinity);
 return `<div class="card"><div class="k">Total investido pelos sócios</div><div class="v">${R(t.ap)}</div></div>
 <div class="card"><div class="k">Compras de estoque</div><div class="v">${R(t.estq)}</div></div>
 <div class="card"><div class="k">Investimento em equipamentos</div><div class="v">${R(t.inv)}</div></div>
 <div class="card"><div class="k">Despesas operacionais</div><div class="v">${R(t.opx)}</div></div>
 <div class="card"><div class="k">Lucro líquido estimado</div><div class="v" style="color:${t.liq<0?"var(--bad)":"var(--ok)"}">${R(t.liq)}</div></div>
 <div class="card"><div class="k">Saldo de caixa</div><div class="v" style="color:${t.saldo<0?"var(--bad)":"inherit"}">${R(t.saldo)}</div></div>`}
function catChg(){const c=$("#kc").value;$("#kt").value=TIPO_CAT[c]||"Despesa operacional";$("#kfil").style.display=c==="Filamentos"?"":"none"}
function kTot(){$("#kv").value=R(num($("#kq").value)*num($("#ku").value))}
function compras(){
 const l=[...cmp].sort((x,y)=>(y.data||"").localeCompare(x.data||"")||(y.num||0)-(x.num||0)).slice(0,150);
 const tc=sm(cmp.filter(c=>c.status==="Comprado"),c=>c.total),tp=sm(cmp.filter(c=>c.status==="Planejado"),c=>c.total);
 const op=a=>a.map(x=>`<option>${esc(x)}</option>`).join("");
 return `<h2>Nova compra ou despesa</h2><div class="card keep"><div class="f">
 <div><label>Item</label><input id="ki"></div>
 <div><label>Categoria</label><select id="kc" onchange="catChg()">${op(CATS)}</select></div>
 <div><label>Tipo</label><select id="kt">${op(TIPOS)}</select></div>
 <div><label>Quantidade</label><input id="kq" inputmode="decimal" value="1" oninput="kTot()"></div>
 <div><label>Valor unitário (R$)</label><input id="ku" inputmode="decimal" oninput="kTot()"></div>
 <div><label>Total</label><input id="kv" readonly value="${R(0)}"></div>
 <div><label>Fornecedor</label><input id="kf"></div><div><label>Data</label><input id="kd" type="date" value="${hoje()}"></div>
 <div><label>Forma de pagamento</label><select id="kp">${op(FORMAS)}</select></div>
 <div><label>Situação</label><select id="ks"><option>Comprado</option><option>Planejado</option></select></div>
 <div><label>Nota fiscal / comprovante (nº ou link https)</label><input id="kn"></div><div><label>Descrição / observações</label><input id="ko"></div></div>
 <div id="kfil" style="margin-top:10px"><div class="f">
 <div style="grid-column:1/-1"><label><input id="kr" type="checkbox" checked style="width:auto"> Dar entrada no estoque (cria um rolo por unidade comprada)</label></div>
 <div><label>Marca</label><input id="kb"></div><div><label>Material</label><select id="km">${op(["PLA","PLA+","PETG","ABS","TPU","Outro"])}</select></div>
 <div><label>Cor</label><input id="kk"></div><div><label>Hex</label><input id="kh" type="color" value="#222222"></div>
 <div><label>Peso por rolo (g)</label><input id="kg" inputmode="decimal" value="1000"></div><div><label>Estoque mínimo (g)</label><input id="kmn" inputmode="decimal" value="150"></div></div></div>
 <p><button class="b" onclick="addCmp()">Registrar</button></p>
 <p class="k">Compras “Planejadas” não entram no financeiro até serem marcadas como compradas. Equipamentos e ferramentas são investimentos; filamentos e embalagens são estoque; o resto é despesa operacional. Rolos cadastrados direto na aba Filamentos não geram lançamento financeiro: para isso, registre a compra aqui.</p></div>
 <div class="grid" style="margin-top:12px"><div class="card"><div class="k">Total comprado</div><div class="v">${R(tc)}</div></div><div class="card"><div class="k">Planejado (a comprar)</div><div class="v" style="color:var(--wn)">${R(tp)}</div></div></div>
 <h2>Histórico de compras e despesas</h2><div class="card tw">${l.length?`<table><tr><th>Nº</th><th>Data</th><th>Item</th><th>Categoria</th><th>Tipo</th><th>Qtd</th><th>Unitário</th><th>Total</th><th>Fornecedor</th><th>Pagamento</th><th>Situação</th><th>Quem</th><th>NF</th><th></th></tr>`+l.map(c=>`<tr style="${c.status==="Cancelado"?"opacity:.5;text-decoration:line-through":""}"><td>#${c.num}</td><td>${fd(c.data)}</td><td>${esc(c.item)}<div class="k">${esc(c.descr)}</div></td><td>${esc(c.cat)}</td><td>${esc(c.tipo)}</td><td>${c.qtd}</td><td>${R(c.unit)}</td><td>${R(c.total)}</td><td>${esc(c.forn)}</td><td>${esc(c.pgto)}</td><td>${esc(c.status)}${c.fil&&c.estoqueOk?'<div class="k">no estoque</div>':""}</td><td>${esc(c.por)}</td><td>${nf(c.nf)}</td><td>${c.status==="Planejado"?`<button class="s" onclick="efetivar('${c.id}')">Marcar como comprado</button> `:""}${c.status!=="Cancelado"?`<button class="s d" onclick="cancCmp('${c.id}')">Cancelar</button>`:""}</td></tr>`).join("")+"</table>":'<div class="em">Nenhuma compra registrada. Use o formulário acima.</div>'}</div>`}
async function addCmp(){
 const g=i=>$("#"+i).value.trim(),q=num(g("kq")),u=num(g("ku")),cat=g("kc"),st=g("ks");
 if(!g("ki"))return toast("Informe o item.");
 if(q<=0||u<=0)return toast("Informe quantidade e valor unitário.");
 if(!g("kd"))return toast("Informe a data.");
 let fi=null;
 if(cat==="Filamentos"&&$("#kr").checked){const pr=num(g("kg"));
  if(!g("kk")||pr<=0)return toast("Informe cor e peso por rolo.");
  if(q!==Math.floor(q))return toast("Para criar rolos, a quantidade deve ser um número inteiro.");
  fi={marca:g("kb"),mat:$("#km").value,cor:g("kk"),hex:$("#kh").value,peso:pr,min:num(g("kmn"))}}
 const n=cmp.reduce((m,c)=>Math.max(m,c.num||0),0)+1;
 const d={num:n,item:g("ki"),cat,tipo:g("kt"),descr:g("ko"),qtd:q,unit:u,total:q*u,forn:g("kf"),data:g("kd"),pgto:g("kp"),status:st,nf:g("kn"),fil:fi,estoqueOk:false,por:meName,ts:Date.now()};
 const ref=await wr(db.collection("compras").add(d));
 if(!ref)return;
 toast("Compra #"+n+" registrada.");
 if(st==="Comprado"&&fi)await entradaEstoque(ref.id,d)}
async function entradaEstoque(id,c){
 if(lock.has(id)||c.estoqueOk||!c.fil)return;lock.add(id);
 try{
  await db.collection("compras").doc(id).update({estoqueOk:true});
  for(let i=1;i<=c.qtd;i++){
   const r=await db.collection("filamentos").add({nome:c.item+(c.qtd>1?` (${i}/${c.qtd})`:""),marca:c.fil.marca,mat:c.fil.mat,cor:c.fil.cor,hex:c.fil.hex,peso0:c.fil.peso,atual:c.fil.peso,preco:c.unit,min:c.fil.min,forn:c.forn,compra:c.num,criado:Date.now()+i});
   await db.collection("movimentos").add({fil:r.id,rolo:c.item+" · "+c.fil.cor,tipo:"compra",g:c.fil.peso,custo:c.unit,ref:"Compra #"+c.num,por:meName,ts:Date.now()})}
  toast(c.qtd+" rolo(s) adicionado(s) ao estoque.")
 }catch(e){toast("Falha ao dar entrada no estoque ("+(e&&e.message||"erro")+"). Confira a aba Filamentos antes de tentar de novo.")}
 finally{lock.delete(id)}}
async function efetivar(id){
 const c=cmp.find(x=>x.id===id);if(!c||c.status!=="Planejado")return;
 const r=await dlg("Marcar como comprado",[{label:"Data da compra",type:"date",value:hoje()},{label:"Valor unitário (R$)",mode:"decimal",value:String(c.unit).replace(".",",")}],"Confirmar");if(!r)return;
 const u=num(r[1]);if(!r[0])return toast("Informe a data.");if(u<=0)return toast("Informe o valor.");
 const d={status:"Comprado",data:r[0],unit:u,total:u*c.qtd};
 const ok=await wr(db.collection("compras").doc(id).update(d).then(()=>true));
 if(ok&&c.fil)await entradaEstoque(id,{...c,...d})}
async function cancCmp(id){const c=cmp.find(x=>x.id===id);if(!c)return;
 if(!await sure(`Cancelar a compra #${c.num} (${c.item})? O registro continua no histórico, mas sai dos totais.`+(c.estoqueOk?" Os rolos já lançados no estoque continuam lá: ajuste na aba Filamentos.":""),"Cancelar compra"))return;
 await wr(db.collection("compras").doc(id).update({status:"Cancelado"}))}
async function addFin(tipo,sid){
 const socio=soc.find(x=>x.id===sid),extra=tipo==="receita"||tipo==="estorno";
 const campos=[{label:"Valor (R$)",mode:"decimal"},{label:"Data",type:"date",value:hoje()}];
 if(extra)campos.push({label:tipo==="receita"?"Descrição da receita":"Cliente / pedido devolvido"});
 campos.push({label:"Observações"});
 const r=await dlg(TN[tipo]+(socio?" — "+socio.nome:""),campos,"Registrar");if(!r)return;
 const v=num(r[0]),ex=extra?r[2]:"";
 if(v<=0)return toast("Informe um valor maior que zero.");if(!r[1])return toast("Informe a data.");if(extra&&!ex)return toast("Preencha a descrição.");
 const cx=resumo(0,Infinity).saldo;
 if((tipo==="retirada"||tipo==="estorno")&&v>cx+0.005&&!await sure(`Saldo de caixa atual: ${R(cx)}. Esta saída deixa o caixa negativo. Registrar mesmo assim?`,"Registrar"))return;
 await wr(db.collection("fin").add({tipo,socio:socio?socio.id:"",socioNome:socio?socio.nome:"",valor:v,data:r[1],descr:ex,obs:r[campos.length-1],cancelado:false,por:meName,ts:Date.now()}));toast("Lançamento registrado.")}
async function cancFin(id){if(await sure("Anular este lançamento? Ele continua no histórico, mas deixa de contar nos totais.","Anular"))await wr(db.collection("fin").doc(id).update({cancelado:true,anuladoPor:meName}))}
async function addSoc(){
 const n=$("#sn").value.trim(),p=num($("#sp").value),ja=sm(soc,x=>x.pct);
 if(!n||p<=0||p>100)return toast("Informe o nome e uma participação entre 0 e 100%.");
 if(ja+p>100.0001)return toast(`A soma das participações passaria de 100% (já há ${ja}%).`);
 await wr(db.collection("socios").add({nome:n,pct:p,ts:Date.now()}));toast("Sócio cadastrado.")}
async function editSoc(id){const s=soc.find(x=>x.id===id);if(!s)return;
 const r=await dlg("Editar sócio",[{label:"Nome",value:s.nome},{label:"Participação nos resultados (%)",mode:"decimal",value:String(s.pct).replace(".",",")}],"Salvar");if(!r)return;
 const p=num(r[1]),ja=sm(soc.filter(x=>x.id!==id),x=>x.pct);
 if(!r[0]||p<=0||p>100)return toast("Dados inválidos.");
 if(ja+p>100.0001)return toast(`A soma passaria de 100% (os outros têm ${ja}%).`);
 await wr(db.collection("socios").doc(id).update({nome:r[0],pct:p}))}
function financeiro(){
 const[a,b]=rng(),t=resumo(a,b),T=resumo(0,Infinity),inr=x=>x>=a&&x<=b;
 const L=(x,y,s="")=>`<div class="r" style="${s}"><span>${x}</span><span>${R(y)}</span></div>`,cor=v=>v<0?"var(--bad)":"var(--ok)";
 const cancRec=sm(ped.filter(p=>p.status==="Cancelado"),pago),devAll=sm(fin.filter(x=>!x.cancelado&&x.tipo==="estorno"),x=>x.valor);
 const cats={};cmp.filter(c=>c.status==="Comprado"&&inr(dts(c.data))).forEach(c=>cats[c.cat]=(cats[c.cat]||0)+c.total);
 const cl=Object.entries(cats).sort((x,y)=>y[1]-x[1]),mx=cl.length?cl[0][1]:1;
 const lan=fin.filter(x=>inr(dts(x.data))).sort((x,y)=>dts(y.data)-dts(x.data)||y.ts-x.ts);
 const sp=sm(soc,x=>x.pct),nomeS=x=>(soc.find(s=>s.id===x.socio)||{}).nome||x.socioNome||"";
 const F=(s,tp)=>sm(fin.filter(x=>!x.cancelado&&x.tipo===tp&&x.socio===s.id&&inr(dts(x.data))),x=>x.valor);
 return `<h2>Período</h2><div class="card"><div class="f"><div><label>Filtro</label><select onchange="per=this.value;draw()">${PER.map(p=>`<option value="${p[0]}" ${per===p[0]?"selected":""}>${p[1]}</option>`).join("")}</select></div>
 ${per==="pers"?`<div><label>De</label><input type="date" value="${esc(pde)}" onchange="pde=this.value;this.blur();draw()"></div><div><label>Até</label><input type="date" value="${esc(pate)}" onchange="pate=this.value;this.blur();draw()"></div>`:""}</div>
 <p class="k" style="margin-bottom:0">Vendas entram pela data do pedido; pagamentos, pela data em que foram registrados; compras e lançamentos, pela data informada.</p></div>
 <h2>Resumo do período</h2><div class="grid">
 <div class="card"><div class="k">Vendas realizadas (faturamento)</div><div class="v">${R(t.fat)}</div></div>
 <div class="card"><div class="k">Recebido</div><div class="v" style="color:var(--ok)">${R(t.rec)}</div></div>
 <div class="card"><div class="k">A receber (vendas do período)</div><div class="v" style="color:var(--wn)">${R(t.areceber)}</div></div>
 <div class="card"><div class="k">Lucro bruto</div><div class="v">${R(t.lb)}</div></div>
 <div class="card"><div class="k">Lucro líquido estimado</div><div class="v" style="color:${cor(t.liq)}">${R(t.liq)}</div></div>
 <div class="card"><div class="k">Margem líquida</div><div class="v">${t.marg===null?"—":(t.marg*100).toFixed(1)+"%"}</div></div>
 <div class="card"><div class="k">Saldo do período (caixa)</div><div class="v" style="color:${cor(t.saldo)}">${R(t.saldo)}</div></div>
 <div class="card"><div class="k">Saldo de caixa acumulado</div><div class="v" style="color:${cor(T.saldo)}">${R(T.saldo)}</div></div></div>
 ${cancRec-devAll>0.005?`<p class="low">Há ${R(cancRec-devAll)} recebidos de pedidos cancelados sem devolução registrada. Se já devolveu ao cliente, lance como “Devolução a cliente”.</p>`:""}
 <div class="grid" style="margin-top:12px;align-items:start">
 <div class="card"><h2 style="margin-top:0">Resultado (lucro)</h2>${L("Receita bruta (vendas)",t.fat)}${L("(−) Custo dos produtos vendidos",-t.cpv)}${L("= Lucro bruto",t.lb,"font-weight:700")}${L("(+) Outras receitas",t.outr)}${L("(−) Despesas operacionais",-t.opx)}${L("(−) Perdas por falhas de impressão",-t.perdas)}${L("= Lucro líquido estimado",t.liq,"border-top:1px solid var(--ln);font-weight:700")}
 <p class="k">Compras de estoque passam pelo custo dos produtos vendidos e equipamentos são investimento: nenhum dos dois entra como despesa aqui.</p></div>
 <div class="card"><h2 style="margin-top:0">Fluxo de caixa</h2>${L("Aportes dos sócios",t.ap)}${L("Recebimentos de vendas",t.rec)}${L("Outras receitas",t.outr)}${L("= Entradas",t.ent,"border-top:1px solid var(--ln);font-weight:700")}
 ${L("Compras de estoque",-t.estq)}${L("Investimentos (equipamentos)",-t.inv)}${L("Despesas operacionais",-t.opx)}${L("Retiradas dos sócios",-t.rt)}${L("Devoluções a clientes",-t.dev)}${L("= Saídas",-t.sai,"border-top:1px solid var(--ln);font-weight:700")}${L("Saldo do período",t.saldo,"font-weight:700")}
 <p class="k">Lucro não é dinheiro disponível: o caixa só conta o que entrou e saiu de fato.</p></div></div>
 <h2>Gastos por categoria</h2><div class="card">${cl.length?cl.map(([c,v])=>`<div class="hb"><span style="width:190px;flex:none">${esc(c)}</span><i style="width:${Math.max(2,100*v/mx)}%;max-width:calc(100% - 300px)"></i><span>${R(v)}</span></div>`).join(""):'<div class="em">Nenhuma compra no período.</div>'}</div>
 <h2>Sócios</h2><div class="card keep"><div class="f"><div><label>Nome</label><input id="sn"></div><div><label>Participação nos resultados (%)</label><input id="sp" inputmode="decimal"></div></div><p><button class="b" onclick="addSoc()">Cadastrar sócio</button></p>
 <p class="k">Os sócios são cadastros de controle financeiro, separados do login da página.</p></div>
 <div class="card tw" style="margin-top:12px">${soc.length?`<table><tr><th>Sócio</th><th>Participação</th><th>Aportes</th><th>Retiradas</th><th>Parte do lucro estimado</th><th></th></tr>`+soc.map(s=>`<tr><td>${esc(s.nome)}</td><td>${s.pct}%</td><td>${R(F(s,"aporte"))}</td><td>${R(F(s,"retirada"))}</td><td>${R(t.liq*s.pct/100)}</td><td><button class="s" onclick="addFin('aporte','${s.id}')">Aporte</button> <button class="s" onclick="addFin('retirada','${s.id}')">Retirada</button> <button class="s" onclick="editSoc('${s.id}')">Editar</button></td></tr>`).join("")+"</table>"+(Math.abs(sp-100)>0.0001?`<p class="low">A soma das participações é ${sp}% (deveria ser 100%).</p>`:""):'<div class="em">Cadastre os sócios para registrar aportes e retiradas.</div>'}</div>
 <h2>Lançamentos financeiros</h2><p><button class="s" onclick="addFin('receita','')">Nova receita</button> <button class="s" onclick="addFin('estorno','')">Devolução a cliente</button></p>
 <div class="card tw">${lan.length?`<table><tr><th>Data</th><th>Tipo</th><th>Sócio / descrição</th><th>Valor</th><th>Obs.</th><th>Quem</th><th></th></tr>`+lan.map(x=>`<tr style="${x.cancelado?"opacity:.5;text-decoration:line-through":""}"><td>${fd(x.data)}</td><td>${TN[x.tipo]||esc(x.tipo)}</td><td>${esc(nomeS(x)||x.descr)}</td><td>${R(x.valor)}</td><td>${esc(x.obs)}</td><td>${esc(x.por)}</td><td>${x.cancelado?"Anulado":`<button class="s d" onclick="cancFin('${x.id}')">Anular</button>`}</td></tr>`).join("")+"</table>":'<div class="em">Nenhum lançamento no período. Aportes e retiradas são registrados na tabela de sócios.</div>'}</div>`}
let meName="Sócio";
const sn=(q,fn)=>db.collection(q).onSnapshot(s=>{fn(s.docs.map(d=>({id:d.id,...d.data()})));draw()},e=>toast("Erro ao ler "+q));
/* Banco local: usado quando a página roda fora do Claude. Dados ficam só neste navegador. */
function localDb(){
 let store={};try{store=JSON.parse(localStorage.getItem("erp3d")||"{}")}catch(e){}
 const subs=[],cp=o=>JSON.parse(JSON.stringify(o));
 const save=()=>{try{localStorage.setItem("erp3d",JSON.stringify(store))}catch(e){toast("Não foi possível salvar neste navegador.")}};
 const notify=()=>subs.slice().forEach(f=>f());
 const newId=()=>"d"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
 const snapDoc=p=>({id:p.split("/").pop(),exists:store[p]!==undefined,data:()=>store[p]===undefined?undefined:cp(store[p]),metadata:{fromCache:true,hasPendingWrites:false}});
 const listen=(f)=>{subs.push(f);setTimeout(f,0);return()=>{const i=subs.indexOf(f);if(i>=0)subs.splice(i,1)}};
 const docRef=p=>({id:p.split("/").pop(),path:p,
  get:async()=>snapDoc(p),
  set:async d=>{store[p]=cp(d);save();notify()},
  update:async d=>{store[p]={...(store[p]||{}),...cp(d)};save();notify()},
  delete:async()=>{delete store[p];save();notify()},
  onSnapshot:next=>listen(()=>next(snapDoc(p)))});
 const colRef=c=>({path:c,doc:id=>docRef(c+"/"+(id||newId())),
  add:async d=>{const r=docRef(c+"/"+newId());await r.set(d);return r},
  onSnapshot:next=>listen(()=>{const docs=Object.keys(store).filter(k=>k.startsWith(c+"/")&&k.split("/").length===2).map(snapDoc);next({docs,size:docs.length,empty:!docs.length})})});
 return{doc:docRef,collection:colRef}}
const comTempo=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(()=>r(null),ms))]);
(async()=>{
 const [u,d0]=await Promise.all([comTempo((async()=>{try{return await claude.use("user")}catch(e){return null}})(),2500),comTempo((async()=>{try{return await claude.use("db")}catch(e){return null}})(),2500)]);
 try{const me=u&&await u.me();if(me&&me.name)meName=me.name}catch(e){}
 db=d0;
 if(!db){db=localDb();$("header h1").textContent+=" · modo local (dados só neste navegador)"}
 db.doc("config/custos").onSnapshot(s=>{if(s.exists)cfg={...cfg,...s.data()};draw()});
 db.doc("config/impressora").onSnapshot(s=>{if(s.exists)imp=s.data();draw()});
 db.doc("config/ams").onSnapshot(s=>{if(s.exists)ams=s.data();draw()});
 sn("filamentos",a=>{fil=a.sort((x,y)=>x.criado-y.criado);ready=true});sn("movimentos",a=>mov=a);sn("produtos",a=>prod=a.sort((x,y)=>y.ts-x.ts));sn("orcamentos",a=>orc=a);sn("pedidos",a=>ped=a);sn("compras",a=>cmp=a);sn("fin",a=>fin=a);sn("socios",a=>soc=a);
 setTimeout(()=>{ready=true;draw()},4000);
})();
draw();
