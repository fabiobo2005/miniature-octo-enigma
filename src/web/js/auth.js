const msalConfig = {
  auth: {
    clientId: '9d1fef36-f1ad-4889-9243-714f426e7d86',
    authority: 'https://login.microsoftonline.com/87cc550f-0777-49cd-a8c0-452328e84b0b',
    redirectUri: window.location.origin + '/',
  },
  cache: { cacheLocation: 'localStorage' }
};
const msalInstance = new msal.PublicClientApplication(msalConfig);
const loginRequest = { scopes: ['openid','profile','email'] };
let msalReadyPromise = null;

function initializeMsal() {
  if (!msalReadyPromise) {
    msalReadyPromise = typeof msalInstance.initialize === 'function'
      ? msalInstance.initialize()
      : Promise.resolve();
  }
  return msalReadyPromise;
}

async function ensureLogin() {
  await initializeMsal();
  let account = msalInstance.getAllAccounts()[0];
  if (!account) {
    await msalInstance.loginRedirect(loginRequest);
    return null;
  }
  msalInstance.setActiveAccount(account);
  return account;
}
async function getToken() {
  await initializeMsal();
  const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
  if (!account) return null;
  try {
    const r = await msalInstance.acquireTokenSilent({ ...loginRequest, account });
    return r.idToken;
  } catch (e) {
    const r = await msalInstance.acquireTokenRedirect({ ...loginRequest, account });
    return r?.idToken || null;
  }
}
async function logout() {
  await initializeMsal();
  await msalInstance.logoutRedirect({ postLogoutRedirectUri: window.location.origin + '/' });
}

// Wrap fetch global to add Authorization header for /api/*
const _origFetch = window.fetch;
window.fetch = async function(input, init){
  const url = typeof input === 'string' ? input : input.url;
  if (url && url.startsWith('/api/')) {
    const tok = await getToken();
    init = init || {};
    init.headers = new Headers(init.headers || {});
    if (tok) init.headers.set('Authorization', 'Bearer ' + tok);
  }
  return _origFetch(input, init);
};

window.apexAuth = { ensureLogin, getToken, logout, msalInstance, initializeMsal };
