# Método Ocupar — Atualização para demonstração

## Antes de publicar
1. Faça backup do banco D1 atual e mantenha cópia do repositório anterior.
2. Substitua no GitHub os arquivos do projeto pelos deste ZIP (use os arquivos da raiz, não a pasta ZIP inteira).
3. Confirme no `wrangler.toml` o `database_id` do D1 atual e o nome exato do bucket R2. Este pacote utiliza `ocupar-db` e `ocupar-filess`, conforme a configuração mostrada.
4. No Cloudflare D1 > ocupar-db > Studio, execute **uma vez** o conteúdo de `MIGRACAO-D1.sql`. NÃO execute `schema.sql` inteiro como substituição do banco.
5. No Worker > Settings > Variables and secrets, crie `GEMINI_API_KEY` como **Secret** para habilitar a análise por IA. Nunca coloque a chave no GitHub. A API Gemini pode exigir faturamento/cotas e o modelo configurado precisa estar disponível para sua chave.
6. Faça deploy do Worker (comando `npx wrangler deploy`), confira bindings DB e FILES e teste.
7. Abra em janela anônima, entre com a conta da Ocleiah, vá em Configurações e personalize as cores e a foto. Na ficha de um cliente, clique em Questionário interativo, gere o link, responda e depois use Analisar com IA e revise o parecer.

## Importante
- A análise de IA é uma síntese exploratória de respostas abertas, NÃO diagnóstico clínico, teste psicométrico ou avaliação profissional automatizada.
- Obtenha consentimento informado para o tratamento e envio das respostas à API de IA; evite dados sensíveis. Antes de uso comercial, implemente política de privacidade, retenção/exclusão de dados, auditoria e revisão de segurança.
- Este pacote é uma atualização funcional de demonstração, não um sistema integralmente auditado para produção.
- Os links de questionário são individuais, mas quem possuir o link poderá responder; compartilhe-os de forma privada.
- Se a foto não aparecer imediatamente, recarregue a página (cache de até 5 minutos).
- Os dados existentes do D1 não são apagados por esta migração aditiva. Confirme que o Worker continua apontando para o MESMO banco.
