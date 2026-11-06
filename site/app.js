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
  var moisArch = '';
  var recherche = '';

  // ---------- Données ----------
  function charger(frais) {
    return fetch('api.php?a=data' + (frais ? '&frais=1' : ''), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
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
    loc.forEach(function (a) { b.appendChild(carteActu(a)); });
    [['France', 'r-france'], ['Europe', 'r-europe'], ['Monde', 'r-monde'], ['Facebook', 'r-facebook']].forEach(function (n) {
      var its = du.filter(function (a) { return a.niveau === n[0]; }); if (!its.length) return;
      var d = el('details', 'repli ' + n[1]); d.appendChild(el('summary', '', n[0] === 'Facebook' ? 'Groupes de quartier' : n[0]));
      its.forEach(function (a) { d.appendChild(carteActu(a)); }); b.appendChild(d);
    });
    v.appendChild(b);
    // Le programme du jour et de demain
    [[AUJ, 'Aujourd\'hui dans l\'agenda'], [cle(ajout(new Date(), 1)), 'Demain']].forEach(function (x) {
      var tous = D.evenements.filter(function (e) { return enCours(e, x[0]); });
      var evs = tous.filter(function (e) { return TYPES[typeDe(e)].g !== 'majo'; });
      var majo = tous.filter(function (e) { return TYPES[typeDe(e)].g === 'majo'; });
      var s = el('section', 'bloc'); var hd = el('div', 'tete-bloc'); hd.appendChild(el('h2', 'h2 bleu', x[1])); s.appendChild(hd);
      if (!evs.length && !majo.length) s.appendChild(el('p', 'vide', 'Rien de prévu dans l\'agenda.'));
      rangerJour(evs, s, false);
      blocMajo(majo, hd, hd);
      v.appendChild(s);
    });
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

  function vueAgenda(v) {
    var f = el('div', 'filtres');
    FILTRES.forEach(function (x) {
      var b = el('button', x[0] === filtre ? 'on' : '', x[1]); b.type = 'button';
      b.addEventListener('click', function () { filtre = x[0]; rendre(); }); f.appendChild(b);
    });
    v.appendChild(f);
    // Barre d'outils : calendrier + légende repliée
    var outils = el('div', 'outils-ag');
    var bcal = el('button', 'bt-cal', '📅 Choisir un jour'); bcal.type = 'button';
    var pop = el('div', 'cal-pop'); pop.hidden = true;
    bcal.addEventListener('click', function (e) { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) dessinerCal(pop, moisCal); });
    var wrap = el('div', 'cal-wrap'); wrap.appendChild(bcal); wrap.appendChild(pop); outils.appendChild(wrap);
    var lg = el('details', 'legende-d'); lg.appendChild(el('summary', '', '🎨 Légende des couleurs'));
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
    haut.forEach(function (e) { c.appendChild(carteEv(e)); });
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
  function verifierRangement() {
    var s = sigPresences(); if (s === signature) return; signature = s;
    if (document.querySelector('.modale:not([hidden])') || !document.querySelector('.ev')) return;
    var y = window.scrollY; rendre(); window.scrollTo(0, y);
  }
  function blocJour(k, evs) {
    var d = dDe(k), j = el('section', 'jour' + (k === AUJ ? ' auj' : ''));
    var t = el('div', 'jour-tete'); t.appendChild(el('b', '', JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]));
    if (k === AUJ) t.appendChild(el('em', '', 'AUJOURD\'HUI'));
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
    var items = D.quartiers.filter(function (it) { return it.date >= depuis && it.date <= AUJ && filtreLieu(it.quartier, it.secteur); })
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
