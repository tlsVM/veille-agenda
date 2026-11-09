/* Veille et agenda · Vivre Mieux — interface
   Les données viennent de api.php (feuille Google + présences enregistrées sur le serveur). */
(function () {
  'use strict';

  // ---------- Outils ----------
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var JC = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MC = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function lien(url, txt) { var a = el('a', '', txt); if (/^https?:\/\//.test(url || '')) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; } return a; }
  function cle(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dDe(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function ajout(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function lundi(d) { return ajout(d, -((d.getDay() + 6) % 7)); }
  function hFmt(h) { return h ? h.replace(':', 'H') : ''; }
  function courte(k) { var d = dDe(k); return d.getDate() + ' ' + MC[d.getMonth()]; }
  function norm(t) { return (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var AUJ = cle(new Date());

  // Types d'événements : couleur et rangement
  // Couleurs reprises de l'agenda Gmail « Agenda élu.e.s mairie Vivre Mieux »
  // c = couleur, f = fond de la carte, h = heure (si la couleur est claire), k = texte de l'étiquette
  var GLYCINE = { c: '#b39ddb', f: '#f6f2fc', h: '#6a4fa3', k: '#2e1f55', g: 'groupe' };
  var FLAMANT = { c: '#e67c73', f: '#fdf3f2', h: '#c2554b', g: 'quartier' };
  var MYRTILLE = { c: '#3f51b5', f: '#f1f3fb', g: 'proto' };
  var PAON = { c: '#039be5', f: '#eef8fd', h: '#0277bd', g: 'proto' };
  var TYPES = {
    'Réunion de groupe': GLYCINE,
    'Protocole': MYRTILLE, 'Cérémonie': MYRTILLE, 'Inauguration': MYRTILLE,
    'Commission': PAON, 'Conseil municipal': PAON,
    'Réunion officielle': FLAMANT, 'Concertation': FLAMANT, 'Réunion publique': FLAMANT,
    'Association de quartier': { c: '#e08a1e', f: '#fff7ec', g: 'quartier' },
    'Vie associative': { c: '#e08a1e', f: '#fff7ec', g: 'quartier' },
    'Militant': { c: '#e00000', f: '#fff1f1', g: 'militant' },
    'Institutionnel': { c: '#56708a', f: '#fff', g: 'autre' },
    'Autre': { c: '#56708a', f: '#fff', g: 'autre' },
    'Culture': { c: '#a9874f', f: '#fffaf1', g: 'culture' },
    'Conférence': { c: '#0b8043', f: '#eef7f1', g: 'culture' },
    'Café-débat': { c: '#0b8043', f: '#eef7f1', g: 'culture' },
    'Mairie': { c: '#c9c9c9', f: '#fff', h: '#616161', k: '#333', g: 'mairie' },
    'Majorité': { c: '#5b4b8a', f: '#f8f6fc', g: 'majo' }
  };
  function typeDe(e) { return TYPES[e.type] ? e.type : 'Autre'; }
  var FILTRES = [['tout', 'Tout'], ['proto', 'Protocole et commissions'], ['quartier', 'Réunions de quartier'], ['militant', 'Militant'], ['culture', 'Culture et conférences'], ['mairie', 'Événements mairie']];

  // ---------- État ----------
  var D = { evenements: [], actus: [], quartiers: [], presences: {}, elus: [] };
  var vue = store('vm-vue') || 'jour';
  var filtre = 'tout';
  var jourChoisi = '';
  var moisCal = '';
  var moi = store('vm-moi') || '';
  var selQ = { s: store('vm-sec') || '', q: store('vm-q') || '' };
  var recherche = '';

  // ---------- Données ----------
  function charger(frais) {
    return fetch('api.php?a=data' + (frais ? '&frais=1' : ''), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.erreur === 'code') { afficherCode(); return; }
      if (d.erreur && !d.evenements) { afficherErreur(d.erreur); return; }
      D = d; D.evenements = d.evenements || []; D.actus = d.actus || []; D.quartiers = d.quartiers || []; D.presences = d.presences || {};
      ajouterReunionsGroupe(); signature = sigPresences();
      D.evenements.sort(function (a, b) { return (a.date + (a.heure || '99')).localeCompare(b.date + (b.heure || '99')); });
      remplirMoi(); rendre();
    }).catch(function () { afficherErreur('reseau'); });
  }
  // Réunion de groupe : tous les lundis à 12h30, ajoutée automatiquement.
  // Une ligne « Réunion de groupe » dans la feuille à la même date la remplace (autre heure, lieu, « Annulée »…).
  function ajouterReunionsGroupe() {
    var deja = {};
    D.evenements.forEach(function (e) { if (e.type === 'Réunion de groupe') deja[e.date] = 1; });
    for (var d = dDe('2026-10-05'), fin = ajout(new Date(), 70); d <= fin; d = ajout(d, 7)) {
      var k = cle(d); if (deja[k]) continue;
      D.evenements.push({ id: 'rg' + k.replace(/-/g, ''), date: k, heure: '12:30', type: 'Réunion de groupe', titre: 'Réunion de groupe Vivre Mieux', lieu: '', details: '' });
    }
  }
  function rafraichirPresences() {
    fetch('api.php?a=pres', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.presences) return; D.presences = d.presences; majPresences();
    }).catch(function () {});
  }
  function afficherErreur(code) {
    var v = document.getElementById('vue'); v.textContent = '';
    var msg = code === 'config' ? 'La plateforme attend son fichier de réglages sur le serveur (étape à faire par Hugo).'
      : code === 'feuille' ? 'La feuille Google n\'est pas lisible pour l\'instant (vérifier qu\'elle est partagée « toute personne disposant du lien »).'
      : 'Connexion impossible pour le moment. Réessayez dans un instant.';
    v.appendChild(el('p', 'vide', msg));
  }

  // ---------- Qui coche ----------
  function remplirMoi() {
    var s = document.getElementById('moi'); s.textContent = '';
    var o0 = el('option', '', '— choisir —'); o0.value = ''; s.appendChild(o0);
    (D.elus || []).forEach(function (n) { var o = el('option', '', n); o.value = n; if (n === moi) o.selected = true; s.appendChild(o); });
    if (!moi) ouvrirChoix();
  }
  function ouvrirChoix() {
    var m = document.getElementById('choix-nom'), l = document.getElementById('choix-liste'); l.textContent = '';
    (D.elus || []).forEach(function (n) {
      var b = el('button', '', n); b.type = 'button';
      b.addEventListener('click', function () { choisirMoi(n); m.hidden = true; });
      l.appendChild(b);
    });
    var plus = el('button', '', 'Plus tard'); plus.type = 'button'; plus.style.color = '#5b6a61';
    plus.addEventListener('click', function () { m.hidden = true; }); l.appendChild(plus);
    m.hidden = false;
  }
  function choisirMoi(n) { moi = n; store('vm-moi', n); document.getElementById('moi').value = n; majPresences(); }
  document.getElementById('moi').addEventListener('change', function (e) { moi = e.target.value; store('vm-moi', moi); majPresences(); });

  // ---------- Présences ----------
  var COURT = function (n) { var p = n.replace(' (collaborateur)', '').split(' '); return p.length > 1 ? p[0].charAt(0) + '. ' + p.slice(1).join(' ') : n; };
  function blocPresence(id) {
    var w = el('div', 'pres'); w.setAttribute('data-id', id);
    [['present', 'Présent·e'], ['peut', 'Peut-être']].forEach(function (v) {
      var b = el('button', 'pb' + (v[0] === 'peut' ? ' peut' : ''), v[1]); b.type = 'button'; b.setAttribute('data-s', v[0]);
      b.addEventListener('click', function (ev) { ev.stopPropagation(); cocher(id, v[0], w); });
      w.appendChild(b);
    });
    var g = el('button', 'pb-autre', '✎ Cocher pour un·e élu·e'); g.type = 'button';
    g.addEventListener('click', function (ev) { ev.stopPropagation(); ouvrirGestion(id, w); });
    w.appendChild(g);
    w.appendChild(el('span', 'qui'));
    peindrePresence(w);
    return w;
  }
  function peindrePresence(w) {
    var id = w.getAttribute('data-id'), p = D.presences[id] || {}, mien = moi ? p[moi] : '';
    w.querySelectorAll('.pb').forEach(function (b) {
      var on = b.getAttribute('data-s') === mien; b.classList.toggle('on', on);
      b.textContent = (on ? '✓ ' : '') + (b.getAttribute('data-s') === 'peut' ? 'Peut-être' : 'Présent·e');
    });
    var pr = [], pe = [];
    Object.keys(p).forEach(function (n) { if (p[n] === 'present') pr.push(COURT(n)); else if (p[n] === 'peut') pe.push(COURT(n)); });
    var q = w.querySelector('.qui'); q.textContent = '';
    if (pr.length) q.appendChild(document.createTextNode('Présent·es : ' + pr.join(', ')));
    if (pe.length) { if (pr.length) q.appendChild(document.createTextNode(' · ')); q.appendChild(el('i', '', 'Peut-être : ' + pe.join(', '))); }
    q.hidden = !(pr.length || pe.length);
  }
  function majPresences() { document.querySelectorAll('.pres').forEach(peindrePresence); verifierRangement(); }
  function cocher(id, s, w) {
    if (!moi) { ouvrirChoix(); return; }
    cocherPour(id, moi, s);
  }
  // Coche (ou décoche si on reclique) la présence de « nom » sur l'événement « id »
  function cocherPour(id, nom, s, apres) {
    var actuel = (D.presences[id] || {})[nom], nouveau = actuel === s ? '' : s;
    // affichage immédiat, puis enregistrement
    D.presences[id] = D.presences[id] || {}; if (nouveau) D.presences[id][nom] = nouveau; else delete D.presences[id][nom];
    majPresences(); if (apres) apres();
    var corps = new URLSearchParams({ a: 'pres', id: id, nom: nom, statut: nouveau });
    fetch('api.php', { method: 'POST', body: corps }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.presences) { D.presences = d.presences; majPresences(); if (apres) apres(); }
      else alert('La présence n\'a pas pu être enregistrée. Réessayez.');
    }).catch(function () { alert('Pas de connexion : la présence n\'a pas été enregistrée.'); });
  }

  // Fenêtre « Cocher pour un·e élu·e » : tous les noms, un clic par personne
  function ouvrirGestion(id, w) {
    var ev = D.evenements.filter(function (e) { return e.id === id; })[0];
    var m = el('div', 'modale'), bx = el('div', 'modale-boite gestion'); bx.setAttribute('role', 'dialog');
    bx.appendChild(el('h2', '', 'Présences'));
    if (ev) bx.appendChild(el('p', '', (ev.heure ? hFmt(ev.heure) + ' · ' : '') + courte(ev.date) + ' · ' + ev.titre));
    var liste = el('div', 'gest-liste'); bx.appendChild(liste);
    function peindre() {
      liste.textContent = ''; var p = D.presences[id] || {};
      (D.elus || []).forEach(function (n) {
        var ligne = el('div', 'gest-ligne'); ligne.appendChild(el('span', 'gest-nom', n.replace(' (collaborateur)', '')));
        [['present', 'Présent·e'], ['peut', 'Peut-être']].forEach(function (v) {
          var on = p[n] === v[0];
          var b = el('button', 'pb' + (v[0] === 'peut' ? ' peut' : '') + (on ? ' on' : ''), (on ? '✓ ' : '') + v[1]); b.type = 'button';
          b.addEventListener('click', function () { cocherPour(id, n, v[0], peindre); });
          ligne.appendChild(b);
        });
        liste.appendChild(ligne);
      });
    }
    peindre();
    var f = el('button', 'gest-fermer', 'Fermer'); f.type = 'button';
    f.addEventListener('click', function () { m.remove(); verifierRangement(); }); bx.appendChild(f);
    m.addEventListener('click', function (e) { if (e.target === m) { m.remove(); verifierRangement(); } });
    m.appendChild(bx); document.body.appendChild(m);
  }

  // ---------- Cartes ----------
  // Petit bouton « copier » discret (deux feuilles superposées)
  var ICO_COPIE = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5" y="5" width="8.5" height="9" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 10.5h-.3A1.4 1.4 0 0 1 1.8 9.1V3.2A1.4 1.4 0 0 1 3.2 1.8h5.9a1.4 1.4 0 0 1 1.4 1.4v.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  function texteEv(e, avecJour) {
    var d = dDe(e.date), l = [];
    l.push((avecJour ? JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + (e.heure ? ' · ' : '') : '') + (e.heure ? e.heure.replace(':', 'h') : '') + ((avecJour || e.heure) ? ' · ' : '') + e.titre);
    if (e.lieu || e.quartier) l.push('📍 ' + (e.lieu || '') + (e.quartier ? (e.lieu ? ' (' + e.quartier + ')' : e.quartier) : ''));
    if (e.details) l.push(e.details);
    if (e.lien) l.push('🔗 ' + e.lien);
    return l.join('\n');
  }
  function btCopie(getTexte, titre) {
    var b = el('button', 'bt-copie'); b.type = 'button'; b.title = titre || 'Copier'; b.setAttribute('aria-label', titre || 'Copier'); b.innerHTML = ICO_COPIE;
    b.addEventListener('click', function (ev) {
      ev.stopPropagation(); var t = getTexte();
      function ok() { b.classList.add('ok'); b.textContent = '✓'; setTimeout(function () { b.classList.remove('ok'); b.innerHTML = ICO_COPIE; }, 1300); }
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(ok).catch(function () { var ta = el('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (x) {} ta.remove(); });
    });
    return b;
  }
  // ---------- Ajouter à mon agenda (Google, Outlook, Apple) ----------
  function bornes(e) { // début et fin (1h30 par défaut), ou journée entière
    if (!e.heure) { var f = ajout(dDe(e.date_fin || e.date), 1); return { jour: true, d: e.date.replace(/-/g, ''), f: cle(f).replace(/-/g, ''), di: e.date, fi: cle(f) }; }
    var p = e.date.split('-'), h = e.heure.split(':'), deb = new Date(+p[0], +p[1] - 1, +p[2], +h[0], +h[1]), fin = new Date(deb.getTime() + 90 * 60000);
    function c(x) { return cle(x).replace(/-/g, '') + 'T' + ('0' + x.getHours()).slice(-2) + ('0' + x.getMinutes()).slice(-2) + '00'; }
    function iso(x) { return cle(x) + 'T' + ('0' + x.getHours()).slice(-2) + ':' + ('0' + x.getMinutes()).slice(-2) + ':00'; }
    return { jour: false, d: c(deb), f: c(fin), di: iso(deb), fi: iso(fin) };
  }
  function lieuDe(e) { return (e.lieu || '') + (e.quartier ? (e.lieu ? ' (' + e.quartier + ')' : e.quartier) : ''); }
  function descDe(e) { return [e.details || '', e.lien || ''].filter(Boolean).join('\n'); }
  function lienGoogle(e) {
    var b = bornes(e);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.titre) + '&dates=' + b.d + '/' + b.f + '&ctz=Europe/Paris&location=' + encodeURIComponent(lieuDe(e)) + '&details=' + encodeURIComponent(descDe(e));
  }
  function lienOutlook(e) {
    var b = bornes(e);
    return 'https://outlook.office.com/calendar/0/action/compose?subject=' + encodeURIComponent(e.titre) + '&startdt=' + b.di + '&enddt=' + b.fi + (b.jour ? '&allday=true' : '') + '&location=' + encodeURIComponent(lieuDe(e)) + '&body=' + encodeURIComponent(descDe(e));
  }
  function choixAgenda(titre, sousTitre, choix, note) {
    var m = el('div', 'modale'), bx = el('div', 'modale-boite gestion choix-ag'); bx.setAttribute('role', 'dialog');
    bx.appendChild(el('h2', '', titre)); if (sousTitre) bx.appendChild(el('p', '', sousTitre));
    choix.forEach(function (c) {
      var a = el('a', 'bt-ag', c[0]); a.href = c[1]; if (/^https/.test(c[1])) { a.target = '_blank'; a.rel = 'noopener'; }
      if (c[2]) a.appendChild(el('small', '', c[2]));
      a.addEventListener('click', function () { setTimeout(function () { m.remove(); }, 300); }); bx.appendChild(a);
    });
    if (note) bx.appendChild(note);
    var f = el('button', 'gest-fermer', 'Fermer'); f.type = 'button'; f.addEventListener('click', function () { m.remove(); }); bx.appendChild(f);
    m.addEventListener('click', function (x) { if (x.target === m) m.remove(); });
    m.appendChild(bx); document.body.appendChild(m);
  }
  function ouvrirAjoutAgenda(e) {
    choixAgenda('Ajouter à mon agenda', (e.heure ? hFmt(e.heure) + ' · ' : '') + courte(e.date) + ' · ' + e.titre, [
      ['Google Agenda', lienGoogle(e)],
      ['Outlook', lienOutlook(e), 'agenda Microsoft (mairie, pro)'],
      ['Apple ou autre agenda', 'api.php?a=ics&id=' + encodeURIComponent(e.id), 'iPhone, Mac, Outlook sur PC… (fichier .ics)']
    ]);
  }
  function lienAbonnement(nom, https) {
    var u = new URL('api.php?a=agenda&qui=' + encodeURIComponent(nom) + '&k=' + ((D.cles_agenda || {})[nom] || ''), location.href).href;
    return https ? u : u.replace(/^https?:/, 'webcal:');
  }
  function ouvrirAbonnement(nom) {
    var https = lienAbonnement(nom, true), web = lienAbonnement(nom, false);
    var note = el('div', 'ab-note');
    note.appendChild(el('p', '', 'Une seule fois : vos rendez-vous cochés « Présent·e » (et « Peut-être », marqués ❔) apparaîtront ensuite tout seuls dans votre agenda, et se mettront à jour.'));
    note.appendChild(el('p', '', 'Délai de mise à jour : environ 1 h sur iPhone et Outlook, jusqu\'à 12 h sur Google Agenda.'));
    var cp = el('button', 'bt-ps', '📋 Copier le lien d\'abonnement'); cp.type = 'button';
    cp.addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(https) : Promise.reject()).then(function () { cp.textContent = '✓ Lien copié'; }).catch(function () { prompt('Copiez ce lien :', https); }); });
    note.appendChild(cp);
    note.appendChild(el('p', 'ab-perso', 'Ce lien est personnel : ne le partagez pas.'));
    choixAgenda('Abonner mon agenda', 'Agenda de ' + nomLong(nom), [
      ['Google Agenda', 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(web), 'sur ordinateur de préférence'],
      ['iPhone, iPad, Mac', web, 'appuyez puis « S\'abonner »'],
      ['Outlook', 'https://outlook.office.com/calendar/0/addfromweb?url=' + encodeURIComponent(https) + '&name=' + encodeURIComponent('Vivre Mieux'), 'agenda Microsoft (mairie, pro)']
    ], note);
  }

  function carteEv(e, avecDate) {
    var t = TYPES[typeDe(e)], c = el('div', 'ev' + (e.important === 'oui' ? ' cle' : ''));
    c.style.setProperty('--c', t.c); c.style.setProperty('--f', t.f); if (t.h) c.style.setProperty('--h', t.h); if (t.k) c.style.setProperty('--k', t.k);
    var h = el('div', 'haut');
    if (avecDate) h.appendChild(el('span', 'h', courte(e.date)));
    if (e.heure) h.appendChild(el('span', 'h', hFmt(e.heure)));
    h.appendChild(el('span', 'tag', e.type || 'Autre'));
    if (e.important === 'oui') h.appendChild(el('span', 'imp', 'IMPORTANT'));
    var ti = el('div', 't'); if (e.lien) ti.appendChild(lien(e.lien, e.titre)); else ti.textContent = e.titre;
    h.appendChild(ti); c.appendChild(h);
    if (e.quartier) c.appendChild(el('span', 'qp', e.quartier));
    if (e.qui) c.appendChild(el('div', 'l', e.qui));
    if (e.lieu) c.appendChild(el('div', 'l', '→ ' + e.lieu + (e.date_fin && e.date_fin !== e.date ? ' · jusqu\'au ' + courte(e.date_fin) : '')));
    if (e.details) c.appendChild(el('div', 'd', e.details));
    if (e.photo === 'oui') {
      var ph = el('button', 'ev-photo'); ph.type = 'button'; ph.title = 'Voir la photo';
      var mi = el('img'); mi.src = 'api.php?a=photo&id=' + e.id; mi.alt = 'Photo jointe'; mi.loading = 'lazy'; ph.appendChild(mi);
      ph.addEventListener('click', function (ev) { ev.stopPropagation(); voirPhoto(e); }); c.appendChild(ph);
    }
    if (e.ajoute === 'oui') {
      var pa = el('div', 'par-qui', 'ajouté par ' + COURT(e.auteur || ''));
      if (moi && (moi === e.auteur || /collaborateur/.test(moi))) {
        var bm = el('button', 'lien-discret', 'modifier'); bm.type = 'button'; bm.addEventListener('click', function (ev) { ev.stopPropagation(); ouvrirAjout(e); });
        var bs = el('button', 'lien-discret', 'supprimer'); bs.type = 'button'; bs.addEventListener('click', function (ev) { ev.stopPropagation(); supprimerAjout(e); });
        pa.appendChild(document.createTextNode(' · ')); pa.appendChild(bm); pa.appendChild(document.createTextNode(' · ')); pa.appendChild(bs);
      }
      c.appendChild(pa);
    }
    if (t.g !== 'majo') c.appendChild(blocPresence(e.id));
    c.appendChild(btCopie(function () { return texteEv(e, true); }, 'Copier cet événement'));
    if (t.g !== 'majo') {
      var ba = el('button', 'bt-copie bt-cal-ev'); ba.type = 'button'; ba.title = 'Ajouter à mon agenda'; ba.setAttribute('aria-label', 'Ajouter à mon agenda');
      ba.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.8" y="2.8" width="12.4" height="11.4" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.8 6.3h12.4M5 1.3v3M11 1.3v3M8 8.3v4M6 10.3h4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
      ba.addEventListener('click', function (ev) { ev.stopPropagation(); ouvrirAjoutAgenda(e); }); c.appendChild(ba);
    }
    return c;
  }
  function carteActu(a) {
    var c = el('div', 'actu');
    if (a.quartier) c.appendChild(el('span', 'q', a.quartier));
    c.appendChild(el('b', '', a.titre));
    if (a.texte) c.appendChild(el('p', '', a.texte));
    if (a.source || a.lien) { var s = el('span', 'src'); if (a.lien) s.appendChild(lien(a.lien, a.source || 'Source')); else s.textContent = a.source; c.appendChild(s); }
    return c;
  }
  // Solution de secours sans IA : Google Actualités, 7 derniers jours
  function lienNews(q) {
    var p = el('p', 'nb'); var a = lien('https://news.google.com/search?hl=fr&gl=FR&ceid=FR:fr&q=' + encodeURIComponent('"' + q + '" Toulouse when:7d'), '→ Ouvrir Google Actualités sur « ' + q + ' » (7 derniers jours)');
    p.appendChild(a); return p;
  }
  // Expressions exactes pour chercher un quartier dans la presse sans homonymes :
  // « quartier des Chalets », « quartier Les Chalets », « aux Chalets »…
  function expressionsQuartier(q) {
    var m, x = [];
    if ((m = /^Les (.+)$/.exec(q))) x = ['quartier des ' + m[1], 'quartier ' + q, 'aux ' + m[1]];
    else if ((m = /^Le (.+)$/.exec(q))) x = ['quartier du ' + m[1], 'quartier ' + q, 'au ' + m[1]];
    else if ((m = /^La (.+)$/.exec(q))) x = ['quartier de la ' + m[1], 'quartier ' + q, 'à la ' + m[1]];
    else if (/s$/.test(q) && !/^(Saint|Sainte|Croix|Pont|Côte|Route|Château) /.test(q) && q.indexOf('-') < 0) x = ['quartier des ' + q, 'quartier ' + q, 'aux ' + q];
    else if (/^[AEÉIOUH]/.test(q)) x = ['quartier ' + q, 'quartier d\'' + q, 'à ' + q + ' à Toulouse'];
    else x = ['quartier ' + q, 'quartier de ' + q, 'à ' + q + ' à Toulouse'];
    return x;
  }
  function chercherPresse(q, res, bt) {
    bt.disabled = true; res.textContent = ''; res.appendChild(el('p', 'nb', 'Recherche en cours… (jusqu\'à 30 secondes)'));
    fetch('api.php?a=presse&q=' + encodeURIComponent(q), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      bt.disabled = false; res.textContent = '';
      if (d.erreur) {
        var m = { cle: 'La recherche n\'est pas encore activée : il manque la clé Gemini sur le serveur (étape à faire par Hugo).', plafond: 'Nombre maximal de recherches atteint pour aujourd\'hui. Réessayez demain.', quota: 'Le quota gratuit de Gemini est atteint pour aujourd\'hui. Réessayez demain.' }[d.erreur] || 'La recherche n\'a pas abouti. Réessayez dans un instant.';
        res.appendChild(el('p', 'nb', m)); if (d.detail || d.code) res.appendChild(el('p', 'nb', 'Détail technique : ' + (d.code ? 'code ' + d.code + ' · ' : '') + (d.detail || '')));
        res.appendChild(lienNews(q)); return;
      }
      var t = el('div', 'nb', 'Recherche du ' + new Date(d.le).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' · articles trouvés par Gemini, à vérifier en ouvrant les liens'); res.appendChild(t);
      if (!d.articles.length) res.appendChild(el('p', 'vide', d.brut || 'Aucun article trouvé sur ce quartier ces 7 derniers jours.'));
      d.articles.forEach(function (x) {
        var c = el('div', 'item');
        var l1 = el('div'); l1.appendChild(el('span', 'dt', courte(x.date))); l1.appendChild(el('span', 'q', x.media)); if (x.date === AUJ) l1.appendChild(el('span', 'av', 'AUJOURD\'HUI')); c.appendChild(l1);
        var b = el('b'); if (x.lien) b.appendChild(lien(x.lien, x.titre)); else b.textContent = x.titre; c.appendChild(b);
        if (x.resume) c.appendChild(el('p', '', x.resume));
        res.appendChild(c);
      });
      if (d.sources && d.sources.length) {
        var s = el('details', 'mini mini-sect'); s.appendChild(el('summary', '', 'Pages consultées par la recherche · ' + d.sources.length));
        d.sources.forEach(function (x) { var p = el('div', 'src'); p.appendChild(lien(x.lien, x.titre)); s.appendChild(p); });
        res.appendChild(s);
      }
    }).catch(function () { bt.disabled = false; res.textContent = ''; res.appendChild(el('p', 'nb', 'Connexion impossible pour le moment.')); });
  }
  function carteItem(it, cat) {
    var c = el('div', 'item');
    var l1 = el('div'); l1.appendChild(el('span', 'dt', courte(it.date) + (it.heure ? ' · ' + hFmt(it.heure) : '')));
    if (it.quartier) l1.appendChild(el('span', 'q', it.quartier));
    if (cat === 'Association' && it.date >= AUJ) l1.appendChild(el('span', 'av', 'À VENIR'));
    c.appendChild(l1);
    c.appendChild(el('b', '', it.titre));
    if (it.texte) c.appendChild(el('p', '', it.texte));
    if (it.source || it.lien) { var s = el('span', 'src'); if (it.lien) s.appendChild(lien(it.lien, it.source || 'Source')); else s.textContent = it.source; c.appendChild(s); }
    return c;
  }

  // ---------- Vue : Aujourd'hui ----------
  function vueJour(v) {
    var dates = D.actus.map(function (a) { return a.date; }).filter(function (d) { return d <= AUJ; }).sort();
    var der = dates.length ? dates[dates.length - 1] : '';
    var b = el('section', 'bloc'); var h = el('h2', 'h2 rouge', 'Actualités du jour');
    if (der) h.appendChild(el('small', '', JC[dDe(der).getDay()] + ' ' + dDe(der).getDate() + ' ' + MOIS[dDe(der).getMonth()])); b.appendChild(h);
    var du = D.actus.filter(function (a) { return a.date === der; });
    var loc = du.filter(function (a) { return a.niveau === 'Toulouse' || !a.niveau; });
    if (!du.length) b.appendChild(el('p', 'vide', 'Pas encore d\'actualités aujourd\'hui.'));
    var ag = el('div', 'actu-g'); loc.forEach(function (a) { ag.appendChild(carteActu(a)); }); b.appendChild(ag);
    [['France', 'r-france'], ['Europe', 'r-europe'], ['Monde', 'r-monde'], ['Facebook', 'r-facebook']].forEach(function (n) {
      var its = du.filter(function (a) { return a.niveau === n[0]; }); if (!its.length) return;
      var d = el('details', 'repli ' + n[1]); d.appendChild(el('summary', '', n[0] === 'Facebook' ? 'Groupes de quartier' : n[0]));
      its.forEach(function (a) { d.appendChild(carteActu(a)); }); b.appendChild(d);
    });
    v.appendChild(b);
  }
  function enCours(e, k) { return e.date === k || (e.date_fin && e.date < k && e.date_fin >= k); }

  // ---------- Vue : Agenda ----------
  // Petit calendrier mensuel : un point sous les jours qui ont des rendez-vous
  function dessinerCal(pop, mois) {
    var base = mois ? dDe(mois + '-01') : new Date(); base = new Date(base.getFullYear(), base.getMonth(), 1);
    moisCal = cle(base).slice(0, 7);
    pop.textContent = '';
    var tete = el('div', 'cal-tete');
    var prec = el('button', 'cal-nav', '◀'); prec.type = 'button'; prec.setAttribute('aria-label', 'Mois précédent');
    var suiv = el('button', 'cal-nav', '▶'); suiv.type = 'button'; suiv.setAttribute('aria-label', 'Mois suivant');
    prec.addEventListener('click', function (e) { e.stopPropagation(); dessinerCal(pop, cle(new Date(base.getFullYear(), base.getMonth() - 1, 1)).slice(0, 7)); });
    suiv.addEventListener('click', function (e) { e.stopPropagation(); dessinerCal(pop, cle(new Date(base.getFullYear(), base.getMonth() + 1, 1)).slice(0, 7)); });
    tete.appendChild(prec); tete.appendChild(el('b', '', MOIS[base.getMonth()] + ' ' + base.getFullYear())); tete.appendChild(suiv);
    pop.appendChild(tete);
    var g = el('div', 'cal-grille');
    ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].forEach(function (x) { g.appendChild(el('span', 'cal-j', x)); });
    var d = lundi(base);
    for (var i = 0; i < 42; i++) {
      var k = cle(d), dans = d.getMonth() === base.getMonth();
      if (!dans && i >= 35) break;
      var nb = D.evenements.filter(function (e) { return enCours(e, k) && TYPES[typeDe(e)].g !== 'majo'; }).length;
      var b = el('button', 'cal-d' + (dans ? '' : ' hors') + (k === AUJ ? ' auj' : '') + (k === jourChoisi ? ' choisi' : '') + (nb ? ' a' : ''), String(d.getDate())); b.type = 'button';
      if (nb) b.title = nb + ' rendez-vous';
      (function (k) { b.addEventListener('click', function (e) { e.stopPropagation(); jourChoisi = k; rendre(); window.scrollTo(0, 0); }); })(k);
      g.appendChild(b); d = ajout(d, 1);
    }
    pop.appendChild(g);
  }
  document.addEventListener('click', function (e) { var p = document.querySelector('.cal-pop'); if (p && !p.hidden && !p.contains(e.target)) p.hidden = true; });

  // ---------- Fenêtre « Présences de la semaine » (vision des déplacements + partage) ----------
  function nomLong(n) { return n.replace(' (collaborateur)', ''); }
  function evsAvecPresences(lundiK, qui) {
    var fin = cle(ajout(dDe(lundiK), 6));
    return D.evenements.filter(function (e) { return e.date >= lundiK && e.date <= fin && (qui ? !!(D.presences[e.id] || {})[qui] : aPresence(e)); })
      .sort(function (a, b) { return (a.date + (a.heure || '99')).localeCompare(b.date + (b.heure || '99')); });
  }
  function texteSemaine(lundiK, pourMilitants, qui) {
    var lu = dDe(lundiK), di = ajout(lu, 6);
    var lignes = [qui ? '📅 Agenda de ' + nomLong(qui) + ' (Vivre Mieux)' : '📅 Présences des élu·es Vivre Mieux', 'Semaine du ' + lu.getDate() + (lu.getMonth() !== di.getMonth() ? ' ' + MOIS[lu.getMonth()] : '') + ' au ' + di.getDate() + ' ' + MOIS[di.getMonth()] + ' ' + di.getFullYear(), ''];
    var jourCourant = '', n = 0;
    evsAvecPresences(lundiK, qui).forEach(function (e) {
      if (pourMilitants && e.type === 'Réunion de groupe') return; // réunion interne : pas diffusée
      var p = D.presences[e.id] || {}, pr = [], pe = [];
      Object.keys(p).forEach(function (x) { if (qui && x !== qui) return; if (pourMilitants && !qui && /collaborateur/.test(x)) return; if (p[x] === 'present') pr.push(nomLong(x)); else if (p[x] === 'peut') pe.push(nomLong(x)); });
      if (!pr.length && !pe.length) return;
      if (e.date !== jourCourant) { jourCourant = e.date; var d = dDe(e.date); lignes.push((n ? '\n' : '') + JOURS[d.getDay()].toUpperCase() + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()].toUpperCase()); }
      n++;
      lignes.push('• ' + (e.heure ? e.heure.replace(':', 'h') + ' · ' : '') + e.titre);
      if (e.lieu) lignes.push('  📍 ' + e.lieu + (e.quartier ? ' (' + e.quartier + ')' : ''));
      if (pr.length) lignes.push('  ✅ ' + pr.join(', '));
      if (pe.length) lignes.push('  ❔ à confirmer : ' + pe.join(', '));
      if (e.lien && pourMilitants) lignes.push('  🔗 ' + e.lien);
    });
    if (!n) lignes.push('Aucune présence notée pour l\'instant.');
    return lignes.join('\n');
  }
  function ouvrirPresencesSemaine(lundiK) {
    var qui = '';
    var m = el('div', 'modale'), bx = el('div', 'modale-boite gestion pres-sem'); bx.setAttribute('role', 'dialog');
    m.appendChild(bx); document.body.appendChild(m);
    function fermer() { m.remove(); }
    m.addEventListener('click', function (e) { if (e.target === m) fermer(); });
    function peindre() {
      bx.textContent = '';
      var lu = dDe(lundiK), di = ajout(lu, 6);
      bx.appendChild(el('h2', '', 'Présences de la semaine'));
      var nav = el('div', 'ps-nav');
      var pr = el('button', 'cal-nav', '◀'); pr.type = 'button'; pr.setAttribute('aria-label', 'Semaine précédente');
      var sv = el('button', 'cal-nav', '▶'); sv.type = 'button'; sv.setAttribute('aria-label', 'Semaine suivante');
      pr.addEventListener('click', function () { lundiK = cle(ajout(dDe(lundiK), -7)); peindre(); });
      sv.addEventListener('click', function () { lundiK = cle(ajout(dDe(lundiK), 7)); peindre(); });
      nav.appendChild(pr); nav.appendChild(el('b', '', 'du ' + lu.getDate() + ' ' + MC[lu.getMonth()] + ' au ' + di.getDate() + ' ' + MC[di.getMonth()])); nav.appendChild(sv);
      bx.appendChild(nav);
      // Filtre : tout le monde ou une personne (qui fait quoi)
      var fq = el('label', 'ps-qui-sel'); fq.appendChild(el('span', '', 'Voir pour'));
      var sq = el('select'); var o0 = el('option', '', 'Tout le monde'); o0.value = ''; sq.appendChild(o0);
      (D.elus || []).forEach(function (n) { var o = el('option', '', nomLong(n)); o.value = n; if (n === qui) o.selected = true; sq.appendChild(o); });
      sq.addEventListener('change', function () { qui = sq.value; peindre(); });
      fq.appendChild(sq); bx.appendChild(fq);
      var evs = evsAvecPresences(lundiK, qui), liste = el('div', 'ps-liste'), jc = '';
      if (!evs.length) liste.appendChild(el('p', 'vide', qui ? 'Rien de noté cette semaine pour ' + nomLong(qui) + '.' : 'Aucune présence notée cette semaine.'));
      evs.forEach(function (e) {
        if (e.date !== jc) { jc = e.date; var d = dDe(e.date); liste.appendChild(el('div', 'ps-jour', JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()])); }
        var t = TYPES[typeDe(e)], c = el('div', 'ps-ev'); c.style.setProperty('--c', t.c);
        var l1 = el('div', 'ps-l1'); l1.appendChild(el('span', 'ps-h', e.heure ? hFmt(e.heure) : '—')); l1.appendChild(el('span', 'ps-t', e.titre)); c.appendChild(l1);
        if (e.lieu) c.appendChild(el('div', 'ps-lieu', '→ ' + e.lieu));
        var p = D.presences[e.id] || {}, a = [], b = [];
        Object.keys(p).forEach(function (x) { if (qui && x !== qui) return; if (p[x] === 'present') a.push(COURT(x)); else if (p[x] === 'peut') b.push(COURT(x)); });
        if (a.length) c.appendChild(el('div', 'ps-qui', '✓ ' + a.join(', ')));
        if (b.length) c.appendChild(el('div', 'ps-peut', 'Peut-être : ' + b.join(', ')));
        liste.appendChild(c);
      });
      bx.appendChild(liste);
      // Partage (texte pour les militants : sans la réunion de groupe interne ni le collaborateur)
      var info = el('p', 'ps-info', qui ? 'Le partage portera sur l\'agenda de ' + nomLong(qui) + ' (sans la réunion de groupe interne).' : 'Partage pour les militant·es : liste des élu·es présent·es, sans la réunion de groupe interne.');
      var act = el('div', 'ps-actions'), msg = el('p', 'ps-msg');
      function bouton(txt, f) { var b = el('button', 'bt-ps', txt); b.type = 'button'; b.addEventListener('click', f); act.appendChild(b); }
      function copier(t) {
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { msg.textContent = '✓ Copié : collez-le dans Telegram, WhatsApp ou un mail.'; })
          .catch(function () { var ta = el('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); msg.textContent = '✓ Copié.'; } catch (x) { msg.textContent = 'Copie impossible ici.'; } ta.remove(); });
      }
      bouton('📋 Copier', function () { copier(texteSemaine(lundiK, true, qui)); });
      bouton('📤 Partager', function () {
        var t = texteSemaine(lundiK, true, qui);
        if (navigator.share) navigator.share({ title: 'Présences des élu·es Vivre Mieux', text: t }).catch(function () {});
        else { copier(t); msg.textContent = 'Partage direct indisponible sur cet appareil : le texte a été copié.'; }
      });
      bouton('⬇️ Télécharger', function () {
        var t = texteSemaine(lundiK, true, qui), lu2 = dDe(lundiK);
        var w = window.open('', '_blank');
        if (!w) { msg.textContent = 'Autorisez les fenêtres pour télécharger.'; return; }
        var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
        w.document.write('<!doctype html><meta charset="utf-8"><title>Présences Vivre Mieux · semaine du ' + lu2.getDate() + ' ' + MOIS[lu2.getMonth()] + '</title><style>body{font:15px/1.5 Arial,sans-serif;max-width:640px;margin:30px auto;padding:0 16px;color:#123326}h1{color:#158c57;font-size:22px;border-bottom:3px solid #f5b5d2;padding-bottom:6px}pre{white-space:pre-wrap;font:inherit}</style><h1>Vivre Mieux Toulouse · groupe municipal d\'opposition</h1><pre>' + esc(t) + '</pre><script>setTimeout(function(){print()},300)<\/script>');
        w.document.close();
        msg.textContent = 'Choisissez « Enregistrer en PDF » dans la fenêtre d\'impression.';
      });
      bx.appendChild(info); bx.appendChild(act); bx.appendChild(msg);
      // Mon agenda personnel : la semaine affichée, ou un abonnement qui se met à jour tout seul
      var pers = qui || moi;
      if (pers && D.cles_agenda) {
        var za = el('div', 'ps-monag'); za.appendChild(el('b', '', '📅 Dans l\'agenda personnel de ' + nomLong(pers)));
        var ag = el('div', 'ps-actions');
        var a1 = el('a', 'bt-ps', '⬇️ Ajouter cette semaine'); a1.href = lienAbonnement(pers, true) + '&du=' + lundiK + '&au=' + cle(di);
        var a2 = el('button', 'bt-ps', '🔄 Abonner mon agenda'); a2.type = 'button'; a2.addEventListener('click', function () { ouvrirAbonnement(pers); });
        ag.appendChild(a1); ag.appendChild(a2); za.appendChild(ag); bx.appendChild(za);
      }
      var f = el('button', 'gest-fermer', 'Fermer'); f.type = 'button'; f.addEventListener('click', fermer); bx.appendChild(f);
    }
    peindre();
  }

  // ---------- Bouton « Partager » : semaine en cours, présences, ou agenda jusqu'à la fin du mois ----------
  function texteListe(titre, sousTitre, evs) {
    var lignes = [titre, sousTitre, ''], jc = '', n = 0;
    evs.forEach(function (e) {
      if (e.date !== jc) { jc = e.date; var d = dDe(e.date); lignes.push((n ? '\n' : '') + JOURS[d.getDay()].toUpperCase() + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()].toUpperCase()); }
      n++;
      lignes.push('• ' + (e.heure ? e.heure.replace(':', 'h') + ' · ' : '') + e.titre);
      if (e.lieu || e.quartier) lignes.push('  📍 ' + (e.lieu || '') + (e.quartier ? (e.lieu ? ' (' + e.quartier + ')' : e.quartier) : ''));
      if (e.lien) lignes.push('  🔗 ' + e.lien);
    });
    if (!n) lignes.push('Aucun rendez-vous.');
    return lignes.join('\n');
  }
  function evsPeriode(debutK, finK) {
    return D.evenements.filter(function (e) { return e.date >= debutK && e.date <= finK && TYPES[typeDe(e)].g !== 'majo' && e.type !== 'Réunion de groupe'; })
      .sort(function (a, b) { return (a.date + (a.heure || '99')).localeCompare(b.date + (b.heure || '99')); });
  }
  function boutonsPartage(zone, getTexte, titreDoc) {
    var act = el('div', 'ps-actions'), msg = el('p', 'ps-msg');
    function copier(t) {
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { msg.textContent = '✓ Copié : collez-le dans Telegram, WhatsApp ou un mail.'; })
        .catch(function () { var ta = el('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); msg.textContent = '✓ Copié.'; } catch (x) { msg.textContent = 'Copie impossible ici.'; } ta.remove(); });
    }
    function b(txt, f) { var x = el('button', 'bt-ps', txt); x.type = 'button'; x.addEventListener('click', f); act.appendChild(x); }
    b('📋 Copier', function () { copier(getTexte()); });
    b('📤 Partager', function () { var t = getTexte(); if (navigator.share) navigator.share({ title: titreDoc(), text: t }).catch(function () {}); else { copier(t); msg.textContent = 'Partage direct indisponible sur cet appareil : le texte a été copié.'; } });
    b('⬇️ Télécharger', function () {
      var t = getTexte(), w = window.open('', '_blank');
      if (!w) { msg.textContent = 'Autorisez les fenêtres pour télécharger.'; return; }
      var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
      w.document.write('<!doctype html><meta charset="utf-8"><title>' + esc(titreDoc()) + '</title><style>body{font:15px/1.5 Arial,sans-serif;max-width:640px;margin:30px auto;padding:0 16px;color:#123326}h1{color:#158c57;font-size:22px;border-bottom:3px solid #f5b5d2;padding-bottom:6px}pre{white-space:pre-wrap;font:inherit}</style><h1>Vivre Mieux Toulouse · groupe municipal d\'opposition</h1><pre>' + esc(t) + '</pre><script>setTimeout(function(){print()},300)<\/script>');
      w.document.close(); msg.textContent = 'Choisissez « Enregistrer en PDF » dans la fenêtre d\'impression.';
    });
    zone.appendChild(act); zone.appendChild(msg);
  }
  function ouvrirPartage() {
    var lundiK = new Date().getDay() === 0 ? cle(ajout(lundi(new Date()), 7)) : cle(lundi(new Date()));
    var lu = dDe(lundiK), di = ajout(lu, 6);
    var finMois = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
    var libSem = 'Semaine du ' + lu.getDate() + (lu.getMonth() !== di.getMonth() ? ' ' + MOIS[lu.getMonth()] : '') + ' au ' + di.getDate() + ' ' + MOIS[di.getMonth()] + ' ' + di.getFullYear();
    var OPTIONS = [
      ['semaine', 'Tous les événements de la semaine', libSem, function () { return texteListe('📅 Agenda Vivre Mieux', libSem, evsPeriode(lundiK, cle(di))); }],
      ['presences', 'Les événements où les élu·es sont présent·es', libSem, function () { return texteSemaine(lundiK, true, ''); }],
      ['mois', 'L\'agenda du mois', 'du ' + new Date().getDate() + ' au ' + finMois.getDate() + ' ' + MOIS[finMois.getMonth()], function () { var s = 'Du ' + new Date().getDate() + ' au ' + finMois.getDate() + ' ' + MOIS[finMois.getMonth()] + ' ' + finMois.getFullYear(); return texteListe('📅 Agenda Vivre Mieux · ' + MOIS[finMois.getMonth()], s, evsPeriode(AUJ, cle(finMois))); }]
    ];
    var choix = 'semaine';
    var m = el('div', 'modale'), bx = el('div', 'modale-boite gestion pres-sem'); bx.setAttribute('role', 'dialog');
    m.appendChild(bx); document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    bx.appendChild(el('h2', '', 'Partager l\'agenda'));
    bx.appendChild(el('p', '', 'Que voulez-vous partager ?'));
    var liste = el('div', 'part-opts');
    OPTIONS.forEach(function (o, i) {
      var l = el('label', 'part-opt'); var r = el('input'); r.type = 'radio'; r.name = 'part'; r.value = o[0]; r.checked = i === 0;
      r.addEventListener('change', function () { choix = o[0]; apercu(); });
      l.appendChild(r); var t = el('span'); t.appendChild(el('b', '', (i + 1) + '. ' + o[1])); t.appendChild(el('small', '', o[2])); l.appendChild(t); liste.appendChild(l);
    });
    bx.appendChild(liste);
    var ap = el('pre', 'part-apercu'); bx.appendChild(ap);
    function opt() { return OPTIONS.filter(function (o) { return o[0] === choix; })[0]; }
    function apercu() { ap.textContent = opt()[3](); }
    apercu();
    bx.appendChild(el('p', 'ps-info', 'Sans l\'agenda de la majorité ni la réunion de groupe interne.'));
    boutonsPartage(bx, function () { return opt()[3](); }, function () { return 'Agenda Vivre Mieux · ' + opt()[1]; });
    var f = el('button', 'gest-fermer', 'Fermer'); f.type = 'button'; f.addEventListener('click', function () { m.remove(); }); bx.appendChild(f);
  }

  // ---------- Code d'accès du groupe ----------
  function afficherCode() {
    var v = document.getElementById('vue'); v.textContent = '';
    var b = el('form', 'code-acces');
    b.appendChild(el('h2', '', 'Accès réservé'));
    b.appendChild(el('p', '', 'Cette plateforme est réservée au groupe Vivre Mieux. Saisissez le code d\'accès transmis par Hugo (une seule fois sur cet appareil).'));
    var i = el('input'); i.type = 'password'; i.autocomplete = 'current-password'; i.placeholder = 'Code d\'accès'; i.required = true;
    var bt = el('button', 'bt-valider', 'Entrer'); bt.type = 'submit';
    var msg = el('p', 'nb');
    b.appendChild(i); b.appendChild(bt); b.appendChild(msg);
    b.addEventListener('submit', function (e) {
      e.preventDefault(); bt.disabled = true; msg.textContent = 'Vérification…';
      fetch('api.php', { method: 'POST', body: new URLSearchParams({ a: 'code', code: i.value.trim() }) }).then(function (r) { return r.json(); }).then(function (d) {
        bt.disabled = false;
        if (!d.ok) { msg.textContent = 'Code incorrect.'; i.select(); return; }
        document.cookie = 'vmcode=' + encodeURIComponent(i.value.trim()) + '; max-age=34560000; path=/; SameSite=Strict' + (location.protocol === 'https:' ? '; Secure' : '');
        msg.textContent = ''; charger(true);
      }).catch(function () { bt.disabled = false; msg.textContent = 'Pas de connexion. Réessayez.'; });
    });
    v.appendChild(b); setTimeout(function () { i.focus(); }, 50);
  }

  // ---------- Ajouter un rendez-vous : lecture automatique d'un texte collé ----------
  var MOISRE = { janv: 1, janvier: 1, fevr: 2, fev: 2, fevrier: 2, mars: 3, avr: 4, avril: 4, mai: 5, juin: 6, juil: 7, juillet: 7, aout: 8, sept: 9, sep: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11, dec: 12, decembre: 12 };
  function annee(m, j) { // sans année : la prochaine occurrence de cette date
    var a = new Date().getFullYear(), d = new Date(a, m - 1, j);
    if (d < ajout(new Date(), -2)) a++;
    return a;
  }
  function k3(a, m, j) { return a + '-' + ('0' + m).slice(-2) + '-' + ('0' + j).slice(-2); }
  function trouverDate(t) {
    var n = norm(t), m;
    m = /\b(\d{1,2})(?:er)?\s+(janvier|janv|fevrier|fevr|fev|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|sep|octobre|oct|novembre|nov|decembre|dec)\.?(?:\s+(20\d\d))?/.exec(n);
    if (m && +m[1] >= 1 && +m[1] <= 31) { var mo = MOISRE[m[2]]; return k3(m[3] || annee(mo, +m[1]), mo, +m[1]); }
    m = /\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/.exec(n);
    if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) { var y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : annee(+m[2], +m[1]); return k3(y, +m[2], +m[1]); }
    m = /\b(20\d\d)-(\d{2})-(\d{2})\b/.exec(n); if (m) return m[0];
    if (/\bapres-demain\b/.test(n)) return cle(ajout(new Date(), 2));
    if (/\bdemain\b/.test(n)) return cle(ajout(new Date(), 1));
    if (/\b(aujourd'hui|ce soir|ce midi|ce matin)\b/.test(n)) return AUJ;
    m = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.exec(n);
    if (m) { var w = JOURS.indexOf(m[1]), d = new Date(), ec = (w - d.getDay() + 7) % 7; if (/prochain/.test(n.slice(m.index, m.index + 25)) && ec === 0) ec = 7; return cle(ajout(d, ec)); }
    return '';
  }
  function trouverHeure(t) {
    var n = norm(t).replace(/\b\d{1,2}[\/.]\d{1,2}([\/.]\d{2,4})?\b/g, ' ');
    var m = /\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?(?![\d])/.exec(n);
    if (m) return ('0' + m[1]).slice(-2) + ':' + (m[2] || '00');
    if (/\bmidi\b/.test(n)) return '12:00';
    return '';
  }
  function trouverLieu(t) {
    var m = /(?:^|\n)\s*(?:lieu|adresse|ou|où|rendez-vous|rdv)\s*[:\-–]\s*([^\n]{3,140})/i.exec(t) || /📍\s*([^\n]{3,140})/.exec(t);
    if (m) return m[1].trim();
    m = /\b((?:salle|maison de (?:quartier|la citoyenneté|l'économie|la culture)|maison|centre (?:culturel|social|d'animation)|espace|place|parc|jardin|mairie de quartier|capitole|gymnase|école|groupe scolaire|collège|lycée|médiathèque|bibliothèque|théâtre|halle|salle des fêtes|marché|cinéma|bar|café)\b[^\n.;]{2,80})/i.exec(t);
    return m ? m[1].replace(/\s*(?:à|a|de)\s*\d{1,2}\s*h.*$/i, '').trim() : '';
  }
  var MOTS_THEME = [
    [/r[ée]union publique|concertation|atelier citoyen|r[ée]union de (?:quartier|concertation)|bilan de mandat/, 'Réunion publique'],
    [/inauguration/, 'Inauguration'], [/c[ée]r[ée]monie|comm[ée]moration|d[ée]p[ôo]t de gerbe/, 'Cérémonie'],
    [/conseil municipal/, 'Conseil municipal'], [/commission/, 'Commission'],
    [/manif|rassemblement|gr[èe]ve|mobilisation|tractage|porte-?[àa]-?porte|marche (?:pour|contre)|piquet/, 'Militant'],
    [/conf[ée]rence|table ronde|d[ée]bat|colloque|rencontre-d[ée]bat/, 'Conférence'],
    [/concert|exposition|expo\b|spectacle|vernissage|festival|th[ée][âa]tre|cin[ée]ma|projection|lecture|danse/, 'Culture'],
    [/assembl[ée]e g[ée]n[ée]rale|\bag\b|comit[ée] de quartier|association|f[êe]te de quartier|vide-grenier|repas de quartier|apéro/, 'Association de quartier']
  ];
  function trouverTheme(t) { var n = t.toLowerCase(); for (var i = 0; i < MOTS_THEME.length; i++) if (MOTS_THEME[i][0].test(n)) return MOTS_THEME[i][1]; return 'Autre'; }
  function trouverTitre(t) {
    var m = /(?:^|\n)\s*(?:objet|sujet|titre)\s*:\s*([^\n]{3,160})/i.exec(t); if (m) return m[1].trim();
    var lignes = t.split(/\n+/).map(function (l) { return l.replace(/^[\s•\-–*#>]+/, '').trim(); }).filter(function (l) {
      return l.length > 3 && !/^(bonjour|bonsoir|madame|monsieur|mesdames|cher|chère|chers|salut|coucou|hello|de\s*:|à\s*:|envoyé|le .* a écrit)/i.test(l) && !/^https?:\/\//.test(l);
    });
    var l = lignes[0] || ''; if (l.length > 110) l = l.slice(0, 107).replace(/\s+\S*$/, '') + '…';
    return l;
  }
  function analyser(t) {
    var lienM = /https?:\/\/[^\s<>"')]+/.exec(t);
    return { titre: trouverTitre(t), date: trouverDate(t), heure: trouverHeure(t), lieu: trouverLieu(t), lien: lienM ? lienM[0].replace(/[.,;]+$/, '') : '', type: trouverTheme(t) };
  }

  // Photo : réduite dans le téléphone (1600 px max) avant l'envoi
  function reduirePhoto(fichier) {
    return new Promise(function (ok, ko) {
      var img = new Image(), u = URL.createObjectURL(fichier);
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * r); c.height = Math.round(h * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        ok({ data: c.toDataURL('image/jpeg', 0.82), canvas: c });
      };
      img.onerror = function () { URL.revokeObjectURL(u); ko(); };
      img.src = u;
    });
  }
  // Lecture du texte d'une photo : module hébergé sur notre serveur (dossier ocr/), chargé seulement au premier usage
  var tesseractP = null;
  function lireTextePhoto(canvas, etat) {
    if (!tesseractP) tesseractP = new Promise(function (ok, ko) {
      var s = document.createElement('script'); s.src = 'ocr/tesseract.min.js';
      s.onload = function () { ok(window.Tesseract); }; s.onerror = function () { tesseractP = null; ko(); }; document.head.appendChild(s);
    });
    var base = new URL('ocr/', location.href).href, wk;
    return tesseractP.then(function (T) {
      etat('Préparation de la lecture (une seule fois)…');
      return T.createWorker('fra', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: false, cacheMethod: 'write',
        logger: function (m) { if (m.status === 'recognizing text') etat('Lecture de la photo… ' + Math.round(m.progress * 100) + ' %'); } });
    }).then(function (w) { wk = w; return w.recognize(canvas); })
      .then(function (r) { wk.terminate(); return r.data.text || ''; })
      .catch(function (e) { if (wk) wk.terminate(); throw e; });
  }

  var THEMES_AJOUT = [['Réunion publique', 'Réunion publique, concertation'], ['Association de quartier', 'Association, comité de quartier'], ['Militant', 'Militant'], ['Culture', 'Culture'], ['Conférence', 'Conférence, café-débat'], ['Commission', 'Commission'], ['Conseil municipal', 'Conseil municipal'], ['Inauguration', 'Inauguration'], ['Cérémonie', 'Cérémonie, commémoration'], ['Mairie', 'Événement mairie'], ['Autre', 'Autre']];

  function ouvrirAjout(existant) {
    if (!D.ajout_actif) { alert('L\'ajout de rendez-vous sera disponible dès que Hugo aura mis en place le code d\'accès du groupe.'); return; }
    if (!moi) { ouvrirChoix(); return; }
    var e0 = existant || {};
    var m = el('div', 'modale'), bx = el('form', 'modale-boite ajout'); bx.setAttribute('role', 'dialog');
    bx.appendChild(el('h2', '', existant ? 'Modifier le rendez-vous' : 'Ajouter un rendez-vous'));
    var photoData = e0.photo === 'oui' ? 'garder' : '';
    if (!existant) {
      bx.appendChild(el('p', '', 'Collez le message reçu, collez une image ou ajoutez une photo : les champs se remplissent tout seuls. Vérifiez puis ajoutez.'));
      var ta = el('textarea', 'aj-colle'); ta.rows = 4; ta.placeholder = 'Collez ici le mail, le SMS, le message WhatsApp… ou une image copiée';
      bx.appendChild(ta);
    }
    var lignePh = el('div', 'aj-photo');
    var inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
    var bph = el('button', 'bt-photo', '📷 ' + (e0.photo === 'oui' ? 'Changer la photo' : 'Ajouter une photo')); bph.type = 'button';
    bph.addEventListener('click', function () { inp.click(); });
    var apercu = el('div', 'aj-apercu'), etat = el('span', 'nb');
    if (e0.photo === 'oui') { var im0 = el('img'); im0.src = 'api.php?a=photo&id=' + e0.id; im0.alt = ''; apercu.appendChild(im0); }
    lignePh.appendChild(bph); lignePh.appendChild(inp); lignePh.appendChild(etat); lignePh.appendChild(apercu); bx.appendChild(lignePh);

    function champ(lab, type, val, attrs) {
      var l = el('label', 'aj-champ'); l.appendChild(el('span', '', lab));
      var i = type === 'textarea' ? el('textarea') : el('input'); if (type !== 'textarea') i.type = type; i.value = val || '';
      Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
      l.appendChild(i); bx.appendChild(l); return i;
    }
    var fT = champ('Titre', 'text', e0.titre, { required: '', maxlength: '160' });
    var dh = el('div', 'aj-dh'); bx.appendChild(dh);
    var fD = champ('Date', 'date', e0.date, { required: '' }), fH = champ('Heure', 'time', e0.heure);
    dh.appendChild(fD.parentNode); dh.appendChild(fH.parentNode);
    var fL = champ('Lieu', 'text', e0.lieu, { maxlength: '200' });
    var fQ = champ('Quartier (facultatif)', 'text', e0.quartier, { maxlength: '80' });
    var ls = el('label', 'aj-champ'); ls.appendChild(el('span', '', 'Thème')); var fY = el('select');
    THEMES_AJOUT.forEach(function (x) { var o = el('option', '', x[1]); o.value = x[0]; fY.appendChild(o); });
    fY.value = THEMES_AJOUT.some(function (x) { return x[0] === e0.type; }) ? e0.type : 'Autre'; ls.appendChild(fY); bx.appendChild(ls);
    var fK = champ('Lien (facultatif)', 'url', e0.lien, { placeholder: 'https://…' });
    var fX = champ('Détails (facultatif)', 'textarea', e0.details, { rows: '3', maxlength: '1500' });
    var pres = null;
    if (!existant) {
      var lp = el('label', 'aj-pres'); pres = el('input'); pres.type = 'checkbox';
      lp.appendChild(pres); lp.appendChild(document.createTextNode(' Je serai présent·e (' + COURT(moi) + ')')); bx.appendChild(lp);
    }
    function remplir(t) {
      var r = analyser(t);
      if (r.titre) fT.value = r.titre; if (r.date) fD.value = r.date; if (r.heure) fH.value = r.heure;
      if (r.lieu) fL.value = r.lieu; if (r.lien) fK.value = r.lien; fY.value = r.type;
      if (!fX.value) fX.value = t.trim().slice(0, 600);
      [fT, fD, fH, fL].forEach(function (x) { x.classList.toggle('vide-aj', !x.value); });
    }
    if (ta) ta.addEventListener('input', function () { if (ta.value.trim().length > 8) remplir(ta.value); });
    inp.addEventListener('change', function () { traiterPhoto(inp.files[0]); });
    // Coller une image (Ctrl+V ou appui long → Coller) n'importe où dans la fenêtre, ou la glisser-déposer
    function imageDe(dt) { var fs = (dt && dt.files) || []; for (var i = 0; i < fs.length; i++) if (/^image\//.test(fs[i].type)) return fs[i]; return null; }
    bx.addEventListener('paste', function (ev) { var f = imageDe(ev.clipboardData); if (f) { ev.preventDefault(); traiterPhoto(f); } });
    bx.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    bx.addEventListener('drop', function (ev) { var f = imageDe(ev.dataTransfer); if (f) { ev.preventDefault(); traiterPhoto(f); } });
    function traiterPhoto(f) {
      if (!f) return;
      etat.textContent = 'Préparation de la photo…';
      reduirePhoto(f).then(function (r) {
        photoData = r.data; apercu.textContent = ''; var im = el('img'); im.src = r.data; im.alt = ''; apercu.appendChild(im);
        bph.textContent = '📷 Changer la photo';
        if (existant) { etat.textContent = ''; return; }
        return lireTextePhoto(r.canvas, function (s) { etat.textContent = s; }).then(function (txt) {
          etat.textContent = txt.trim() ? 'Photo lue : vérifiez les champs.' : 'Pas de texte lisible : complétez à la main.';
          if (txt.trim()) { ta.value = (ta.value ? ta.value + '\n' : '') + txt.trim(); remplir(ta.value); }
        });
      }).catch(function () { etat.textContent = 'Lecture impossible : complétez à la main (la photo reste jointe).'; });
    }

    var err = el('p', 'aj-err');
    var act = el('div', 'aj-actions');
    var ann = el('button', 'gest-fermer', 'Annuler'); ann.type = 'button'; ann.addEventListener('click', function () { m.remove(); });
    var ok = el('button', 'bt-valider', existant ? 'Enregistrer' : '➕ Ajouter à l\'agenda'); ok.type = 'submit';
    act.appendChild(ann); act.appendChild(ok); bx.appendChild(err); bx.appendChild(act);
    bx.addEventListener('submit', function (ev) {
      ev.preventDefault(); err.textContent = '';
      if (!fT.value.trim() || !fD.value) { err.textContent = 'Il faut au moins un titre et une date.'; return; }
      ok.disabled = true; ok.textContent = 'Envoi…';
      var corps = { nom: moi, id: e0.id || '', titre: fT.value, date: fD.value, heure: fH.value, lieu: fL.value, quartier: fQ.value, type: fY.value, lien: fK.value, details: fX.value, photo: photoData };
      fetch('api.php?a=ajout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) throw d;
        m.remove();
        if (pres && pres.checked) cocherPour(d.id, moi, 'present');
        jourChoisi = fD.value; return charger(true);
      }).catch(function () { ok.disabled = false; ok.textContent = 'Réessayer'; err.textContent = 'Le rendez-vous n\'a pas pu être enregistré. Vérifiez la connexion et réessayez.'; });
    });
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    m.appendChild(bx); document.body.appendChild(m);
    if (ta) setTimeout(function () { ta.focus(); }, 50);
  }
  function supprimerAjout(e) {
    if (!confirm('Supprimer « ' + e.titre + ' » de l\'agenda ?')) return;
    fetch('api.php', { method: 'POST', body: new URLSearchParams({ a: 'suppr', id: e.id, nom: moi }) }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw d; charger(true);
    }).catch(function () { alert('La suppression n\'a pas pu être faite. Réessayez.'); });
  }
  function voirPhoto(e) {
    var m = el('div', 'modale photo-grande'), im = el('img'); im.src = 'api.php?a=photo&id=' + e.id; im.alt = e.titre;
    m.appendChild(im); m.addEventListener('click', function () { m.remove(); }); document.body.appendChild(m);
  }

  function vueAgenda(v) {
    // Barre d'outils : calendrier + légende repliée
    var bAj = el('button', 'bt-ajout', '➕ Ajouter un rendez-vous'); bAj.type = 'button';
    bAj.addEventListener('click', function () { ouvrirAjout(); }); v.appendChild(bAj);
    var outils = el('div', 'outils-ag');
    var bcal = el('button', 'bt-cal', '📅 Choisir un jour'); bcal.type = 'button';
    var pop = el('div', 'cal-pop'); pop.hidden = true;
    bcal.addEventListener('click', function (e) { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) dessinerCal(pop, moisCal); });
    var wrap = el('div', 'cal-wrap'); wrap.appendChild(bcal); wrap.appendChild(pop); outils.appendChild(wrap);
    // Trier par thème (menu déroulant à droite)
    var tl = el('label', 'tri-theme'); var ts = el('select'); ts.setAttribute('aria-label', 'Trier par thème');
    FILTRES.forEach(function (x) { var o = el('option', '', x[0] === 'tout' ? 'Tous les thèmes' : x[1]); o.value = x[0]; if (x[0] === filtre) o.selected = true; ts.appendChild(o); });
    ts.addEventListener('change', function () { filtre = ts.value; rendre(); });
    var bps = el('button', 'bt-presences', '👥 Vision des présences'); bps.type = 'button'; bps.title = 'Présences de la semaine';
    bps.addEventListener('click', function () { ouvrirPresencesSemaine(new Date().getDay() === 0 ? cle(ajout(lundi(new Date()), 7)) : cle(lundi(new Date()))); });
    tl.appendChild(el('span', '', 'Trier par thème')); tl.appendChild(ts); outils.appendChild(tl);
    var pw = el('div', 'pres-wrap'); pw.appendChild(bps); outils.appendChild(pw);
    var bpa = el('button', 'bt-presences bt-partager', '📤 Partager'); bpa.type = 'button';
    bpa.addEventListener('click', ouvrirPartage);
    var paw = el('div', 'part-wrap'); paw.appendChild(bpa); outils.appendChild(paw);
    var lg = el('details', 'legende-d'); lg.appendChild(el('summary', '', 'légende'));
    var lgc = el('div', 'legende');
    [['#b39ddb', 'Réunion de groupe'], ['#3f51b5', 'Protocole, inauguration'], ['#039be5', 'Commission'], ['#e67c73', 'Réunion de quartier'], ['#e08a1e', 'Association'], ['#e00000', 'Militant'], ['#a9874f', 'Culture'], ['#0b8043', 'Conférence, café-débat'], ['#fff', 'Mairie']].forEach(function (x) {
      var s = el('span'); var i = el('i'); i.style.background = x[0]; if (x[0] === '#fff') i.style.boxShadow = 'inset 0 0 0 1px #999'; s.appendChild(i); s.appendChild(document.createTextNode(x[1])); lgc.appendChild(s);
    });
    lg.appendChild(lgc); outils.appendChild(lg);
    v.appendChild(outils);

    // Un jour choisi dans le calendrier : on l'affiche en premier
    if (jourChoisi) {
      var evsJ = D.evenements.filter(function (e) { return enCours(e, jourChoisi) && (filtre === 'tout' || TYPES[typeDe(e)].g === filtre || TYPES[typeDe(e)].g === 'majo'); });
      var zc = el('div', 'jour-choisi');
      var ret = el('button', 'bt-retour', '✕ Fermer ce jour'); ret.type = 'button';
      ret.addEventListener('click', function () { jourChoisi = ''; rendre(); });
      zc.appendChild(ret); zc.appendChild(blocJour(jourChoisi, evsJ)); v.appendChild(zc);
    }

    var debut = lundi(new Date()), fin = ajout(new Date(), 31), finSem1 = ajout(debut, 6);
    var parJour = {};
    D.evenements.forEach(function (e) {
      var g = TYPES[typeDe(e)].g;
      if (filtre !== 'tout' && g !== filtre) return;
      var k = e.date; if (k < cle(debut) || k > cle(fin)) { if (!(e.date_fin && e.date < cle(debut) && e.date_fin >= cle(debut))) return; k = cle(debut); }
      (parJour[k] = parJour[k] || []).push(e);
    });
    var dimanche = new Date().getDay() === 0, ouverte = dimanche ? cle(ajout(debut, 7)) : cle(debut);
    var jours = Object.keys(parJour).sort();
    if (!jours.length) { v.appendChild(el('p', 'vide', 'Aucun rendez-vous dans cette sélection.')); return; }
    var groupes = {};
    jours.forEach(function (k) { var s = cle(lundi(dDe(k))); (groupes[s] = groupes[s] || []).push(k); });
    Object.keys(groupes).sort().forEach(function (s, i) {
      var lu = dDe(s), di = ajout(lu, 6);
      var lib = (i === 0 && s === cle(debut) ? 'Cette semaine' : 'Semaine du ' + lu.getDate()) + (i === 0 && s === cle(debut) ? ' → ' + lu.getDate() : '') + (lu.getMonth() !== di.getMonth() ? ' ' + MC[lu.getMonth()] : '') + ' au ' + di.getDate() + ' ' + MC[di.getMonth()];
      var cont;
      if (dimanche && s === cle(debut)) {
        // le dimanche, la semaine qui s'achève passe en petit menu gris replié
        cont = el('details', 'sem-prec'); var sp = el('summary'); sp.appendChild(el('b', '', 'Semaine précédente ')); sp.appendChild(el('span', '', lu.getDate() + ' → ' + di.getDate() + ' ' + MC[di.getMonth()]));
        cont.appendChild(sp); groupes[s].forEach(function (k) { cont.appendChild(blocJour(k, parJour[k])); }); v.appendChild(cont); return;
      }
      if (s === ouverte) { cont = el('div', 'sem-1'); cont.appendChild(el('div', 'semaine', s === cle(debut) ? lib : 'Cette semaine → ' + lu.getDate() + (lu.getMonth() !== di.getMonth() ? ' ' + MC[lu.getMonth()] : '') + ' au ' + di.getDate() + ' ' + MC[di.getMonth()])); }
      else { cont = el('details', 'sem'); var sm = el('summary'); var sd = el('div', 'semaine', lib); sd.appendChild(el('span', '', groupes[s].length + ' jour' + (groupes[s].length > 1 ? 's' : ''))); sm.appendChild(sd); cont.appendChild(sm); }
      var prec = null, nPrec = 0, grilleJ = el('div', 'jours-g');
      groupes[s].forEach(function (k) {
        var j = blocJour(k, parJour[k]);
        if (k < AUJ) {
          if (!prec) { prec = el('details', 'prec'); var ps = el('summary'); ps.appendChild(el('b', '', 'Jours précédents ')); ps.appendChild(el('span', 'pd')); prec.appendChild(ps); cont.appendChild(prec); prec._d1 = k; }
          prec.appendChild(j); nPrec++;
          prec.querySelector('.pd').textContent = (nPrec > 1 ? JC[dDe(prec._d1).getDay()] + ' ' + dDe(prec._d1).getDate() + ' → ' : '') + JC[dDe(k).getDay()] + ' ' + courte(k);
        } else grilleJ.appendChild(j);
      });
      cont.appendChild(grilleJ);
      v.appendChild(cont);
    });
  }
  // Règle de mise en avant, chaque jour :
  // en premier les réunions publiques de quartier, commissions, protocole, réunion de groupe,
  // et tout événement où au moins une personne est notée présente ou peut-être.
  // Le reste est enroulé, plus discret ; les événements mairie (veille du site) tout en bas, en blanc.
  var PRIORITAIRES = { 'Réunion de groupe': 1, 'Protocole': 1, 'Cérémonie': 1, 'Inauguration': 1, 'Commission': 1, 'Conseil municipal': 1, 'Réunion officielle': 1, 'Concertation': 1, 'Réunion publique': 1 };
  function aPresence(e) { var p = D.presences[e.id]; return !!(p && Object.keys(p).length); }
  function enAvant(e) { return !!PRIORITAIRES[e.type] || aPresence(e); }
  // Thèmes enroulés, dans cet ordre (les événements mairie tout en bas)
  var THEMES = [
    ['Culture', ['Culture'], 'mini-cult'],
    ['Conférences et débats', ['Conférence', 'Café-débat'], 'mini-conf'],
    ['Associations', ['Association de quartier', 'Vie associative'], 'mini-asso'],
    ['Militant', ['Militant'], 'mini-mili'],
    ['Institutionnel', ['Institutionnel', 'Autre'], 'mini-inst'],
    ['Événements mairie', ['Mairie'], 'mini-mairie']
  ];
  function rangerJour(evs, c, toutOuvert) {
    var haut = evs.filter(enAvant), reste = evs.filter(function (e) { return !enAvant(e); });
    var eg = el('div', 'ev-g'); haut.forEach(function (e) { eg.appendChild(carteEv(e)); }); if (haut.length) c.appendChild(eg);
    THEMES.forEach(function (th) {
      var its = reste.filter(function (e) { return th[1].indexOf(typeDe(e)) >= 0; }); if (!its.length) return;
      var d = el('details', 'mini ' + th[2]); d.open = toutOuvert;
      var sm = el('summary'); var pt = el('i', 'pt'); pt.style.background = TYPES[th[1][0]].c; sm.appendChild(pt);
      sm.appendChild(document.createTextNode(th[0] + ' · ' + its.length)); d.appendChild(sm);
      its.forEach(function (e) { d.appendChild(carteEv(e)); }); c.appendChild(d);
    });
  }
  // Agenda du maire et de la majorité : petit bloc enroulé
  // Agenda du maire et de la majorité : petit bouton 👁 dans la barre du jour, qui ouvre la liste juste en dessous
  function blocMajo(majo, barre, apres) {
    if (!majo.length) return;
    var pan = el('div', 'majo-pan'); pan.hidden = true;
    majo.forEach(function (e) { var li = el('div', 'majo-li' + (/maire/i.test(e.qui || e.source || '') ? ' maire' : '')); li.appendChild(el('b', '', (hFmt(e.heure) || '') + (e.qui ? ' · ' + e.qui : ''))); li.appendChild(document.createTextNode(' ' + e.titre + (e.lieu ? ' → ' + e.lieu : ''))); pan.appendChild(li); });
    var b = el('button', 'oeil'); b.appendChild(el('span', 'oeil-i', '👀')); b.appendChild(el('span', 'oeil-txt', 'Majorité · ')); b.appendChild(document.createTextNode(majo.length)); b.type = 'button'; b.title = 'Agenda du maire et de la majorité'; b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () { pan.hidden = !pan.hidden; b.classList.toggle('on', !pan.hidden); b.setAttribute('aria-expanded', String(!pan.hidden)); });
    var em = barre.querySelector('em'); if (em) barre.insertBefore(b, em); else barre.appendChild(b);
    apres.parentNode.insertBefore(pan, apres.nextSibling);
  }
  // Si une présence fait monter ou descendre un événement, on réaffiche (en gardant la position)
  var signature = '';
  function sigPresences() { return Object.keys(D.presences).filter(function (k) { return Object.keys(D.presences[k] || {}).length; }).sort().join(','); }
  // On ne réaffiche plus la page au moment du clic (ça refermait les semaines et faisait sauter l'écran) :
  // l'événement coché remontera en haut de sa journée au prochain affichage (changement d'onglet, rechargement).
  function verifierRangement() { signature = sigPresences(); }
  function blocJour(k, evs) {
    var d = dDe(k), j = el('section', 'jour' + (k === AUJ ? ' auj' : ''));
    var t = el('div', 'jour-tete'); t.appendChild(el('b', '', JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]));
    if (k === AUJ) t.appendChild(el('em', '', 'AUJOURD\'HUI'));
    t.querySelector('b').appendChild(btCopie(function () {
      var liste = evs.filter(function (e) { return TYPES[typeDe(e)].g !== 'majo' && (filtre === 'tout' || TYPES[typeDe(e)].g === filtre); }).sort(function (a, b) { return (a.heure || '99').localeCompare(b.heure || '99'); });
      return JOURS[d.getDay()].toUpperCase() + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()].toUpperCase() + '\n\n' + liste.map(function (e) { return '• ' + texteEv(e, false).replace(/\n/g, '\n  '); }).join('\n');
    }, 'Copier la journée'));
    j.appendChild(t);
    var c = el('div', 'jour-corps');
    var majo = evs.filter(function (e) { return TYPES[typeDe(e)].g === 'majo'; });
    rangerJour(evs.filter(function (e) { return TYPES[typeDe(e)].g !== 'majo'; }), c, filtre !== 'tout');
    if (filtre === 'tout') blocMajo(majo, t, t);
    if (!c.childNodes.length) c.appendChild(el('p', 'vide', '—'));
    j.appendChild(c);
    return j;
  }

  // ---------- Vue : Quartiers ----------
  var SECTEURS = {
    'Centre': ['Capitole', 'Arnaud-Bernard', 'Carmes', 'Amidonniers', 'Compans-Caffarelli', 'Brouardel', 'Les Chalets', 'Bayard', 'Belfort', 'Saint-Aubin', 'Dupuy', 'Matabiau', 'Roquelaine'],
    'Rive gauche': ['Saint-Cyprien', 'Croix-de-Pierre', 'Route d\'Espagne', 'Fontaine-Lestang', 'Arènes', 'Bagatelle', 'Papus', 'Tabar', 'Bordelongue', 'Mermoz', 'La Faourette', 'Casselardit', 'Fontaines-Garonne', 'Cartoucherie', 'TOEC'],
    'Nord': ['Minimes', 'Barrière de Paris', 'Ponts-Jumeaux', 'La Vache', 'Sept Deniers', 'Ginestous-Sesquières', 'Lalande', 'Trois Cocus', 'Borderouge', 'Croix-Daurade', 'Paléficat', 'Grand Selve'],
    'Est': ['Lapujade', 'Bonnefoy', 'Périole', 'Marengo', 'La Colonne', 'Jolimont', 'Soupetard', 'Roseraie', 'Gloire', 'Gramont', 'Amouroux', 'Bonhoure', 'Guilheméry', 'Château de l\'Hers', 'Limayrac', 'Côte Pavée'],
    'Sud-Est': ['Pont des Demoiselles', 'Ormeau', 'Montaudran', 'La Terrasse', 'Malepère', 'Rangueil', 'Sauzelong', 'Jules-Julien', 'Pech-David', 'Pouvourville', 'Saint-Michel', 'Saint-Agne', 'Empalot', 'Le Busca', 'Île du Ramier', 'Monplaisir'],
    'Ouest': ['Arènes Romaines', 'Ancely', 'Saint-Martin-du-Touch', 'Purpan', 'Lardenne', 'Pradettes', 'Basso-Cambo', 'Mirail-Université', 'Mirail', 'Reynerie', 'Bellefontaine', 'Saint-Simon', 'Lafourguette', 'Oncopole', 'Héraklès']
  };
  function secteurDuQuartier(q) { var n = norm(q); for (var s in SECTEURS) { if (SECTEURS[s].some(function (x) { return n.indexOf(norm(x)) > -1; })) return s; } return ''; }
  function correspond(texte, q) { var a = norm(texte), b = norm(q); return a && b && (a.indexOf(b) > -1 || b.indexOf(a) > -1); }
  function vueQuartiers(v) {
    var sel = el('div', 'selecteurs bloc');
    var ls = el('label', '', 'Secteur'), ss = el('select'); ls.appendChild(ss);
    var lq = el('label', '', 'Quartier'), sq = el('select'); lq.appendChild(sq);
    var o = el('option', '', 'Tous les secteurs'); o.value = ''; ss.appendChild(o);
    Object.keys(SECTEURS).forEach(function (s) { var x = el('option', '', s); x.value = s; if (s === selQ.s) x.selected = true; ss.appendChild(x); });
    var oq = el('option', '', 'Tous les quartiers'); oq.value = ''; sq.appendChild(oq);
    Object.keys(SECTEURS).forEach(function (s) {
      if (selQ.s && s !== selQ.s) return;
      var g = el('optgroup'); g.label = s;
      SECTEURS[s].forEach(function (q) { var x = el('option', '', q); x.value = q; if (q === selQ.q) x.selected = true; g.appendChild(x); }); sq.appendChild(g);
    });
    ss.addEventListener('change', function () { selQ.s = ss.value; selQ.q = ''; store('vm-sec', selQ.s); store('vm-q', ''); rendre(); });
    sq.addEventListener('change', function () { selQ.q = sq.value; if (selQ.q && !selQ.s) selQ.s = secteurDuQuartier(selQ.q); store('vm-q', selQ.q); store('vm-sec', selQ.s); rendre(); });
    sel.appendChild(ls); sel.appendChild(lq); v.appendChild(sel);

    // Tout ce qui se passe dans les quartiers : événements de l'agenda avec un quartier
    // (sauf majorité et réceptions au Capitole) + rendez-vous annoncés par les associations
    function filtreLieu(q, sec) {
      if (selQ.q) return correspond(q, selQ.q) || norm(q).indexOf(norm(selQ.q)) > -1;
      if (selQ.s) return (sec || secteurDuQuartier(q)) === selQ.s;
      return true;
    }
    var rdvQ = [];
    D.evenements.forEach(function (e) {
      var g = TYPES[typeDe(e)].g;
      if (g === 'majo' || !e.quartier || (g === 'proto' && /capitole/i.test(e.quartier))) return;
      if (!filtreLieu(e.quartier)) return;
      rdvQ.push({ date: e.date, fin: e.date_fin, heure: e.heure, titre: e.titre, quartier: e.quartier, secteur: secteurDuQuartier(e.quartier), lieu: e.lieu, lien: e.lien, coul: TYPES[typeDe(e)].c, type: e.type, ev: e });
    });
    D.quartiers.forEach(function (it) {
      if (it.categorie !== 'Association' || !filtreLieu(it.quartier, it.secteur)) return;
      rdvQ.push({ date: it.date, heure: it.heure, titre: it.titre, quartier: it.quartier, secteur: it.secteur || secteurDuQuartier(it.quartier), lieu: '', lien: it.lien, coul: '#e08a1e', type: 'Association', texte: it.texte, source: it.source });
    });
    rdvQ.sort(function (x, y) { return (x.date + (x.heure || '99')).localeCompare(y.date + (y.heure || '99')); });
    function ce(x, k) { return x.date === k || (x.fin && x.date < k && x.fin >= k); }

    // Une ligne compacte ; on la déroule pour voir le détail et cocher sa présence
    function ligneQ(x, avecQuartier) {
      var d = el('details', 'lq'); d.style.setProperty('--c', x.coul);
      var sm = el('summary');
      sm.appendChild(el('span', 'lq-h', x.heure ? hFmt(x.heure) : '—'));
      var t = el('span', 'lq-t', x.titre); sm.appendChild(t);
      if (avecQuartier && x.quartier) sm.appendChild(el('span', 'lq-q', x.quartier));
      if (x.ev && aPresence(x.ev)) sm.appendChild(el('span', 'lq-p', '✓ ' + Object.keys(D.presences[x.ev.id]).length));
      d.appendChild(sm);
      if (x.ev) d.appendChild(carteEv(x.ev));
      else { var c = el('div', 'item'); if (x.texte) c.appendChild(el('p', '', x.texte)); if (x.lien) { var s = el('span', 'src'); s.appendChild(lien(x.lien, x.source || 'Voir l\'annonce')); c.appendChild(s); } d.appendChild(c); }
      return d;
    }

    var nom = selQ.q || selQ.s;
    function blocAvenir(titre, sousTitre, debut, nbJours) {
      var av = el('section', 'bloc bloc-q');
      av.appendChild(el('h2', 'grand-titre', titre));
      av.appendChild(el('p', 'sous-titre', sousTitre));
      var rien = true;
      for (var i = debut; i <= nbJours; i++) {
        var k = cle(ajout(new Date(), i)), dd = dDe(k);
        var its = rdvQ.filter(function (x) { return i === debut ? ce(x, k) : x.date === k; }); if (!its.length) continue;
        rien = false;
        av.appendChild(el('div', 'jour-q', (k === AUJ ? 'Aujourd\'hui · ' : '') + JOURS[dd.getDay()] + ' ' + dd.getDate() + ' ' + MOIS[dd.getMonth()]));
        its.forEach(function (x) { av.appendChild(ligneQ(x, true)); });
      }
      if (rien) av.appendChild(el('p', 'vide', 'Rien de repéré pour l\'instant.'));
      return av;
    }
    var depuis = cle(ajout(new Date(), -31));
    // 📎 Mobilisations et doléances : épinglées en haut, 60 derniers jours
    function estDoleance(it) { return /^(dol[ée]ance|mobilisation)/i.test(it.categorie || ''); }
    var depuis60 = cle(ajout(new Date(), -60));
    var epingles = D.quartiers.filter(function (it) { return estDoleance(it) && it.date >= depuis60 && filtreLieu(it.quartier, it.secteur); })
      .sort(function (x, y) { return y.date.localeCompare(x.date); });
    if (epingles.length) {
      var ep = el('section', 'bloc bloc-q epingle');
      ep.appendChild(el('h2', 'grand-titre petit', 'Mobilisations et doléances'));
      ep.appendChild(el('p', 'sous-titre', 'ce qui remonte des habitants et des comités de quartier · ' + epingles.length));
      epingles.forEach(function (it) { ep.appendChild(carteItem(it, 'Doléance')); });
      v.appendChild(ep);
    }
    var items = D.quartiers.filter(function (it) { return !estDoleance(it) && it.date >= depuis && it.date <= AUJ && filtreLieu(it.quartier, it.secteur); })
      .sort(function (x, y) { return y.date.localeCompare(x.date); });

    if (!nom) {
      // ===== Vue d'ensemble : tous les secteurs, tous les quartiers =====
      // 1. Aujourd'hui dans les quartiers, rangé par secteur puis quartier
      var auj = el('section', 'bloc bloc-q');
      auj.appendChild(el('h2', 'grand-titre', 'Aujourd\'hui dans les quartiers'));
      auj.appendChild(el('p', 'sous-titre', JOURS[new Date().getDay()] + ' ' + new Date().getDate() + ' ' + MOIS[new Date().getMonth()]));
      var duJour = rdvQ.filter(function (x) { return ce(x, AUJ); });
      if (!duJour.length) auj.appendChild(el('p', 'vide', 'Rien de repéré aujourd\'hui dans les quartiers.'));
      var grille = el('div', 'grille-q');
      Object.keys(SECTEURS).concat(['']).forEach(function (s) {
        var its = duJour.filter(function (x) { return (x.secteur || '') === s; }); if (!its.length) return;
        var col = el('div', 'sect'); col.appendChild(el('h3', 'sect-t', s || 'Autres lieux'));
        var parQ = {}; its.forEach(function (x) { (parQ[x.quartier] = parQ[x.quartier] || []).push(x); });
        Object.keys(parQ).forEach(function (q) {
          col.appendChild(el('div', 'quart-t', q));
          parQ[q].forEach(function (x) { col.appendChild(ligneQ(x, false)); });
        });
        grille.appendChild(col);
      });
      auj.appendChild(grille); v.appendChild(auj);
      // 2. À venir dans nos quartiers : les 10 prochains jours
      v.appendChild(blocAvenir('À venir dans nos quartiers', 'les 10 prochains jours', 1, 10));
      // 3. Actualité des quartiers, enroulée par secteur
      var act = el('section', 'bloc bloc-q'); act.appendChild(el('h2', 'grand-titre petit', 'Actualité des quartiers'));
      act.appendChild(el('p', 'sous-titre', 'presse et associations, le mois écoulé · choisissez un secteur ou un quartier pour le détail'));
      Object.keys(SECTEURS).forEach(function (s) {
        var its = items.filter(function (it) { return (it.secteur || secteurDuQuartier(it.quartier)) === s; }); if (!its.length) return;
        var d = el('details', 'mini mini-sect'); d.appendChild(el('summary', '', s + ' · ' + its.length));
        its.forEach(function (it) { d.appendChild(carteItem(it, it.categorie === 'Association' ? 'Association' : 'Presse')); });
        act.appendChild(d);
      });
      if (!items.length) act.appendChild(el('p', 'vide', 'Rien de repéré ce mois-ci.'));
      v.appendChild(act);
      return;
    }

    // ===== Vue personnalisée : un secteur ou un quartier choisi =====
    // 1. Actualité · nom
    var act2 = el('section', 'bloc bloc-q');
    act2.appendChild(el('h2', 'grand-titre', 'Actualité · ' + nom));
    act2.appendChild(el('p', 'sous-titre', selQ.q ? 'quartier ' + (selQ.s ? 'du secteur ' + selQ.s : '') : 'secteur · ' + SECTEURS[selQ.s].length + ' quartiers'));
    // recherche en ligne : le quartier, ou tous les quartiers du secteur
    // Requête : quartier "Chalets" Toulouse  → les trois mots sont obligatoires (couvre « quartier des Chalets », « quartier Les Chalets »…)
    function sansArticle(q) { return q.replace(/^(Les|Le|La) /, '').replace(/^L'/, ''); }
    var termes = selQ.q ? 'quartier "' + sansArticle(selQ.q) + '" Toulouse' : 'quartier (' + SECTEURS[selQ.s].map(function (q) { return '"' + sansArticle(q) + '"'; }).join(' OR ') + ') Toulouse';
    var rz = el('div', 'rech-presse');
    var gn = lien('https://www.google.com/search?tbm=nws&tbs=qdr:w&hl=fr&gl=fr&q=' + encodeURIComponent(termes), '📰 Presse en ligne · 7 derniers jours'); gn.className = 'bt-presse';
    rz.appendChild(gn); act2.appendChild(rz);
    var presse = items.filter(function (x) { return x.categorie !== 'Association'; });
    var asso = items.filter(function (x) { return x.categorie === 'Association'; });
    [['sb-presse', 'Dans la presse · le mois écoulé', presse, 'Presse'], ['sb-asso', 'Associations, Facebook et sites de quartier', asso, 'Association']].forEach(function (z) {
      var sb = el('div', 'sb ' + z[0]); sb.appendChild(el('div', 'sb-titre', z[1]));
      if (!z[2].length) sb.appendChild(el('p', 'nb', 'Rien de repéré pour l\'instant.'));
      z[2].forEach(function (x) { sb.appendChild(carteItem(x, z[3])); });
      act2.appendChild(sb);
    });
    v.appendChild(act2);
    // 2. À venir · nom : aujourd'hui et les 30 prochains jours
    v.appendChild(blocAvenir('À venir · ' + nom, 'aujourd\'hui et les 30 prochains jours', 0, 30));
  }
  // ---------- Vue : Archives ----------
  // ---------- Vue : Archives = moteur de recherche (mois, thème, quartier, mot-clé) ----------
  var arch = { mois: '', theme: '', lieu: '', mot: '', lance: false };
  var THEMES_ARCH = [
    ['', 'Tous les thèmes'],
    ['presse', 'Actualité presse'],
    ['quartier', 'Comités de quartier et réunions publiques'],
    ['culture', 'Infos culturelles et conférences'],
    ['doleance', 'Mobilisations et doléances'],
    ['institution', 'Protocole, commissions et institutions']
  ];
  function themeDe(x) {
    if (x._t === 'actu') return 'presse';
    if (x._t === 'q') { var c = x.categorie || ''; if (/^(dol|mobil)/i.test(c)) return 'doleance'; if (c === 'Association') return 'quartier'; return 'presse'; }
    var g = TYPES[typeDe(x)].g, t = x.type || '';
    if (g === 'culture') return 'culture';
    if (g === 'quartier') return 'quartier';
    if (g === 'majo') return 'majo';
    if (/militant/i.test(t)) return 'militant';
    return 'institution';
  }
  function vueArchives(v) {
    var tout = [].concat(
      D.actus.map(function (x) { return Object.assign({ _t: 'actu' }, x); }),
      D.quartiers.map(function (x) { return Object.assign({ _t: 'q' }, x); }),
      D.evenements.map(function (x) { return Object.assign({ _t: 'ev' }, x); })
    ).filter(function (x) { return x.date; });
    var mois = {}; tout.forEach(function (x) { if (x.date <= AUJ) mois[x.date.slice(0, 7)] = 1; });
    var liste = Object.keys(mois).sort().reverse();

    var bx = el('section', 'bloc bloc-q moteur');
    bx.appendChild(el('h2', 'grand-titre petit', 'Rechercher dans les archives'));
    bx.appendChild(el('p', 'sous-titre', 'toute la veille enregistrée : presse, quartiers, Facebook, agenda'));
    var g = el('div', 'selecteurs');
    function choix(label, opts, val, cb) {
      var l = el('label', '', label), s = el('select'); l.appendChild(s);
      opts.forEach(function (o) {
        if (o.groupe) { var og = document.createElement('optgroup'); og.label = o.groupe; o.items.forEach(function (it) { var op = el('option', '', it[1]); op.value = it[0]; if (it[0] === val) op.selected = true; og.appendChild(op); }); s.appendChild(og); return; }
        var op = el('option', '', o[1]); op.value = o[0]; if (o[0] === val) op.selected = true; s.appendChild(op);
      });
      s.addEventListener('change', function () { cb(s.value); });
      g.appendChild(l); return s;
    }
    choix('Mois', [['', 'Tous les mois']].concat(liste.map(function (m) { var p = m.split('-'); return [m, MOIS[+p[1] - 1] + ' ' + p[0]]; })), arch.mois, function (x) { arch.mois = x; });
    choix('Thème', THEMES_ARCH, arch.theme, function (x) { arch.theme = x; });
    var optsLieu = [['', 'Tous les quartiers']];
    optsLieu.push({ groupe: 'Secteurs', items: Object.keys(SECTEURS).map(function (s) { return ['s:' + s, 'Secteur ' + s]; }) });
    Object.keys(SECTEURS).forEach(function (s) { optsLieu.push({ groupe: s, items: SECTEURS[s].map(function (q) { return ['q:' + q, q]; }) }); });
    choix('Quartier ou secteur', optsLieu, arch.lieu, function (x) { arch.lieu = x; });
    var lm = el('label', '', 'Mot-clé (facultatif)'), im = el('input'); im.type = 'search'; im.placeholder = 'ex. vélo, Bordeblanche, crèche…'; im.value = arch.mot; lm.appendChild(im); g.appendChild(lm);
    bx.appendChild(g);
    var go = el('button', 'bt-presse bt-loupe', '🔍 Rechercher'); go.type = 'button';
    function lancer() { arch.mot = im.value.trim(); arch.lance = true; rendre(); }
    go.addEventListener('click', lancer);
    im.addEventListener('keydown', function (e) { if (e.key === 'Enter') lancer(); });
    var cz = el('div', 'rech-presse'); cz.appendChild(go); bx.appendChild(cz);
    v.appendChild(bx);
    if (!arch.lance) { v.appendChild(el('p', 'vide', 'Choisissez vos critères puis appuyez sur 🔍 Rechercher.')); return; }

    // filtrage
    var mots = norm(arch.mot).split(/\s+/).filter(Boolean);
    var res = tout.filter(function (x) {
      if (arch.mois && x.date.slice(0, 7) !== arch.mois) return false;
      var th = themeDe(x);
      if (arch.theme) { if (th !== arch.theme) return false; }
      else if (th === 'majo') return false;
      if (arch.lieu) {
        var q = x.quartier || '', sec = x.secteur || secteurDuQuartier(q);
        if (arch.lieu.indexOf('s:') === 0) { if (sec !== arch.lieu.slice(2)) return false; }
        else { var nq = arch.lieu.slice(2); if (!(correspond(q, nq) || norm(q).indexOf(norm(nq)) > -1)) return false; }
      }
      if (mots.length) { var h = norm([x.titre, x.texte, x.details, x.lieu, x.quartier, x.source, x.qui].join(' ')); if (!mots.every(function (m) { return h.indexOf(m) > -1; })) return false; }
      return true;
    }).sort(function (a, b) { return (b.date + (b.heure || '')).localeCompare(a.date + (a.heure || '')); });

    var rz = el('section', 'bloc');
    rz.appendChild(el('h2', 'h2', res.length + ' résultat' + (res.length > 1 ? 's' : '')));
    if (!res.length) rz.appendChild(el('p', 'vide', 'Aucun résultat avec ces critères. Essayez « Tous les mois » ou un thème plus large.'));
    var max = 150;
    res.slice(0, max).forEach(function (x) {
      if (x._t === 'ev') { rz.appendChild(carteEv(x, true)); return; }
      if (x._t === 'actu') { var c = carteActu(x); c.insertBefore(el('span', 'dt', courte(x.date) + ' '), c.firstChild); rz.appendChild(c); return; }
      rz.appendChild(carteItem(x, /^(dol|mobil)/i.test(x.categorie || '') ? 'Doléance' : x.categorie));
    });
    if (res.length > max) rz.appendChild(el('p', 'nb', 'Seuls les ' + max + ' plus récents sont affichés : affinez la recherche.'));
    v.appendChild(rz);
  }
  function vueRecherche(v) {
    var b = el('div', 'bloc recherche'); var i = el('input'); i.type = 'search'; i.placeholder = 'Un quartier, un mot, un nom…'; i.value = recherche; b.appendChild(i); v.appendChild(b);
    var res = el('div'); v.appendChild(res);
    function chercher() {
      recherche = i.value; res.textContent = '';
      var m = norm(recherche.trim()); if (m.length < 2) { res.appendChild(el('p', 'vide', 'Tapez au moins deux lettres.')); return; }
      var ok = function (x) { return norm([x.titre, x.texte, x.details, x.quartier, x.lieu, x.qui, x.source].join(' ')).indexOf(m) > -1; };
      var tout = [];
      D.evenements.filter(ok).forEach(function (x) { tout.push({ d: x.date, n: carteEv(x, true) }); });
      D.actus.filter(ok).forEach(function (x) { var c = carteActu(x); c.insertBefore(el('span', 'dt', courte(x.date) + ' '), c.firstChild); tout.push({ d: x.date, n: c }); });
      D.quartiers.filter(ok).forEach(function (x) { tout.push({ d: x.date, n: carteItem(x, x.categorie) }); });
      tout.sort(function (a, c) { return c.d.localeCompare(a.d); });
      res.appendChild(el('p', 'nb', tout.length + ' résultat' + (tout.length > 1 ? 's' : '')));
      var bl = el('div', 'bloc'); tout.slice(0, 150).forEach(function (x) { bl.appendChild(x.n); }); if (tout.length) res.appendChild(bl);
    }
    var t; i.addEventListener('input', function () { clearTimeout(t); t = setTimeout(chercher, 200); });
    chercher(); setTimeout(function () { i.focus(); }, 50);
  }

  // ---------- Rendu ----------
  function rendre() {
    var v = document.getElementById('vue'); v.textContent = '';
    document.querySelectorAll('.onglets button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === vue); });
    ({ jour: vueJour, agenda: vueAgenda, quartiers: vueQuartiers, archives: vueArchives, recherche: vueRecherche }[vue] || vueJour)(v);
    var p = el('p', 'pied', 'Données mises à jour ' + (D.maj ? 'le ' + new Date(D.maj).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '')); v.appendChild(p);
  }
  document.querySelectorAll('.onglets button').forEach(function (b) {
    b.addEventListener('click', function () { vue = b.getAttribute('data-v'); store('vm-vue', vue); rendre(); window.scrollTo(0, 0); });
  });

  charger();
  setInterval(rafraichirPresences, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { AUJ = cle(new Date()); rafraichirPresences(); } });

  // ---------- Application installable ----------
  if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }
  (function () {
    var installe = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (installe) return;
    var masque = false; try { masque = localStorage.getItem('vm-install-masque') === '1'; } catch (x) {}
    if (masque) return;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var ev = null;
    function bandeauInstall(texte, action) {
      if (document.querySelector('.install')) return;
      var b = el('div', 'install'); b.appendChild(el('span', 'install-ico', '📲'));
      var t = el('span', 'install-t'); t.innerHTML = texte; b.appendChild(t);
      if (action) { var go = el('button', 'install-go', 'Installer'); go.type = 'button'; go.addEventListener('click', action); b.appendChild(go); }
      var x = el('button', 'install-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Fermer');
      x.addEventListener('click', function () { b.remove(); try { localStorage.setItem('vm-install-masque', '1'); } catch (y) {} });
      b.appendChild(x); document.body.appendChild(b);
    }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); ev = e;
      bandeauInstall('<b>Installer l\'appli</b> sur cet appareil', function () { ev.prompt(); ev.userChoice.finally(function () { var b = document.querySelector('.install'); if (b) b.remove(); }); });
    });
    if (ios && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)) {
      setTimeout(function () { bandeauInstall('Pour l\'avoir en appli : touchez <b>Partager</b> <span aria-hidden="true">⎙</span> puis <b>« Sur l\'écran d\'accueil »</b>'); }, 2500);
    }
  })();
})();
