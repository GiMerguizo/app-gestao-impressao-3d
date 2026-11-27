'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./db');
const log = require('./log');

const DIR = path.join(__dirname, '..', 'migrations');

/** Aplica, em ordem e uma única vez, os arquivos .sql de migrations/. */
async function migrar() {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(424242)');
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nome text PRIMARY KEY, aplicado_em timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await c.query('SELECT nome FROM schema_migrations');
    const feitas = new Set(rows.map((r) => r.nome));
    const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const arq of arquivos) {
      if (feitas.has(arq)) continue;
      const sql = fs.readFileSync(path.join(DIR, arq), 'utf8');
      log.info('aplicando migração', { arquivo: arq });
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arq]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Falha na migração ${arq}: ${e.message}`);
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    c.release();
  }
}

module.exports = { migrar };
