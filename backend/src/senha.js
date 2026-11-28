'use strict';
// Hash de senha com scrypt (memória-intensivo, recomendado pela OWASP), sem dependências nativas.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const N = 2 ** 15, R = 8, P = 1, TAM = 64;
const memoria = (n, r) => 128 * n * r * 2;

async function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const h = await scrypt(String(senha).normalize('NFKC'), sal, TAM, { N, r: R, p: P, maxmem: memoria(N, R) });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${h.toString('base64')}`;
}

async function verificar(senha, armazenado) {
  const partes = String(armazenado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [n, r, p] = partes.slice(1, 4).map(Number);
  const sal = Buffer.from(partes[4], 'base64');
  const esperado = Buffer.from(partes[5], 'base64');
  const h = await scrypt(String(senha).normalize('NFKC'), sal, esperado.length, { N: n, r, p, maxmem: memoria(n, r) });
  return crypto.timingSafeEqual(h, esperado);
}

/** Regras mínimas: 10+ caracteres e não conter o login. */
function validarForca(senha, login) {
  if (typeof senha !== 'string' || senha.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (senha !== senha.trim()) return 'A senha não pode começar nem terminar com espaço.';
  if (senha.length > 200) return 'A senha é longa demais (máximo 200 caracteres).';
  if (login && senha.toLowerCase().includes(String(login).toLowerCase())) return 'A senha não pode conter o login.';
  return null;
}

// Hash usado quando o login não existe, para o tempo de resposta não revelar quais logins são válidos.
let ficticio = null;
async function hashFicticio() {
  if (!ficticio) ficticio = await gerarHash(crypto.randomBytes(16).toString('hex'));
  return ficticio;
}

module.exports = { gerarHash, verificar, validarForca, hashFicticio };
