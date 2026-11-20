/* Viovi – App-Logik: Daten, Anzeige, Spracheingabe, Sprachausgabe, Erinnerungen */
(function () {
  'use strict';
  const P = window.VioviParser;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'viovi-data-v1';

  // ---------- Daten ----------
  let data = { events: [], notes: [], reminders: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) data = Object.assign(data, saved);
  } catch (e) { /* leer starten */ }
  const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {} };
  // Speichern: auf dem Gerät + (wenn angemeldet) in die Cloud
  const save = () => {
    data.updatedAt = new Date().toISOString();
    persist();
    if (window.VioviCloud) window.VioviCloud.push(data);
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let pending = null;      // wartet auf Rückfrage (z. B. "Wann?")
  let lastDeleted = null;  // für "rückgängig"
  let view = 'heute';
  let calMonth = startOfDay(new Date()); calMonth.setDate(1);
  let selectedDay = startOfDay(new Date());

  // ---------- Hilfsfunktionen Datum ----------
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
  const fmtTime = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  function fmtDay(d) {
    const today = startOfDay(new Date());
    const diff = Math.round((startOfDay(d) - today) / 86400000);
    if (diff === 0) return 'heute';
    if (diff === 1) return 'morgen';
    if (diff === 2) return 'übermorgen';
    if (diff === -1) return 'gestern';
    return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function fmtWhen(d, allDay) {
    return allDay ? fmtDay(d) : fmtDay(d) + ' um ' + fmtTime(d) + ' Uhr';
  }
  // für Sprachausgabe: "15:30" -> "15 Uhr 30"
  const speakable = (t) => t.replace(/(\d{1,2}):(\d{2}) Uhr/g, (_, h, m) => parseInt(h, 10) + ' Uhr' + (m === '00' ? '' : ' ' + parseInt(m, 10)));

  // ---------- Sprachausgabe ----------
  let speaking = false;
  let germanVoice = null;
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    germanVoice = voices.find((v) => v.lang === 'de-DE' && /natural|online|google/i.test(v.name)) ||
      voices.find((v) => v.lang && v.lang.startsWith('de')) || null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function say(text, after) {
    $('bubble-bot').textContent = text;
    if (!('speechSynthesis' in window)) { if (after) after(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.lang = 'de-DE';
    if (germanVoice) u.voice = germanVoice;
    speaking = true;
    stopListening();
    u.onend = u.onerror = () => {
      speaking = false;
      if (after) after();
      else if ($('handsfree').checked || pending) startListening();
    };
    speechSynthesis.speak(u);
  }

  // ---------- Spracherkennung ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, gotFinal = false;
  if (SR) {
    rec = new SR();
    rec.lang = 'de-DE';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => { listening = true; gotFinal = false; $('mic').classList.add('listening'); showUser('Ich höre zu …'); };
    rec.onresult = (e) => {
      let txt = '';
      let final = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0].transcript;
        if (e.results[i].isFinal) final = true;
      }
      showUser('„' + txt.trim() + '“');
      if (final) { gotFinal = true; handleInput(txt.trim()); }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        $('handsfree').checked = false;
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
        $('bubble-bot').textContent = ios
          ? 'Ich darf das Mikrofon nicht benutzen. Auf dem iPhone: Einstellungen › Siri einschalten, und unter Einstellungen › Safari › Mikrofon „Fragen“ oder „Erlauben“ wählen.'
          : 'Ich darf das Mikrofon nicht benutzen. Bitte erlaube den Zugriff oben in der Adressleiste (Schloss-Symbol).';
      } else if (e.error === 'network') {
        $('bubble-bot').textContent = 'Für die Spracherkennung braucht der Browser eine Internetverbindung.';
      }
    };
    rec.onend = () => {
      listening = false;
      $('mic').classList.remove('listening');
      if (!gotFinal) showUser('');
      if ($('handsfree').checked && !speaking) setTimeout(startListening, 300);
    };
  }
  function startListening() {
    if (!rec || listening || speaking) return;
    try { rec.start(); } catch (e) {}
  }
  function stopListening() {
    if (rec && listening) { try { rec.abort(); } catch (e) {} }
  }
  function showUser(t) {
    $('bubble-user').textContent = t;
    $('bubble-user').classList.toggle('hidden', !t);
  }

  // ---------- Befehle ausführen ----------
  function handleInput(text) {
    const now = new Date();
    let cmd = P.parse(text, now);

    // Rückfrage beantworten (z. B. nach "Wann?")
    if (pending) {
      const p = pending;
      pending = null;
      if (cmd.type === 'cancel') return say('Okay, abgebrochen.');
      if (p.need === 'when') {
        const w = P.extractWhen(text, now);
        if (w.when) cmd = Object.assign({}, p.cmd, { when: w.when, allDay: w.allDay });
      } else if (p.need === 'text') {
        if (['unknown', 'event', 'note'].includes(cmd.type)) cmd = Object.assign({}, p.cmd, p.cmd.type === 'event' ? { title: text } : { text: capital(text) });
      }
    }
    run(cmd, text);
  }
  const capital = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;

  function run(cmd, raw) {
    switch (cmd.type) {
      case 'empty': return;
      case 'help': return say(HELP_TEXT);
      case 'thanks': return say('Gern geschehen!');
      case 'cancel': return say('Okay.');
      case 'nav':
        showView(cmd.view);
        return say({ heute: 'Hier ist deine Übersicht.', kalender: 'Hier ist dein Kalender.', notizen: 'Hier sind deine Notizen.', erinnerungen: 'Hier sind deine Erinnerungen.' }[cmd.view]);

      case 'note': {
        if (!cmd.text) { pending = { cmd, need: 'text' }; return say('Was soll ich notieren?'); }
        data.notes.unshift({ id: uid(), text: cmd.text, created: new Date().toISOString() });
        save(); render();
        return say('Notiert: ' + cmd.text);
      }

      case 'reminder': {
        if (!cmd.text) { pending = { cmd, need: 'text' }; return say('Woran soll ich dich erinnern?'); }
        if (!cmd.when) { pending = { cmd, need: 'when' }; return say('Wann soll ich dich an „' + cmd.text + '“ erinnern?'); }
        let due = new Date(cmd.when);
        if (cmd.allDay) due.setHours(9, 0, 0, 0);
        if (due <= new Date()) { pending = { cmd, need: 'when' }; return say('Dieser Zeitpunkt liegt in der Vergangenheit. Wann genau?'); }
        data.reminders.push({ id: uid(), text: cmd.text, due: due.toISOString(), done: false, fired: false });
        save(); render();
        return say('Alles klar, ich erinnere dich ' + fmtWhen(due) + ' an: ' + cmd.text);
      }

      case 'event': {
        if (!cmd.when) {
          if (!cmd.title) return say('Das habe ich leider nicht verstanden. Sag „Hilfe“, um die Befehle zu hören.');
          pending = { cmd, need: 'when' };
          return say('Wann ist der Termin „' + cmd.title + '“?');
        }
        if (!cmd.title) { pending = { cmd, need: 'text' }; return say('Wie soll der Termin heißen?'); }
        data.events.push({ id: uid(), title: cmd.title, start: new Date(cmd.when).toISOString(), allDay: !!cmd.allDay });
        save();
        selectedDay = startOfDay(cmd.when);
        calMonth = new Date(selectedDay); calMonth.setDate(1);
        render();
        return say('Termin eingetragen: ' + cmd.title + ', ' + fmtWhen(new Date(cmd.when), cmd.allDay) + '.');
      }

      case 'agenda': return say(agendaText(cmd.date, cmd.week));
      case 'readNotes': {
        if (!data.notes.length) return say('Du hast noch keine Notizen.');
        const list = data.notes.slice(0, 10).map((n, i) => (i + 1) + '. ' + n.text).join('\n');
        showView('notizen');
        return say('Du hast ' + countWord(data.notes.length, 'Notiz', 'Notizen') + ':\n' + list);
      }
      case 'readReminders': {
        const open = openReminders();
        if (!open.length) return say('Du hast keine offenen Erinnerungen.');
        showView('erinnerungen');
        return say('Offene Erinnerungen:\n' + open.slice(0, 10).map((r) => fmtWhen(new Date(r.due)) + ': ' + r.text).join('\n'));
      }
      case 'done': {
        const r = findItem(openReminders(), cmd.query, (x) => x.text);
        if (!r) return say('Ich habe keine offene Erinnerung zu „' + cmd.query + '“ gefunden.');
        r.done = true; r.fired = true; save(); render();
        return say('Erledigt: ' + r.text);
      }
      case 'delete': return say(deleteItem(cmd));
      case 'undo': {
        if (!lastDeleted) return say('Es gibt nichts zum Wiederherstellen.');
        data[lastDeleted.list].splice(lastDeleted.pos, 0, lastDeleted.item);
        lastDeleted = null; save(); render();
        return say('Wiederhergestellt.');
      }
      default:
        return say('Das habe ich nicht verstanden: „' + raw + '“. Sag zum Beispiel „Notiz: Milch kaufen“ oder „Hilfe“.');
    }
  }

  const HELP_TEXT = [
    'Das kannst du sagen:',
    '• „Termin morgen um 15 Uhr Zahnarzt“',
    '• „Trage am 3. Dezember um 10 Uhr Meeting mit Anna ein“',
    '• „Erinnere mich in 20 Minuten an die Wäsche“',
    '• „Erinnere mich am Freitag um 8 Uhr an den Müll“',
    '• „Notiz: Milch und Brot kaufen“',
    '• „Was steht heute an?“ oder „Was habe ich morgen?“',
    '• „Lies meine Notizen vor“ / „Welche Erinnerungen habe ich?“',
    '• „Wäsche erledigt“',
    '• „Lösche die letzte Notiz“ / „Lösche Termin Zahnarzt“',
    '• „Rückgängig“',
    '• „Zeige Kalender“',
  ].join('\n');

  function countWord(n, one, many, article = 'eine') { return (n === 1 ? article + ' ' + one : n + ' ' + many); }
  const openReminders = () => data.reminders.filter((r) => !r.done).sort((a, b) => new Date(a.due) - new Date(b.due));
  const eventsOn = (day) => data.events.filter((e) => sameDay(new Date(e.start), day)).sort((a, b) => new Date(a.start) - new Date(b.start));
  const remindersOn = (day) => openReminders().filter((r) => sameDay(new Date(r.due), day));

  function agendaText(day, week) {
    if (week) {
      const parts = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(day); d.setDate(d.getDate() + i);
        const ev = eventsOn(d);
        if (ev.length) parts.push(fmtDay(d) + ': ' + ev.map(evText).join(', '));
      }
      return parts.length ? 'In den nächsten 7 Tagen:\n' + parts.join('\n') : 'In den nächsten 7 Tagen hast du keine Termine.';
    }
    const ev = eventsOn(day), rem = remindersOn(day);
    const label = fmtDay(day);
    showDay(day);
    if (!ev.length && !rem.length) return capital(label) + ' hast du nichts geplant.';
    let out = '';
    if (ev.length) out += capital(label) + ' hast du ' + countWord(ev.length, 'Termin', 'Termine', 'einen') + ': ' + ev.map(evText).join(', ') + '.';
    if (rem.length) out += (out ? '\n' : capital(label) + ' ') + 'Erinnerungen: ' + rem.map((r) => fmtTime(new Date(r.due)) + ' Uhr ' + r.text).join(', ') + '.';
    return out;
  }
  const evText = (e) => (e.allDay ? '' : fmtTime(new Date(e.start)) + ' Uhr ') + e.title;

  // Eintrag per Text suchen (enthält Wort)
  function findItem(list, query, getText) {
    if (!query) return null;
    const q = query.toLowerCase();
    return list.find((x) => getText(x).toLowerCase().includes(q)) ||
      list.find((x) => q.split(' ').some((w) => w.length > 2 && getText(x).toLowerCase().includes(w)));
  }

  function deleteItem(cmd) {
    const lists = cmd.kind ? [cmd.kind] : ['note', 'event', 'reminder'];
    const names = { note: ['notes', 'Notiz', (x) => x.text], event: ['events', 'Termin', (x) => x.title], reminder: ['reminders', 'Erinnerung', (x) => x.text] };
    for (const k of lists) {
      const [key, label, getText] = names[k];
      const arr = data[key];
      let item = null;
      if (cmd.which === 'last') {
        item = k === 'note' ? arr[0] : arr[arr.length - 1];
      } else if (cmd.which === 'index') {
        const ordered = k === 'note' ? arr : k === 'event' ? [...arr].sort((a, b) => new Date(a.start) - new Date(b.start)) : openReminders();
        item = ordered[cmd.index - 1];
      } else {
        item = findItem(arr, cmd.query, getText);
      }
      if (item) {
        const pos = arr.indexOf(item);
        arr.splice(pos, 1);
        lastDeleted = { list: key, pos, item };
        save(); render();
        return label + ' „' + getText(item) + '“ gelöscht. Sag „rückgängig“, falls das ein Versehen war.';
      }
      if (cmd.kind && cmd.which !== 'query') return 'Ich habe keine passende ' + label + ' gefunden.';
    }
    return 'Ich habe nichts Passendes zum Löschen gefunden' + (cmd.query ? ' zu „' + cmd.query + '“.' : '.');
  }

  // ---------- Erinnerungen auslösen ----------
  function checkReminders() {
    const now = new Date();
    data.reminders.forEach((r) => {
      if (!r.done && !r.fired && new Date(r.due) <= now) {
        r.fired = true;
        save(); render();
        fireReminder(r);
      }
    });
  }
  function fireReminder(r) {
    beep();
    const late = (new Date() - new Date(r.due)) > 5 * 60000;
    const msg = (late ? 'Verpasste Erinnerung: ' : 'Erinnerung: ') + r.text;
    toast('⏰ ' + msg);
    if ('Notification' in window && Notification.permission === 'granted') {
      const opts = { body: r.text, icon: 'icon-192.png', requireInteraction: true, vibrate: [200, 100, 200] };
      // Android erlaubt Benachrichtigungen nur über den Service Worker
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((reg) => reg.showNotification('Viovi', opts)).catch(() => {});
      } else {
        try { new Notification('Viovi', opts); } catch (e) {}
      }
    }
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    setTimeout(() => say(msg + '. Sag „' + r.text.split(' ').slice(-1)[0] + ' erledigt“, wenn du fertig bist.'), 900);
  }
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.2, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    } catch (e) {}
  }
  let toastTimer;
  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 10000);
    t.onclick = () => t.classList.add('hidden');
  }

  // ---------- Anzeige ----------
  function showView(v) {
    view = v;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    render();
  }
  function showDay(day) {
    selectedDay = startOfDay(day);
    calMonth = new Date(selectedDay); calMonth.setDate(1);
    render();
  }

  function li(html, cls) {
    const el = document.createElement('li');
    if (cls) el.className = cls;
    el.innerHTML = html;
    return el;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fill(ul, items, emptyText) {
    ul.innerHTML = '';
    if (!items.length) ul.appendChild(li(esc(emptyText), 'empty'));
    items.forEach((x) => ul.appendChild(x));
  }
  function delBtn(list, id) {
    return '<button class="edit" data-edit="' + list + '" data-id="' + id + '" title="Bearbeiten" aria-label="Bearbeiten">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>' +
      '<button class="del" data-del="' + list + '" data-id="' + id + '" title="Löschen" aria-label="Löschen">🗑</button>';
  }
  function eventLi(e, withDay) {
    const d = new Date(e.start);
    const badge = e.allDay ? 'ganztags' : fmtTime(d);
    return li('<span class="badge">' + badge + '</span><div class="main"><div class="title">' + esc(e.title) + '</div>' +
      (withDay ? '<div class="sub">' + esc(capital(fmtDay(d))) + '</div>' : '') + '</div>' + delBtn('events', e.id));
  }
  function reminderLi(r) {
    const d = new Date(r.due);
    const overdue = !r.done && d < new Date();
    return li('<input type="checkbox" data-done="' + r.id + '"' + (r.done ? ' checked' : '') + '>' +
      '<div class="main"><div class="title">' + esc(r.text) + '</div><div class="sub">' + esc(capital(fmtWhen(d))) + (overdue ? ' · fällig' : '') + '</div></div>' +
      delBtn('reminders', r.id), (r.done ? 'done' : '') + (overdue ? ' overdue' : ''));
  }
  function noteLi(n, i) {
    const d = new Date(n.created);
    return li('<span class="badge">' + (i + 1) + '</span><div class="main"><div class="title">' + esc(n.text) + '</div><div class="sub">' +
      esc(capital(fmtDay(d)) + ', ' + fmtTime(d)) + '</div></div>' + delBtn('notes', n.id));
  }

  function render() {
    const today = startOfDay(new Date());
    $('today-label').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

    // Heute
    fill($('today-events'), eventsOn(today).map((e) => eventLi(e)), 'Heute keine Termine.');
    fill($('today-reminders'), openReminders().slice(0, 5).map(reminderLi), 'Keine offenen Erinnerungen.');
    fill($('today-notes'), data.notes.slice(0, 3).map(noteLi), 'Noch keine Notizen.');

    // Notizen
    fill($('notes-list'), data.notes.map(noteLi), 'Noch keine Notizen. Sag z. B. „Notiz: Milch kaufen“.');

    // Erinnerungen
    fill($('rem-open'), openReminders().map(reminderLi), 'Keine offenen Erinnerungen.');
    fill($('rem-done'), data.reminders.filter((r) => r.done).sort((a, b) => new Date(b.due) - new Date(a.due)).slice(0, 20).map(reminderLi), 'Noch nichts erledigt.');

    renderCalendar();
  }

  function renderCalendar() {
    $('cal-title').textContent = calMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const grid = $('cal-grid');
    grid.innerHTML = '';
    const first = new Date(calMonth);
    const offset = (first.getDay() + 6) % 7; // Montag zuerst
    const start = new Date(first); start.setDate(1 - offset);
    const today = startOfDay(new Date());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const btn = document.createElement('button');
      btn.className = 'cal-day' + (d.getMonth() !== calMonth.getMonth() ? ' other' : '') +
        (sameDay(d, today) ? ' today' : '') + (sameDay(d, selectedDay) ? ' selected' : '');
      const evCount = eventsOn(d).length, remCount = remindersOn(d).length;
      let dots = '';
      for (let k = 0; k < Math.min(evCount, 3); k++) dots += '<i class="dot"></i>';
      if (remCount) dots += '<i class="dot rem"></i>';
      btn.innerHTML = '<span>' + d.getDate() + '</span><span class="dots">' + dots + '</span>';
      btn.onclick = () => { selectedDay = startOfDay(d); renderCalendar(); };
      grid.appendChild(btn);
    }
    $('day-title').textContent = capital(fmtDay(selectedDay)) + (/^(heute|morgen|übermorgen|gestern)$/.test(fmtDay(selectedDay)) ? ', ' + selectedDay.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' }) : '');
    fill($('day-list'), [...eventsOn(selectedDay).map((e) => eventLi(e)), ...remindersOn(selectedDay).map(reminderLi)], 'Nichts geplant. Sag z. B. „Termin ' + fmtDay(selectedDay) + ' um 10 Uhr …“');
  }

  // ---------- Klicks & Eingaben ----------
  function deleteItem(list, id) {
    const arr = data[list];
    const pos = arr.findIndex((x) => x.id === id);
    if (pos < 0) return;
    lastDeleted = { list, pos, item: arr[pos] };
    arr.splice(pos, 1); save(); render();
    $('bubble-bot').textContent = 'Gelöscht. Sag „rückgängig“, um es wiederherzustellen.';
  }
  document.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) return deleteItem(del.dataset.del, del.dataset.id);
    const ed = e.target.closest('[data-edit]');
    if (ed) return openEditor(ed.dataset.edit, ed.dataset.id);
    // Antippen des Eintrags selbst öffnet ebenfalls das Bearbeiten
    const row = e.target.closest('.list li .main');
    if (row) {
      const btn = row.parentElement.querySelector('[data-edit]');
      if (btn) return openEditor(btn.dataset.edit, btn.dataset.id);
    }
    if (e.target.closest('[data-close]') || e.target.classList.contains('sheet')) closeSheets();
  });

  // ---------- Fenster von unten (Menü, Bearbeiten) ----------
  function openSheet(id) {
    const s = $(id);
    s.classList.remove('hidden', 'closing');
  }
  function closeSheets() {
    document.querySelectorAll('.sheet:not(.hidden)').forEach((s) => {
      s.classList.add('closing');
      setTimeout(() => s.classList.add('hidden'), 200);
    });
  }
  function showDialog(html) {
    $('sheet-body').innerHTML = html;
    openSheet('sheet');
  }
  $('menu-btn').onclick = () => { if (window.VioviCloud) window.VioviCloud.renderAccount(); openSheet('menu'); };

  // ---------- Bearbeiten ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dateVal = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const timeVal = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  function readDate(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, mi] = (timeStr || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, h || 0, mi || 0);
  }
  const KIND = {
    events: { title: 'Termin bearbeiten', icon: 'cal' },
    reminders: { title: 'Erinnerung bearbeiten', icon: 'rem' },
    notes: { title: 'Notiz bearbeiten', icon: 'note' },
  };
  function openEditor(list, id) {
    const item = data[list].find((x) => x.id === id);
    if (!item) return;
    let fields = '';
    if (list === 'events') {
      const d = new Date(item.start);
      fields =
        '<label class="field"><span>Was?</span><input name="text" value="' + esc(item.title) + '" required></label>' +
        '<div class="field-row">' +
        '<label class="field"><span>Datum</span><input type="date" name="date" value="' + dateVal(d) + '" required></label>' +
        '<label class="field"><span>Uhrzeit</span><input type="time" name="time" value="' + (item.allDay ? '' : timeVal(d)) + '"' + (item.allDay ? ' disabled' : '') + '></label>' +
        '</div>' +
        '<label class="check-row"><input type="checkbox" name="allDay"' + (item.allDay ? ' checked' : '') + '> Ganztägig</label>';
    } else if (list === 'reminders') {
      const d = new Date(item.due);
      fields =
        '<label class="field"><span>Woran?</span><input name="text" value="' + esc(item.text) + '" required></label>' +
        '<div class="field-row">' +
        '<label class="field"><span>Datum</span><input type="date" name="date" value="' + dateVal(d) + '" required></label>' +
        '<label class="field"><span>Uhrzeit</span><input type="time" name="time" value="' + timeVal(d) + '" required></label>' +
        '</div>' +
        '<label class="check-row"><input type="checkbox" name="done"' + (item.done ? ' checked' : '') + '> Erledigt</label>';
    } else {
      fields = '<label class="field"><span>Notiz</span><textarea name="text" rows="5" required>' + esc(item.text) + '</textarea></label>';
    }
    showDialog(
      '<form id="edit-form" class="edit-form">' +
      '<h2 class="sheet-title"><span class="ic ' + KIND[list].icon + '"></span>' + KIND[list].title + '</h2>' +
      fields +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn-danger-soft" id="edit-del">Löschen</button>' +
      '<button type="button" class="btn btn-light" data-close>Abbrechen</button>' +
      '<button type="submit" class="btn btn-primary">Speichern</button>' +
      '</div></form>'
    );
    // Symbol aus der Kopfzeile der Karten übernehmen
    const srcIcon = document.querySelector('.ic.' + KIND[list].icon + ' svg');
    if (srcIcon) $('sheet-body').querySelector('.ic').appendChild(srcIcon.cloneNode(true));
    const f = $('edit-form');
    if (f.allDay) f.allDay.onchange = () => { f.time.disabled = f.allDay.checked; if (!f.allDay.checked && !f.time.value) f.time.value = '09:00'; };
    $('edit-del').onclick = () => { closeSheets(); deleteItem(list, id); };
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const text = f.text.value.trim();
      if (!text) return;
      if (list === 'events') {
        item.title = text;
        item.allDay = f.allDay.checked;
        item.start = readDate(f.date.value, item.allDay ? '00:00' : f.time.value).toISOString();
      } else if (list === 'reminders') {
        item.text = text;
        const due = readDate(f.date.value, f.time.value);
        if (due.toISOString() !== item.due) { item.due = due.toISOString(); item.fired = item.done || due <= new Date(); }
        item.done = f.done.checked;
        if (item.done) item.fired = true;
      } else {
        item.text = text;
      }
      save(); render(); closeSheets();
      $('bubble-bot').textContent = 'Gespeichert.';
    };
  }
  document.addEventListener('change', (e) => {
    const id = e.target.dataset && e.target.dataset.done;
    if (!id) return;
    const r = data.reminders.find((x) => x.id === id);
    if (r) { r.done = e.target.checked; if (r.done) r.fired = true; save(); render(); }
  });
  document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  $('cal-prev').onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); };
  $('cal-next').onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); };

  $('text-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('text-input').value.trim();
    if (!v) return;
    $('text-input').value = '';
    showUser('„' + v + '“');
    handleInput(v);
  });

  $('mic').onclick = () => {
    askNotify();
    if (!rec) {
      $('bubble-bot').textContent = 'Dein Browser kann leider keine Sprache erkennen. Bitte öffne Viovi in Google Chrome oder Microsoft Edge. Bis dahin kannst du Befehle unten eintippen.';
      return;
    }
    speechSynthesis && speechSynthesis.cancel();
    speaking = false;
    if (listening) stopListening(); else startListening();
  };
  // Tastatur-Knopf blendet das Eingabefeld ein/aus
  $('kbd-btn').onclick = () => {
    const form = $('text-form');
    const show = form.classList.toggle('hidden') === false;
    $('kbd-btn').classList.toggle('active', show);
    if (show) $('text-input').focus();
  };
  $('handsfree').onchange = (e) => {
    if (e.target.checked) { askNotify(); startListening(); } else stopListening();
  };
  // Leertaste = Sprechen (wenn nicht im Textfeld)
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && !e.repeat) {
      e.preventDefault();
      $('mic').click();
    }
  });

  function askNotify() {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(updateNotifyBtn);
  }
  function updateNotifyBtn() {
    const ok = !('Notification' in window) || Notification.permission === 'granted';
    $('notify-btn').classList.toggle('hidden', ok);
  }
  $('notify-btn').onclick = askNotify;

  // Beispiel-Knöpfe
  const EXAMPLES = ['Termin morgen um 15 Uhr Zahnarzt', 'Erinnere mich in 10 Minuten an die Wäsche', 'Notiz: Milch und Brot kaufen',
    'Was steht morgen an?', 'Trage am Freitag um 18:30 Kino mit Lisa ein', 'Lies meine Notizen vor', 'Hilfe'];
  EXAMPLES.forEach((ex) => {
    const b = document.createElement('button');
    b.textContent = '„' + ex + '“';
    b.onclick = () => { showUser('„' + ex + '“'); handleInput(ex); };
    $('examples').appendChild(b);
  });

  // ---------- Sprechblasen: kurz einblenden, dann von selbst ausblenden ----------
  let bubbleTimer;
  function hideBubbles() {
    clearTimeout(bubbleTimer);
    $('bubble-bot').classList.add('hidden');
    $('bubble-user').classList.add('hidden');
  }
  new MutationObserver(() => {
    const bot = $('bubble-bot');
    const text = bot.textContent.trim();
    bot.classList.toggle('hidden', !text);
    clearTimeout(bubbleTimer);
    // Lange Antworten (z. B. Hilfe) bleiben länger stehen
    if (text) bubbleTimer = setTimeout(hideBubbles, Math.max(5000, text.length * 70));
  }).observe($('bubble-bot'), { childList: true, characterData: true, subtree: true });
  $('bubble-bot').onclick = hideBubbles;
  $('bubble-user').onclick = hideBubbles;

  // ---------- Einführung beim ersten Start ----------
  const INTRO_KEY = 'viovi-intro-done';
  function showIntro() {
    const box = $('intro');
    const slides = box.querySelectorAll('.intro-slide');
    const dots = box.querySelectorAll('.intro-dots span');
    let i = 0;
    const go = (n) => {
      i = n;
      slides.forEach((s, k) => s.classList.toggle('active', k === i));
      dots.forEach((d, k) => d.classList.toggle('active', k === i));
      $('intro-next').textContent = i === slides.length - 1 ? 'Los geht’s' : 'Weiter';
    };
    const close = () => {
      box.classList.add('hidden');
      try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) {}
      if (location.search) history.replaceState(null, '', location.pathname);
    };
    $('intro-next').onclick = () => (i < slides.length - 1 ? go(i + 1) : close());
    $('intro-skip').onclick = close;
    go(0);
    box.classList.remove('hidden');
  }
  function maybeIntro() {
    let introDone = false;
    try { introDone = localStorage.getItem(INTRO_KEY) === '1'; } catch (e) {}
    if (!introDone || /[?&]intro=1/.test(location.search)) showIntro();
  }
  // Mit Cloud zeigt cloud.js die Einführung erst nach dem Anmelden
  const cloudOn = !!(window.VIOVI_CONFIG && window.VIOVI_CONFIG.supabaseUrl);
  if (!cloudOn) maybeIntro();

  // ---------- Start ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  updateNotifyBtn();
  render();
  checkReminders();
  setInterval(checkReminders, 5000);
  setInterval(() => { if (view === 'heute') render(); }, 60000);

  window.Viovi = {
    handleInput,
    data: () => data,
    // Daten aus der Cloud übernehmen (ohne erneut hochzuladen)
    setData(next) {
      data = Object.assign({ events: [], notes: [], reminders: [] }, next);
      persist(); render();
    },
    clearLocal() {
      data = { events: [], notes: [], reminders: [] };
      persist(); render();
    },
    maybeIntro, showDialog, closeSheets, esc,
  };
})();
