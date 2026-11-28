'use strict';
const { Pool } = require('pg');
const config = require('./config');
const log = require('./log');

if (!config.db.password) throw new Error('Senha do banco ausente (defina DB_PASSWORD_FILE ou DB_PASSWORD).');

const pool = new Pool(config.db);
pool.on('error', (e) => log.erro('erro no pool do PostgreSQL', { erro: e.message }));

const q = (texto, params) => pool.query(texto, params);

async function transacao(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { pool, q, transacao };
