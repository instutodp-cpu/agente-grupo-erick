'use strict';
/* Staging-only browser pilot. No service role; JWT/tenant membership + RLS own authorization. */
(function () {
  const script = document.currentScript || document.querySelector('script[data-publishable-key]');
  const status = document.getElementById('status');
  const loginArea = document.getElementById('loginArea');
  const workspace = document.getElementById('workspace');
  const who = document.getElementById('who');
  const results = document.getElementById('results');
  const redirect = 'https://hermes-staging.grupoerick.tech/brain/';
  const tenant = 'grupo_erick';
  function message(text) { status.textContent = text; }
  function friendly(err) {
    const code = String(err && err.code || '');
    if (code === '42501' || code === 'PGRST301' || code === '425P01') return 'Acesso não autorizado ou vínculo ao espaço ainda pendente.';
    return 'Operação não concluída. Verifique a sessão, o vínculo ao Grupo Erick e tente novamente.';
  }
  if (location.origin !== 'https://hermes-staging.grupoerick.tech' ||
      !script || !window.supabase || typeof window.supabase.createClient !== 'function' ||
      !/^sb_publishable_/.test(script.dataset.publishableKey || '')) {
    message('Ambiente de login não autorizado ou configuração ausente. Nenhuma operação habilitada.');
    return;
  }
  const client = window.supabase.createClient(script.dataset.supabaseUrl, script.dataset.publishableKey, {
    auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: false, autoRefreshToken: true }
  });
  async function refreshIdentity() {
    try {
      const sessionResponse = await client.auth.getSession();
      if (sessionResponse.error) throw sessionResponse.error;
      if (!sessionResponse.data.session) {
        loginArea.hidden = false;
        workspace.hidden = true;
        message('Entre com o e-mail já confirmado no Hermes Brain.');
        return;
      }
      const identity = await client.auth.getUser();
      if (identity.error || !identity.data.user) throw identity.error || Error('user_unverified');
      who.textContent = 'Identidade autenticada: ' + (identity.data.user.email || 'usuário confirmado');
      loginArea.hidden = true;
      workspace.hidden = false;
      message('Sessão autenticada. Consulta e proposta ainda dependem de associação ativa ao tenant e das políticas RLS.');
    } catch (_) {
      loginArea.hidden = false;
      workspace.hidden = true;
      message('Não foi possível validar a sessão. Solicite um novo link, sem criar outra conta.');
    }
  }
  document.getElementById('loginForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const email = document.getElementById('email').value.trim();
      const response = await client.auth.signInWithOtp({
        email: email, options: { emailRedirectTo: redirect, shouldCreateUser: false }
      });
      if (response.error) throw response.error;
      message('Se a conta já existir, o link de acesso será enviado ao e-mail informado. Confira sua caixa de entrada.');
    } catch (_) {
      message('Não foi possível enviar o link de acesso. Confira o e-mail e a URL de retorno autorizada.');
    } finally { button.disabled = false; }
  });
  document.getElementById('logout').addEventListener('click', async function () {
    try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
    workspace.hidden = true;
    loginArea.hidden = false;
    results.replaceChildren();
    message('Sessão encerrada neste navegador.');
  });
  document.getElementById('searchForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const query = document.getElementById('query').value.trim();
    if (query.length < 2 || query.length > 160) return;
    button.disabled = true;
    results.replaceChildren();
    try {
      const check = await client.auth.getUser();
      if (check.error || !check.data.user) throw check.error || Error('session_invalid');
      const response = await client.rpc('hermes_brain_search', {p_tenant_id: tenant,p_query: query,p_limit: 5});
      if (response.error) throw response.error;
      const records = Array.isArray(response.data) ? response.data : [];
      if (records.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'Nenhuma memória aprovada encontrada. Isso NÃO comprova que o espaço já está autorizado.';
        results.appendChild(p);
      }
      for (const record of records) {
        const article = document.createElement('article');
        const heading = document.createElement('strong');
        heading.textContent = String(record.title || 'Memória');
        const text = document.createElement('p');
        text.textContent = String(record.content || '');
        const origin = document.createElement('small');
        origin.textContent = 'Fonte: ' + String(record.provider || '') + ' · versão ' + String(record.source_version || '');
        article.append(heading,text,origin);
        results.appendChild(article);
      }
      message('Busca concluída sob a identidade autenticada e as políticas RLS.');
    } catch (error) { message(friendly(error)); }
    finally { button.disabled = false; }
  });
  document.getElementById('noteForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const title = document.getElementById('title').value.trim();
    const body = document.getElementById('body').value.trim();
    const domain = document.getElementById('domain').value;
    if (!title || !body || title.length > 160 || body.length > 4000 ||
        !['projetos','compras','financeiro'].includes(domain)) return;
    button.disabled = true;
    try {
      const check = await client.auth.getUser();
      if (check.error || !check.data.user) throw check.error || Error('session_invalid');
      const ref = 'user_note:' + crypto.randomUUID();
      const response = await client.rpc('hermes_brain_submit_note', {
        p_tenant_id: tenant,p_source_ref: ref,p_title: title,p_body: body,p_domain: domain
      });
      if (response.error) throw response.error;
      document.getElementById('noteForm').reset();
      message('Proposta registrada como PENDENTE para revisão humana. Nenhuma aprovação ou execução foi realizada.');
    } catch (error) { message(friendly(error)); }
    finally { button.disabled = false; }
  });
  void refreshIdentity();
})();
