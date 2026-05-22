// ===== audio.js : áudio da sessão, TTS e Wake Lock =====
(function(){
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  const KEYS = {
    volume: 'apex.audio.volume',
    beep: 'apex.audio.beep',
    tts: 'apex.audio.tts',
    wakeLock: 'apex.audio.wakeLock'
  };
  const DEFAULTS = { volume: 70, beep: 'simple', tts: false, wakeLock: true };
  const state = { silent: null, wakeLock: null, active: false, visibilityHandler: null };

  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
  function getStoredBool(key, fallback){
    const value = localStorage.getItem(key);
    if (value == null) return fallback;
    return value === '1' || value === 'true';
  }
  function getSettings(){
    const volume = clamp(Number(localStorage.getItem(KEYS.volume) ?? DEFAULTS.volume) || DEFAULTS.volume, 0, 100);
    const beep = localStorage.getItem(KEYS.beep) || DEFAULTS.beep;
    return {
      volume,
      beep: ['simple','double','bell'].includes(beep) ? beep : DEFAULTS.beep,
      tts: getStoredBool(KEYS.tts, DEFAULTS.tts),
      wakeLock: getStoredBool(KEYS.wakeLock, DEFAULTS.wakeLock)
    };
  }
  function saveSettings(settings){
    const current = getSettings();
    const next = Object.assign({}, current, settings || {});
    localStorage.setItem(KEYS.volume, String(clamp(Number(next.volume) || 0, 0, 100)));
    localStorage.setItem(KEYS.beep, ['simple','double','bell'].includes(next.beep) ? next.beep : DEFAULTS.beep);
    localStorage.setItem(KEYS.tts, next.tts ? '1' : '0');
    localStorage.setItem(KEYS.wakeLock, next.wakeLock ? '1' : '0');
    if (state.active) refreshSessionAudio();
    return getSettings();
  }

  function ensureSilent(){
    if (!state.silent) {
      state.silent = new Audio(SILENT_WAV);
      state.silent.loop = true;
      state.silent.volume = 0.01;
    }
    return state.silent;
  }
  async function playSilentLoop(){
    try { await ensureSilent().play(); return true; }
    catch { return false; }
  }
  function stopSilentLoop(){
    if (!state.silent) return;
    try { state.silent.pause(); state.silent.currentTime = 0; } catch {}
  }
  async function requestWakeLock(){
    const settings = getSettings();
    if (!settings.wakeLock || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return false;
    try {
      if (state.wakeLock) await state.wakeLock.release().catch(() => {});
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
      return true;
    } catch { return false; }
  }
  async function releaseWakeLock(){
    const lock = state.wakeLock;
    state.wakeLock = null;
    if (lock) await lock.release().catch(() => {});
  }
  function bindVisibility(){
    if (state.visibilityHandler) return;
    state.visibilityHandler = () => {
      if (!state.active || document.visibilityState !== 'visible') return;
      playSilentLoop();
      requestWakeLock();
    };
    document.addEventListener('visibilitychange', state.visibilityHandler);
  }
  function unbindVisibility(){
    if (!state.visibilityHandler) return;
    document.removeEventListener('visibilitychange', state.visibilityHandler);
    state.visibilityHandler = null;
  }
  async function startSessionAudio(){
    state.active = true;
    bindVisibility();
    await playSilentLoop();
    await requestWakeLock();
  }
  async function stopSessionAudio(){
    state.active = false;
    unbindVisibility();
    stopSilentLoop();
    await releaseWakeLock();
  }
  async function refreshSessionAudio(){
    if (!state.active) return;
    await playSilentLoop();
    const settings = getSettings();
    if (settings.wakeLock) await requestWakeLock();
    else await releaseWakeLock();
  }

  function createAudioContext(){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    return Ctx ? new Ctx() : null;
  }
  function tone(ac, frequency, start, duration, gainValue, type){
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(frequency, ac.currentTime + start);
    gain.gain.setValueAtTime(0.0001, ac.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), ac.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(ac.currentTime + start);
    osc.stop(ac.currentTime + start + duration + 0.03);
  }
  function beep(type){
    try {
      const settings = getSettings();
      const kind = type || settings.beep;
      const gainValue = 0.2 * (settings.volume / 100);
      if (gainValue <= 0) return;
      const ac = createAudioContext();
      if (!ac) return;
      if (ac.state === 'suspended' && ac.resume) ac.resume().catch(() => {});
      if (kind === 'double') {
        tone(ac, 880, 0, 0.13, gainValue, 'square');
        tone(ac, 880, 0.19, 0.13, gainValue, 'square');
        setTimeout(() => ac.close().catch(() => {}), 430);
      } else if (kind === 'bell') {
        tone(ac, 660, 0, 0.55, gainValue * 0.9, 'sine');
        tone(ac, 990, 0.01, 0.45, gainValue * 0.45, 'triangle');
        setTimeout(() => ac.close().catch(() => {}), 700);
      } else {
        tone(ac, 880, 0, 0.25, gainValue, 'sine');
        setTimeout(() => ac.close().catch(() => {}), 360);
      }
    } catch {}
  }
  function speak(text){
    return new Promise(resolve => {
      const settings = getSettings();
      if (!settings.tts || !text || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return resolve(false);
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pt-BR';
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.onend = () => resolve(true);
        utterance.onerror = () => resolve(false);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        setTimeout(() => resolve(true), Math.max(1200, text.length * 90));
      } catch { resolve(false); }
    });
  }
  async function announceThenBeep(text, type){
    const spoke = await speak(text);
    if (spoke) setTimeout(() => beep(type), 120);
    else beep(type);
  }

  window.ApexAudio = {
    getSettings,
    saveSettings,
    startSessionAudio,
    stopSessionAudio,
    refreshSessionAudio,
    beep,
    speak,
    announceThenBeep,
    isWakeLockSupported: () => !!(navigator.wakeLock && navigator.wakeLock.request),
    isTtsSupported: () => !!(window.speechSynthesis && window.SpeechSynthesisUtterance)
  };
})();
