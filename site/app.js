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
    'Militant': { c: '#d32f2f', f: '#fdf6f6', g: 'militant' },
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
  var moi = store('vm-moi') || '';
  var selQ = { s: store('vm-sec') || '', q: store('vm-q') || '' };
  var moisArch = '';
  var recherche = '';

  // ---------- Données ----------
  function charger(frais) {
    return fetch('api.php?a=data' + (frais ? '&frais=1' : ''), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.erreur && !d.evenements) { afficherErreur(d.erreur); return; }
      D = d; D.evenements = d.evenements || []; D.actus = d.actus || []; D.quartiers = d.quartiers || []; D.presences = d.presences || {};
      ajouterReunionsGroupe();
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
  function majPresences() { document.querySelectorAll('.pres').forEach(peindrePresence); }
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
    f.addEventListener('click', function () { m.remove(); }); bx.appendChild(f);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    m.appendChild(bx); document.body.appendChild(m);
  }

  // ---------- Cartes ----------
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
    if (t.g !== 'majo') c.appendChild(blocPresence(e.id));
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
    loc.forEach(function (a) { b.appendChild(carteActu(a)); });
    [['France', 'r-france'], ['Europe', 'r-europe'], ['Monde', 'r-monde'], ['Facebook', 'r-facebook']].forEach(function (n) {
      var its = du.filter(function (a) { return a.niveau === n[0]; }); if (!its.length) return;
      var d = el('details', 'repli ' + n[1]); d.appendChild(el('summary', '', n[0] === 'Facebook' ? 'Groupes de quartier' : n[0]));
      its.forEach(function (a) { d.appendChild(carteActu(a)); }); b.appendChild(d);
    });
    v.appendChild(b);
    // Le programme du jour et de demain
    [[AUJ, 'Aujourd\'hui dans l\'agenda'], [cle(ajout(new Date(), 1)), 'Demain']].forEach(function (x) {
      var evs = D.evenements.filter(function (e) { return enCours(e, x[0]) && TYPES[typeDe(e)].g !== 'majo'; });
      var s = el('section', 'bloc'); s.appendChild(el('h2', 'h2 bleu', x[1]));
      if (!evs.length) s.appendChild(el('p', 'vide', 'Rien de prévu dans l\'agenda.'));
      evs.forEach(function (e) { s.appendChild(carteEv(e)); });
      v.appendChild(s);
    });
  }
  function enCours(e, k) { return e.date === k || (e.date_fin && e.date < k && e.date_fin >= k); }

  // ---------- Vue : Agenda ----------
  function vueAgenda(v) {
    var f = el('div', 'filtres');
    FILTRES.forEach(function (x) {
      var b = el('button', x[0] === filtre ? 'on' : '', x[1]); b.type = 'button';
      b.addEventListener('click', function () { filtre = x[0]; rendre(); }); f.appendChild(b);
    });
    v.appendChild(f);
    var lg = el('div', 'legende');
    [['#b39ddb', 'Réunion de groupe'], ['#3f51b5', 'Protocole, inauguration'], ['#039be5', 'Commission'], ['#e67c73', 'Réunion de quartier'], ['#e08a1e', 'Association'], ['#d32f2f', 'Militant'], ['#a9874f', 'Culture'], ['#0b8043', 'Conférence, café-débat'], ['#fff', 'Mairie']].forEach(function (x) {
      var s = el('span'); var i = el('i'); i.style.background = x[0]; if (x[0] === '#fff') i.style.boxShadow = 'inset 0 0 0 1px #999'; s.appendChild(i); s.appendChild(document.createTextNode(x[1])); lg.appendChild(s);
    });
    v.appendChild(lg);

    var debut = lundi(new Date()), fin = ajout(new Date(), 31), finSem1 = ajout(debut, 6);
    var parJour = {};
    D.evenements.forEach(function (e) {
      var g = TYPES[typeDe(e)].g;
      if (filtre !== 'tout' && g !== filtre && g !== 'groupe') return;
      var k = e.date; if (k < cle(debut) || k > cle(fin)) { if (!(e.date_fin && e.date < cle(debut) && e.date_fin >= cle(debut))) return; k = cle(debut); }
      (parJour[k] = parJour[k] || []).push(e);
    });
    var jours = Object.keys(parJour).sort();
    if (!jours.length) { v.appendChild(el('p', 'vide', 'Aucun rendez-vous dans cette sélection.')); return; }
    var groupes = {};
    jours.forEach(function (k) { var s = cle(lundi(dDe(k))); (groupes[s] = groupes[s] || []).push(k); });
    Object.keys(groupes).sort().forEach(function (s, i) {
      var lu = dDe(s), di = ajout(lu, 6);
      var lib = (i === 0 && s === cle(debut) ? 'Cette semaine' : 'Semaine du ' + lu.getDate()) + (i === 0 && s === cle(debut) ? ' → ' + lu.getDate() : '') + (lu.getMonth() !== di.getMonth() ? ' ' + MC[lu.getMonth()] : '') + ' au ' + di.getDate() + ' ' + MC[di.getMonth()];
      var cont;
      if (s === cle(debut)) { cont = el('div', 'sem-1'); cont.appendChild(el('div', 'semaine', lib)); }
      else { cont = el('details', 'sem'); var sm = el('summary'); var sd = el('div', 'semaine', lib); sd.appendChild(el('span', '', groupes[s].length + ' jour' + (groupes[s].length > 1 ? 's' : ''))); sm.appendChild(sd); cont.appendChild(sm); }
      var prec = null, nPrec = 0;
      groupes[s].forEach(function (k) {
        var j = blocJour(k, parJour[k]);
        if (k < AUJ) {
          if (!prec) { prec = el('details', 'prec'); var ps = el('summary'); ps.appendChild(el('b', '', 'Jours précédents ')); ps.appendChild(el('span', 'pd')); prec.appendChild(ps); cont.appendChild(prec); prec._d1 = k; }
          prec.appendChild(j); nPrec++;
          prec.querySelector('.pd').textContent = (nPrec > 1 ? JC[dDe(prec._d1).getDay()] + ' ' + dDe(prec._d1).getDate() + ' → ' : '') + JC[dDe(k).getDay()] + ' ' + courte(k);
        } else cont.appendChild(j);
      });
      v.appendChild(cont);
    });
  }
  function blocJour(k, evs) {
    var d = dDe(k), j = el('section', 'jour' + (k === AUJ ? ' auj' : ''));
    var t = el('div', 'jour-tete'); t.appendChild(el('b', '', JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]));
    if (k === AUJ) t.appendChild(el('em', '', 'AUJOURD\'HUI'));
    j.appendChild(t);
    var c = el('div', 'jour-corps');
    var main = evs.filter(function (e) { var g = TYPES[typeDe(e)].g; return g !== 'culture' && g !== 'mairie' && g !== 'majo'; });
    main.forEach(function (e) { c.appendChild(carteEv(e)); });
    var cult = evs.filter(function (e) { return TYPES[typeDe(e)].g === 'culture'; });
    var mai = evs.filter(function (e) { return TYPES[typeDe(e)].g === 'mairie'; });
    var majo = evs.filter(function (e) { return TYPES[typeDe(e)].g === 'majo'; });
    var ouvert = filtre !== 'tout';
    if (cult.length) { var dc = el('details', 'mini mini-cult'); dc.open = ouvert || !main.length; dc.appendChild(el('summary', '', '● Culture et conférences · ' + cult.length)); cult.forEach(function (e) { dc.appendChild(carteEv(e)); }); c.appendChild(dc); }
    if (mai.length) { var dm = el('details', 'mini mini-mairie'); dm.open = ouvert; dm.appendChild(el('summary', '', '○ Événements mairie · ' + mai.length)); mai.forEach(function (e) { dm.appendChild(carteEv(e)); }); c.appendChild(dm); }
    if (majo.length && filtre === 'tout') {
      var dj = el('details', 'mini mini-majo'); dj.appendChild(el('summary', '', '👁 Maire et majorité · ' + majo.length + ' rdv'));
      majo.forEach(function (e) { var li = el('div', 'majo-li' + (/maire/i.test(e.qui || '') ? ' maire' : '')); li.appendChild(el('b', '', (hFmt(e.heure) || '') + ' · ' + (e.qui || ''))); li.appendChild(document.createTextNode(' → ' + e.titre + (e.lieu ? ' → ' + e.lieu : ''))); dj.appendChild(li); });
      c.appendChild(dj);
    }
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

    var depuis = cle(ajout(new Date(), -31)), jusqua = cle(ajout(new Date(), 31));
    var items = D.quartiers.filter(function (it) {
      if (it.date < depuis || it.date > jusqua) return false;
      if (selQ.q) return correspond(it.quartier, selQ.q);
      if (selQ.s) return it.secteur === selQ.s || secteurDuQuartier(it.quartier) === selQ.s;
      return true;
    }).sort(function (a, b) { return b.date.localeCompare(a.date); });
    var rdv = D.evenements.filter(function (e) {
      var g = TYPES[typeDe(e)].g; if (g === 'majo' || !e.quartier || e.date < AUJ || e.date > jusqua) return false;
      if (selQ.q) return correspond(e.quartier, selQ.q) || norm(e.quartier).indexOf(norm(selQ.q)) > -1;
      if (selQ.s) return secteurDuQuartier(e.quartier) === selQ.s;
      return g === 'quartier';
    });
    var secs = selQ.s ? [selQ.s] : Object.keys(SECTEURS);
    secs.forEach(function (s) {
      var b = el('section', 'bloc'); b.appendChild(el('h2', 'h2 orange', s));
      var its = items.filter(function (it) { return (it.secteur || secteurDuQuartier(it.quartier)) === s; });
      var rv = rdv.filter(function (e) { return secteurDuQuartier(e.quartier) === s; });
      [['sb-agenda', 'Rendez-vous à venir dans l\'agenda', rv, 'ev'], ['sb-presse', 'Actualité dans la presse', its.filter(function (x) { return x.categorie !== 'Association'; }), 'Presse'], ['sb-asso', 'Associations, Facebook et sites de quartier', its.filter(function (x) { return x.categorie === 'Association'; }), 'Association']].forEach(function (z) {
        var sb = el('div', 'sb ' + z[0]); sb.appendChild(el('div', 'sb-titre', z[1]));
        if (!z[2].length) sb.appendChild(el('p', 'nb', 'Rien de repéré pour l\'instant.'));
        z[2].forEach(function (x) { sb.appendChild(z[3] === 'ev' ? carteEv(x, true) : carteItem(x, z[3])); });
        b.appendChild(sb);
      });
      v.appendChild(b);
    });
  }

  // ---------- Vue : Archives ----------
  function vueArchives(v) {
    var mois = {};
    [].concat(D.actus, D.quartiers, D.evenements).forEach(function (x) { if (x.date && x.date < AUJ) mois[x.date.slice(0, 7)] = 1; });
    var liste = Object.keys(mois).sort().reverse();
    if (!liste.length) { v.appendChild(el('p', 'vide', 'Pas encore d\'archives.')); return; }
    if (!moisArch || liste.indexOf(moisArch) < 0) moisArch = liste[0];
    var sel = el('div', 'selecteurs bloc'), l = el('label', '', 'Mois'), s = el('select'); l.appendChild(s);
    liste.forEach(function (m) { var p = m.split('-'); var o = el('option', '', MOIS[+p[1] - 1] + ' ' + p[0]); o.value = m; if (m === moisArch) o.selected = true; s.appendChild(o); });
    s.addEventListener('change', function () { moisArch = s.value; rendre(); });
    sel.appendChild(l); v.appendChild(sel);
    var dans = function (x) { return x.date && x.date.slice(0, 7) === moisArch && x.date < AUJ; };
    var desc = function (a, b) { return b.date.localeCompare(a.date); };
    var a = D.actus.filter(dans).sort(desc), q = D.quartiers.filter(dans).sort(desc), e = D.evenements.filter(function (x) { return dans(x) && TYPES[typeDe(x)].g !== 'majo'; }).sort(desc);
    var b1 = el('section', 'bloc'); b1.appendChild(el('h2', 'h2 rouge', 'Actualités · ' + a.length)); a.forEach(function (x) { var c = carteActu(x); c.insertBefore(el('span', 'dt', courte(x.date) + ' '), c.firstChild); b1.appendChild(c); }); v.appendChild(b1);
    var b2 = el('section', 'bloc'); b2.appendChild(el('h2', 'h2 orange', 'Quartiers · ' + q.length)); q.forEach(function (x) { b2.appendChild(carteItem(x, x.categorie)); }); v.appendChild(b2);
    var b3 = el('details', 'bloc repli'); b3.appendChild(el('summary', '', 'Rendez-vous passés · ' + e.length)); b3.querySelector('summary').style.cssText = 'background:#2f5f8f;color:#fff'; e.forEach(function (x) { b3.appendChild(carteEv(x, true)); }); v.appendChild(b3);
  }

  // ---------- Vue : Recherche ----------
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
})();
