-- Estrutura inicial do ERP Impressão 3D.
-- Os dados do ERP ficam em "documentos" (coleção + id + JSON), sempre isolados por empresa.

CREATE TABLE empresas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL UNIQUE CHECK (length(nome) BETWEEN 1 AND 120),
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login             text NOT NULL UNIQUE CHECK (login ~ '^[a-z0-9._-]{3,40}$'),
  nome              text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  senha_hash        text NOT NULL,
  ativo             boolean NOT NULL DEFAULT true,
  senha_alterada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_login_em   timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now()
);

-- Permissão de cada usuário em cada empresa.
--   admin   : lê e grava tudo
--   editor  : lê e grava tudo
--   leitura : apenas consulta
CREATE TABLE usuario_empresa (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  papel      text NOT NULL CHECK (papel IN ('admin','editor','leitura')),
  PRIMARY KEY (usuario_id, empresa_id)
);

-- Sessões: o navegador guarda um token aleatório; aqui fica só o SHA-256 dele.
CREATE TABLE sessoes (
  token_hash    bytea PRIMARY KEY,
  usuario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id    uuid REFERENCES empresas(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL,
  ip            text,
  user_agent    text
);
CREATE INDEX sessoes_usuario_idx ON sessoes (usuario_id);
CREATE INDEX sessoes_expira_idx ON sessoes (expira_em);

CREATE TABLE documentos (
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  colecao        text NOT NULL,
  id             text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  dados          jsonb NOT NULL CHECK (jsonb_typeof(dados) = 'object'),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  PRIMARY KEY (empresa_id, colecao, id)
);

-- Histórico de alterações (permite reconstruir um registro apagado por engano).
CREATE TABLE auditoria (
  id         bigserial PRIMARY KEY,
  em         timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  empresa_id uuid REFERENCES empresas(id) ON DELETE SET NULL,
  acao       text NOT NULL,
  colecao    text,
  doc_id     text,
  dados      jsonb,
  ip         text
);
CREATE INDEX auditoria_em_idx ON auditoria (em);
CREATE INDEX auditoria_doc_idx ON auditoria (empresa_id, colecao, doc_id);
