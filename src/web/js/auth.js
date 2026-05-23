const msalConfig = {
  auth: {
    clientId: '23dfd1f2-389d-4402-ac80-3dad256b7231',
    authority: 'https://login.microsoftonline.com/5537a00c-2813-4c5c-8422-aa1d3ce1d4ec',
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
