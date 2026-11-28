'use strict';
const fs = require('node:fs');

/** Lê um segredo de NOME_FILE (Docker secrets) ou, na falta, de NOME. */
function segredo(nome) {
  const arquivo = process.env[`${nome}_FILE`];
  if (arquivo) return fs.readFileSync(arquivo, 'utf8').trim();
  return process.env[nome];
}

const env = process.env;
const numero = (v, padrao) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : padrao);

module.exports = {
  porta: numero(env.PORT, 3000),
  db: {
    host: env.DB_HOST || 'db',
    port: numero(env.DB_PORT, 5432),
    database: env.DB_NAME || 'erp3d',
    user: env.DB_USER || 'erp3d',
    password: segredo('DB_PASSWORD'),
    max: numero(env.DB_POOL_MAX, 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'erp3d-backend',
  },
  // Cookie "Secure" exige HTTPS (tailscale serve). Só desligue se usar HTTP puro dentro da tailnet.
  cookieSeguro: env.COOKIE_SECURE !== 'false',
  sessaoInatividadeHoras: numero(env.SESSAO_INATIVIDADE_HORAS, 72),
  sessaoMaxDias: numero(env.SESSAO_MAX_DIAS, 30),
  loginMaxFalhasUsuario: numero(env.LOGIN_MAX_FALHAS_USUARIO, 8),
  loginMaxFalhasIp: numero(env.LOGIN_MAX_FALHAS_IP, 20),
  loginJanelaMin: numero(env.LOGIN_JANELA_MIN, 15),
};
