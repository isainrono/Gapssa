<?php
/**
 * dbConfigLayerProbe.php — closed, non-sensitive diagnostic probe.
 *
 * Determines which EspoCRM config layer (of the six Espo\Core\Utils\Config
 * sources, in the real merge order confirmed against the running 10.0.3
 * image: systemConfig.php -> config.php -> config-internal.php ->
 * config-override.php -> config-internal-override.php -> state.php) is
 * actually feeding the database credential the running app would use, and
 * whether that credential authenticates against the real server.
 *
 * Contract:
 *   - Never prints a secret value, hash, DSN, path-with-credentials, or raw
 *     driver exception text. Output is exactly the 7 fixed "key=value"
 *     lines below, nothing else, on stdout. (Two more — php_syntax_ok,
 *     ownership_mode_ok — are added by the .sh wrapper for a 9-line total;
 *     this script only ever emits its own 7.)
 *   - Read-only: only `include`s the six config files and opens a PDO
 *     connection to SELECT 1. Never writes to disk, never runs DDL/DML.
 *   - Takes the external store's current password on STDIN only (never
 *     argv, never getenv()), as RAW bytes — never trimmed. The value is
 *     validated against this toolkit's secret contract
 *     (lib/secretValueContract.mjs::validateSecretValue, mirrored here in
 *     PHP: non-empty, <=4096 bytes, no NUL/CR/LF, valid UTF-8) and
 *     REJECTED — never silently corrected — if it fails. The caller MUST
 *     send the value with `printf '%s'`, never `echo` (which would add a
 *     trailing LF the contract would then correctly reject).
 *   - A config source that EXISTS but fails to `include` cleanly, or does
 *     not evaluate to an array, is NOT the same thing as a source that is
 *     simply absent. Espo\Core\Utils\Config\ConfigFileManager::getPhpContents
 *     throws when a present file doesn't yield an array — it does not
 *     silently substitute []. This probe mirrors that: each source is
 *     loaded into one of three states (missing / ok / invalid), and an
 *     `invalid` state never gets treated as an empty, harmless layer.
 *   - The EFFECTIVE ('database') config is computed by bootstrapping the
 *     REAL Espo\Core\Utils\Config class via the app's own
 *     vendor/autoload.php when present — not a reimplementation of
 *     Util::merge(). A hand-rolled fallback (espo_like_merge) only runs
 *     when the real class can't be loaded.
 *   - Every port read goes through normalize_port(): MySQL/MariaDB client
 *     libraries treat port 0 (or an empty string cast to int) as "use the
 *     default 3306" — a raw fsockopen() does not. Without this, a
 *     legitimately-empty 'port' value in config-internal.php (this
 *     deployment never sets ESPOCRM_DATABASE_PORT) produces a false
 *     network_resolution_ok=false next to a true
 *     stored_credential_authenticates=true for the identical host.
 *
 * Usage (secret piped via stdin, never in argv/env — see the .sh wrapper
 * for the actual invocation used against a real deployment):
 *   printf '%s' "$stored_password" | php dbConfigLayerProbe.php --base=/var/www/html
 */

declare(strict_types=1);

function out_bool(string $key, bool $value): void
{
    echo $key . '=' . ($value ? 'true' : 'false') . "\n";
}

function out_cat(string $key, string $value): void
{
    echo $key . '=' . $value . "\n";
}

// --- secret contract (mirrors lib/secretValueContract.mjs::validateSecretValue) ---

const MAX_SECRET_VALUE_BYTES = 4096;

/**
 * @return array{0: bool, 1: string} [ok, reason] — reason is a short
 *   category, never repeats or echoes the value.
 */
function validate_secret_value(string $raw): array
{
    $len = strlen($raw); // byte length, not multibyte — matches Buffer.length in the Node contract
    if ($len === 0) {
        return [false, 'empty'];
    }
    if ($len > MAX_SECRET_VALUE_BYTES) {
        return [false, 'too_long'];
    }
    if (strpos($raw, "\0") !== false) {
        return [false, 'contains_nul'];
    }
    if (strpos($raw, "\r") !== false) {
        return [false, 'contains_cr'];
    }
    if (strpos($raw, "\n") !== false) {
        return [false, 'contains_lf'];
    }
    if (mb_check_encoding($raw, 'UTF-8') !== true) {
        return [false, 'invalid_utf8'];
    }
    return [true, ''];
}

// --- config source loading: missing / ok / invalid, never conflated -------

const SRC_MISSING = 'missing';
const SRC_OK = 'ok';
const SRC_INVALID = 'invalid';

/**
 * Minimal, faithful re-implementation of Espo\Core\Utils\Util::merge()'s
 * observed behaviour (read from the real class in the running 10.0.3
 * image): recursive, later array wins per-key, scalars overwrite,
 * non-array replaces array and vice-versa. Reimplemented standalone
 * (rather than bootstrapping the real framework classes) so this probe
 * has no dependency on the app's DI container / autoload / DB — it must
 * keep working even when the app itself is broken.
 *
 * @param mixed $current
 * @param mixed $new
 * @return mixed
 */
function espo_like_merge($current, $new)
{
    if (!is_array($current) || !is_array($new)) {
        return is_array($new) ? $new : ($new ?? $current);
    }
    $result = $current;
    foreach ($new as $key => $value) {
        if (is_array($value) && isset($result[$key]) && is_array($result[$key])) {
            $result[$key] = espo_like_merge($result[$key], $value);
        } else {
            $result[$key] = $value;
        }
    }
    return $result;
}

/**
 * @return array{status: string, data: array<string, mixed>}
 */
function load_source(string $path): array
{
    if (!file_exists($path)) {
        return ['status' => SRC_MISSING, 'data' => []];
    }
    try {
        $data = include $path;
    } catch (\Throwable $e) {
        // Present but broken (parse error, thrown exception, etc.) — this
        // is exactly the case Espo's own ConfigFileManager does NOT treat
        // as an empty/absent layer. Never echo $e->getMessage().
        return ['status' => SRC_INVALID, 'data' => []];
    }
    if (!is_array($data)) {
        return ['status' => SRC_INVALID, 'data' => []];
    }
    return ['status' => SRC_OK, 'data' => $data];
}

/**
 * MySQL/MariaDB client libraries (libmysqlclient/libmariadb — what PDO_MYSQL
 * links against) treat a port of 0 as "use the default port" (documented
 * mysql_real_connect() behaviour: "If port is not 0, the value is used for
 * the TCP/IP connection"). config-internal.php can legitimately have a
 * 'port' KEY present with an EMPTY STRING value (this deployment's compose
 * setup never sets ESPOCRM_DATABASE_PORT) — `?? 3306` does NOT catch that,
 * since the key exists and isn't null, only an empty *string*. Casting '' to
 * int gives 0, which PDO/mariadb silently treats as "use 3306" but a raw
 * `fsockopen($host, 0, ...)` does NOT — it dials literal TCP port 0 and
 * fails immediately. Left unfixed, this produces a real false negative:
 * `stored_credential_authenticates=true` (via PDO, silently correct) next
 * to `network_resolution_ok=false` (via fsockopen, taking port 0 literally)
 * for the exact same host. Every port read in this file goes through this
 * function so both paths agree.
 */
function normalize_port($raw): int
{
    // Deliberately narrow: ONLY null (key absent) or an empty string (key
    // present, no value — this deployment's actual state, since
    // ESPOCRM_DATABASE_PORT is never set) normalize to the default. Any
    // OTHER value — including an explicit 0, a non-numeric string, or a
    // boolean — is cast as-is and left exactly as invalid/valid as it
    // really is. Silently "fixing" more than the one real, confirmed case
    // would risk masking a genuinely corrupt port value instead of
    // surfacing it as a real connection failure.
    if ($raw === null || $raw === '') {
        return 3306;
    }
    return (int) $raw;
}

/**
 * Loads the EFFECTIVE 'database' config the exact way the real app does:
 * bootstraps the real Espo\Core\Utils\Config class (via the app's own
 * composer autoloader, if present under $base/vendor/autoload.php) instead
 * of a reimplementation of Util::merge() that could silently drift from the
 * real one. Returns null if the real class isn't available or its own load
 * path throws (e.g. a required file is present-but-invalid — Espo's own
 * ConfigFileManager::getPhpContents() throws in that case, matching this
 * probe's SRC_INVALID handling) — callers fall back to the hand-rolled
 * merge in that case, never silently to an empty array.
 *
 * @return array<string, mixed>|null
 */
function load_effective_via_real_config(string $base): ?array
{
    $autoload = $base . '/vendor/autoload.php';
    if (!is_file($autoload)) {
        return null;
    }
    $cwd = getcwd();
    try {
        require_once $autoload;
        if (!class_exists('Espo\\Core\\Utils\\Config\\ConfigFileManager') || !class_exists('Espo\\Core\\Utils\\Config')) {
            return null;
        }
        if ($cwd !== false) {
            chdir($base);
        }
        $fileManagerClass = 'Espo\\Core\\Utils\\Config\\ConfigFileManager';
        $configClass = 'Espo\\Core\\Utils\\Config';
        $fm = new $fileManagerClass();
        $cfg = new $configClass($fm);
        $db = $cfg->get('database');
        return is_array($db) ? $db : [];
    } catch (\Throwable $e) {
        // Never echo $e->getMessage() — a present-but-invalid required
        // source throwing here is exactly the "invalid, not missing" case;
        // the caller's fallback path re-derives that same distinction.
        return null;
    } finally {
        if ($cwd !== false) {
            chdir($cwd);
        }
    }
}

function classify_error(?string $sqlstate, ?int $driverErrno): string
{
    if ($driverErrno !== null) {
        if (in_array($driverErrno, [1045, 1044, 1698, 1524], true)) {
            return 'auth';
        }
        if (in_array($driverErrno, [1049], true)) {
            return 'schema';
        }
        if (in_array($driverErrno, [2002, 2003, 2005, 2006, 2013], true)) {
            return 'network';
        }
    }
    if ($sqlstate !== null) {
        if (str_starts_with($sqlstate, '28')) {
            return 'auth';
        }
        if (str_starts_with($sqlstate, '08')) {
            return 'network';
        }
        if ($sqlstate === '42S02' || $sqlstate === '3D000') {
            return 'schema';
        }
    }
    return 'other';
}

/**
 * @param array<string, mixed> $db
 * @return array{0: bool, 1: string}  [authenticated, error_category]
 */
function try_connect(array $db, string $password): array
{
    $host = (string) ($db['host'] ?? '');
    $port = normalize_port($db['port'] ?? null);
    $name = (string) ($db['dbname'] ?? '');
    $user = (string) ($db['user'] ?? '');
    $charset = (string) ($db['charset'] ?? 'utf8mb4');

    if ($host === '' || $user === '') {
        return [false, 'other'];
    }

    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $host, $port, $name, $charset);

    try {
        $pdo = new \PDO($dsn, $user, $password, [
            \PDO::ATTR_TIMEOUT => 5,
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        ]);
        $pdo->query('SELECT 1');
        return [true, 'other'];
    } catch (\PDOException $e) {
        $sqlstate = is_array($e->errorInfo ?? null) ? ($e->errorInfo[0] ?? null) : null;
        $driverErrno = is_array($e->errorInfo ?? null) ? ($e->errorInfo[1] ?? null) : null;
        if ($driverErrno === null && preg_match('/SQLSTATE\[(\w+)\]/', $e->getMessage(), $m)) {
            $sqlstate = $m[1];
        }
        return [false, classify_error($sqlstate, $driverErrno !== null ? (int) $driverErrno : null)];
    } catch (\Throwable $e) {
        return [false, 'other'];
    }
}

function network_only_probe(string $host, int $port): bool
{
    if ($host === '') {
        return false;
    }
    $errno = 0;
    $errstr = '';
    $fp = @fsockopen($host, $port, $errno, $errstr, 5);
    if ($fp === false) {
        return false;
    }
    fclose($fp);
    return true;
}

// --- entry point -----------------------------------------------------

function emit_fail_closed(): void
{
    // Reachable only when the required config-internal.php source itself
    // is invalid (present but unparseable) or the stored secret fails the
    // contract — in both cases nothing downstream can be trusted, so every
    // boolean fails closed rather than being computed from partial/empty
    // data that would look identical to a legitimately absent layer.
    out_bool('stored_credential_authenticates', false);
    out_bool('config_internal_matches_store', false);
    out_bool('effective_config_matches_store', false);
    out_bool('effective_config_authenticates', false);
    out_bool('later_override_detected', true);
    out_bool('network_resolution_ok', false);
    out_cat('database_error_category', 'other');
}

$base = '/var/www/html';
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--base=')) {
        $base = substr($arg, strlen('--base='));
    }
}

$rawStdin = stream_get_contents(STDIN);
$rawStdin = $rawStdin === false ? '' : $rawStdin;
[$secretOk] = validate_secret_value($rawStdin);
if (!$secretOk) {
    // The store's own value doesn't meet this toolkit's secret contract —
    // fail closed rather than silently trimming/coercing it into something
    // that would pass.
    emit_fail_closed();
    exit(0);
}
$storedPassword = $rawStdin;

$paths = [
    'system'           => $base . '/application/Espo/Resources/defaults/systemConfig.php',
    'config'           => $base . '/data/config.php',
    'internal'         => $base . '/data/config-internal.php',
    'override'         => $base . '/data/config-override.php',
    'internalOverride' => $base . '/data/config-internal-override.php',
    'state'            => $base . '/data/state.php',
];

$loaded = [];
foreach ($paths as $label => $p) {
    $loaded[$label] = load_source($p);
}

if ($loaded['internal']['status'] === SRC_INVALID) {
    // config-internal.php is the one REQUIRED source this whole probe is
    // about. If it exists but is broken, the real app would be broken too
    // (Espo throws here) — do not compute anything from an empty stand-in.
    emit_fail_closed();
    exit(0);
}

$internalDb = is_array($loaded['internal']['data']['database'] ?? null) ? $loaded['internal']['data']['database'] : [];

$internalPw = $internalDb['password'] ?? null;
$configInternalMatchesStore = is_string($internalPw) && hash_equals($storedPassword, $internalPw);

// Structural: does a layer that merges AFTER config-internal.php define its
// own 'database' key at all? (existence-based — never compares values.)
// Always computed directly from the raw files, independent of which path
// below produces $effectiveDb, so it stays meaningful even when the real
// Config class was used for the merge itself.
$anyOverridePositionInvalid =
    $loaded['override']['status'] === SRC_INVALID ||
    $loaded['internalOverride']['status'] === SRC_INVALID ||
    $loaded['state']['status'] === SRC_INVALID;
$laterOverrideDetected = $anyOverridePositionInvalid ||
    ($loaded['override']['status'] === SRC_OK && array_key_exists('database', $loaded['override']['data'])) ||
    ($loaded['internalOverride']['status'] === SRC_OK && array_key_exists('database', $loaded['internalOverride']['data'])) ||
    ($loaded['state']['status'] === SRC_OK && array_key_exists('database', $loaded['state']['data']));

// Effective config: prefer the REAL Espo\Core\Utils\Config class (bootstrapped
// via the app's own composer autoloader) over the hand-rolled merge below —
// zero risk of this probe's reimplementation silently drifting from the real
// Util::merge(). Falls back only when the real class isn't reachable.
$realEffectiveDb = load_effective_via_real_config($base);
$usedRealConfig = $realEffectiveDb !== null;

if ($usedRealConfig) {
    $effectiveDb = $realEffectiveDb;
    $effectivePw = $effectiveDb['password'] ?? null;
    $effectiveConfigMatchesStore = is_string($effectivePw) && hash_equals($storedPassword, $effectivePw);
    $effectivePwForConnect = is_string($effectivePw) ? $effectivePw : '';
    [$effectiveAuthenticates, $effectiveErrorCategory] = try_connect($effectiveDb, $effectivePwForConnect);
} else {
    // Fallback: hand-rolled merge, same order Espo\Core\Utils\Config::load()
    // uses (confirmed against the running 10.0.3 source). A layer that is
    // `invalid` contributes [] to the merge (same shape as `missing`) — the
    // structural $laterOverrideDetected above already tracks that
    // separately so it's never reported as an ordinary "no override".
    $effective = [];
    foreach (['system', 'config', 'internal', 'override', 'internalOverride', 'state'] as $label) {
        $effective = espo_like_merge($effective, $loaded[$label]['data']);
    }
    $anyEarlyLayerInvalid =
        $loaded['system']['status'] === SRC_INVALID ||
        $loaded['config']['status'] === SRC_INVALID;
    $effectiveDb = is_array($effective['database'] ?? null) ? $effective['database'] : [];

    if ($anyEarlyLayerInvalid) {
        // system/config.php broken: the merge above is not trustworthy even
        // though config-internal.php itself parsed fine. Fail the
        // "effective" comparisons closed rather than reporting a merge we
        // can't vouch for.
        $effectiveConfigMatchesStore = false;
        $effectiveAuthenticates = false;
        $effectiveErrorCategory = 'other';
    } else {
        $effectivePw = $effectiveDb['password'] ?? null;
        $effectiveConfigMatchesStore = is_string($effectivePw) && hash_equals($storedPassword, $effectivePw);
        $effectivePwForConnect = is_string($effectivePw) ? $effectivePw : '';
        [$effectiveAuthenticates, $effectiveErrorCategory] = try_connect($effectiveDb, $effectivePwForConnect);
    }
}

[$storedAuthenticates, ] = try_connect($internalDb, $storedPassword);

$networkOk = network_only_probe(
    (string) ($effectiveDb['host'] ?? $internalDb['host'] ?? ''),
    normalize_port($effectiveDb['port'] ?? $internalDb['port'] ?? null)
);

$errorCategory = $effectiveAuthenticates ? 'other' : $effectiveErrorCategory;
if (!$networkOk) {
    $errorCategory = 'network';
}

out_bool('stored_credential_authenticates', $storedAuthenticates);
out_bool('config_internal_matches_store', $configInternalMatchesStore);
out_bool('effective_config_matches_store', $effectiveConfigMatchesStore);
out_bool('effective_config_authenticates', $effectiveAuthenticates);
out_bool('later_override_detected', $laterOverrideDetected);
out_bool('network_resolution_ok', $networkOk);
out_cat('database_error_category', $errorCategory);
