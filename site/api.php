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
  sortir(['ok' => true, 'id' => $id]);
}

// ---------- Aiguillage ----------

$a = $_REQUEST['a'] ?? 'data';

if ($a === 'code') {
  $att = codeAttendu();
  $ok = $att !== '' && hash_equals($att, (string)($_POST['code'] ?? ''));
  if (!$ok) { sleep(1); } // ralentit les essais au hasard
  sortir(['ok' => $ok]);
}

if (!codeOk()) { sortir(['erreur' => 'code'], 401); }

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $a === 'ajout') {
  if (codeAttendu() === '') { sortir(['erreur' => 'sans_code'], 403); }
  enregistrerAjout();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $a === 'suppr') {
  if (codeAttendu() === '') { sortir(['erreur' => 'sans_code'], 403); }
  $id = (string)($_POST['id'] ?? ''); $nom = (string)($_POST['nom'] ?? '');
  if (!preg_match('/^u[a-f0-9]{10}$/', $id) || !in_array($nom, ELUS, true)) { sortir(['erreur' => 'id'], 400); }
  modifierAjouts(function ($p) use ($id) { return array_filter($p, function ($x) use ($id) { return $x['id'] !== $id; }); });
  @rename("$DATA/photos/$id.jpg", "$DATA/photos/supprime-$id.jpg"); // gardée de côté, au cas où
  @file_put_contents("$DATA/journal-ajouts.log", date('c') . "\tsuppr\t$id\t$nom\n", FILE_APPEND | LOCK_EX);
  sortir(['ok' => true]);
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
  sortir(['ok' => true, 'presences' => enregistrerPresence($id, $nom, $statut)]);
}

if ($a === 'pres') { sortir(['presences' => presences()]); }

if ($a === 'presse' && !empty((config() ?? [])['presse_ia'])) { // désactivé : la recherche Google via Gemini n'est pas gratuite
  $q = trim((string)($_GET['q'] ?? ''));
  if (!preg_match("/^[\\p{L}0-9 '’·.,\\-]{2,80}$/u", $q)) { sortir(['erreur' => 'quartier'], 400); }
  sortir(recherchePresse($q));
}

if ($a === 'data') {
  $d = donnees();
  if (!empty($d['evenements']) || isset($d['maj'])) { $d['evenements'] = array_merge($d['evenements'] ?? [], ajouts()); }
  $d['presences'] = presences();
  $d['ajout_actif'] = codeAttendu() !== '';
  $d['elus'] = ELUS;
  sortir($d);
}

sortir(['erreur' => 'action'], 400);
