'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const { q } = require('./db');

const NOME_COOKIE = config.cookieSeguro ? '__Host-erp3d_sessao' : 'erp3d_sessao';
const hashToken = (t) => crypto.createHash('sha256').update(t).digest();

function lerCookie(req) {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === NOME_COOKIE) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function cookie(valor, maxAgeSeg) {
  return [
    `${NOME_COOKIE}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    config.cookieSeguro ? 'Secure' : null,
    `Max-Age=${maxAgeSeg}`,
  ].filter(Boolean).join('; ');
}

async function criar(res, usuarioId, empresaId, ip, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = config.sessaoMaxDias * 86400;
  await q(
    `INSERT INTO sessoes (token_hash, usuario_id, empresa_id, expira_em, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, $6)`,
    [hashToken(token), usuarioId, empresaId, maxAge, ip, String(userAgent || '').slice(0, 300)],
  );
  res.setHeader('Set-Cookie', cookie(token, maxAge));
}

function limparCookie(res) {
  res.setHeader('Set-Cookie', cookie('', 0));
}

/** Retorna a sessão válida associada ao token (ou null). Renova "ultimo_uso_em" no máximo 1x/minuto. */
async function validarToken(token) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const h = hashToken(token);
  const { rows } = await q(
    `SELECT s.usuario_id, s.empresa_id, s.ultimo_uso_em,
            u.nome, u.login, ue.papel, e.nome AS empresa_nome
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id AND u.ativo
       LEFT JOIN usuario_empresa ue ON ue.usuario_id = s.usuario_id AND ue.empresa_id = s.empresa_id
       LEFT JOIN empresas e ON e.id = s.empresa_id
      WHERE s.token_hash = $1
        AND s.expira_em > now()
        AND s.ultimo_uso_em > now() - make_interval(hours => $2)`,
    [h, config.sessaoInatividadeHoras],
  );
  const s = rows[0];
  if (!s) return null;
  if (Date.now() - new Date(s.ultimo_uso_em).getTime() > 60_000) {
    await q('UPDATE sessoes SET ultimo_uso_em = now() WHERE token_hash = $1', [h]);
  }
  return {
    tokenHash: h,
    usuario: { id: s.usuario_id, nome: s.nome, login: s.login },
    // Sem papel = usuário foi desvinculado da empresa: a sessão continua, mas sem acesso aos dados.
    empresa: s.papel ? { id: s.empresa_id, nome: s.empresa_nome, papel: s.papel } : null,
  };
}

async function encerrar(tokenHash) {
  await q('DELETE FROM sessoes WHERE token_hash = $1', [tokenHash]);
}

async function encerrarTodas(usuarioId) {
  await q('DELETE FROM sessoes WHERE usuario_id = $1', [usuarioId]);
}

async function limparExpiradas() {
  await q(
    `DELETE FROM sessoes WHERE expira_em < now() OR ultimo_uso_em < now() - make_interval(hours => $1)`,
    [config.sessaoInatividadeHoras],
  );
}

module.exports = { lerCookie, criar, limparCookie, validarToken, encerrar, encerrarTodas, limparExpiradas, hashToken };
