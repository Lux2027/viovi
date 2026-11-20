/* Viovi – Anmelden (Google / E-Mail-Code), Konto löschen und Cloud-Synchronisierung über Supabase.
   Ist in config.js nichts eingetragen, bleibt alles aus und Viovi speichert nur auf dem Gerät. */
(function () {
  'use strict';
  const cfg = window.VIOVI_CONFIG || {};
  const V = window.Viovi;
  const $ = (id) => document.getElementById(id);
  const esc = V.esc;
  const GUEST_KEY = 'viovi-guest';
  const SYNC_USER_KEY = 'viovi-sync-user';
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------- Ohne Einrichtung: nur auf dem Gerät ----------
  if (!cfg.supabaseUrl || !cfg.supabaseKey) {
    window.VioviCloud = {
      push() {},
      renderAccount() {
        $('account-box').innerHTML =
          '<div class="account-card"><div class="account-avatar">?</div><div><b>Ohne Konto</b>' +
          '<small>Deine Daten sind nur auf diesem Gerät gespeichert.</small></div></div>';
      },
    };
    return;
  }

  let client = null;
  let user = null;
  let pushTimer = null;

  // ---------- Hilfen ----------
  function msg(text, isError) {
    const m = $('auth-msg');
    m.textContent = text || '';
    m.classList.toggle('hidden', !text);
    m.classList.toggle('error', !!isError);
  }
  function errText(err) {
    const t = String((err && err.message) || err || '');
    if (/rate limit|too many|security purposes/i.test(t)) return 'Zu viele Versuche. Bitte warte kurz und versuche es dann noch einmal.';
    if (/expired|invalid|token/i.test(t)) return 'Der Code stimmt nicht oder ist abgelaufen. Lass dir einen neuen schicken.';
    if (/fetch|network|failed/i.test(t)) return 'Keine Verbindung. Bitte prüfe dein Internet.';
    return 'Das hat leider nicht geklappt: ' + t;
  }
  const redirectUrl = () => location.origin + location.pathname;

  // Zwei Datenstände zusammenführen (gleiche Einträge nur einmal; bei gleichem Eintrag gewinnt "a")
  function merge(a, b) {
    const out = { events: [], notes: [], reminders: [], updatedAt: new Date().toISOString() };
    ['events', 'notes', 'reminders'].forEach((k) => {
      const seen = new Set();
      [...((a && a[k]) || []), ...((b && b[k]) || [])].forEach((x) => {
        if (x && !seen.has(x.id)) { seen.add(x.id); out[k].push(x); }
      });
    });
    out.notes.sort((x, y) => new Date(y.created) - new Date(x.created));
    return out;
  }
  const isEmpty = (d) => !d || !['events', 'notes', 'reminders'].some((k) => (d[k] || []).length);

  // ---------- Synchronisieren ----------
  async function pushNow(d) {
    clearTimeout(pushTimer);
    if (!client || !user) return;
    const payload = d || V.data();
    const { error } = await client.from('viovi_data').upsert({ user_id: user.id, data: payload, updated_at: new Date().toISOString() });
    if (error) console.warn('Viovi: Hochladen fehlgeschlagen', error.message);
  }
  async function pull() {
    if (!client || !user) return;
    const { data: row, error } = await client.from('viovi_data').select('data, updated_at').eq('user_id', user.id).maybeSingle();
    if (error) { console.warn('Viovi: Laden fehlgeschlagen', error.message); return; }
    const local = V.data();
    const sameUser = store.get(SYNC_USER_KEY) === user.id;
    if (!row) {
      await pushNow(local);                       // erstes Mal: Gerät -> Cloud
    } else if (!sameUser) {
      const merged = isEmpty(local) ? row.data : merge(row.data, local);  // Gerät zum ersten Mal mit diesem Konto
      V.setData(merged);
      if (!isEmpty(local)) await pushNow(merged);
    } else {
      const cloudTime = new Date((row.data && row.data.updatedAt) || row.updated_at || 0);
      const localTime = new Date(local.updatedAt || 0);
      if (cloudTime > localTime) V.setData(row.data);   // anderes Gerät war neuer
      else if (localTime > cloudTime) await pushNow(local);
    }
    store.set(SYNC_USER_KEY, user.id);
  }

  // ---------- Anmelde-Fenster ----------
  function showAuth() {
    msg('');
    $('auth-start').classList.remove('hidden');
    $('auth-code-form').classList.add('hidden');
    $('auth').classList.remove('hidden');
  }
  function hideAuth() { $('auth').classList.add('hidden'); }

  $('auth-google').onclick = async () => {
    msg('Einen Moment …');
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } });
    if (error) msg(errText(error), true);
  };
  let pendingEmail = '';
  $('auth-email-form').onsubmit = async (e) => {
    e.preventDefault();
    pendingEmail = $('auth-email').value.trim();
    if (!pendingEmail) return;
    msg('Code wird gesendet …');
    const { error } = await client.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: true, emailRedirectTo: redirectUrl() } });
    if (error) return msg(errText(error), true);
    msg('');
    $('auth-email-show').textContent = pendingEmail;
    $('auth-start').classList.add('hidden');
    $('auth-code-form').classList.remove('hidden');
    $('auth-code').value = '';
    $('auth-code').focus();
  };
  $('auth-code-form').onsubmit = async (e) => {
    e.preventDefault();
    const token = $('auth-code').value.replace(/\s/g, '');
    if (!token) return;
    msg('Prüfe Code …');
    const { error } = await client.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
    if (error) msg(errText(error), true);
    // Erfolg: onAuthStateChange übernimmt
  };
  $('auth-back').onclick = showAuth;
  $('auth-guest').onclick = () => {
    store.set(GUEST_KEY, '1');
    hideAuth();
    V.maybeIntro();
  };

  async function onSignedIn(u) {
    const firstTime = !user || user.id !== u.id;
    user = u;
    store.del(GUEST_KEY);
    hideAuth();
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search);
    if (firstTime) {
      await pull();
      V.maybeIntro();
    }
  }

  // ---------- Konto im Menü ----------
  function renderAccount() {
    const box = $('account-box');
    if (!user) {
      box.innerHTML =
        '<div class="account-card"><div class="account-avatar">?</div><div><b>Ohne Konto</b>' +
        '<small>Deine Daten sind nur auf diesem Gerät.</small></div></div>' +
        '<button class="btn btn-primary" id="acc-login">Anmelden</button>';
      $('acc-login').onclick = () => { V.closeSheets(); showAuth(); };
      return;
    }
    const name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || '';
    const email = user.email || '';
    const initial = (name || email || '?').trim().charAt(0).toUpperCase();
    const pic = user.user_metadata && user.user_metadata.avatar_url;
    box.innerHTML =
      '<div class="account-card">' +
      (pic ? '<img class="account-avatar" src="' + esc(pic) + '" alt="" referrerpolicy="no-referrer">' : '<div class="account-avatar">' + esc(initial) + '</div>') +
      '<div><b>' + esc(name || email) + '</b><small>' + (name ? esc(email) + ' · ' : '') + 'Synchronisiert ☁️</small></div></div>' +
      '<div class="btn-row">' +
      '<button class="btn btn-light" id="acc-logout">Abmelden</button>' +
      '<button class="btn btn-danger-soft" id="acc-delete">Konto löschen</button>' +
      '</div>';
    $('acc-logout').onclick = signOut;
    $('acc-delete').onclick = confirmDelete;
  }

  async function signOut() {
    await pushNow();
    await client.auth.signOut();
    user = null;
    store.del(SYNC_USER_KEY);
    V.clearLocal();               // Daten bleiben sicher in deinem Konto
    V.closeSheets();
    showAuth();
  }

  function confirmDelete() {
    V.showDialog(
      '<div class="confirm">' +
      '<div class="confirm-icon">⚠️</div>' +
      '<h2 class="sheet-title center">Konto wirklich löschen?</h2>' +
      '<p>Dein Konto und <b>alle deine Termine, Notizen und Erinnerungen in der Cloud</b> werden endgültig gelöscht. Das kann <b>nicht rückgängig</b> gemacht werden.</p>' +
      '<label class="check-row"><input type="checkbox" id="del-local" checked> Auch die Daten auf diesem Gerät löschen</label>' +
      '<p id="del-msg" class="auth-msg error hidden"></p>' +
      '<div class="btn-row">' +
      '<button class="btn btn-light" data-close>Abbrechen</button>' +
      '<button class="btn btn-danger" id="del-go">Endgültig löschen</button>' +
      '</div></div>'
    );
    $('del-go').onclick = async () => {
      $('del-go').disabled = true;
      $('del-go').textContent = 'Wird gelöscht …';
      const { error } = await client.rpc('delete_my_account');
      if (error) {
        $('del-go').disabled = false;
        $('del-go').textContent = 'Endgültig löschen';
        $('del-msg').textContent = errText(error);
        $('del-msg').classList.remove('hidden');
        return;
      }
      const wipe = $('del-local').checked;
      await client.auth.signOut({ scope: 'local' });
      user = null;
      store.del(SYNC_USER_KEY);
      if (wipe) V.clearLocal();
      V.showDialog(
        '<div class="confirm"><div class="confirm-icon">✅</div>' +
        '<h2 class="sheet-title center">Dein Konto wurde gelöscht</h2>' +
        '<p>Alle deine Daten in der Cloud sind entfernt.</p>' +
        '<div class="btn-row"><button class="btn btn-primary" data-close>OK</button></div></div>'
      );
      showAuth();
    };
  }

  window.VioviCloud = {
    push(d) {
      if (!user) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => pushNow(d), 800);
    },
    renderAccount,
  };

  // ---------- Start ----------
  function loadLib() {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const s = document.createElement('script');
      s.src = SUPABASE_JS;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  loadLib().then(async () => {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((event, session) => {
      if (session && session.user) setTimeout(() => onSignedIn(session.user), 0);
    });
    const { data } = await client.auth.getSession();
    if (data && data.session) await onSignedIn(data.session.user);
    else if (store.get(GUEST_KEY) === '1') V.maybeIntro();
    else showAuth();
    // Wenn die App wieder geöffnet wird: neuesten Stand holen
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  }).catch(() => {
    // Offline oder Bibliothek nicht ladbar: einfach lokal weiterarbeiten
    V.maybeIntro();
  });
})();
