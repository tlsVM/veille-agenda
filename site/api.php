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
  $c = include $f;
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

// ---------- Aiguillage ----------

$a = $_REQUEST['a'] ?? 'data';

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

if ($a === 'data') {
  $d = donnees();
  $d['presences'] = presences();
  $d['elus'] = ELUS;
  sortir($d);
}

sortir(['erreur' => 'action'], 400);
