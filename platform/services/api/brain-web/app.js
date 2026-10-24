'use strict';
/* Staging-only browser pilot. No service role; JWT/tenant membership + RLS own authorization. */
(function () {
  const script = document.currentScript || document.querySelector('script[data-publishable-key]');
  const status = document.getElementById('status');
  const loginArea = document.getElementById('loginArea');
  const workspace = document.getElementById('workspace');
  const sessionArea = document.getElementById('sessionArea');
  const accessPending = document.getElementById('accessPending');
  const noteSection = document.getElementById('noteSection');
  const publishSection = document.getElementById('publishSection');
  const publishStatus = document.getElementById('publishStatus');
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
    // Default deny: authentication never unlocks a tenant by itself.
    workspace.hidden = true;
    sessionArea.hidden = true;
    accessPending.hidden = true;
    publishSection.hidden = true;
    try {
      const sessionResponse = await client.auth.getSession();
      if (sessionResponse.error) throw sessionResponse.error;
      if (!sessionResponse.data.session) {
        loginArea.hidden = false;
        message('Entre com o e-mail já confirmado no Hermes Brain.');
        return;
      }
      const identity = await client.auth.getUser();
      if (identity.error || !identity.data.user) throw identity.error || Error('user_unverified');
      who.textContent = 'Identidade autenticada: ' + (identity.data.user.email || 'usuário confirmado');
      loginArea.hidden = true;
      sessionArea.hidden = false;
    } catch (_) {
      loginArea.hidden = false;
      message('Não foi possível validar a sessão. Solicite um novo link, sem criar outra conta.');
      return;
    }
    try {
      // The server checks the verified JWT + the active tenant membership through RLS.
      const admission = await client.rpc('hermes_brain_access_status', {p_tenant_id: tenant});
      if (admission.error) throw admission.error;
      if (!Array.isArray(admission.data) || admission.data.length !== 1) throw Error('invalid_access_status');
      const access = admission.data[0];
      if (access.authorized !== true) {
        accessPending.hidden = false;
        message('Sessão autenticada. Acesso empresarial pendente; nenhuma operação habilitada.');
        return;
      }
      workspace.hidden = false;
      publishSection.hidden = false;
      const known = new Set(['projetos', 'compras', 'financeiro']);
      const granted = new Set(Array.isArray(access.allowed_domains) ? access.allowed_domains : []);
      const domainSelect = document.getElementById('domain');
      for (const option of domainSelect.options) {
        option.disabled = !known.has(option.value) || !granted.has(option.value);
      }
      const firstAllowed = [...domainSelect.options].find(option => !option.disabled);
      noteSection.hidden = access.can_propose_internal !== true || !firstAllowed;
      if (firstAllowed) domainSelect.value = firstAllowed.value;
      message('Sessão autenticada e associação ativa confirmada pelo PostgreSQL RLS.');
    } catch (_) {
      workspace.hidden = true;
      accessPending.hidden = false;
      message('Não foi possível confirmar as permissões do espaço. Acesso bloqueado por segurança.');
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
    publishSection.hidden = true;
    sessionArea.hidden = true;
    accessPending.hidden = true;
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
  document.getElementById('publishAttested').addEventListener('click', async function (event) {
    const button = event.currentTarget;
    button.disabled = true;
    publishStatus.textContent = 'Validando os quatro itens e a sessão autorizada…';
    try {
      const identity = await client.auth.getUser();
      if (identity.error || !identity.data.user) throw identity.error || Error('session_invalid');
      const admission = await client.rpc('hermes_brain_access_status', {p_tenant_id: tenant});
      if (admission.error || !Array.isArray(admission.data) ||
          admission.data.length !== 1 || admission.data[0].authorized !== true) {
        throw Error('membership_denied');
      }
      const staged = await client.rpc('hermes_brain_get_attested_automemory', {p_tenant_id: tenant});
      if (staged.error) throw staged.error;
      const items = staged.data;
      if (!Array.isArray(items) || items.length !== 4 ||
          !items.every(item => typeof item.content === 'string' &&
            item.content.length >= 12 && item.content.length <= 420)) {
        throw Error('verified_bundle_invalid');
      }
      const outcome = await client.rpc('hermes_brain_publish_automemory',
        {p_tenant_id: tenant,p_items: items});
      if (outcome.error) throw outcome.error;
      const receipt = outcome.data;
      if (!receipt || receipt.status !== 'committed' ||
          receipt.tenant_id !== tenant ||
          Number(receipt.inserted) + Number(receipt.duplicates) !== 4) {
        throw Error('unverified_publication_receipt');
      }
      publishStatus.textContent =
        'Publicação confirmada pelo banco: ' + receipt.inserted +
        ' nova(s), ' + receipt.duplicates + ' já existente(s). Apenas memórias; nenhuma ação financeira.';
      message('Publicação autenticada de quatro memórias verificada pelo PostgreSQL.');
    } catch (error) {
      publishStatus.textContent = friendly(error);
    } finally { button.disabled = false; }
  });
  void refreshIdentity();
})();
