/* Viovi – versteht deutsche Sprachbefehle und macht daraus Aktionen.
   Alles läuft lokal im Browser. */
(function () {
  'use strict';

  const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli',
    'august', 'september', 'oktober', 'november', 'dezember'];
  const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];

  // Zahlwörter -> Zahlen
  const NUMS = {
    null: 0, ein: 1, eins: 1, eine: 1, einer: 1, einem: 1, einen: 1, zwei: 2, drei: 3,
    vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
    dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18,
    neunzehn: 19, zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60,
  };
  const UNITS = ['ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  UNITS.forEach((u, i) => {
    NUMS[u + 'undzwanzig'] = 21 + i;
    NUMS[u + 'unddreißig'] = 31 + i;
    NUMS[u + 'undvierzig'] = 41 + i;
    NUMS[u + 'undfünfzig'] = 51 + i;
  });

  // Ordnungszahlen (erster, dritten, einunddreißigsten …)
  const ORD = {};
  const ordStem = (n) => {
    const special = { 1: 'erst', 3: 'dritt', 7: 'siebt', 8: 'acht' };
    if (special[n]) return special[n];
    const word = Object.keys(NUMS).find((k) => NUMS[k] === n && !/^(eins?|eine[rmn]?)$/.test(k));
    return n < 20 ? word + 't' : word + 'st';
  };
  for (let n = 1; n <= 31; n++) {
    const stem = ordStem(n);
    ['e', 'en', 'er', 'em'].forEach((s) => { ORD[stem + s] = n; });
  }

  const byLen = (a, b) => b.length - a.length;
  const NUM = '(\\d{1,2}|' + Object.keys(NUMS).sort(byLen).join('|') + ')';
  const DAYNUM = '(\\d{1,2}|' + Object.keys(ORD).sort(byLen).join('|') + ')';
  const MON = '(' + MONTHS.join('|') + '|jänner)';
  const WD = '(' + WEEKDAYS.join('|') + ')';
  // Wortgrenzen, die auch mit Umlauten funktionieren
  const B = '(?<![\\p{L}\\d])';
  const E = '(?![\\p{L}\\d])';
  const rx = (src) => new RegExp(B + src + E, 'iu');

  function num(s) {
    if (s == null) return null;
    s = String(s).toLowerCase();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s in NUMS) return NUMS[s];
    if (s in ORD) return ORD[s];
    return null;
  }

  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  const PART_TIMES = {
    morning: { h: 8, m: 0 }, forenoon: { h: 10, m: 0 }, noon: { h: 12, m: 0 },
    afternoon: { h: 15, m: 0 }, evening: { h: 19, m: 0 }, night: { h: 22, m: 0 },
  };
  function partOf(word) {
    word = word.toLowerCase();
    if (/^(früh|morgens?|morgen früh)$/.test(word)) return 'morning';
    if (/^vormittags?$/.test(word)) return 'forenoon';
    if (/^mittags?$/.test(word)) return 'noon';
    if (/^nachmittags?$/.test(word)) return 'afternoon';
    if (/^abends?$/.test(word)) return 'evening';
    if (/^nachts?$/.test(word)) return 'night';
    return null;
  }

  /* Findet Datum/Uhrzeit im Text.
     Rückgabe: { when: Date|null, allDay, rest: Text ohne Zeitangaben } */
  function extractWhen(input, now) {
    now = now || new Date();
    let s = ' ' + String(input).replace(/[,!?;]/g, ' ').replace(/\.\s*$/, '').replace(/\s+/g, ' ') + ' ';
    let date = null, time = null, abs = null, part = null;

    const take = (src, fn) => {
      const m = s.match(rx(src));
      if (!m) return false;
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
      fn(m);
      return true;
    };

    // --- relative Angaben: "in 10 Minuten", "in einer halben Stunde" ---
    take('in (?:einer )?halben stunde', () => { abs = new Date(now.getTime() + 30 * 60000); });
    take('in (?:einer )?viertel ?stunde', () => { abs = new Date(now.getTime() + 15 * 60000); });
    take('in (?:einer )?dreiviertel ?stunde', () => { abs = new Date(now.getTime() + 45 * 60000); });
    take('in (?:anderthalb|eineinhalb) stunden', () => { abs = new Date(now.getTime() + 90 * 60000); });
    take('in ' + NUM + ' (minuten?|min|sekunden?|stunden?|std|tagen?|wochen?|monaten?)(?: und ' + NUM + ' minuten?)?', (m) => {
      const n = num(m[1]) || 1;
      const unit = m[2].toLowerCase();
      if (/^sek/.test(unit)) abs = new Date(now.getTime() + n * 1000);
      else if (/^min/.test(unit)) abs = new Date(now.getTime() + n * 60000);
      else if (/^(stunde|std)/.test(unit)) abs = new Date(now.getTime() + n * 3600000 + (num(m[3]) || 0) * 60000);
      else if (/^tag/.test(unit)) date = addDays(startOfDay(now), n);
      else if (/^woche/.test(unit)) date = addDays(startOfDay(now), n * 7);
      else if (/^monat/.test(unit)) { date = startOfDay(now); date.setMonth(date.getMonth() + n); }
    });

    // --- Uhrzeit ---
    take('(?:um |gegen )?halb ' + NUM + '(?: uhr)?', (m) => { time = { h: num(m[1]) - 1, m: 30 }; });
    take('(?:um |gegen )?viertel nach ' + NUM, (m) => { time = { h: num(m[1]), m: 15 }; });
    take('(?:um |gegen )?viertel vor ' + NUM, (m) => { time = { h: num(m[1]) - 1, m: 45 }; });
    take('(?:um |gegen )?dreiviertel ' + NUM, (m) => { time = { h: num(m[1]) - 1, m: 45 }; });
    if (!time) take('(?:um |gegen |ab )?' + NUM + '(?: ?[:.] ?(\\d{2}))? ?uhr(?: ' + NUM + ')?', (m) => {
      time = { h: num(m[1]), m: m[2] ? parseInt(m[2], 10) : (num(m[3]) || 0) };
    });
    if (!time) take('(?:um|gegen) ' + NUM + '(?: ?[:.] ?(\\d{2}))?', (m) => {
      time = { h: num(m[1]), m: m[2] ? parseInt(m[2], 10) : 0 };
    });

    // --- Tageszeit ---
    take('(?:heute|morgen|übermorgen)? ?(?:am |in der )?(früh|morgens|vormittags?|mittags?|nachmittags?|abends?|nachts?)', (m) => {
      // "heute/morgen" vorne wieder freigeben, damit sie unten als Tag erkannt werden
      const lead = m[0].trim().split(' ')[0].toLowerCase();
      if (['heute', 'morgen', 'übermorgen'].includes(lead)) s = ' ' + lead + s;
      part = partOf(m[1]);
    });
    take('zu mittag', () => { part = 'noon'; });

    // --- Tag ---
    take('übermorgen', () => { date = addDays(startOfDay(now), 2); });
    take('morgen', () => { date = addDays(startOfDay(now), 1); });
    take('heute', () => { date = startOfDay(now); });
    take('(?:am |den |diesen |nächsten |kommenden )?' + DAYNUM + '\\.? ?' + MON + '(?: (\\d{4}))?', (m) => {
      const d = num(m[1]);
      const mon = m[2].toLowerCase() === 'jänner' ? 0 : MONTHS.indexOf(m[2].toLowerCase());
      let y = m[3] ? parseInt(m[3], 10) : now.getFullYear();
      let cand = new Date(y, mon, d);
      if (!m[3] && cand < startOfDay(now)) cand = new Date(y + 1, mon, d);
      date = cand;
    });
    take('(?:am |den )?(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2,4})?', (m) => {
      let y = m[3] ? parseInt(m[3], 10) : now.getFullYear();
      if (y < 100) y += 2000;
      let cand = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      if (!m[3] && cand < startOfDay(now)) cand.setFullYear(y + 1);
      date = cand;
    });
    take('(?:am |diesen |nächsten |nächste woche |kommenden )*' + WD + 's?', (m) => {
      const target = WEEKDAYS.indexOf(m[1].toLowerCase());
      let diff = (target - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      if (/nächste woche/i.test(m[0]) && diff < 7 && now.getDay() !== 0 && target > now.getDay()) diff += 7;
      date = addDays(startOfDay(now), diff);
    });
    take('nächste woche', () => {
      const diff = ((1 - now.getDay() + 7) % 7) || 7; // nächster Montag
      date = addDays(startOfDay(now), diff);
    });

    // --- Uhrzeit sinnvoll machen ---
    if (time) {
      if (part && ['afternoon', 'evening', 'night'].includes(part) && time.h < 12) time.h += 12;
      else if (!part && time.h >= 1 && time.h <= 5) time.h += 12; // "um 3" = 15 Uhr
      if (time.h === 24) time.h = 0;
    } else if (part) {
      time = PART_TIMES[part];
    }

    let when = null, allDay = false;
    if (abs) {
      when = abs;
    } else if (date || time) {
      const d = date ? new Date(date) : startOfDay(now);
      if (time) d.setHours(time.h, time.m, 0, 0);
      else allDay = true;
      if (!date && time && d <= now) d.setDate(d.getDate() + 1);
      when = d;
    }

    const rest = s.replace(/\s+/g, ' ').trim();
    return { when, allDay, rest };
  }

  // Füllwörter vorne/hinten entfernen und schön machen
  function tidy(text, fillersStart, fillersEnd) {
    let t = ' ' + text + ' ';
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of fillersStart) {
        const re = new RegExp('^\\s*' + f + '(?![\\p{L}\\d])', 'iu');
        if (re.test(t)) { t = t.replace(re, ''); changed = true; }
      }
      for (const f of fillersEnd || []) {
        const re = new RegExp('(?<![\\p{L}\\d])' + f + '\\s*$', 'iu');
        if (re.test(t)) { t = t.replace(re, ''); changed = true; }
      }
    }
    t = t.replace(/\s+/g, ' ').replace(/^[\s:.\-]+|[\s:\-]+$/g, '').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  const REM_START = ['bitte', 'erinnere', 'erinner', 'erinnerung', 'mich', 'uns', 'bitte', 'an', 'daran', 'dass', 'das', 'zu', 'am', 'um', 'neue', 'setze?', 'stelle?', 'eine', 'den', 'die', 'der', 'dem', 'ans'];
  const EVT_START = ['bitte', 'neuer', 'neuen', 'einen?', 'termin', 'trage?', 'trag', 'plane?', 'mir', 'ein', 'den', 'am', 'um', 'für', 'mit dem titel', 'namens', ':'];
  const EVT_END = ['ein', 'eintragen', 'in den kalender', 'im kalender', 'in meinen kalender', 'in meinem kalender', 'bitte', 'am', 'um', 'ein termin', 'termin'];

  /* Hauptfunktion: Satz -> Befehl */
  function parse(raw, now) {
    now = now || new Date();
    const text = String(raw || '').trim().replace(/\s+/g, ' ');
    const l = text.toLowerCase().replace(/[.!?]+$/, '');
    if (!l) return { type: 'empty' };

    if (/^(hilfe|was kannst du|wie funktioniert|welche befehle|befehle)/.test(l)) return { type: 'help' };
    if (/^(rückgängig|mach (das|es) rückgängig|undo|wiederherstellen)/.test(l)) return { type: 'undo' };
    if (/^(stopp?|abbrechen|abbruch|vergiss es|egal|nichts)$/.test(l)) return { type: 'cancel' };
    if (/^(danke|dankeschön|vielen dank)/.test(l)) return { type: 'thanks' };

    // Navigation
    let m = l.match(/^(zeig|zeige|öffne|geh zu|gehe zu|wechsel zu|wechsle zu)( mir)?( die| den| das| meine?n?)? ?(kalender|notizen|erinnerungen|übersicht|heute|start)/);
    if (m) {
      const map = { kalender: 'kalender', notizen: 'notizen', erinnerungen: 'erinnerungen', übersicht: 'heute', heute: 'heute', start: 'heute' };
      return { type: 'nav', view: map[m[4]] };
    }

    // Löschen
    if (/^(lösch|entfern|streich|lösche)/.test(l)) {
      const kind = /notiz/.test(l) ? 'note' : /termin/.test(l) ? 'event' : /erinnerung/.test(l) ? 'reminder' : null;
      if (/(letzte|neueste|zuletzt)/.test(l)) return { type: 'delete', kind, which: 'last' };
      const n = l.match(new RegExp('(?:notiz|termin|erinnerung)(?: nummer| nr\\.?)? ' + NUM + '$', 'iu'));
      if (n) return { type: 'delete', kind, which: 'index', index: num(n[1]) };
      const q = l.replace(/^(lösche|lösch|entferne|entfern|streiche|streich)\s*/, '')
        .replace(/^(bitte\s*)?(die|den|das|meine?n?)?\s*(notiz|termin|erinnerung)(en)?\s*/, '')
        .replace(/^(über|zu|mit|namens|an)\s+/, '')
        .replace(/\s*(bitte)?$/, '').trim();
      return { type: 'delete', kind, which: 'query', query: q };
    }

    // Erledigt markieren
    m = l.match(/^(?:erinnerung )?(.+?) (?:ist )?erledigt$/) || l.match(/^(?:hake|hak) (.+?) ab$/);
    if (m && !/^(alle|ich)/.test(m[1])) return { type: 'done', query: m[1].replace(/^(die |den |das |erinnerung )/, '') };

    // Vorlesen
    if (/(lies|lese|vorlesen|was steht in|welche notizen|was habe ich notiert)/.test(l) && /notiz|notiert/.test(l)) return { type: 'readNotes' };
    if (/(welche|was für|lies|lese|habe ich|hab ich).*(erinnerung)/.test(l)) return { type: 'readReminders' };

    // Tagesplan abfragen
    if (/^(was steht|was habe ich|was hab ich|was hab' ich|welche termine|habe ich|hab ich|was ist|was gibt'?s|wie sieht|mein tag|tagesplan|termine)/.test(l) &&
        !/^(habe ich|hab ich) (eine )?notiz/.test(l)) {
      const w = extractWhen(text, now);
      const day = w.when ? startOfDay(w.when) : startOfDay(now);
      const week = /(woche)/.test(l) && !/nächste woche/.test(l) ? true : /nächste woche/.test(l);
      return { type: 'agenda', date: day, week };
    }

    // Notiz
    m = text.match(/^(neue )?(notiz|notiere|notier|schreib(e)?( mir)?( bitte)? auf|schreib(e)? mit|merk(e)? dir|halte fest|halt fest|speichere?)( mir)?( bitte)?( dass| das| folgendes)?[:,]?\s*/i);
    if (m) {
      let note = text.slice(m[0].length).replace(/\s*(auf|fest)$/i, '').trim();
      return { type: 'note', text: note ? note.charAt(0).toUpperCase() + note.slice(1) : '' };
    }
    m = text.match(/^(.+?)\s+(notieren|aufschreiben|merken)$/i);
    if (m) return { type: 'note', text: m[1].charAt(0).toUpperCase() + m[1].slice(1) };

    // Erinnerung
    if (/^(bitte )?(erinnere?|erinner|erinnerung|neue erinnerung|wecke?|weck)/.test(l)) {
      const w = extractWhen(text, now);
      const t = tidy(w.rest, REM_START, ['bitte', 'erinnern']);
      return { type: 'reminder', text: t, when: w.when, allDay: w.allDay };
    }

    // Termin
    const w = extractWhen(text, now);
    if (/(termin|trag|eintragen|plane?|kalender|treffen|verabredung|meeting|besprechung|geburtstag)/.test(l) || w.when) {
      const t = tidy(w.rest, EVT_START, EVT_END);
      return { type: 'event', title: t, when: w.when, allDay: w.allDay };
    }

    return { type: 'unknown', text };
  }

  window.VioviParser = { parse, extractWhen, num };
})();
