# Recuperar acesso administrativo — Método Ocupar

## Atenção ao e-mail
O texto `ocleiagomesgmail.com` **não é um e-mail válido** (falta `@`). O endereço usado nos exemplos abaixo é `ocleiagomes@gmail.com`. Confirme com a profissional antes de executar.

## Publicação
1. Substitua os arquivos do repositório GitHub pelo conteúdo deste pacote, preservando o `wrangler.toml` configurado.
2. Confirme no Cloudflare que o deploy terminou com **Success**. Se houver erro D1 10021, confira o Database ID e se a integração GitHub aponta para o commit correto.
3. No Cloudflare Worker > Settings > Variables and secrets, adicione um Secret temporário `ADMIN_RECOVERY_KEY` com valor aleatório de pelo menos 32 caracteres. Não use `ADMIN_SETUP_KEY` e não publique a chave no GitHub.

## Redefinir credenciais sem apagar clientes
No PowerShell, cole o script abaixo. Ele solicita a nova senha localmente, sem embuti-la no repositório. Digite a senha desejada no prompt (não compartilhe em mensagens).

```powershell
$site = 'https://metodo-ocupar.clecioabtt.workers.dev'
$chave = Read-Host 'ADMIN_RECOVERY_KEY temporaria'
$email = Read-Host 'Email confirmado da Ocleiah (ex.: ocleiagomes@gmail.com)'
$senha = Read-Host 'Nova senha' -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $senha).Password
$body = @{email=$email;password=$plain} | ConvertTo-Json
Invoke-RestMethod -Uri "$site/api/admin/recover" -Method Post -Headers @{'X-Recovery-Key'=$chave} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body))
Remove-Variable plain,body,senha,chave -ErrorAction SilentlyContinue
```

Após `ok: true`, **remova imediatamente `ADMIN_RECOVERY_KEY` do Cloudflare**, e teste o login. A recuperação invalida sessões anteriores e atualiza somente o primeiro usuário administrador ativo. Não apaga dados de clientes.

## Segurança
A senha fornecida no chat deve ser considerada exposta; prefira uma senha exclusiva diferente e altere a chave `ADMIN_SETUP_KEY` que também apareceu em mensagens anteriores. Não execute `schema.sql` novamente nem exclua o banco.
