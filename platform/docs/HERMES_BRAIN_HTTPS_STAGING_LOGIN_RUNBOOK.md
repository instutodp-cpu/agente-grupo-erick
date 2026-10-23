# Hermes Brain — portal HTTPS mínimo de staging (PR #564)
**Não é a liberação do SaaS nem do Telegram.** Apenas autenticação, proposta pendente e busca RLS.
Reutilizar `hermes-staging.grupoerick.tech`, sem instalar outro proxy.

## Fonte e credenciais
- `brain-web/index.html` e `brain-web/app.js` são somente arquivos públicos estáticos.
- Apenas chave **publishable** do Supabase, deliberadamente pública. Nunca service_role, segredos, tokens em Git/logs.
- SDK oficial UMD v2.83.0 pinado por versão + Subresource Integrity.
- Sessão em memória no navegador (`persistSession:false`): após recarregar, pode exigir novo magic link. Sem cookie compartilhado.
- `getUser()` verifica a sessão no provedor antes de consultar. A autorização efetiva é exclusivamente a RPC SECURITY INVOKER + RLS no PostgreSQL.
- O tenant `grupo_erick` está fixo neste piloto e **não é informado pela IA**; futuras empresas precisarão da escolha de workspace autenticada.

## Instalação no Caddy (staging apenas; revisão humana do diff)
1. Confirmar `GET /health = 200` e que o Caddy existente mantém ingress observação/missão intacto. Fazer backup do Caddyfile.
2. Instalar exatamente `brain-web/index.html` como `/var/www/hermes-brain-staging/brain/index.html` e `brain-web/app.js` como `/var/www/hermes-brain-staging/brain/app.js`; diretórios sem gravação para o usuário do Caddy.
3. No bloco `route` do host `hermes-staging.grupoerick.tech`, antes do `handle` final que responde 404, inserir:

```caddy
@hermes_brain_static {
    method GET
    path /brain/ /brain/app.js
}
handle @hermes_brain_static {
    root * /var/www/hermes-brain-staging
    header Cache-Control "private, no-store"
    header Referrer-Policy "no-referrer"
    header X-Content-Type-Options "nosniff"
    header X-Frame-Options "DENY"
    header Content-Security-Policy "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src https://asceucchdnuoaqgdjbtg.supabase.co; img-src 'self' data:; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
    file_server
}
```

4. Validar Caddyfile offline, recarregar somente após backup e teste; preservar rota 404 para qualquer URL fora da lista.
5. Supabase Auth → URL Configuration: **Site URL** = `https://hermes-staging.grupoerick.tech/brain/` e adicionar **Redirect URL exata** = `https://hermes-staging.grupoerick.tech/brain/`. Nunca definir URL aleatória nem wildcard universal.
6. Verificar em navegador: magic link para conta existente, retorno ao portal, `getUser()` confirmado. Sem membership, RPC não deve permitir propor memória nem revelar dados de outro tenant.
7. Onboarding de `grupo_erick` é **tarefa administrativa separada** com prova out-of-band da identidade, menor privilégio, teste de cross-tenant e trilha auditável. Este portal **não provisiona tenant/membership**, não aprova memórias e não exige serviço privilegiado no frontend.

## Gates
- Sem atualizar produção e sem merge automático.
- Testar `node --test platform/services/api/test/hermes-brain-web-staging.test.js`.
- Registrar HTTP 200 em /brain/, /brain/app.js; 404 em caminhos fora da allowlist.
- Rastrear CI da PR, verificar HEAD antes de alteração da VPS; rollback = restaurar Caddyfile e remover apenas o handle estático.
