<?php
/*
 * Veille et agenda · Vivre Mieux — serveur de la plateforme
 *
 * Ce fichier ne contient AUCUNE donnée. Les réglages (identifiant de la feuille Google)
 * et les présences des élus sont stockés hors du dépôt GitHub et hors du dossier public,
 * dans ~/agenda-data/ sur le serveur o2switch.
 *
 *   GET  api.php?a=data   → événements, actus, infos de quartier, présences
 *   GET  api.php?a=pres   → présences seulement (rafraîchissement régulier)
 *   POST api.php  a=pres&id=…&nom=…&statut=present|peut|  → enregistre une présence
 *   POST api.php?a=ajout  (JSON)  → ajoute ou corrige un rendez-vous saisi par un élu (+ photo)
 *   POST api.php  a=suppr&id=…&nom=…  → supprime un rendez-vous ajouté
 *   GET  api.php?a=photo&id=…  → photo jointe à un rendez-vous
 *   POST api.php  a=code&code=…  → vérifie le code d'accès du groupe
 *
 *   GET  api.php?a=ics&id=…  → un rendez-vous au format agenda (.ics)
 *   GET  api.php?a=agenda&qui=…&k=…  → agenda personnel d'un élu (abonnement Google, Apple, Outlook)
 *
 * Code d'accès : si config.php contient 'code_acces' => '…', toute la plateforme le demande.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const ELUS = [
  'François Briançon', 'Hélène Cabanes', 'Vincent Gibert', 'Inès Goffre-Pedrosa',
  'Régis Godec', 'Isabelle Hardy', 'Anne-Sophie de Surgy', 'Maxime Le Texier',
  'Hugo Sajhau (collaborateur)',
];
const ONGLETS = ['evenements' => 0, 'actus' => 101, 'quartiers' => 102];
const CACHE_SECONDES = 120;

// Dossier des données : /home/<compte>/agenda-data (le site est dans /home/<compte>/repositories/veille-agenda/site)
$DATA = dirname(__DIR__, 3) . '/agenda-data';
if (!is_dir($DATA)) { @mkdir($DATA, 0700, true); }
if (!is_dir("$DATA/cache")) { @mkdir("$DATA/cache", 0700, true); }

function sortir($donnees, $code = 200) {
  http_response_code($code);
  echo json_encode($donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function config() {
  global $DATA;
  $f = "$DATA/config.php";
  if (!is_file($f)) { return null; }
  try { $c = include $f; } catch (Throwable $e) { return null; } // fichier de réglages mal écrit
  return is_array($c) ? $c : null;
}

// ---------- Lecture de la feuille Google (export CSV, avec cache) ----------

function telecharger($url) {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_TIMEOUT => 15, CURLOPT_USERAGENT => 'VivreMieux-Agenda/1.0']);
    $r = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($code === 200 && $r !== false) ? $r : null;
  }
  $r = @file_get_contents($url);
  return $r === false ? null : $r;
}

function lireDate($v) {
  $v = trim((string)$v);
  if ($v === '') { return ''; }
  if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})/', $v, $m)) { return sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]); }
  if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{4})/', $v, $m)) { return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]); }
  return '';
}

function lireHeure($v) {
  $v = trim((string)$v);
  if (preg_match('/^(\d{1,2})\s*[:hH]\s*(\d{2})?/', $v, $m)) { return sprintf('%02d:%02d', $m[1], isset($m[2]) && $m[2] !== '' ? $m[2] : 0); }
  return '';
}

function lireOnglet($sheetId, $gid) {
  $csv = telecharger("https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv&gid=$gid");
  if ($csv === null || stripos(ltrim($csv), '<!doctype html') === 0 || stripos(ltrim($csv), '<html') === 0) { return null; }
  $f = fopen('php://temp', 'r+'); fwrite($f, $csv); rewind($f);
  $entete = fgetcsv($f);
  if (!$entete) { return []; }
  $entete = array_map(function ($h) { return strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', $h))); }, $entete);
  $lignes = [];
  while (($l = fgetcsv($f)) !== false) {
    if (count(array_filter($l, function ($x) { return trim($x) !== ''; })) === 0) { continue; }
    $r = [];
    foreach ($entete as $i => $h) { if ($h !== '') { $r[$h] = isset($l[$i]) ? trim($l[$i]) : ''; } }
    if (isset($r['afficher']) && strtolower($r['afficher']) === 'non') { continue; }
    foreach (['date', 'date_fin'] as $k) { if (isset($r[$k])) { $r[$k] = lireDate($r[$k]); } }
    if (isset($r['heure'])) { $r['heure'] = lireHeure($r['heure']); }
    if (empty($r['date'])) { continue; }
    if (empty($r['id'])) { $r['id'] = 'h' . substr(md5(($r['date'] ?? '') . '|' . ($r['heure'] ?? '') . '|' . ($r['titre'] ?? '')), 0, 8); }
    unset($r['afficher']);
    $lignes[] = $r;
  }
  fclose($f);
  return $lignes;
}

function donnees() {
  global $DATA;
  $cache = "$DATA/cache/donnees.json";
  if (is_file($cache) && time() - filemtime($cache) < CACHE_SECONDES && !isset($_GET['frais'])) {
    $d = json_decode(file_get_contents($cache), true);
    if ($d) { return $d; }
  }
  $c = config();
  if (!$c || empty($c['sheet_id'])) {
    return is_file($cache) ? json_decode(file_get_contents($cache), true) : ['erreur' => 'config'];
  }
  $d = ['maj' => date('c')];
  foreach (ONGLETS as $nom => $gid) {
    $o = lireOnglet($c['sheet_id'], $gid);
    if ($o === null) {
      // feuille injoignable : on garde la dernière version connue
      if (is_file($cache)) { $vieux = json_decode(file_get_contents($cache), true); if ($vieux) { touch($cache); return $vieux; } }
      return ['erreur' => 'feuille'];
    }
    $d[$nom] = $o;
  }
  file_put_contents($cache, json_encode($d, JSON_UNESCAPED_UNICODE), LOCK_EX);
  return $d;
}


// ---------- Agenda Gmail Vivre Mieux → plateforme (adresse secrète iCal dans config.php, clé 'ical') ----------

const ICAL_SECONDES = 600; // relu au plus toutes les 10 minutes

function icalBrut($url) {
  if (function_exists('curl_init')) {
    $h = curl_init($url);
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 12, CURLOPT_USERAGENT => 'VeilleAgenda/1.0']);
    $t = curl_exec($h); $ok = curl_getinfo($h, CURLINFO_HTTP_CODE) === 200; curl_close($h);
    return ($ok && is_string($t) && strpos($t, 'BEGIN:VCALENDAR') !== false) ? $t : null;
  }
  $t = @file_get_contents($url);
  return ($t !== false && strpos($t, 'BEGIN:VCALENDAR') !== false) ? $t : null;
}

function icalDate($v, $params) {
  // renvoie [date AAAA-MM-JJ, heure HH:MM ou ''] à l'heure de Paris
  $paris = new DateTimeZone('Europe/Paris');
  if (preg_match('/VALUE=DATE(?!-)/', $params) || preg_match('/^\d{8}$/', $v)) {
    return [substr($v, 0, 4) . '-' . substr($v, 4, 2) . '-' . substr($v, 6, 2), ''];
  }
  try {
    if (substr($v, -1) === 'Z') { $d = new DateTime($v, new DateTimeZone('UTC')); }
    elseif (preg_match('/TZID=([^;:]+)/', $params, $m)) { $d = new DateTime($v, new DateTimeZone(trim($m[1], '"'))); }
    else { $d = new DateTime($v, $paris); }
  } catch (Exception $e) { return ['', '']; }
  $d->setTimezone($paris);
  return [$d->format('Y-m-d'), $d->format('H:i')];
}

function icalTexte($t) {
  $t = str_replace(['\\n', '\\N', '\\,', '\;', '\\\\'], ["\n", "\n", ',', ';', '\\'], $t);
  $t = preg_replace('#<br\s*/?>|</p>#i', "\n", $t);
  $t = html_entity_decode(strip_tags($t), ENT_QUOTES, 'UTF-8');
  return trim($t);
}

function icalType($titre) {
  $t = mb_strtolower($titre);
  $regles = [
    'Commission' => '/commission/u', 'Conseil municipal' => '/conseil municipal/u',
    'Réunion officielle' => '/r[ée]union (publique|de quartier)|r[ée]unions? publiques?/u', 'Concertation' => '/concertation|consultation/u',
    'Inauguration' => '/inauguration/u', 'Cérémonie' => '/c[ée]r[ée]monie|comm[ée]moration|armistice/u', 'Protocole' => '/r[ée]ception|s[ée]ance solennelle|vernissage|c[ée]l[ée]bration|f[êe]te de l.ind[ée]pendance/u',
    'Militant' => '/manif|rassemblement|gr[èe]ve|d[ée]ambulation|mobilisation/u', 'Conférence' => '/conf[ée]rence|d[ée]bat|table ronde|ciné-rencontre|rencontre/u',
    'Culture' => '/concert|festival|spectacle|exposition|th[ée][âa]tre/u',
  ];
  foreach ($regles as $type => $re) { if (preg_match($re, $t)) { return $type; } }
  return 'Autre';
}

function icalEvenements() {
  global $DATA;
  $c = config(); $url = trim((string)(($c ?? [])['ical'] ?? ''));
  if ($url === '') { return []; }
  $cache = "$DATA/cache/ical.json";
  if (is_file($cache) && time() - filemtime($cache) < ICAL_SECONDES && !isset($_GET['frais'])) {
    $p = json_decode(file_get_contents($cache), true); if (is_array($p)) { return $p; }
  }
  $brut = icalBrut($url);
  if ($brut === null) { // agenda injoignable : dernière version connue
    if (is_file($cache)) { touch($cache); $p = json_decode(file_get_contents($cache), true); return is_array($p) ? $p : []; }
    return [];
  }
  $brut = preg_replace("/\r?\n[ \t]/", '', str_replace("\r\n", "\n", $brut)); // lignes repliées
  $min = date('Y-m-d', strtotime('-90 days')); $max = date('Y-m-d', strtotime('+200 days'));
  $out = [];
  foreach (explode('BEGIN:VEVENT', $brut) as $i => $bloc) {
    if ($i === 0) { continue; }
    $bloc = explode('END:VEVENT', $bloc)[0];
    $p = [];
    foreach (explode("\n", $bloc) as $l) {
      if (!preg_match('/^([A-Z-]+)((?:;[^:]*)?):(.*)$/', $l, $m)) { continue; }
      if (!isset($p[$m[1]])) { $p[$m[1]] = [$m[2], $m[3]]; }
    }
    if (empty($p['DTSTART']) || empty($p['SUMMARY'])) { continue; }
    if (isset($p['STATUS']) && strtoupper(trim($p['STATUS'][1])) === 'CANCELLED') { continue; }
    if (isset($p['RRULE'])) { continue; } // événements répétés (ex. réunion de groupe) : gérés par la plateforme
    [$date, $heure] = icalDate(trim($p['DTSTART'][1]), $p['DTSTART'][0]);
    if ($date === '' || $date < $min || $date > $max) { continue; }
    $titre = icalTexte($p['SUMMARY'][1]);
    $titre = trim(preg_replace('/\[cite:[^\]]*\]/i', '', $titre));
    if (preg_match('/r[ée]union de groupe/iu', $titre)) { continue; } // déjà générée par la plateforme le lundi
    $desc = icalTexte($p['DESCRIPTION'][1] ?? '');
    // on retire les liens de visio (Teams, Meet), les codes et les lignes ajoutées par la plateforme
    $lignes = array_filter(explode("\n", $desc), function ($l) {
      return !preg_match('/teams\.microsoft|meet\.google|zoom\.us|num[ée]ro de r[ée]union|code secret|^\s*rejoindre|r[ée]union microsoft teams|participer avec|pr[ée]sent·es\s*:|peut-[êe]tre\s*:|ajout[ée] depuis la plateforme/iu', $l);
    });
    $desc = trim(preg_replace('/\[cite:[^\]]*\]/i', '', implode("\n", $lignes)));
    $lien = '';
    if (preg_match('#https?://[^\s<>"]+#', $desc, $m)) { $lien = rtrim($m[0], '.,;)'); }
    $fin = isset($p['DTEND']) ? icalDate(trim($p['DTEND'][1]), $p['DTEND'][0]) : ['', ''];
    $dateFin = ($fin[0] && $fin[0] > $date && !($heure === '' && $fin[0] === date('Y-m-d', strtotime($date . ' +1 day')))) ? ($heure === '' ? date('Y-m-d', strtotime($fin[0] . ' -1 day')) : $fin[0]) : '';
    $titreAff = trim(preg_replace('/^\s*\[(important|commission|comission)\]\s*/i', '', $titre));
    $out[] = [
      'id' => 'g' . substr(md5(trim($p['UID'][1] ?? ($date . $heure . $titre))), 0, 10),
      'gid' => preg_replace('/@google\.com$/', '', trim($p['UID'][1] ?? '')),
      'date' => $date, 'date_fin' => $dateFin, 'heure' => $heure,
      'type' => icalType($titre), 'titre' => $titreAff ?: $titre,
      'lieu' => trim(preg_replace('/\[cite:[^\]]*\]/i', '', icalTexte($p['LOCATION'][1] ?? ''))),
      'details' => mb_substr($desc, 0, 1500), 'lien' => $lien,
      'source' => 'Agenda Gmail Vivre Mieux', 'important' => preg_match('/\[important\]/i', $titre) ? 'oui' : '',
    ];
  }
  file_put_contents($cache, json_encode($out, JSON_UNESCAPED_UNICODE), LOCK_EX);
  return $out;
}

// Un événement Gmail déjà présent dans le tableau (même jour, heure proche, titre proche) n'est pas ajouté une seconde fois
function motsCles($t) {
  $t = mb_strtolower(preg_replace('/[^\p{L}\p{N} ]+/u', ' ', $t));
  $vide = ['reunion', 'réunion', 'publique', 'quartier', 'toulouse', 'avec', 'pour', 'dans', 'commission', 'important', 'cérémonie', 'ceremonie', 'salon', 'rencontre', 'soirée', 'soiree', 'assemblée', 'générale', 'association', 'associations', 'inauguration', 'exposition', 'festival', 'conseil', 'municipal', 'novembre', 'décembre', 'l\'armistice', 'armistice'];
  return array_values(array_filter(explode(' ', $t), function ($w) use ($vide) { return mb_strlen($w) >= 5 && !in_array($w, $vide, true); }));
}
function fusionIcal($evs) {
  $g = icalEvenements(); if (!$g) { return $evs; }
  $parJour = [];
  foreach ($evs as $i => $e) { $parJour[$e['date'] ?? ''][] = $i; }
  foreach ($g as $x) {
    // on cherche la ligne de la plateforme qui correspond le mieux (heure, mots du titre et du lieu)
    $double = null; $meilleur = 0;
    foreach ($parJour[$x['date']] ?? [] as $i) {
      $e = $evs[$i];
      if (!empty($e['gid']) && $e['gid'] !== ($x['gid'] ?? '')) { continue; } // déjà reliée à un autre événement Gmail
      $h1 = $x['heure'] ? strtotime($x['heure']) : null; $h2 = !empty($e['heure']) ? strtotime($e['heure']) : null;
      if ($h1 === null || $h2 === null) { if ($h1 !== $h2) { continue; } $ecart = 0; } else { $ecart = abs($h1 - $h2); if ($ecart > 1800) { continue; } }
      $communs = array_intersect(motsCles($x['titre'] . ' ' . $x['lieu']), motsCles(($e['titre'] ?? '') . ' ' . ($e['lieu'] ?? '') . ' ' . ($e['quartier'] ?? '')));
      $fort = count($communs) >= 2 || array_filter($communs, function ($w) { return mb_strlen($w) >= 8; });
      $generiques = preg_match('/r[ée]union publique|commission/iu', $x['titre']) && preg_match('/r[ée]union publique|commission|^qualit|^[ée]cologie|^vie quotidienne|^petite enfance|^solidarit/iu', $e['titre'] ?? '');
      $egal = mb_strtolower($x['titre']) === mb_strtolower($e['titre'] ?? '');
      if (!$fort && !$generiques && !$egal) { continue; }
      $score = ($ecart === 0 ? 3 : 1) + 2 * count($communs) + ($egal ? 5 : 0) + ($generiques ? 1 : 0);
      if ($score > $meilleur) { $meilleur = $score; $double = $i; }
    }
    if ($double !== null) {
      // même rendez-vous : on garde la ligne de la plateforme, reliée à l'événement Gmail (pour y écrire les présences)
      if (empty($evs[$double]['gid']) && !empty($x['gid'])) { $evs[$double]['gid'] = $x['gid']; }
    } else { $evs[] = $x; $parJour[$x['date']][] = count($evs) - 1; }
  }
  return $evs;
}


// ---------- Plateforme → agenda Gmail Vivre Mieux (compte de service : ~/agenda-data/google-cle.json) ----------
// Ajoute les événements où au moins une personne est inscrite (et ceux ajoutés avec ➕), et écrit les présences
// dans la description. Ne supprime jamais rien, n'envoie aucun mail aux invités.

const MARQUE_PLATEFORME = '(ajouté depuis la plateforme Veille et agenda)';

function journalGoogle($t) { global $DATA; @file_put_contents("$DATA/journal-google.log", date('c') . "\t$t\n", FILE_APPEND | LOCK_EX); }

function googleJeton() {
  global $DATA;
  $f = "$DATA/google-cle.json"; if (!is_file($f)) { return null; }
  $cache = "$DATA/cache/google-jeton.json";
  if (is_file($cache)) { $j = json_decode(file_get_contents($cache), true); if ($j && $j['exp'] > time() + 60) { return $j['jeton']; } }
  $cle = json_decode(file_get_contents($f), true);
  if (empty($cle['client_email']) || empty($cle['private_key'])) { journalGoogle('clé illisible'); return null; }
  $b64 = function ($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); };
  $now = time();
  $entete = $b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
  $corps = $b64(json_encode(['iss' => $cle['client_email'], 'scope' => 'https://www.googleapis.com/auth/calendar.events',
    'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600]));
  if (!openssl_sign("$entete.$corps", $sig, $cle['private_key'], OPENSSL_ALGO_SHA256)) { journalGoogle('signature impossible'); return null; }
  $h = curl_init('https://oauth2.googleapis.com/token');
  curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => "$entete.$corps." . $b64($sig)])]);
  $r = json_decode(curl_exec($h), true); curl_close($h);
  if (empty($r['access_token'])) { journalGoogle('jeton refusé : ' . json_encode($r)); return null; }
  file_put_contents($cache, json_encode(['jeton' => $r['access_token'], 'exp' => $now + (int)($r['expires_in'] ?? 3600)]), LOCK_EX);
  return $r['access_token'];
}

function gapi($methode, $chemin, $corps = null) {
  $jeton = googleJeton(); if (!$jeton) { return null; }
  $c = config(); $cal = rawurlencode(trim((string)(($c ?? [])['calendar_id'] ?? 'toulousevivremieux@gmail.com')));
  $h = curl_init("https://www.googleapis.com/calendar/v3/calendars/$cal/events$chemin");
  $opt = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CUSTOMREQUEST => $methode,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $jeton, 'Content-Type: application/json']];
  if ($corps !== null) { $opt[CURLOPT_POSTFIELDS] = json_encode($corps, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
  curl_setopt_array($h, $opt);
  $t = curl_exec($h); $code = curl_getinfo($h, CURLINFO_HTTP_CODE); curl_close($h);
  if ($code >= 300) { journalGoogle("$methode $chemin → $code " . substr((string)$t, 0, 300)); return null; }
  return json_decode($t, true) ?: [];
}

function nomCourt($n) {
  $n = preg_replace('/ \(collaborateur\)$/', '', $n); $m = explode(' ', $n);
  $out = []; foreach ($m as $i => $w) { $out[] = ($i < count($m) - 1 && !in_array($w, ['de', 'Le'], true)) ? mb_substr($w, 0, 1) . '.' : $w; }
  return implode(' ', $out);
}

function lignesPresence($id) {
  $p = presences()[$id] ?? []; $pr = []; $pe = [];
  foreach ($p as $n => $s) { if ($s === 'present') { $pr[] = nomCourt($n); } elseif ($s === 'peut') { $pe[] = nomCourt($n); } }
  $l = [];
  if ($pr) { $l[] = '✅ Présent·es : ' . implode(', ', $pr); }
  if ($pe) { $l[] = '❔ Peut-être : ' . implode(', ', $pe); }
  return $l;
}

function sansPresences($desc) {
  // retire les anciennes lignes de présences (texte ou HTML) avant d'écrire les nouvelles
  $desc = preg_replace('/(<br\s*\/?>|\n)*\s*(✅\s*)?Pr[ée]sent·es\s*:[^\n<]*/u', '', (string)$desc);
  $desc = preg_replace('/(<br\s*\/?>|\n)*\s*(❔\s*)?Peut-[êe]tre\s*:[^\n<]*/u', '', $desc);
  return rtrim($desc);
}

const COULEURS_GOOGLE = ['Réunion officielle' => '4', 'Concertation' => '4', 'Protocole' => '9', 'Cérémonie' => '9', 'Inauguration' => '9',
  'Commission' => '7', 'Conseil municipal' => '7', 'Conférence' => '10', 'Café-débat' => '10', 'Militant' => '11', 'Culture' => '6'];

function pousserVersGoogle($id) {
  global $DATA;
  if (!is_file("$DATA/google-cle.json") || !preg_match('/^[a-z0-9]{3,40}$/', $id) || strpos($id, 'rg') === 0) { return; }
  $e = null; foreach (tousEvenements() as $x) { if ($x['id'] === $id) { $e = $x; break; } }
  if (!$e || in_array($e['type'] ?? '', ['Majorité', 'Réunion de groupe'], true)) { return; }
  $lignes = lignesPresence($id); $bloc = $lignes ? "\n\n" . implode("\n", $lignes) : '';
  // 1) événement venu de Gmail : on complète sa description
  if (!empty($e['gid'])) {
    $g = gapi('GET', '/' . rawurlencode($e['gid'])); if ($g === null) { return; }
    $desc = sansPresences($g['description'] ?? '') . $bloc;
    if ($desc !== ($g['description'] ?? '')) { gapi('PATCH', '/' . rawurlencode($e['gid']) . '?sendUpdates=none', ['description' => $desc]); journalGoogle("présences $id → " . implode(' / ', $lignes)); }
    return;
  }
  // 2) événement de la plateforme : déjà poussé ?
  $trouve = gapi('GET', '?privateExtendedProperty=' . rawurlencode('vmid=' . $id) . '&showDeleted=false&maxResults=2');
  if ($trouve === null) { return; }
  $base = trim(($e['details'] ?? '') . (!empty($e['lien']) ? "\n" . $e['lien'] : ''));
  if (!empty($trouve['items'])) {
    $g = $trouve['items'][0];
    gapi('PATCH', '/' . rawurlencode($g['id']) . '?sendUpdates=none', ['description' => trim($base . $bloc . "\n\n" . MARQUE_PLATEFORME)]);
    journalGoogle("maj $id"); return;
  }
  if (!$lignes && ($e['ajoute'] ?? '') !== 'oui') { return; } // personne d'inscrit : on n'encombre pas l'agenda Gmail
  $ev = ['summary' => $e['titre'], 'description' => trim($base . $bloc . "\n\n" . MARQUE_PLATEFORME),
    'extendedProperties' => ['private' => ['vmid' => $id]]];
  $lieu = trim(($e['lieu'] ?? '') . (!empty($e['quartier']) ? ' (' . $e['quartier'] . ')' : '')); if ($lieu !== '') { $ev['location'] = $lieu; }
  if (!empty(COULEURS_GOOGLE[$e['type'] ?? ''])) { $ev['colorId'] = COULEURS_GOOGLE[$e['type']]; }
  if (!empty($e['heure'])) {
    $deb = new DateTime($e['date'] . ' ' . $e['heure'], new DateTimeZone('Europe/Paris')); $fin = (clone $deb)->modify('+90 minutes');
    $ev['start'] = ['dateTime' => $deb->format('Y-m-d\TH:i:s'), 'timeZone' => 'Europe/Paris'];
    $ev['end'] = ['dateTime' => $fin->format('Y-m-d\TH:i:s'), 'timeZone' => 'Europe/Paris'];
  } else {
    $f = new DateTime(!empty($e['date_fin']) ? $e['date_fin'] : $e['date']); $f->modify('+1 day');
    $ev['start'] = ['date' => $e['date']]; $ev['end'] = ['date' => $f->format('Y-m-d')];
  }
  if (gapi('POST', '?sendUpdates=none', $ev) !== null) { journalGoogle("ajout $id {$e['date']} {$e['titre']}"); }
}

// Répond tout de suite à l'élu, puis met l'agenda Gmail à jour (sans le faire attendre)
function sortirPuisGoogle($donnees, $id) {
  ignore_user_abort(true);
  echo json_encode($donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); } else { @ob_flush(); flush(); }
  try { pousserVersGoogle($id); } catch (Throwable $t) { journalGoogle('erreur ' . $t->getMessage()); }
  exit;
}

// ---------- Présences (fichier JSON hors du dossier public) ----------

function presences() {
  global $DATA;
  $f = "$DATA/presences.json";
  if (!is_file($f)) { return []; }
  $p = json_decode(file_get_contents($f), true);
  return is_array($p) ? $p : [];
}

function enregistrerPresence($id, $nom, $statut) {
  global $DATA;
  $f = "$DATA/presences.json";
  $h = fopen($f, 'c+');
  if (!$h) { sortir(['erreur' => 'ecriture'], 500); }
  flock($h, LOCK_EX);
  $p = json_decode(stream_get_contents($h), true);
  if (!is_array($p)) { $p = []; }
  if ($statut === '') { unset($p[$id][$nom]); if (empty($p[$id])) { unset($p[$id]); } }
  else { $p[$id][$nom] = $statut; }
  ftruncate($h, 0); rewind($h);
  fwrite($h, json_encode($p, JSON_UNESCAPED_UNICODE));
  fflush($h); flock($h, LOCK_UN); fclose($h);
  // journal simple, utile pour vérifier qui a coché quoi
  @file_put_contents("$DATA/journal-presences.log", date('c') . "\t$id\t$nom\t$statut\n", FILE_APPEND | LOCK_EX);
  return $p;
}

// ---------- Recherche presse par quartier (Gemini + recherche Google) ----------
// Une seule recherche par quartier et par jour, gardée en mémoire et partagée par tous.
// Plafond de recherches par jour pour ne jamais dépasser le quota gratuit.
const PRESSE_MAX_PAR_JOUR = 40;

function recherchePresse($quartier) {
  global $DATA;
  $c = config();
  if (!$c || empty($c['gemini_key'])) { return ['erreur' => 'cle']; }
  $jour = date('Y-m-d');
  $slug = substr(preg_replace('/[^a-z0-9]+/', '-', strtolower(iconv('UTF-8', 'ASCII//TRANSLIT', $quartier))), 0, 50);
  $f = "$DATA/cache/presse-$slug-$jour.json";
  if (is_file($f) && !isset($_GET['frais'])) { $d = json_decode(file_get_contents($f), true); if ($d) { $d['memoire'] = true; return $d; } }
  // compteur du jour
  $cpt = "$DATA/cache/presse-compteur-$jour.txt";
  $n = is_file($cpt) ? (int)file_get_contents($cpt) : 0;
  if ($n >= PRESSE_MAX_PAR_JOUR) { return ['erreur' => 'plafond']; }
  file_put_contents($cpt, (string)($n + 1), LOCK_EX);

  // modèle : celui du réglage s'il existe, sinon l'alias « dernier Flash », sinon 2.5 Flash
  $modeles = array_values(array_unique(array_filter([$c['gemini_modele'] ?? '', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'])));
  $date = strftime_fr();
  $consigne = "Nous sommes le $date. Cherche les articles de presse publiés aujourd'hui et ces 7 derniers jours qui concernent le quartier « $quartier » à Toulouse (France) : La Dépêche du Midi, Actu Toulouse, France 3 Occitanie, ici Occitanie (France Bleu), Le Journal toulousain, Mediacités, 20 Minutes Toulouse, Toulouse Infos, sites de la Mairie et des associations du quartier.\n"
    . "Ne garde que ce qui parle vraiment de ce quartier de Toulouse (pas d'homonymes ailleurs). N'invente rien : si tu ne trouves rien, réponds seulement AUCUN.\n"
    . "Réponds uniquement par des lignes, du plus récent au plus ancien, au format exact :\n"
    . "AAAA-MM-JJ | Média | Titre de l'article | Résumé factuel en une ou deux phrases | URL de l'article\n"
    . "Maximum 10 lignes, en français, sans autre texte.";
  $corps = json_encode([
    'contents' => [['parts' => [['text' => $consigne]]]],
    'tools' => [['google_search' => new stdClass()]],
    'generationConfig' => ['temperature' => 0.2],
  ], JSON_UNESCAPED_UNICODE);
  $r = null; $code = 0; $detail = '';
  foreach ($modeles as $modele) {
    $ch = curl_init("https://generativelanguage.googleapis.com/v1beta/models/$modele:generateContent");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 60,
      CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $c['gemini_key']], CURLOPT_POSTFIELDS => $corps]);
    $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $cerr = curl_error($ch); curl_close($ch);
    if ($code === 200 && $r) { break; }
    $e = json_decode((string)$r, true);
    $detail = "$modele : " . ($e['error']['message'] ?? ($cerr ?: 'réponse vide'));
    @file_put_contents("$DATA/journal-presse.log", date('c') . "\t$quartier\t$code\t$detail\n", FILE_APPEND | LOCK_EX);
    if ($code !== 404 && $code !== 429) { break; } // modèle inexistant ou sans quota gratuit : on essaie le suivant
  }
  if ($code === 429) { return ['erreur' => 'quota', 'detail' => $detail]; }
  if ($code !== 200 || !$r) { return ['erreur' => 'gemini', 'code' => $code, 'detail' => $detail]; }
  $j = json_decode($r, true);
  $texte = '';
  foreach (($j['candidates'][0]['content']['parts'] ?? []) as $p) { $texte .= $p['text'] ?? ''; }
  $articles = [];
  foreach (preg_split('/\r?\n/', $texte) as $l) {
    $l = trim($l, " \t*-•");
    $x = array_map('trim', explode('|', $l));
    if (count($x) >= 4 && preg_match('/^\d{4}-\d{2}-\d{2}$/', $x[0])) {
      $url = isset($x[4]) && preg_match('#^https?://#', $x[4]) ? $x[4] : '';
      $articles[] = ['date' => $x[0], 'media' => $x[1], 'titre' => $x[2], 'resume' => $x[3], 'lien' => $url];
    }
  }
  // sources réellement consultées par la recherche Google (liens vérifiables)
  $sources = [];
  foreach (($j['candidates'][0]['groundingMetadata']['groundingChunks'] ?? []) as $g) {
    if (!empty($g['web']['uri'])) { $sources[] = ['titre' => $g['web']['title'] ?? 'source', 'lien' => $g['web']['uri']]; }
  }
  $d = ['quartier' => $quartier, 'le' => date('c'), 'articles' => $articles, 'sources' => array_slice($sources, 0, 12),
        'brut' => $articles ? '' : (stripos($texte, 'AUCUN') !== false ? '' : trim($texte))];
  file_put_contents($f, json_encode($d, JSON_UNESCAPED_UNICODE), LOCK_EX);
  return $d;
}
function strftime_fr() {
  $m = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return date('j') . ' ' . $m[(int)date('n') - 1] . ' ' . date('Y');
}

// ---------- Code d'accès du groupe ----------

function codeAttendu() { $c = config(); return trim((string)(($c ?? [])['code_acces'] ?? '')); }
function codeOk() {
  $att = codeAttendu();
  if ($att === '') { return true; } // pas encore de code choisi : plateforme ouverte (lecture seule pour les ajouts)
  return hash_equals($att, (string)($_COOKIE['vmcode'] ?? ''));
}

// ---------- Rendez-vous ajoutés par les élus (fichier JSON + photos hors du dossier public) ----------

const TYPES_AJOUT = ['Réunion publique', 'Concertation', 'Association de quartier', 'Vie associative', 'Militant', 'Culture',
  'Conférence', 'Café-débat', 'Commission', 'Conseil municipal', 'Inauguration', 'Cérémonie', 'Protocole', 'Réunion de groupe', 'Mairie', 'Autre'];

function ajouts() {
  global $DATA;
  $f = "$DATA/ajouts.json";
  if (!is_file($f)) { return []; }
  $p = json_decode(file_get_contents($f), true);
  return is_array($p) ? $p : [];
}

function modifierAjouts($fn) {
  global $DATA;
  $h = fopen("$DATA/ajouts.json", 'c+');
  if (!$h) { sortir(['erreur' => 'ecriture'], 500); }
  flock($h, LOCK_EX);
  $p = json_decode(stream_get_contents($h), true);
  if (!is_array($p)) { $p = []; }
  $p = $fn($p);
  ftruncate($h, 0); rewind($h);
  fwrite($h, json_encode(array_values($p), JSON_UNESCAPED_UNICODE));
  fflush($h); flock($h, LOCK_UN); fclose($h);
  return $p;
}

function champ($d, $k, $max) {
  $v = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string)($d[$k] ?? '')));
  return mb_substr($v, 0, $max);
}

function enregistrerAjout() {
  global $DATA;
  $d = json_decode(file_get_contents('php://input'), true);
  if (!is_array($d)) { sortir(['erreur' => 'format'], 400); }
  $nom = (string)($d['nom'] ?? '');
  if (!in_array($nom, ELUS, true)) { sortir(['erreur' => 'nom'], 400); }
  $e = [
    'date' => lireDate(champ($d, 'date', 10)), 'heure' => lireHeure(champ($d, 'heure', 5)),
    'titre' => champ($d, 'titre', 160), 'lieu' => champ($d, 'lieu', 200), 'quartier' => champ($d, 'quartier', 80),
    'lien' => champ($d, 'lien', 400), 'details' => champ($d, 'details', 1500), 'type' => champ($d, 'type', 40),
  ];
  if ($e['date'] === '' || $e['titre'] === '') { sortir(['erreur' => 'champs'], 400); }
  if (!in_array($e['type'], TYPES_AJOUT, true)) { $e['type'] = 'Autre'; }
  if ($e['lien'] !== '' && !preg_match('#^https?://#i', $e['lien'])) { $e['lien'] = ''; }
  $id = (string)($d['id'] ?? '');
  if ($id !== '' && !preg_match('/^u[a-f0-9]{10}$/', $id)) { sortir(['erreur' => 'id'], 400); }
  $nouveau = $id === '';
  if ($nouveau) { $id = 'u' . bin2hex(random_bytes(5)); }

  // Photo (JPEG déjà réduite par le téléphone), facultative
  $photo = (string)($d['photo'] ?? '');
  if ($photo !== '' && $photo !== 'garder') {
    if (!is_dir("$DATA/photos")) { @mkdir("$DATA/photos", 0700, true); }
    $bin = base64_decode(preg_replace('#^data:image/jpeg;base64,#', '', $photo), true);
    if ($bin === false || strlen($bin) > 4000000) { sortir(['erreur' => 'photo'], 400); }
    $info = @getimagesizefromstring($bin);
    if (!$info || $info[2] !== IMAGETYPE_JPEG) { sortir(['erreur' => 'photo'], 400); }
    file_put_contents("$DATA/photos/$id.jpg", $bin, LOCK_EX);
  }
  if ($photo === 'retirer') { @unlink("$DATA/photos/$id.jpg"); }

  modifierAjouts(function ($p) use ($e, $id, $nom, $nouveau, $DATA) {
    $e['id'] = $id; $e['ajoute'] = 'oui'; $e['photo'] = is_file("$DATA/photos/$id.jpg") ? 'oui' : '';
    foreach ($p as $i => $x) {
      if ($x['id'] === $id) { $e['auteur'] = $x['auteur']; $e['cree'] = $x['cree']; $e['modifie'] = date('c'); $p[$i] = $e; return $p; }
    }
    $e['auteur'] = $nom; $e['cree'] = date('c'); $p[] = $e; return $p;
  });
  @file_put_contents("$DATA/journal-ajouts.log", date('c') . "\t" . ($nouveau ? 'ajout' : 'modif') . "\t$id\t$nom\t{$e['date']}\t{$e['titre']}\n", FILE_APPEND | LOCK_EX);
  sortirPuisGoogle(['ok' => true, 'id' => $id], $id);
}

// ---------- Export vers les agendas personnels (Google, Apple, Outlook) ----------

function secretIcs() {
  global $DATA;
  $f = "$DATA/secret-agenda.txt";
  if (!is_file($f)) { file_put_contents($f, bin2hex(random_bytes(16)), LOCK_EX); @chmod($f, 0600); }
  return trim(file_get_contents($f));
}
function cleIcs($nom) { return substr(hash_hmac('sha256', $nom, secretIcs()), 0, 20); }

function tousEvenements() {
  $d = donnees();
  $evs = fusionIcal(array_merge($d['evenements'] ?? [], ajouts()));
  $ids = [];
  foreach ($evs as $e) { $ids[$e['id']] = 1; }
  foreach (array_keys(presences()) as $id) { // réunions de groupe du lundi (créées par l'application)
    if (!isset($ids[$id]) && preg_match('/^rg(\d{4})(\d{2})(\d{2})$/', $id, $m)) {
      $evs[] = ['id' => $id, 'date' => "$m[1]-$m[2]-$m[3]", 'heure' => '12:30', 'type' => 'Réunion de groupe', 'titre' => 'Réunion de groupe Vivre Mieux', 'lieu' => '', 'details' => ''];
    }
  }
  return $evs;
}

function icsTexte($t) { return str_replace(["\\", ';', ',', "\r\n", "\n"], ["\\\\", '\;', '\,', '\n', '\n'], (string)$t); }
function icsLigne($l) { // lignes de 75 octets au plus
  $out = ''; while (strlen($l) > 74) { $n = 74; while ($n > 0 && (ord($l[$n]) & 0xC0) === 0x80) { $n--; } $out .= substr($l, 0, $n) . "\r\n "; $l = substr($l, $n); }
  return $out . $l . "\r\n";
}
function icsEvenement($e, $prefixe = '') {
  $l = ['BEGIN:VEVENT', 'UID:' . $e['id'] . '@agenda.vivremieuxtoulouse.fr', 'DTSTAMP:' . gmdate('Ymd\THis\Z')];
  $d = str_replace('-', '', $e['date']);
  if (!empty($e['heure'])) {
    $deb = new DateTime($e['date'] . ' ' . $e['heure'], new DateTimeZone('Europe/Paris'));
    $fin = (clone $deb)->modify('+90 minutes');
    $l[] = 'DTSTART;TZID=Europe/Paris:' . $deb->format('Ymd\THis');
    $l[] = 'DTEND;TZID=Europe/Paris:' . $fin->format('Ymd\THis');
  } else {
    $f = new DateTime(!empty($e['date_fin']) ? $e['date_fin'] : $e['date']); $f->modify('+1 day');
    $l[] = 'DTSTART;VALUE=DATE:' . $d; $l[] = 'DTEND;VALUE=DATE:' . $f->format('Ymd');
  }
  $l[] = 'SUMMARY:' . icsTexte($prefixe . ($e['titre'] ?? ''));
  $lieu = trim(($e['lieu'] ?? '') . (!empty($e['quartier']) ? ' (' . $e['quartier'] . ')' : ''));
  if ($lieu !== '') { $l[] = 'LOCATION:' . icsTexte($lieu); }
  $desc = trim(($e['details'] ?? '') . (!empty($e['lien']) ? "\n" . $e['lien'] : ''));
  if ($desc !== '') { $l[] = 'DESCRIPTION:' . icsTexte($desc); }
  if (!empty($e['lien']) && preg_match('#^https?://#', $e['lien'])) { $l[] = 'URL:' . $e['lien']; }
  $l[] = 'END:VEVENT';
  return implode('', array_map('icsLigne', $l));
}
function sortirIcs($nomCal, $evsIcs, $fichier) {
  header('Content-Type: text/calendar; charset=utf-8');
  header('Content-Disposition: inline; filename="' . $fichier . '"');
  header('Cache-Control: no-cache');
  echo "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Vivre Mieux Toulouse//Veille et agenda//FR\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n";
  echo icsLigne('X-WR-CALNAME:' . icsTexte($nomCal)) . "X-WR-TIMEZONE:Europe/Paris\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\nX-PUBLISHED-TTL:PT1H\r\n";
  echo "BEGIN:VTIMEZONE\r\nTZID:Europe/Paris\r\nBEGIN:DAYLIGHT\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nTZNAME:CEST\r\nDTSTART:19700329T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nTZNAME:CET\r\nDTSTART:19701025T030000\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";
  echo $evsIcs . "END:VCALENDAR\r\n";
  exit;
}

// ---------- Aiguillage ----------

$a = $_REQUEST['a'] ?? 'data';

if ($a === 'code') {
  $att = codeAttendu();
  $ok = $att !== '' && hash_equals($att, (string)($_POST['code'] ?? ''));
  if (!$ok) { sleep(1); } // ralentit les essais au hasard
  sortir(['ok' => $ok]);
}

// Abonnement personnel : protégé par une clé propre à chaque élu (les applications d'agenda ne connaissent pas le code d'accès)
if ($a === 'agenda') {
  $qui = (string)($_GET['qui'] ?? '');
  if (!in_array($qui, ELUS, true) || !hash_equals(cleIcs($qui), (string)($_GET['k'] ?? ''))) { http_response_code(403); exit; }
  $du = lireDate((string)($_GET['du'] ?? '')) ?: date('Y-m-d', strtotime('-30 days'));
  $au = lireDate((string)($_GET['au'] ?? '')) ?: '2100-01-01';
  $p = presences(); $sortie = '';
  foreach (tousEvenements() as $e) {
    $st = $p[$e['id']][$qui] ?? '';
    if ($st === '' || $e['date'] < $du || $e['date'] > $au) { continue; }
    $sortie .= icsEvenement($e, $st === 'peut' ? '❔ ' : '');
  }
  $court = preg_replace('/ \(collaborateur\)$/', '', $qui);
  sortirIcs("Vivre Mieux · $court", $sortie, 'vivre-mieux.ics');
}

if (!codeOk()) { sortir(['erreur' => 'code'], 401); }

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $a === 'ajout') {
  enregistrerAjout();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $a === 'suppr') {
  $id = (string)($_POST['id'] ?? ''); $nom = (string)($_POST['nom'] ?? '');
  if (!preg_match('/^u[a-f0-9]{10}$/', $id) || !in_array($nom, ELUS, true)) { sortir(['erreur' => 'id'], 400); }
  modifierAjouts(function ($p) use ($id) { return array_filter($p, function ($x) use ($id) { return $x['id'] !== $id; }); });
  @rename("$DATA/photos/$id.jpg", "$DATA/photos/supprime-$id.jpg"); // gardée de côté, au cas où
  @file_put_contents("$DATA/journal-ajouts.log", date('c') . "\tsuppr\t$id\t$nom\n", FILE_APPEND | LOCK_EX);
  sortir(['ok' => true]);
}

if ($a === 'ics') {
  $id = (string)($_GET['id'] ?? '');
  foreach (tousEvenements() as $e) {
    if ($e['id'] === $id) { sortirIcs('Vivre Mieux', icsEvenement($e), 'rendez-vous.ics'); }
  }
  http_response_code(404); exit;
}

if ($a === 'photo') {
  $id = (string)($_GET['id'] ?? '');
  $f = "$DATA/photos/$id.jpg";
  if (!preg_match('/^u[a-f0-9]{10}$/', $id) || !is_file($f)) { http_response_code(404); exit; }
  header('Content-Type: image/jpeg');
  header('Cache-Control: private, max-age=86400');
  readfile($f);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $a === 'pres') {
  $id = (string)($_POST['id'] ?? '');
  $nom = (string)($_POST['nom'] ?? '');
  $statut = (string)($_POST['statut'] ?? '');
  if (!preg_match('/^[a-z0-9]{3,40}$/', $id)) { sortir(['erreur' => 'id'], 400); }
  if (!in_array($nom, ELUS, true)) { sortir(['erreur' => 'nom'], 400); }
  if (!in_array($statut, ['present', 'peut', ''], true)) { sortir(['erreur' => 'statut'], 400); }
  sortirPuisGoogle(['ok' => true, 'presences' => enregistrerPresence($id, $nom, $statut)], $id);
}

if ($a === 'pres') { sortir(['presences' => presences()]); }

// ---------- Sondages de date (réponses des élus) ----------
function sondages() {
  global $DATA; $f = "$DATA/sondages.json";
  if (!is_file($f)) { return []; }
  $p = json_decode(file_get_contents($f), true); return is_array($p) ? $p : [];
}
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $a === 'vote') {
  $sid = (string)($_POST['s'] ?? ''); $cr = (string)($_POST['cr'] ?? ''); $nom = (string)($_POST['nom'] ?? ''); $rep = (string)($_POST['rep'] ?? '');
  if (!preg_match('/^[a-z0-9-]{2,40}$/', $sid) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $cr)) { sortir(['erreur' => 'id'], 400); }
  if (!in_array($nom, ELUS, true)) { sortir(['erreur' => 'nom'], 400); }
  if (!in_array($rep, ['oui', 'sib', 'non', ''], true)) { sortir(['erreur' => 'rep'], 400); }
  $h = fopen("$DATA/sondages.json", 'c+'); if (!$h) { sortir(['erreur' => 'ecriture'], 500); }
  flock($h, LOCK_EX);
  $p = json_decode(stream_get_contents($h), true); if (!is_array($p)) { $p = []; }
  if ($rep === '') { unset($p[$sid][$cr][$nom]); } else { $p[$sid][$cr][$nom] = $rep; }
  ftruncate($h, 0); rewind($h); fwrite($h, json_encode($p, JSON_UNESCAPED_UNICODE)); fflush($h); flock($h, LOCK_UN); fclose($h);
  @file_put_contents("$DATA/journal-sondages.log", date('c') . "\t$sid\t$cr\t$nom\t$rep\n", FILE_APPEND | LOCK_EX);
  sortir(['ok' => true, 'sondages' => $p]);
}

if ($a === 'presse' && !empty((config() ?? [])['presse_ia'])) { // désactivé : la recherche Google via Gemini n'est pas gratuite
  $q = trim((string)($_GET['q'] ?? ''));
  if (!preg_match("/^[\\p{L}0-9 '’·.,\\-]{2,80}$/u", $q)) { sortir(['erreur' => 'quartier'], 400); }
  sortir(recherchePresse($q));
}

if ($a === 'data') {
  $d = donnees();
  if (!empty($d['evenements']) || isset($d['maj'])) { $d['evenements'] = fusionIcal(array_merge($d['evenements'] ?? [], ajouts())); }
  $d['presences'] = presences();
  $d['sondages'] = sondages();
  $d['ajout_actif'] = true; // ajout ouvert à tous ; le code d'accès, s'il est mis en place, protégera toute la plateforme
  $d['elus'] = ELUS;
  $d['cles_agenda'] = array_combine(ELUS, array_map('cleIcs', ELUS));
  sortir($d);
}

sortir(['erreur' => 'action'], 400);
