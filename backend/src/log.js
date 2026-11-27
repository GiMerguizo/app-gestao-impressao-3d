'use strict';
// Logs em JSON, uma linha por evento, lidos com "docker compose logs backend".
function escrever(nivel, msg, extra) {
  const linha = { t: new Date().toISOString(), nivel, msg, ...extra };
  (nivel === 'erro' ? process.stderr : process.stdout).write(JSON.stringify(linha) + '\n');
}
module.exports = {
  info: (msg, extra) => escrever('info', msg, extra),
  aviso: (msg, extra) => escrever('aviso', msg, extra),
  erro: (msg, extra) => escrever('erro', msg, extra),
};
