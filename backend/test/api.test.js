'use strict';
/*
 * Teste de integração da API. Precisa de um PostgreSQL descartável:
 *   docker run -d --name pgtest -e POSTGRES_USER=erp3d -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=erp3d \
 *     -p 127.0.0.1:55432:5432 postgres:17-alpine
 *   DB_HOST=127.0.0.1 DB_PORT=55432 DB_PASSWORD=teste COOKIE_SECURE=false npm test
 * NUNCA aponte para o banco de produção: o teste apaga as tabelas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.COOKIE_SECURE = 'false';
const { q, pool } = require('../src/db');
const { migrar } = require('../src/migrar');
const senhas = require('../src/senha');
const { criarApp } = require('../src/server');

let base, srv;

async function chamar(metodo, caminho, { corpo, cookie, semCabecalho } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (!semCabecalho) h['X-ERP3D'] = '1';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(base + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
  const texto = await r.text();
  return { status: r.status, json: texto ? JSON.parse(texto) : null, setCookie: r.headers.get('set-cookie') };
}

async function entrar(login, senha) {
  const r = await chamar('POST', '/api/auth/login', { corpo: { login, senha } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.setCookie.split(';')[0];
}

test.before(async () => {
  const { rows } = await q('SELECT current_database() AS d');
  if (rows[0].d !== 'erp3d' || process.env.DB_HOST === 'db') throw new Error('Use um banco de teste descartável.');
  await q('DROP TABLE IF EXISTS auditoria, documentos, sessoes, usuario_empresa, usuarios, empresas, schema_migrations CASCADE');
  await migrar();
  const e1 = (await q(`INSERT INTO empresas (nome) VALUES ('A') RETURNING id`)).rows[0].id;
  const e2 = (await q(`INSERT INTO empresas (nome) VALUES ('B') RETURNING id`)).rows[0].id;
  const h = await senhas.gerarHash('senha-de-teste-1');
  const ins = async (login, emp, papel) => {
    const id = (await q('INSERT INTO usuarios (login, nome, senha_hash) VALUES ($1, $1, $2) RETURNING id', [login, h])).rows[0].id;
    await q('INSERT INTO usuario_empresa VALUES ($1, $2, $3)', [id, emp, papel]);
  };
  await ins('ana', e1, 'admin');
  await ins('bia', e1, 'leitura');
  await ins('caio', e2, 'editor');
  await new Promise((r) => { srv = criarApp().listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});

test.after(async () => { srv.close(); await pool.end(); });

test('health', async () => {
  const r = await chamar('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.app, 'erp3d');
});

test('rotas de dados exigem sessão', async () => {
  assert.equal((await chamar('GET', '/api/docs/filamentos')).status, 401);
  assert.equal((await chamar('GET', '/api/auth/me')).status, 401);
});

test('login com senha errada falha de forma genérica', async () => {
  const r1 = await chamar('POST', '/api/auth/login', { corpo: { login: 'ana', senha: 'errada-errada' } });
  const r2 = await chamar('POST', '/api/auth/login', { corpo: { login: 'ninguem', senha: 'errada-errada' } });
  assert.equal(r1.status, 401);
  assert.equal(r2.status, 401);
  assert.equal(r1.json.erro, r2.json.erro);
});

test('cookie de sessão é HttpOnly e SameSite=Strict', async () => {
  const r = await chamar('POST', '/api/auth/login', { corpo: { login: 'ana', senha: 'senha-de-teste-1' } });
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Strict/);
});

test('requisição de escrita sem cabeçalho X-ERP3D é recusada (CSRF)', async () => {
  const c = await entrar('ana', 'senha-de-teste-1');
  const r = await chamar('POST', '/api/docs/filamentos', { cookie: c, corpo: { data: { nome: 'x' } }, semCabecalho: true });
  assert.equal(r.status, 403);
});

test('CRUD, merge e isolamento entre empresas', async () => {
  const ana = await entrar('ana', 'senha-de-teste-1');
  const caio = await entrar('caio', 'senha-de-teste-1');

  const me = await chamar('GET', '/api/auth/me', { cookie: ana });
  assert.equal(me.json.empresa.nome, 'A');

  const novo = await chamar('POST', '/api/docs/filamentos', { cookie: ana, corpo: { data: { nome: 'PLA', atual: 1000 } } });
  assert.equal(novo.status, 201);
  const id = novo.json.id;

  const up = await chamar('PATCH', `/api/docs/filamentos/${id}`, { cookie: ana, corpo: { data: { atual: 800 } } });
  assert.deepEqual(up.json.data, { nome: 'PLA', atual: 800 });

  await chamar('PUT', '/api/docs/config/custos', { cookie: ana, corpo: { data: { kwh: 1.1 } } });
  assert.equal((await chamar('GET', '/api/docs/config/custos', { cookie: ana })).json.data.kwh, 1.1);

  // Empresa B não enxerga nem altera dados da empresa A.
  assert.equal((await chamar('GET', '/api/docs/filamentos', { cookie: caio })).json.length, 0);
  await chamar('PATCH', `/api/docs/filamentos/${id}`, { cookie: caio, corpo: { data: { atual: 0 } } });
  assert.equal((await chamar('GET', `/api/docs/filamentos/${id}`, { cookie: ana })).json.data.atual, 800);

  const del = await chamar('DELETE', `/api/docs/filamentos/${id}`, { cookie: ana });
  assert.equal(del.status, 200);
  assert.equal((await chamar('GET', `/api/docs/filamentos/${id}`, { cookie: ana })).json.exists, false);

  // O PATCH do caio cria um registro na empresa B (upsert), nunca altera o da empresa A.
  const aud = await q(
    `SELECT a.acao FROM auditoria a JOIN empresas e ON e.id = a.empresa_id WHERE a.doc_id = $1 AND e.nome = 'A' ORDER BY a.id`, [id]);
  assert.deepEqual(aud.rows.map((r) => r.acao), ['gravar', 'atualizar', 'excluir']);
});

test('papel leitura não grava', async () => {
  const bia = await entrar('bia', 'senha-de-teste-1');
  assert.equal((await chamar('GET', '/api/docs/filamentos', { cookie: bia })).status, 200);
  assert.equal((await chamar('POST', '/api/docs/filamentos', { cookie: bia, corpo: { data: { a: 1 } } })).status, 403);
});

test('validação de coleção, id e corpo', async () => {
  const ana = await entrar('ana', 'senha-de-teste-1');
  assert.equal((await chamar('GET', '/api/docs/usuarios', { cookie: ana })).status, 404);
  assert.equal((await chamar('GET', '/api/docs/filamentos/a.b', { cookie: ana })).status, 400);
  assert.equal((await chamar('POST', '/api/docs/filamentos', { cookie: ana, corpo: { data: [1] } })).status, 400);
});

test('logout invalida a sessão', async () => {
  const c = await entrar('ana', 'senha-de-teste-1');
  assert.equal((await chamar('POST', '/api/auth/logout', { cookie: c })).status, 200);
  assert.equal((await chamar('GET', '/api/auth/me', { cookie: c })).status, 401);
});

test('troca de senha encerra outras sessões', async () => {
  const c1 = await entrar('caio', 'senha-de-teste-1');
  const c2 = await entrar('caio', 'senha-de-teste-1');
  const r = await chamar('POST', '/api/auth/senha', { cookie: c1, corpo: { atual: 'senha-de-teste-1', nova: 'nova-senha-longa-2' } });
  assert.equal(r.status, 200);
  assert.equal((await chamar('GET', '/api/auth/me', { cookie: c1 })).status, 200);
  assert.equal((await chamar('GET', '/api/auth/me', { cookie: c2 })).status, 401);
});

test('bloqueio após muitas falhas de login', async () => {
  let ultimo;
  for (let i = 0; i < 10; i++) ultimo = await chamar('POST', '/api/auth/login', { corpo: { login: 'bia', senha: 'errada-' + i } });
  assert.equal(ultimo.status, 429);
});
