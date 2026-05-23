(function(){
  const form = document.getElementById('signupPersonalForm');
  const successPanel = document.getElementById('successPanel');
  const statusMessage = document.getElementById('statusMessage');
  const submitBtn = document.getElementById('submitBtn');
  const bio = document.getElementById('bio');
  const bioCount = document.getElementById('bioCount');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');

  let currentClaims = null;

  function showMessage(message, isError){
    statusMessage.textContent = message;
    statusMessage.className = 'msg ' + (isError ? 'err' : 'ok');
    statusMessage.hidden = false;
  }

  function clearMessage(){
    statusMessage.hidden = true;
    statusMessage.textContent = '';
  }

  function getMsalInstance(){
    if (typeof msalInstance !== 'undefined') return msalInstance;
    if (typeof msalApp !== 'undefined') return msalApp;
    return window.msalInstance || window.msalApp || window.authMsalInstance || null;
  }

  function getClaimEmail(claims, account){
    return claims && (claims.preferred_username || claims.email || claims.upn) || account && account.username || '';
  }

  function getClaimName(claims, account){
    return claims && (claims.name || claims.given_name) || account && account.name || '';
  }

  function applyClaims(account){
    if (!account) return;
    const claims = account.idTokenClaims || currentClaims || null;
    currentClaims = claims;

    const claimName = getClaimName(claims, account);
    const claimEmail = getClaimEmail(claims, account);

    if (claimName) {
      nameInput.value = claimName;
      nameInput.readOnly = true;
    }
    if (claimEmail) {
      emailInput.value = claimEmail;
      emailInput.readOnly = true;
    }
  }

  function getActiveOrFirstAccount(instance){
    if (!instance) return null;
    if (typeof instance.getActiveAccount === 'function') {
      const active = instance.getActiveAccount();
      if (active) return active;
    }
    if (typeof instance.getAllAccounts === 'function') {
      const accounts = instance.getAllAccounts();
      if (accounts && accounts.length) return accounts[0];
    }
    return null;
  }

  async function trySilentAccount(){
    const instance = getMsalInstance();
    const account = getActiveOrFirstAccount(instance);
    if (!instance || !account) return null;

    if (typeof instance.setActiveAccount === 'function') instance.setActiveAccount(account);

    try {
      if (typeof instance.acquireTokenSilent === 'function') {
        const result = await instance.acquireTokenSilent({
          account,
          scopes: ['openid', 'profile', 'email']
        });
        if (result && result.idTokenClaims) currentClaims = result.idTokenClaims;
        applyClaims(result && result.account ? result.account : account);
      } else {
        applyClaims(account);
      }
    } catch (err) {
      console.warn('MSAL silent login unavailable', err);
      applyClaims(account);
    }

    return account;
  }

  function validateForm(){
    if (!form.checkValidity()) {
      form.reportValidity();
      return false;
    }
    return true;
  }

  function getErrorMessage(response, fallback){
    return response.text().then((text) => {
      if (!text) return fallback;
      try {
        const data = JSON.parse(text);
        return data.error || data.message || fallback;
      } catch {
        return text || fallback;
      }
    });
  }

  async function submitPersonal(event){
    event.preventDefault();
    clearMessage();
    if (!validateForm()) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando…';

    try {
      await trySilentAccount();
      const payload = {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        specialization: document.getElementById('specialization').value,
        profession: (document.getElementById('profession') && document.getElementById('profession').value) || 'personal_trainer',
        bio: bio.value.trim(),
        entra_object_id: currentClaims && currentClaims.oid ? currentClaims.oid : null
      };

      const response = await fetch('/api/auth/register-personal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Não foi possível enviar a solicitação. Verifique os dados e tente novamente.'));
      }

      form.hidden = true;
      successPanel.hidden = false;
      showMessage('Solicitação enviada. Aguarde aprovação do administrador.', false);
    } catch (err) {
      showMessage(err.message || 'Erro ao solicitar cadastro como Personal.', true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Solicitar cadastro como Personal';
    }
  }

  function updateBioCount(){
    bioCount.textContent = String(bio.value.length);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    updateBioCount();
    bio.addEventListener('input', updateBioCount);
    form.addEventListener('submit', submitPersonal);
    await trySilentAccount();
  });
})();
