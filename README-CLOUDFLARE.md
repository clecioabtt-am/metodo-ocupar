# Método Ocupar — Cloudflare Workers + D1 + R2

Projeto MVP pronto para GitHub e Cloudflare.

## O que já funciona
- Site público profissional e responsivo
- PWA instalável
- Formulário de leads
- Login seguro com PBKDF2
- Perfis: administradora e cliente
- Painel administrativo
- Cadastro de clientes com acesso individual
- Avaliações comportamentais
- Planos de desenvolvimento
- Agenda de sessões
- Diário profissional do cliente
- Upload/download de documentos em R2 (API pronta)
- D1 como banco de dados

## 1. Subir para o GitHub
1. Crie um repositório novo, por exemplo: `metodo-ocupar`.
2. Extraia o ZIP.
3. Envie TODOS os arquivos e pastas para a raiz do repositório.
4. Confira se `package.json`, `wrangler.toml`, `schema.sql`, `src/` e `public/` estão na raiz.

## 2. Criar o banco D1
No Cloudflare Dashboard:
- Storage & Databases → D1 SQL Database → Create.
- Nome recomendado: `ocupar-db`.
- Copie o `database_id`.
- Abra `wrangler.toml` e substitua `COLE_AQUI_O_DATABASE_ID` pelo ID real.

Depois execute o arquivo `schema.sql` no Console do D1, ou use:

```bash
npx wrangler d1 execute ocupar-db --remote --file=./schema.sql
```

## 3. Criar o R2
- Cloudflare → R2 Object Storage → Create bucket.
- Nome: `ocupar-files`.
- O `wrangler.toml` já usa esse nome.

## 4. Configurar o primeiro administrador
Crie uma variável SECRETA no Worker chamada:

`ADMIN_SETUP_KEY`

Use uma chave forte, por exemplo uma sequência aleatória longa. Não coloque essa chave no GitHub.

Depois do primeiro deploy, crie o administrador via terminal usando:

```bash
curl -X POST "https://SEU-WORKER.workers.dev/api/setup/admin" \
  -H "Content-Type: application/json" \
  -H "X-Setup-Key: SUA_CHAVE_SECRETA" \
  -d '{"name":"Ocleiah Araujo","email":"EMAIL_DA_OCLEIAH","password":"SENHA_FORTE"}'
```

A rota permite criar somente o primeiro administrador. Depois ela se bloqueia automaticamente.

## 5. Deploy pelo Cloudflare Workers Builds
- Workers & Pages → Create → Import a repository.
- Selecione o repositório GitHub.
- Framework preset: None.
- Build command: deixe vazio (ou `npm install`).
- Deploy command: `npx wrangler deploy`.
- Root directory: `/`.

Se preferir usar o terminal:

```bash
npm install
npx wrangler deploy
```

## 6. Variáveis e bindings esperados
O `wrangler.toml` espera:
- D1 binding: `DB`
- R2 binding: `FILES`
- Variável: `APP_NAME`
- Secret: `ADMIN_SETUP_KEY`

## 7. Primeiro teste
Acesse:
- `/api/health` → deve retornar `ok: true`.
- `/api/setup/status` → mostra se o administrador já foi criado.
- Página inicial → formulário de leads e botão Entrar.

## 8. Observações importantes
- Troque os textos, domínio, e-mail e links quando a Ocleiah aprovar o projeto.
- O projeto não depende de Supabase.
- Atualizar o código pelo GitHub NÃO apaga o D1 nem o R2. Os dados ficam persistidos nos serviços Cloudflare.
- Evite apagar/recriar o banco D1 ou o bucket R2 sem backup.

## Próximas evoluções recomendadas
- Questionário comportamental completo com pontuação automática
- Relatórios PDF personalizados
- IA treinada com materiais e metodologia da Ocleiah
- Pagamentos/assinaturas
- Planos corporativos para empresas
- Notificações por e-mail/WhatsApp
- Área de cursos e biblioteca de conteúdo
