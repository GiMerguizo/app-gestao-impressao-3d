'use strict';
/*
 * Administração pelo terminal do servidor (não existe painel administrativo na web).
 * Uso:  docker compose exec backend node src/cli.js <comando> [argumentos]
 */
const fs = require('node:fs');
const readline = require('node:readline');
const { q, pool, transacao } = require('./db');
const { migrar } = require('./migrar');
const senhas = require('./senha');
const { COLECOES } = require('./server');

const AJUDA = `
Comandos:
  empresa:criar "<nome>"
  empresa:listar
  usuario:criar <login> "<nome>" "<empresa>" [admin|editor|leitura]   (padrão: admin)
  usuario:listar
  usuario:senha <login>                 redefine a senha e encerra as sessões
  usuario:vincular <login> "<empresa>" <admin|editor|leitura>
  usuario:desvincular <login> "<empresa>"
  usuario:desativar <login>             bloqueia o acesso e encerra as sessões
  usuario:ativar <login>
  sessoes:listar
  sessoes:encerrar <login>
  auditoria [quantidade]                últimos eventos (padrão 30)
  dados:importar "<empresa>" < arquivo.json
        importa o conteúdo do localStorage "erp3d" do modo local (navegador)

A senha é pedida no terminal (use "docker compose exec", com -it implícito).
Sem terminal interativo, é lida da primeira linha da entrada padrão.
`;

function falhar(msg) { console.error('Erro: ' + msg); process.exit(1); }

function lerSenhaOculta(pergunta) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', (l) => { resolve(l); rl.close(); });
      rl.once('close', () => resolve(''));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(pergunta)) process.stdout.write(s); };
    rl.question(pergunta, (r) => { rl.close(); process.stdout.write('\n'); resolve(r); });
  });
}

async function pedirSenhaNova(login) {
  const s1 = await lerSenhaOculta('Nova senha: ');
  const problema = senhas.validarForca(s1, login);
  if (problema) falhar(problema);
  if (process.stdin.isTTY) {
    const s2 = await lerSenhaOculta('Repita a senha: ');
    if (s1 !== s2) falhar('As senhas não conferem.');
  }
  return senhas.gerarHash(s1);
}

async function empresaPorNome(nome) {
  const { rows } = await q('SELECT id FROM empresas WHERE nome = $1', [nome]);
  if (!rows[0]) falhar(`Empresa "${nome}" não encontrada. Use empresa:listar.`);
  return rows[0].id;
}

async function usuarioPorLogin(login) {
  const { rows } = await q('SELECT id FROM usuarios WHERE login = $1', [String(login || '').toLowerCase()]);
  if (!rows[0]) falhar(`Usuário "${login}" não encontrado. Use usuario:listar.`);
  return rows[0].id;
}

function papelValido(p) {
  if (!['admin', 'editor', 'leitura'].includes(p)) falhar('Papel deve ser admin, editor ou leitura.');
  return p;
}

const comandos = {
  async 'empresa:criar'(nome) {
    if (!nome) falhar('Informe o nome da empresa.');
    await q('INSERT INTO empresas (nome) VALUES ($1)', [nome]);
    console.log(`Empresa "${nome}" criada.`);
  },
  async 'empresa:listar'() {
    const { rows } = await q('SELECT nome, criado_em FROM empresas ORDER BY nome');
    console.table(rows);
  },
  async 'usuario:criar'(login, nome, empresa, papel = 'admin') {
    login = String(login || '').toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(login)) falhar('Login deve ter 3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou _.');
    if (!nome || !empresa) falhar('Uso: usuario:criar <login> "<nome>" "<empresa>" [papel]');
    const empId = await empresaPorNome(empresa);
    papelValido(papel);
    const hash = await pedirSenhaNova(login);
    await transacao(async (c) => {
      const { rows } = await c.query('INSERT INTO usuarios (login, nome, senha_hash) VALUES ($1, $2, $3) RETURNING id', [login, nome, hash]);
      await c.query('INSERT INTO usuario_empresa (usuario_id, empresa_id, papel) VALUES ($1, $2, $3)', [rows[0].id, empId, papel]);
      await c.query(`INSERT INTO auditoria (usuario_id, empresa_id, acao) VALUES ($1, $2, 'usuario_criado_cli')`, [rows[0].id, empId]);
    });
    console.log(`Usuário "${login}" criado com papel ${papel} em "${empresa}".`);
  },
  async 'usuario:listar'() {
    const { rows } = await q(
      `SELECT u.login, u.nome, u.ativo, u.ultimo_login_em,
              coalesce(string_agg(e.nome || ' (' || ue.papel || ')', ', ' ORDER BY e.nome), '—') AS empresas
         FROM usuarios u LEFT JOIN usuario_empresa ue ON ue.usuario_id = u.id LEFT JOIN empresas e ON e.id = ue.empresa_id
        GROUP BY u.id ORDER BY u.login`);
    console.table(rows);
  },
  async 'usuario:senha'(login) {
    const id = await usuarioPorLogin(login);
    const hash = await pedirSenhaNova(login);
    await q('UPDATE usuarios SET senha_hash = $1, senha_alterada_em = now() WHERE id = $2', [hash, id]);
    await q('DELETE FROM sessoes WHERE usuario_id = $1', [id]);
    await q(`INSERT INTO auditoria (usuario_id, acao) VALUES ($1, 'senha_redefinida_cli')`, [id]);
    console.log('Senha redefinida. Sessões abertas foram encerradas.');
  },
  async 'usuario:vincular'(login, empresa, papel) {
    const id = await usuarioPorLogin(login);
    const empId = await empresaPorNome(empresa);
    papelValido(papel);
    await q(`INSERT INTO usuario_empresa (usuario_id, empresa_id, papel) VALUES ($1, $2, $3)
             ON CONFLICT (usuario_id, empresa_id) DO UPDATE SET papel = EXCLUDED.papel`, [id, empId, papel]);
    console.log(`"${login}" agora é ${papel} em "${empresa}".`);
  },
  async 'usuario:desvincular'(login, empresa) {
    const id = await usuarioPorLogin(login);
    const empId = await empresaPorNome(empresa);
    await q('DELETE FROM usuario_empresa WHERE usuario_id = $1 AND empresa_id = $2', [id, empId]);
    console.log(`"${login}" não tem mais acesso a "${empresa}".`);
  },
  async 'usuario:desativar'(login) {
    const id = await usuarioPorLogin(login);
    await q('UPDATE usuarios SET ativo = false WHERE id = $1', [id]);
    await q('DELETE FROM sessoes WHERE usuario_id = $1', [id]);
    console.log(`"${login}" desativado e desconectado.`);
  },
  async 'usuario:ativar'(login) {
    const id = await usuarioPorLogin(login);
    await q('UPDATE usuarios SET ativo = true WHERE id = $1', [id]);
    console.log(`"${login}" reativado.`);
  },
  async 'sessoes:listar'() {
    const { rows } = await q(
      `SELECT u.login, s.criado_em, s.ultimo_uso_em, s.expira_em, s.ip, left(s.user_agent, 60) AS navegador
         FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id ORDER BY s.ultimo_uso_em DESC`);
    console.table(rows);
  },
  async 'sessoes:encerrar'(login) {
    const id = await usuarioPorLogin(login);
    const r = await q('DELETE FROM sessoes WHERE usuario_id = $1', [id]);
    console.log(`${r.rowCount} sessão(ões) encerrada(s).`);
  },
  async auditoria(qtd = '30') {
    const { rows } = await q(
      `SELECT a.em, u.login, a.acao, a.colecao, a.doc_id, a.ip
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT $1`, [Number(qtd) || 30]);
    console.table(rows);
  },
  async 'dados:importar'(empresa) {
    if (!empresa) falhar('Uso: dados:importar "<empresa>" < arquivo.json');
    const empId = await empresaPorNome(empresa);
    const texto = fs.readFileSync(0, 'utf8');
    let store;
    try { store = JSON.parse(texto); } catch { falhar('O arquivo não é um JSON válido.'); }
    // O export pode vir como string JSON (copy(localStorage.getItem("erp3d"))) ou já como objeto.
    if (typeof store === 'string') store = JSON.parse(store);
    let n = 0, ignorados = 0;
    await transacao(async (c) => {
      for (const [caminho, dados] of Object.entries(store)) {
        const [col, id, ...resto] = caminho.split('/');
        if (resto.length || !COLECOES.has(col) || !/^[A-Za-z0-9_-]{1,64}$/.test(id || '') || !dados || typeof dados !== 'object' || Array.isArray(dados)) {
          ignorados++; continue;
        }
        await c.query(
          `INSERT INTO documentos (empresa_id, colecao, id, dados) VALUES ($1, $2, $3, $4)
           ON CONFLICT (empresa_id, colecao, id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()`,
          [empId, col, id, JSON.stringify(dados)]);
        n++;
      }
      await c.query(`INSERT INTO auditoria (empresa_id, acao, dados) VALUES ($1, 'importacao_cli', $2)`,
        [empId, JSON.stringify({ importados: n, ignorados })]);
    });
    console.log(`${n} registro(s) importado(s), ${ignorados} ignorado(s). Peça para os usuários recarregarem a página.`);
  },
};

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || !comandos[cmd]) { console.log(AJUDA); process.exit(cmd ? 1 : 0); }
  await migrar();
  await comandos[cmd](...args);
  await pool.end();
})().catch((e) => {
  if (e.code === '23505') console.error('Erro: já existe um registro com esse nome/login.');
  else console.error('Erro: ' + e.message);
  process.exit(1);
});
