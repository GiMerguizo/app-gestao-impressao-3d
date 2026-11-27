'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const log = require('./log');
const { q, pool } = require('./db');
const { migrar } = require('./migrar');
const senhas = require('./senha');
const sessao = require('./sessao');

// Coleções que o frontend pode usar. Qualquer outra é recusada.
const COLECOES = new Set([
  'filamentos', 'movimentos', 'produtos', 'orcamentos', 'pedidos', 'compras', 'fin', 'socios', 'config',
]);
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
const TAM_MAX_DOC = 256 * 1024;

class ErroHttp extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const ipDe = (req) => String(req.headers['x-real-ip'] || req.socket.remoteAddress || '').slice(0, 64);
const novoId = () => 'd' + Date.now().toString(36) + crypto.randomBytes(6).toString('base64url');
const objetoSimples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ---------- Limite de tentativas de login (em memória) ---------- */
const falhas = new Map();
function bloqueado(chave, max) {
  const f = falhas.get(chave);
  if (!f) return false;
  if (Date.now() - f.inicio > config.loginJanelaMin * 60_000) { falhas.delete(chave); return false; }
  return f.n >= max;
}
function registrarFalha(chave) {
  const f = falhas.get(chave);
  if (!f || Date.now() - f.inicio > config.loginJanelaMin * 60_000) falhas.set(chave, { n: 1, inicio: Date.now() });
  else f.n++;
}
setInterval(() => {
  const limite = Date.now() - config.loginJanelaMin * 60_000;
  for (const [k, f] of falhas) if (f.inicio < limite) falhas.delete(k);
}, 60_000).unref();

/* ---------- Auditoria ---------- */
function auditar(req, acao, extra = {}) {
  return q(
    `INSERT INTO auditoria (usuario_id, empresa_id, acao, colecao, doc_id, dados, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [extra.usuarioId ?? req.sessao?.usuario.id ?? null, extra.empresaId ?? req.sessao?.empresa?.id ?? null,
      acao, extra.colecao ?? null, extra.docId ?? null, extra.dados === undefined ? null : JSON.stringify(extra.dados), ipDe(req)],
  ).catch((e) => log.erro('falha ao gravar auditoria', { erro: e.message }));
}

/* ---------- Tempo real (Server-Sent Events) ---------- */
const clientesSse = new Set();
function emitir(empresaId, evento) {
  const msg = `event: change\ndata: ${JSON.stringify(evento)}\n\n`;
  for (const c of clientesSse) if (c.empresaId === empresaId) c.res.write(msg);
}

/* ---------- Middlewares ---------- */
async function exigirSessao(req, res, next) {
  const s = await sessao.validarToken(sessao.lerCookie(req));
  if (!s) { sessao.limparCookie(res); throw new ErroHttp(401, 'Sessão expirada. Entre novamente.'); }
  req.sessao = s;
  next();
}

function exigirEmpresa(req, _res, next) {
  if (!req.sessao.empresa) throw new ErroHttp(403, 'Você não tem acesso a esta empresa.');
  next();
}

function exigirEscrita(req, _res, next) {
  if (!['admin', 'editor'].includes(req.sessao.empresa?.papel)) throw new ErroHttp(403, 'Seu usuário tem permissão apenas de leitura.');
  next();
}

// Proteção contra CSRF: além do cookie SameSite=Strict, toda requisição que altera dados
// precisa do cabeçalho X-ERP3D (navegadores não o enviam em requisições de outros sites sem CORS).
function exigirCabecalhoApp(req, _res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-erp3d') !== '1') {
    throw new ErroHttp(403, 'Requisição recusada.');
  }
  next();
}

function validarColecao(req) {
  const { col, id } = req.params;
  if (!COLECOES.has(col)) throw new ErroHttp(404, 'Coleção desconhecida.');
  if (id !== undefined && !ID_OK.test(id)) throw new ErroHttp(400, 'Identificador inválido.');
  return { col, id };
}

function validarDados(body) {
  const dados = body?.data;
  if (!objetoSimples(dados)) throw new ErroHttp(400, 'Envie um objeto em "data".');
  if (Buffer.byteLength(JSON.stringify(dados)) > TAM_MAX_DOC) throw new ErroHttp(413, 'Registro grande demais.');
  return dados;
}

/* ---------- Aplicação ---------- */
function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use((req, res, next) => {
    const inicio = process.hrtime.bigint();
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      if (req.path === '/api/health') return;
      log.info('req', {
        metodo: req.method, rota: req.path, status: res.statusCode,
        ms: Number((process.hrtime.bigint() - inicio) / 1_000_000n), usuario: req.sessao?.usuario.login, ip: ipDe(req),
      });
    });
    next();
  });

  app.use(express.json({ limit: '512kb' }));
  app.use('/api', exigirCabecalhoApp);

  app.get('/api/health', async (_req, res) => {
    try {
      await q('SELECT 1');
      res.json({ app: 'erp3d', ok: true, db: true });
    } catch {
      res.status(503).json({ app: 'erp3d', ok: false, db: false });
    }
  });

  /* ----- Autenticação ----- */
  app.post('/api/auth/login', async (req, res) => {
    const login = String(req.body?.login ?? '').trim().toLowerCase().slice(0, 40);
    const senha = String(req.body?.senha ?? '');
    const ip = ipDe(req);
    if (!login || !senha || senha.length > 200) throw new ErroHttp(400, 'Informe usuário e senha.');
    if (bloqueado('ip:' + ip, config.loginMaxFalhasIp) || bloqueado('login:' + login, config.loginMaxFalhasUsuario)) {
      throw new ErroHttp(429, `Muitas tentativas. Aguarde ${config.loginJanelaMin} minutos.`);
    }

    const { rows } = await q('SELECT id, nome, login, senha_hash, ativo FROM usuarios WHERE login = $1', [login]);
    const u = rows[0];
    const ok = u ? await senhas.verificar(senha, u.senha_hash) : (await senhas.verificar(senha, await senhas.hashFicticio()), false);
    if (!ok || !u.ativo) {
      registrarFalha('ip:' + ip);
      registrarFalha('login:' + login);
      log.aviso('login recusado', { login, ip });
      await auditar(req, 'login_falhou', { usuarioId: u?.id ?? null, dados: { login } });
      throw new ErroHttp(401, 'Usuário ou senha inválidos.');
    }

    const emp = await q(
      `SELECT e.id FROM usuario_empresa ue JOIN empresas e ON e.id = ue.empresa_id
        WHERE ue.usuario_id = $1 ORDER BY e.nome LIMIT 1`, [u.id]);
    if (!emp.rows[0]) throw new ErroHttp(403, 'Usuário sem empresa vinculada. Fale com o administrador.');

    falhas.delete('login:' + login);
    await sessao.criar(res, u.id, emp.rows[0].id, ip, req.get('user-agent'));
    await q('UPDATE usuarios SET ultimo_login_em = now() WHERE id = $1', [u.id]);
    await auditar(req, 'login', { usuarioId: u.id, empresaId: emp.rows[0].id });
    sessao.limparExpiradas().catch(() => {});
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', exigirSessao, async (req, res) => {
    await sessao.encerrar(req.sessao.tokenHash);
    await auditar(req, 'logout');
    sessao.limparCookie(res);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout-todos', exigirSessao, async (req, res) => {
    await sessao.encerrarTodas(req.sessao.usuario.id);
    await auditar(req, 'logout_todos');
    sessao.limparCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', exigirSessao, async (req, res) => {
    const { rows } = await q(
      `SELECT e.id, e.nome, ue.papel FROM usuario_empresa ue JOIN empresas e ON e.id = ue.empresa_id
        WHERE ue.usuario_id = $1 ORDER BY e.nome`, [req.sessao.usuario.id]);
    res.json({ usuario: { nome: req.sessao.usuario.nome, login: req.sessao.usuario.login }, empresa: req.sessao.empresa, empresas: rows });
  });

  app.post('/api/auth/empresa', exigirSessao, async (req, res) => {
    const empresaId = String(req.body?.empresaId ?? '');
    const { rows } = await q(
      'SELECT 1 FROM usuario_empresa WHERE usuario_id = $1 AND empresa_id::text = $2', [req.sessao.usuario.id, empresaId]);
    if (!rows[0]) throw new ErroHttp(403, 'Você não tem acesso a esta empresa.');
    await q('UPDATE sessoes SET empresa_id = $1 WHERE token_hash = $2', [empresaId, req.sessao.tokenHash]);
    res.json({ ok: true });
  });

  app.post('/api/auth/senha', exigirSessao, async (req, res) => {
    const atual = String(req.body?.atual ?? '');
    const nova = String(req.body?.nova ?? '');
    const { rows } = await q('SELECT senha_hash FROM usuarios WHERE id = $1', [req.sessao.usuario.id]);
    if (!rows[0] || !(await senhas.verificar(atual, rows[0].senha_hash))) throw new ErroHttp(400, 'Senha atual incorreta.');
    const problema = senhas.validarForca(nova, req.sessao.usuario.login);
    if (problema) throw new ErroHttp(400, problema);
    await q('UPDATE usuarios SET senha_hash = $1, senha_alterada_em = now() WHERE id = $2',
      [await senhas.gerarHash(nova), req.sessao.usuario.id]);
    // Encerra as outras sessões; mantém a atual.
    await q('DELETE FROM sessoes WHERE usuario_id = $1 AND token_hash <> $2', [req.sessao.usuario.id, req.sessao.tokenHash]);
    await auditar(req, 'senha_alterada');
    res.json({ ok: true });
  });

  /* ----- Dados do ERP ----- */
  const dados = express.Router();
  dados.use(exigirSessao, exigirEmpresa);

  dados.get('/:col', async (req, res) => {
    const { col } = validarColecao(req);
    const { rows } = await q(
      'SELECT id, dados FROM documentos WHERE empresa_id = $1 AND colecao = $2 ORDER BY criado_em, id',
      [req.sessao.empresa.id, col]);
    res.json(rows.map((r) => ({ id: r.id, data: r.dados })));
  });

  dados.get('/:col/:id', async (req, res) => {
    const { col, id } = validarColecao(req);
    const { rows } = await q('SELECT dados FROM documentos WHERE empresa_id = $1 AND colecao = $2 AND id = $3',
      [req.sessao.empresa.id, col, id]);
    res.json({ id, exists: !!rows[0], data: rows[0]?.dados ?? null });
  });

  async function gravar(req, col, id, d, mesclar) {
    const emp = req.sessao.empresa.id;
    const { rows } = await q(
      `INSERT INTO documentos (empresa_id, colecao, id, dados, atualizado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (empresa_id, colecao, id) DO UPDATE
         SET dados = ${mesclar ? 'documentos.dados || EXCLUDED.dados' : 'EXCLUDED.dados'},
             atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por
       RETURNING dados`,
      [emp, col, id, JSON.stringify(d), req.sessao.usuario.id]);
    const final = rows[0].dados;
    await auditar(req, mesclar ? 'atualizar' : 'gravar', { colecao: col, docId: id, dados: final });
    emitir(emp, { col, id, data: final });
    return final;
  }

  dados.post('/:col', exigirEscrita, async (req, res) => {
    const { col } = validarColecao(req);
    const id = novoId();
    res.status(201).json({ id, data: await gravar(req, col, id, validarDados(req.body), false) });
  });

  dados.put('/:col/:id', exigirEscrita, async (req, res) => {
    const { col, id } = validarColecao(req);
    res.json({ id, data: await gravar(req, col, id, validarDados(req.body), false) });
  });

  dados.patch('/:col/:id', exigirEscrita, async (req, res) => {
    const { col, id } = validarColecao(req);
    res.json({ id, data: await gravar(req, col, id, validarDados(req.body), true) });
  });

  dados.delete('/:col/:id', exigirEscrita, async (req, res) => {
    const { col, id } = validarColecao(req);
    const emp = req.sessao.empresa.id;
    const { rows } = await q('DELETE FROM documentos WHERE empresa_id = $1 AND colecao = $2 AND id = $3 RETURNING dados',
      [emp, col, id]);
    if (rows[0]) {
      await auditar(req, 'excluir', { colecao: col, docId: id, dados: rows[0].dados });
      emitir(emp, { col, id, data: null });
    }
    res.json({ ok: true });
  });

  app.use('/api/docs', dados);

  /* ----- Atualizações em tempo real ----- */
  app.get('/api/stream', exigirSessao, exigirEmpresa, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\nevent: ready\ndata: {}\n\n');
    const cliente = { res, empresaId: req.sessao.empresa.id, tokenHash: req.sessao.tokenHash };
    clientesSse.add(cliente);
    // Batimento a cada 25 s; aproveita para conferir se a sessão continua válida.
    const pulso = setInterval(async () => {
      const ainda = await q('SELECT 1 FROM sessoes WHERE token_hash = $1 AND expira_em > now()', [cliente.tokenHash]).catch(() => null);
      if (ainda && !ainda.rows[0]) { res.write('event: sessao\ndata: {}\n\n'); res.end(); return; }
      res.write(': pulso\n\n');
    }, 25_000);
    req.on('close', () => { clearInterval(pulso); clientesSse.delete(cliente); });
  });

  app.use('/api', (_req, _res, next) => next(new ErroHttp(404, 'Rota não encontrada.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let msg = err instanceof ErroHttp ? err.message : 'Erro interno.';
    if (err.type === 'entity.parse.failed') msg = 'JSON inválido.';
    if (err.type === 'entity.too.large') { status = 413; msg = 'Requisição grande demais.'; }
    if (status >= 500) log.erro('erro na requisição', { rota: req.path, erro: err.message, stack: err.stack });
    if (!res.headersSent) res.status(status).json({ erro: msg });
  });

  return app;
}

async function iniciar() {
  // Aguarda o banco (útil logo após o boot do notebook).
  for (let i = 1; ; i++) {
    try { await q('SELECT 1'); break; } catch (e) {
      if (i >= 30) throw e;
      log.aviso('aguardando PostgreSQL', { tentativa: i, erro: e.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await migrar();
  const srv = criarApp().listen(config.porta, () => log.info('backend no ar', { porta: config.porta }));
  const sair = (sinal) => {
    log.info('encerrando', { sinal });
    for (const c of clientesSse) c.res.end();
    srv.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', sair);
  process.on('SIGINT', sair);
}

if (require.main === module) {
  iniciar().catch((e) => { log.erro('falha ao iniciar', { erro: e.message }); process.exit(1); });
}

module.exports = { criarApp, COLECOES };
