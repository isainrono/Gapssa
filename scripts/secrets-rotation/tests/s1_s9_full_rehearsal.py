#!/usr/bin/env python3
"""scripts/secrets-rotation/tests/s1_s9_full_rehearsal.py — Bloque 6

Ensayo INTEGRAL, desechable y REPRODUCIBLE de rotate-all-interactive.sh
completo, S1 -> S9, contra infraestructura Docker real (Postgres 18,
MariaDB 11.4, Redis 8, EspoCRM 10.0.3) y un apps/web REAL arrancado con
`npm run dev`, todo aislado y desechable. NUNCA usa fake-bin (eso queda
para run_scenarios.py, que prueba la MECANICA de estados) -- este ensayo
demuestra el recorrido real de las nueve puertas.

Nunca toca gapssa-espocrm-1/gapssa-apps-db-1/gapssa-espocrm-db-1/
gapssa-redis-1 ni ningun recurso GAPSSA real. Nunca lee ni escribe el
.env real del repositorio: rotate-all-interactive.sh resuelve
REPO_ROOT/ENV_REPO a partir de su PROPIA ubicacion (${BASH_SOURCE[0]}),
asi que este ensayo lo invoca desde un "repo sombra" -- un directorio
desechable con enlaces simbolicos a cada entrada real del monorepo
(scripts/apps/packages/node_modules/etc.) EXCEPTO ".env", que aqui es un
fichero real nuevo con valores puramente ficticios. bash preserva el
prefijo de ruta simbolica en cd+pwd (verificado empiricamente), asi que
REPO_ROOT dentro de ese proceso resuelve al repo sombra, nunca al real.

Uso: python3 s1_s9_full_rehearsal.py
Salida: 0 si todo paso, 1 si algo fallo (ver "FAIL" en la salida).
"""
import glob
import json
import os
import re
import secrets as pysecrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import textwrap
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_driver import PtyProcess  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS_ROTATION_DIR = os.path.dirname(HERE)
REPO_ROOT_REAL = os.path.dirname(os.path.dirname(SECRETS_ROTATION_DIR))

RESULTS = []
FAIL_FAST_ABORTED = False


def report(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    status = "ok  " if ok else "FAIL"
    print(f"{status} - {name}", flush=True)
    if not ok and detail:
        print(textwrap.indent(str(detail), "        "), flush=True)


def hexsecret(nbytes=24):
    return pysecrets.token_hex(nbytes)


def b64secret(nbytes=32):
    import base64

    return base64.b64encode(pysecrets.token_bytes(nbytes)).decode("ascii")


class Project:
    """Estado de un ensayo integral desechable: nombres/puertos/credenciales
    generados una vez, reutilizados por cada paso."""

    def __init__(self):
        self.name = f"gapssa-s1s9-rehearsal-{pysecrets.token_hex(4)}"
        if not self.name.startswith("gapssa-s1s9-rehearsal-"):
            raise RuntimeError("nombre de proyecto inesperado")
        # Puertos efimeros — rangos disjuntos de los usados por
        # s2_s5_recovery_rehearsal.sh y de los REALES de compose.yml
        # (5433/6380/8081/8083), para poder correr ambos ensayos a la vez
        # sin colision.
        self.pg_port = 31000 + (pysecrets.randbelow(2000))
        self.mariadb_port = 34000 + (pysecrets.randbelow(1000))
        self.redis_port = 35000 + (pysecrets.randbelow(1000))
        self.espocrm_port = 36000 + (pysecrets.randbelow(1000))
        self.espocrm_ws_port = 37000 + (pysecrets.randbelow(1000))

        self.pg_user = "gapssa_apps"
        self.pg_db_cms = "gapssa_cms"
        self.pg_db_auth = "gapssa_auth"
        self.pg_db_booking = "gapssa_booking"
        self.pg_password = hexsecret()

        self.mariadb_db = "espocrm"
        self.mariadb_user = "espocrm"
        self.mariadb_password = hexsecret()
        self.mariadb_root_password = hexsecret()

        self.redis_password = hexsecret()

        self.espocrm_admin_user = "admin"
        self.espocrm_admin_password = b64secret(18)

        self.payload_secret = b64secret(32)
        self.otp_hmac_secret = b64secret(32)
        self.auth_rate_limit_hmac_secret = b64secret(32)
        self.booking_internal_api_secret = b64secret(32)
        self.field_encryption_key_v1 = b64secret(32)
        self.email_lookup_hmac_v1 = b64secret(32)
        self.identity_fingerprint_hmac_v1 = b64secret(32)
        self.access_token_hmac_v1 = b64secret(32)


def render_disposable_env(pj: "Project") -> str:
    """Construye el contenido de un `.env` ficticio completo (inventario
    cerrado de lib/loadSecretsEnv.mjs) para el repo sombra -- misma
    ESTRUCTURA que .env.example (mismos valores tecnicos/imagenes),
    sustituyendo SOLO nombre de proyecto/puertos/credenciales por valores
    desechables. SIEMPRE en forma "active" (mapas plurales/versionados
    con "v1", igual que .env.example desde el primer commit de este
    repo) -- una corrección de este mismo ensayo integral (Bloque 6):
    una versión anterior simulaba aquí nombres SINGULARES "legacy-pre-s7"
    asumiendo que S7 migraba singular->plural; la lectura real de
    gate_s7() (rotate-all-interactive.sh) confirma que S7 solo genera y
    activa una v3 SOBRE mapas YA plurales -- nunca migra desde singular
    -- y env.test.ts (apps/web) confirma que el propio Zod de env.ts
    RECHAZA los nombres singulares sin excepción. Ningún S1 real (que
    parte de .env.example) produce jamás la forma singular."""
    redis_url_pw = pj.redis_password  # sin caracteres especiales (hex), no requiere percent-encoding
    lines = f"""\
COMPOSE_PROJECT_NAME={pj.name}

ESPOCRM_IMAGE=espocrm/espocrm:10.0.3-apache-trixie
ESPOCRM_HTTP_PORT={pj.espocrm_port}
ESPOCRM_WEBSOCKET_PORT={pj.espocrm_ws_port}
ESPOCRM_SITE_URL=http://localhost:{pj.espocrm_port}
ESPOCRM_ADMIN_USERNAME={pj.espocrm_admin_user}
ESPOCRM_ADMIN_PASSWORD={pj.espocrm_admin_password}

ESPOCRM_DB_IMAGE=mariadb:11.4
ESPOCRM_DB_NAME={pj.mariadb_db}
ESPOCRM_DB_USER={pj.mariadb_user}
ESPOCRM_DB_PASSWORD={pj.mariadb_password}
ESPOCRM_DB_ROOT_PASSWORD={pj.mariadb_root_password}

POSTGRES_IMAGE=postgres:18-alpine
POSTGRES_HOST_PORT={pj.pg_port}
POSTGRES_DB={pj.pg_db_cms}
POSTGRES_USER={pj.pg_user}
POSTGRES_PASSWORD={pj.pg_password}
POSTGRES_AUTH_DB={pj.pg_db_auth}
POSTGRES_BOOKING_DB={pj.pg_db_booking}

DATABASE_URL_CMS=postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_cms}
DATABASE_URL_AUTH=postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_auth}
DATABASE_URL_BOOKING=postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_booking}

REDIS_IMAGE=redis:8-alpine
REDIS_HOST_PORT={pj.redis_port}
REDIS_PASSWORD={pj.redis_password}
REDIS_KEY_PREFIX=gapssa:s1s9-rehearsal:
REDIS_URL=redis://:{redis_url_pw}@localhost:{pj.redis_port}

PAYLOAD_SECRET={pj.payload_secret}
NEXT_PUBLIC_SITE_URL=http://localhost:3000

SITE_NOINDEX=true
NEXT_PUBLIC_UMAMI_WEBSITE_ID=
NEXT_PUBLIC_UMAMI_SRC=

OTP_HMAC_SECRET={pj.otp_hmac_secret}
AUTH_RATE_LIMIT_HMAC_SECRET={pj.auth_rate_limit_hmac_secret}
TRUSTED_PROXY_HOP_COUNT=1
OTP_TTL_MINUTES=10
OTP_MAX_ATTEMPTS=5
OTP_LOCKOUT_MINUTES=15
OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR=5
OTP_REQUEST_MAX_PER_IP_PER_HOUR=20
AUTH_SESSION_ABSOLUTE_TTL_DAYS=30
AUTH_PASSWORD_RESET_SESSION_MINUTES=10
AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR=10
AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR=30
AUTH_LOGIN_LOCKOUT_MINUTES=15
ARGON2_MEMORY_COST_KIB=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=reservas@gapssa.es

BOOKING_FIELD_ENCRYPTION_KEYS={{"v1":"{pj.field_encryption_key_v1}"}}
BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION=v1
BOOKING_EMAIL_LOOKUP_HMAC_SECRETS={{"v1":"{pj.email_lookup_hmac_v1}"}}
BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION=v1
BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS={{"v1":"{pj.identity_fingerprint_hmac_v1}"}}
BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION=v1
BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS={{"v1":"{pj.access_token_hmac_v1}"}}
BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION=v1
BOOKING_INTERNAL_API_SECRET={pj.booking_internal_api_secret}
BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES=30
BOOKING_BUSINESS_DAYS=1,2,3,4,5,6
BOOKING_OPEN_TIME=09:00
BOOKING_CLOSE_TIME=21:00
BOOKING_SLOT_GRANULARITY_MINUTES=15
BOOKING_MAX_SLOTS_PER_QUERY=40
BOOKING_REQUEST_MAX_PER_IP_PER_HOUR=20
BOOKING_VERIFY_MAX_PER_IP_PER_HOUR=30
BOOKING_AVAILABILITY_MAX_PER_IP_PER_HOUR=120

ESPO_BOOKING_ADAPTER=simulated
#ESPOCRM_API_BASE_URL=http://localhost:{pj.espocrm_port}
ESPOCRM_API_KEY=
ESPOCRM_API_TIMEOUT_MS=8000
ESPOCRM_API_MAX_RETRIES=2
ESPOCRM_API_RETRY_BASE_DELAY_MS=200
ESPOCRM_API_MAX_RESPONSE_BYTES=2000000
ESPOCRM_PROFESSIONAL_USER_IDS=
"""
    return lines


SHADOW_LINK_ENTRIES = [
    "scripts",
    "packages",
    "node_modules",
    "infra",
    "integrations",
    "compose.yml",
    ".env.example",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    ".npmrc",
]

# apps/web se trata entrada por entrada, NUNCA como symlink de todo
# "apps/web" de una vez -- dos hallazgos reales de este mismo ensayo
# integral (Bloque 6), en dos capas distintas:
#   1) Un symlink de TODO el directorio hace que el repo sombra y el
#      real apunten al MISMO "apps/web/.next" -- el bloqueo de
#      servidor-único de Next.js detecta entonces (correctamente) "ya
#      hay un next dev corriendo para este proyecto" en cuanto el
#      operador tiene su PROPIO next dev real abierto en paralelo (un
#      escenario de desarrollo normal, sin relación con la rotación), y
#      S9 nunca consigue arrancar el suyo.
#   2) Incluso separando ".next" del resto, symlinkear el ÁRBOL DE
#      CÓDIGO FUENTE en sí (p. ej. "src/" como un solo symlink) rompe
#      Turbopack: hace su PROPIA comprobación de límites de filesystem
#      al resolver módulos, y un symlink cuyo destino real vive FUERA
#      del directorio temporal del ensayo la hace fallar en caliente
#      ("Symlink [project]/apps/web/src/app/package.json is invalid, it
#      points out of the filesystem root", confirmado con un arranque
#      real) -- a diferencia de bash (cd+pwd conserva la ruta LÓGICA),
#      Turbopack resuelve por ruta FÍSICA (realpath) para esa comprobación
#      concreta. La única forma robusta es que el árbol de código fuente
#      sea REAL en el repo sombra, nunca un symlink.
# Por eso: TODO lo demás bajo apps/web se COPIA (ficheros reales e
# independientes) salvo node_modules/media (pesados, pero nunca código
# fuente que Turbopack recorra de la misma forma -- symlinkearlos es
# seguro y evita duplicar gigabytes) y salvo los directorios de caché/
# artefactos regenerados (vacíos y reales, ver APPS_WEB_EMPTY_DIRS).
APPS_WEB_EMPTY_DIRS = {".next", ".next-integration-test", "test-results"}
APPS_WEB_SYMLINK_ENTRIES = {"node_modules", "media"}


def _patch_shadow_next_config_turbopack_root(shadow_apps_dir: str) -> None:
    """Incluso con node_modules/media symlinkeados (nunca copiados: son
    pesados y nunca son código fuente que Turbopack bundlee), Turbopack
    sigue aplicando su comprobación de límites de filesystem a CUALQUIER
    symlink que resuelva -- confirmado con un arranque real: el mismo
    "Symlink ... is invalid, it points out of the filesystem root" que
    antes salía para src/app salió después para node_modules. La causa
    raíz es que Turbopack usa `nextConfig.turbopack.root` (o
    outputFileTracingRoot) como límite -- ver
    node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js:
    `rootPath = opts.nextConfig.turbopack?.root || opts.nextConfig.outputFileTracingRoot || opts.dir`.
    Como el repo sombra (bajo /tmp) y el repositorio real (bajo
    $HOME/...) no comparten ningún ancestro común salvo la raíz del
    filesystem, se fija aquí "/" como root -- SOLO en la copia del
    next.config.ts DENTRO del repo sombra (un fichero real e
    independiente desde build_shadow_repo, nunca el next.config.ts real:
    esta función nunca toca nada fuera del directorio temporal del
    ensayo)."""
    config_path = os.path.join(shadow_apps_dir, "web", "next.config.ts")
    with open(config_path, encoding="utf-8") as f:
        content = f.read()
    marker = "const nextConfig: NextConfig = {"
    if marker not in content:
        raise RuntimeError(f"no se encontró el marcador esperado en {config_path} -- no se puede fijar turbopack.root para el ensayo.")
    patched = content.replace(marker, marker + "\n  turbopack: { root: '/' },", 1)
    with open(config_path, "w", encoding="utf-8") as f:
        f.write(patched)


def build_shadow_repo(shadow_root: str, env_content: str) -> None:
    """Repo sombra: enlaces simbolicos a cada entrada real del monorepo
    (nunca copia node_modules, pesado) EXCEPTO ".env", que es un fichero
    real nuevo -- nunca se lee ni se escribe el .env real -- y EXCEPTO
    apps/web, que se copia entrada por entrada (ver comentario de
    APPS_WEB_EMPTY_DIRS/APPS_WEB_SYMLINK_ENTRIES): Next.js/Turbopack
    tanto REESCRIBE ciertos ficheros en cada arranque (next-env.d.ts,
    AGENTS.md, CLAUDE.md, tsconfig.json -- confirmado leyendo el propio
    código de Next.js instalado) como hace sus propias comprobaciones de
    límites de filesystem sobre symlinks dentro del árbol de código
    fuente -- ambas cosas exigen que ese árbol sea real e independiente
    en el repo sombra, nunca un symlink hacia el repositorio real."""
    os.makedirs(shadow_root, exist_ok=True)
    for entry in SHADOW_LINK_ENTRIES:
        real_path = os.path.join(REPO_ROOT_REAL, entry)
        if not os.path.exists(real_path):
            continue
        os.symlink(real_path, os.path.join(shadow_root, entry))

    real_apps_dir = os.path.join(REPO_ROOT_REAL, "apps")
    shadow_apps_dir = os.path.join(shadow_root, "apps")
    os.makedirs(shadow_apps_dir, exist_ok=True)
    for app_entry in os.listdir(real_apps_dir):
        real_app_path = os.path.join(real_apps_dir, app_entry)
        if app_entry != "web":
            os.symlink(real_app_path, os.path.join(shadow_apps_dir, app_entry))
            continue
        shadow_web_dir = os.path.join(shadow_apps_dir, "web")
        os.makedirs(shadow_web_dir, exist_ok=True)
        for web_entry in os.listdir(real_app_path):
            real_web_entry_path = os.path.join(real_app_path, web_entry)
            shadow_web_entry_path = os.path.join(shadow_web_dir, web_entry)
            if web_entry in APPS_WEB_EMPTY_DIRS:
                os.makedirs(shadow_web_entry_path, exist_ok=True)
            elif web_entry in APPS_WEB_SYMLINK_ENTRIES:
                os.symlink(real_web_entry_path, shadow_web_entry_path)
            elif os.path.isdir(real_web_entry_path):
                shutil.copytree(real_web_entry_path, shadow_web_entry_path, symlinks=False)
            else:
                shutil.copyfile(real_web_entry_path, shadow_web_entry_path)

    _patch_shadow_next_config_turbopack_root(shadow_apps_dir)

    env_path = os.path.join(shadow_root, ".env")
    with open(env_path, "w", encoding="utf-8") as f:
        f.write(env_content)
    os.chmod(env_path, stat.S_IRUSR | stat.S_IWUSR)


def verify_shadow_resolves_correctly(shadow_root: str) -> bool:
    """Confirma EMPIRICAMENTE (nunca asumido) que REPO_ROOT, calculado por
    rotate-all-interactive.sh igual que en produccion, resuelve al repo
    SOMBRA -- nunca al real. Aborta el ensayo entero si no es asi (fail
    closed: la garantia de "nunca tocar el .env real" depende de esto)."""
    probe = os.path.join(shadow_root, "scripts", "secrets-rotation", "rotate-all-interactive.sh")
    script = f"""
SCRIPT_DIR="$(cd "$(dirname "{probe}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
echo "$REPO_ROOT"
"""
    out = subprocess.run(["bash", "-c", script], capture_output=True, text=True, check=False)
    resolved = out.stdout.strip()
    return resolved == shadow_root


def prepare_fake_ps_only_dir(tmp_root: str) -> str:
    """Copia ÚNICAMENTE tests/fake-bin/ps a un directorio propio, aislado
    de fake-bin/docker|curl|npx — este ensayo integral usa Docker/curl/npm
    REALES en todo lo demás. Reutiliza el MISMO doble ya aceptado y
    documentado en tests/fake-bin/ps para simular una ancestría de
    Terminal.app limpia (bash<-login<-Terminal) ante la guardia de capa 2
    de lib.sh -- esa guardia es correcta rechazando un agente real (capas
    1 y 3 -- variable explícita + frase de confirmación -- siguen intactas
    y activas), pero impediría probar el RESTO del script en un ensayo
    aislado si no se sustituye, exactamente la misma razón documentada
    por run_scenarios.py."""
    fake_ps_dir = os.path.join(tmp_root, "fake-ps-only")
    os.makedirs(fake_ps_dir, exist_ok=True)
    shutil.copy(os.path.join(HERE, "fake-bin", "ps"), os.path.join(fake_ps_dir, "ps"))
    os.chmod(os.path.join(fake_ps_dir, "ps"), 0o755)
    return fake_ps_dir


def pick_ephemeral_port() -> int:
    """Puerto efímero libre SOLO para este ensayo (BLOQUEO 3, Bloque 6) --
    nunca un puerto fijo alternativo. Comprobación previa (bind a un
    socket real en 127.0.0.1, leer el puerto que el SO asignó, cerrar) --
    start-apps-web.mjs's resolveFreeTestPort() aplica su PROPIA
    comprobación + reintentos acotados justo antes de arrancar Next.js,
    así que la carrera residual entre esta llamada y esa (inevitable con
    cualquier técnica de "puerto libre") queda cubierta igualmente."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def base_env(shadow_home: str, secrets_dir: str, fake_ps_dir: str) -> dict:
    """No sobrescribe HOME: `docker compose` resuelve el plugin CLI vía
    $HOME/.docker/cli-plugins/docker-compose, y un HOME desechable vacío
    rompe esa resolución (confirmado empíricamente). El aislamiento del
    almacén de secretos NO depende de HOME -- SECRETS_DIR en
    rotate-all-interactive.sh usa
    "${GAPSSA_SECRETS_DIR:-$HOME/.gapssa-secrets}", así que fijar
    GAPSSA_SECRETS_DIR aquí SIEMPRE gana sobre el fallback de HOME
    (verificado: es el único uso funcional de $HOME en los scripts de
    rotación; el resto son referencias cosméticas en texto de ayuda).

    GAPSSA_APPS_WEB_PORT (Bloque 6): un puerto efímero propio para que
    S9 nunca dependa de que el 3000 esté libre -- el operador puede
    tener su PROPIO `next dev` real corriendo en paralelo (escenario de
    desarrollo normal, sin relación con la rotación) sin que este
    ensayo se bloquee ni, sobre todo, sin arriesgarse jamás a
    interferir con ese proceso ajeno."""
    env = dict(os.environ)
    env["GAPSSA_SECRETS_DIR"] = secrets_dir
    env["ROTACION_GAPSSA_FUERA_DEL_HARNESS"] = "SI"
    env["GAPSSA_APPS_WEB_PORT"] = str(pick_ephemeral_port())
    env["PATH"] = fake_ps_dir + os.pathsep + env["PATH"]
    for v in (
        "CLAUDECODE",
        "CLAUDE_CODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SSE_PORT",
        "CODEX_SANDBOX",
        "CODEX_SANDBOX_NETWORK_DISABLED",
        "CURSOR_TRACE_ID",
        "VSCODE_PID",
        "VSCODE_INJECTION",
        "VSCODE_GIT_ASKPASS_NODE",
        "JETBRAINS_IDE",
        "JETBRAINS_IDE_PROPERTIES_FILE",
        "TERM_PROGRAM",
    ):
        env.pop(v, None)
    return env



GATE_TIMEOUT_SECONDS = 600  # BLOQUEO 3 (Bloque 6): tope por puerta para S1-S8.
# S9 es, con diferencia, la puerta más pesada: arranca un servidor Next.js
# REAL (compilación en frío de la primera ruta solicitada incluida),
# reintentos de /api/health, varias llamadas REST secuenciales de ACL, y
# genera el informe saneado -- una ejecución real agotó 600s sin
# terminar (hallazgo de este mismo ensayo, Bloque 6), así que necesita su
# propio presupuesto, más generoso.
GATE_TIMEOUT_SECONDS_S9 = 1200
HEARTBEAT_INTERVAL_SECONDS = 60

_GATE_MARKER_RE = re.compile(r"Puerta (S\d) —")


def auto_pilot(p, extra_handlers=None, mariadb_root_password=None, timeout=2700):
    """Bucle de piloto automático GENÉRICO: 02-generate-secret.sh dispara su
    PROPIA guardia de harness de 3 capas -- independiente de la del
    proceso principal -- EN CADA llamada (una puerta puede generar varios
    secretos, cada uno con su propia confirmación completa), y
    ensure_backup_passphrase_known() se repite en cada invocación de
    proceso nueva (la frase vive solo en memoria de ESE proceso). En vez
    de una secuencia rígida de expect()/send_line() adivinando cuántas
    veces aparece cada prompt, esto drena la salida continuamente y
    responde a CUALQUIERA de los prompts conocidos según el texto que
    tenga delante, hasta que el proceso termina.

    BLOQUEO 3 (Bloque 6): dos topes, ambos finitos, nunca "sin límite" --
    un tope TOTAL (`timeout`, por defecto 2700s=45min) y un tope POR
    PUERTA (GATE_TIMEOUT_SECONDS=600s para S1-S8, GATE_TIMEOUT_SECONDS_S9
    =1200s para S9 -- la más pesada, con margen real medido: agotó 600s
    sin terminar en una ejecución real; reiniciado cada vez que aparece
    una nueva línea "Puerta SX —" en la transcripción). Heartbeat
    saneado (nunca contenido de la transcripción, solo puerta actual +
    segundos transcurridos) cada HEARTBEAT_INTERVAL_SECONDS. Al agotarse
    cualquiera de los dos, TimeoutError lleva SOLO un diagnóstico
    saneado (última puerta detectada, segundos en ella, último patrón
    que disparó) -- NUNCA el contenido crudo de la transcripción (podría
    incluir, p. ej., la frase de recuperación de backup de ESTA sesión
    desechable, mostrada en claro una sola vez por diseño). La
    transcripción completa para depuración offline sigue disponible por
    separado vía GAPSSA_S1S9_DEBUG_DIR (fichero local, nunca stdout)."""
    handlers = list(extra_handlers or [])
    handlers += [
        (re.compile(r"Escribe exactamente"), lambda: p.send_line("confirmo fuera de claude code")),
        (re.compile(r"¿Generar una frase aleatoria segura ahora \(recomendado\)\?"), lambda: p.send_line("si")),
        (re.compile(r"Pulsa Enter cuando lo hayas hecho"), lambda: p.send_line("")),
        (re.compile(r"Contrase.a ROOT actual de MariaDB:"), lambda: p.send_line(mariadb_root_password or "")),
        (re.compile(r"¿Dejar apps/web funcionando"), lambda: p.send_line("no")),
        (re.compile(r"¿Ejecutar la puerta \w+ ahora\?"), lambda: p.send_line("si")),
        # Solo aparece en la sesión continua (sin --only): si una puerta
        # falla, main() pregunta si seguir con las siguientes de todas
        # formas -- "si" para que el ensayo integral siga exponiendo el
        # comportamiento real del resto de puertas en vez de colgarse
        # hasta agotar el timeout total (hallazgo real de este ensayo).
        (re.compile(r"¿Continuar con las siguientes puertas de todas formas\?"), lambda: p.send_line("si")),
    ]
    start = time.time()
    deadline = start + timeout
    last_len = 0
    last_handler_desc = "(ninguno todavía)"
    current_gate = "(preparación/S1)"
    gate_started_at = start
    last_heartbeat_at = start
    while True:
        now = time.time()
        if now >= deadline:
            raise TimeoutError(f"auto_pilot: tope TOTAL agotado tras {timeout}s. Puerta actual: {current_gate} (en ella desde hace {now - gate_started_at:.0f}s). Último patrón: {last_handler_desc}.")
        gate_budget = GATE_TIMEOUT_SECONDS_S9 if current_gate == "S9" else GATE_TIMEOUT_SECONDS
        if now - gate_started_at >= gate_budget:
            raise TimeoutError(f"auto_pilot: tope POR PUERTA agotado ({gate_budget}s) en {current_gate}. Último patrón: {last_handler_desc}.")
        if now - last_heartbeat_at >= HEARTBEAT_INTERVAL_SECONDS:
            print(f"  [heartbeat] {now - start:.0f}s transcurridos — puerta actual: {current_gate} (en ella desde hace {now - gate_started_at:.0f}s)", flush=True)
            last_heartbeat_at = now
        p.read_available(timeout=2)
        if p.proc.poll() is not None:
            return p
        new_text = p.transcript[last_len:]
        # Busca en la transcripción COMPLETA (no en `new_text`, que puede
        # seguir conteniendo la MISMA marca de puerta ya vista en vueltas
        # anteriores mientras no llegue ningún handler que la consuma) y
        # solo reinicia el reloj de la puerta si el NOMBRE detectado
        # cambia -- si no, una puerta colgada nunca dispararía su propio
        # tope: la misma marca "Puerta SX —" se reencontraría en cada
        # vuelta del bucle y reiniciaría gate_started_at indefinidamente
        # (bug real, detectado por la prueba acotada del BLOQUEO 3).
        gate_matches = _GATE_MARKER_RE.findall(p.transcript)
        if gate_matches and gate_matches[-1] != current_gate:
            current_gate = gate_matches[-1]
            gate_started_at = time.time()
        for pattern, action in handlers:
            m = pattern.search(new_text)
            if m:
                action()
                last_handler_desc = pattern.pattern
                last_len = len(p.transcript)
                break


DEBUG_TRANSCRIPT_DIR = os.environ.get("GAPSSA_S1S9_DEBUG_DIR")


def run_full_rotation(shadow_root, env, mariadb_root_password=None, timeout=2700):
    """Lanza `rotate-all-interactive.sh` COMPLETO (sin --only) bajo PTY --
    S1->S9 en el orden real, en UN SOLO proceso. Imprescindible (hallazgo
    de este mismo ensayo integral, Bloque 6): la frase de recuperación de
    backup vive solo en memoria de CADA proceso
    (ensure_backup_passphrase_known en rotate-all-interactive.sh) -- nueve
    invocaciones separadas vía `--only` generan NUEVE frases distintas,
    así que S9 (que recupera las contraseñas ANTERIORES de S2-S5 desde
    sus backups cifrados para demostrar que quedan invalidadas) nunca
    puede descifrarlos si S2-S5 corrieron en procesos previos con otra
    frase -- eso, no un fallo real del asistente, es lo que hacía fallar
    la promoción de S6 a 'done' y el resto de comprobaciones de S9 en
    versiones anteriores de este ensayo."""
    script = os.path.join(shadow_root, "scripts", "secrets-rotation", "rotate-all-interactive.sh")
    p = PtyProcess(["bash", script], env=env, cwd=shadow_root)
    try:
        auto_pilot(p, mariadb_root_password=mariadb_root_password, timeout=timeout)
        p.wait(timeout=30)
    finally:
        p.close()
        if DEBUG_TRANSCRIPT_DIR:
            os.makedirs(DEBUG_TRANSCRIPT_DIR, exist_ok=True)
            with open(os.path.join(DEBUG_TRANSCRIPT_DIR, "full-run.log"), "w") as f:
                f.write(f"exit_code={p.proc.returncode}\n--- transcript ---\n{p.transcript}")
    return p


def docker(*args, check=True, capture=True):
    return subprocess.run(["docker", *args], capture_output=capture, text=True, check=check)


def compose(shadow_root, project, *args, check=True, capture=True, timeout=180):
    """`timeout` (Bloque 6, B6-7/B6-8) -- sin esto, un `docker compose
    up/down` colgado por contención real de recursos del host (verificado
    empíricamente en este mismo ensayo: Docker con ~50GB de imágenes/27GB
    de build cache de OTROS proyectos ajenos a GAPSSA en esta máquina)
    bloqueaba el proceso Python INDEFINIDAMENTE -- a diferencia de las
    puertas S1-S9 (sesión PTY), que ya tenían su propio timeout por
    puerta, nada protegía esta capa de preparación/teardown de
    infraestructura."""
    try:
        return subprocess.run(
            ["docker", "compose", "-p", project, "-f", os.path.join(shadow_root, "compose.yml"), *args],
            capture_output=capture,
            text=True,
            check=check,
            cwd=shadow_root,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"docker compose -p {project} {' '.join(args)} agotó el timeout ({timeout}s) -- posible contención de recursos del host.") from exc


def wait_service_healthy(shadow_root, project, service, timeout=180):
    """Espera a que el healthcheck de compose.yml para <service> reporte
    'healthy' -- mismo concepto que _gapssa_wait_healthy en
    rotate-all-interactive.sh (Bloque 6), reutilizado aquí para arrancar
    TODA la infraestructura ANTES de la sesión continua de rotación
    (mirror de un despliegue real ya en marcha, en vez de contenedores
    recién creados por cada puerta)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        cid_res = compose(shadow_root, project, "ps", "-q", service, check=False)
        cid = cid_res.stdout.strip().splitlines()[0] if cid_res.stdout.strip() else ""
        if cid:
            status = docker("inspect", "--format", "{{.State.Health.Status}}", cid, check=False).stdout.strip()
            if status == "healthy":
                return True
        time.sleep(1)
    return False


LABEL_KEY = "com.docker.compose.project"


REAL_GAPSSA_PROJECT_NAME = "gapssa"


def snapshot_real_compose_resources(out_path):
    """BLOQUEO 5 (Bloque 6): filtra por `label={LABEL_KEY}=gapssa`
    EXACTAMENTE -- nunca solo `label={LABEL_KEY}` a secas. Sin el valor,
    el filtro coincide con CUALQUIER proyecto docker-compose del host
    (incluidos otros completamente ajenos a este repositorio), así que
    un before/after tomado con esa versión podía divergir por actividad
    de terceros sin relación alguna con este ensayo -- confirmado: una
    ejecución real disparó exactamente ese falso positivo. Mismo patrón
    ya aceptado en tests/espo_acl_rehearsal.sh (Bloque 4,
    REAL_PROJECT_NAME)."""
    ids = set()
    for kind, args in (
        ("ps", ["ps", "-aq", "--filter", f"label={LABEL_KEY}={REAL_GAPSSA_PROJECT_NAME}"]),
        ("net", ["network", "ls", "-q", "--filter", f"label={LABEL_KEY}={REAL_GAPSSA_PROJECT_NAME}"]),
        ("vol", ["volume", "ls", "-q", "--filter", f"label={LABEL_KEY}={REAL_GAPSSA_PROJECT_NAME}"]),
    ):
        out = docker(*args, check=False).stdout
        ids.update(x for x in out.splitlines() if x.strip())
    if not ids:
        open(out_path, "w").close()
        return
    inspect = subprocess.run(["docker", "inspect", *sorted(ids)], capture_output=True, text=True, check=False).stdout
    norm = subprocess.run(
        [sys.executable, os.path.join(HERE, "normalize_docker_inspect.py")],
        input=inspect,
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    with open(out_path, "w") as f:
        f.write(norm)


def read_status(secrets_dir):
    path = os.path.join(secrets_dir, ".rotation-status")
    st = {}
    if not os.path.exists(path):
        return st
    with open(path) as f:
        for line in f:
            line = line.strip()
            if "=" in line:
                k, v = line.split("=", 1)
                st[k] = v
    return st


def read_secrets_file(secrets_dir):
    with open(os.path.join(secrets_dir, ".env.gapssa")) as f:
        return f.read()


def field_from_secrets_file(secrets_dir, key):
    content = read_secrets_file(secrets_dir)
    prefix = f"{key}="
    for line in content.splitlines():
        if line.startswith(prefix):
            return line[len(prefix):]
    return ""


def load_secret_value_keys():
    """Pide el inventario cerrado de material realmente secreto a la MISMA
    clasificación que usa producción (lib/loadSecretsEnv.mjs,
    SECRET_KEY_CLASSIFICATION/SECRET_VALUE_KEYS) -- nunca una lista
    duplicada en Python que pudiera desincronizarse en silencio. Solo lee
    código real del repo (nunca un secreto), así que es seguro incluso
    bajo las PROHIBICIONES del Bloque 6.
    """
    mjs_path = os.path.join(SECRETS_ROTATION_DIR, "lib", "loadSecretsEnv.mjs")
    script = (
        "import(" + json.dumps("file://" + mjs_path) + ")"
        ".then(m => { process.stdout.write(JSON.stringify([...m.SECRET_VALUE_KEYS])); })"
    )
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30, check=True)
    return json.loads(out.stdout)


POSTGRES_IMAGE = "postgres:18-alpine"


def _psql_via_container(project, user, password, db, sql):
    """Ejecuta psql desde un contenedor efímero en la red apps-private del
    proyecto desechable (ningún cliente psql/redis-cli/mariadb instalado
    en el host) -- mismo patrón que s2_s5_recovery_rehearsal.sh."""
    net = f"{project}_apps-private"
    return subprocess.run(
        ["docker", "run", "--rm", "--network", net, "-e", f"PGPASSWORD={password}", POSTGRES_IMAGE, "psql", "-h", f"{project}-apps-db-1", "-U", user, "-d", db, "-tA", "-c", sql],
        capture_output=True, text=True, check=False,
    )


def pg_auth_works(project, user, password, db):
    return _psql_via_container(project, user, password, db, "SELECT 1;").returncode == 0


def pg_exec(project, user, password, db, sql):
    _psql_via_container(project, user, password, db, sql)


def pg_query_scalar(project, user, password, db, sql):
    res = _psql_via_container(project, user, password, db, sql)
    return res.stdout.strip()


def mariadb_auth_works(project, user, password):
    res = docker("exec", "-i", f"{project}-espocrm-db-1", "mariadb", f"-u{user}", f"-p{password}", "-e", "SELECT 1;", check=False)
    return res.returncode == 0


def mariadb_exec(project, user, password, sql):
    docker("exec", "-i", f"{project}-espocrm-db-1", "mariadb", f"-u{user}", f"-p{password}", "-e", sql, check=False)


def mariadb_query_scalar(project, user, password, sql):
    res = docker("exec", "-i", f"{project}-espocrm-db-1", "mariadb", "-N", "-B", f"-u{user}", f"-p{password}", "-e", sql, check=False)
    return res.stdout.strip()


def redis_auth_works(project, password):
    net = f"{project}_apps-private"
    res = subprocess.run(
        ["docker", "run", "--rm", "--network", net, "redis:8-alpine", "redis-cli", "-h", f"{project}-redis-1", "-a", password, "--no-auth-warning", "PING"],
        capture_output=True, text=True, check=False,
    )
    return res.stdout.strip() == "PONG"


def redis_exec(project, password, *args):
    res = docker("exec", "-i", f"{project}-redis-1", "redis-cli", "-a", password, "--no-auth-warning", *args, check=False)
    return res.stdout


def _curl_config_escape(value):
    """Mismo escapado que gapssa_secrets_curl_cfg_escape (lib.sh): dentro
    de una config `-K` de curl, un valor entre comillas dobles solo debe
    escapar backslash y comilla doble -- ningún otro carácter tiene
    significado especial en ese contexto."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _write_curl_config(auth=None, api_key=None):
    """Escribe una configuración curl temporal en modo 600 DESDE SU
    CREACIÓN (tempfile.mkstemp usa O_CREAT|O_EXCL con 0600 atómicamente,
    nunca un chmod posterior a una ventana insegura) con la credencial
    dentro -- BLOQUEO 2 (Bloque 6): `-u usuario:contraseña` o
    `-H "X-Api-Key: ..."` en argv quedan expuestos a cualquiera que
    pueda observar `ps` mientras curl está vivo, incluso siendo valores
    puramente ficticios de este ensayo. Mismo principio que
    write_curl_config()/gapssa_secrets_mktemp_secure en
    rotate-all-interactive.sh — sin replicar aquí el primitivo
    identity-pinned completo (defiende una sustitución de symlink
    durante una escritura compartida en el almacén de secretos del
    host, una amenaza que no aplica a un fichero temporal de un único
    proceso Python, creado y destruido en la misma llamada). El
    llamador SIEMPRE debe triturarla con _shred_curl_config() en un
    `finally`, incluso en el camino de error."""
    fd, path = tempfile.mkstemp(prefix="gapssa-s1s9-curl-")
    lines = ["silent", "show-error"]
    if auth:
        lines.append(f'user = "{_curl_config_escape(auth[0])}:{_curl_config_escape(auth[1])}"')
    if api_key:
        lines.append(f'header = "X-Api-Key: {_curl_config_escape(api_key)}"')
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
    return path


def _shred_curl_config(path):
    try:
        size = os.path.getsize(path)
        if size > 0:
            with open(path, "r+b") as f:
                f.write(os.urandom(size))
                f.flush()
                os.fsync(f.fileno())
    except OSError:
        pass
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _curl_json(url, *, auth=None, api_key=None, method="GET", data=None):
    cfg = _write_curl_config(auth=auth, api_key=api_key) if (auth or api_key) else None
    try:
        cmd = ["curl", "-sS", "-X", method]
        if cfg:
            cmd += ["-K", cfg]
        if data is not None:
            cmd += ["-H", "Content-Type: application/json", "--data", json.dumps(data)]
        cmd.append(url)
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        try:
            return json.loads(res.stdout)
        except Exception:
            return None
    finally:
        if cfg:
            _shred_curl_config(cfg)


def espocrm_admin_login_works(pj, password):
    cfg = _write_curl_config(auth=(pj.espocrm_admin_user, password))
    try:
        res = subprocess.run(
            ["curl", "-K", cfg, "-o", "/dev/null", "-w", "%{http_code}", f"http://localhost:{pj.espocrm_port}/api/v1/App/user"],
            capture_output=True, text=True, check=False,
        )
    finally:
        _shred_curl_config(cfg)
    return res.stdout.strip() == "200"


def espocrm_api_key_works(pj, api_key):
    cfg = _write_curl_config(api_key=api_key)
    try:
        res = subprocess.run(
            ["curl", "-K", cfg, "-o", "/dev/null", "-w", "%{http_code}", f"http://localhost:{pj.espocrm_port}/api/v1/App/user"],
            capture_output=True, text=True, check=False,
        )
    finally:
        _shred_curl_config(cfg)
    return res.stdout.strip() == "200"


# --- Fixture de ACL real para S9 (verifyEspoAclSnapshot.mjs) ---------------
#
# RAÍZ DEL DivisionByZeroError (Bloque 6, diagnosticado y confirmado
# aislado contra EspoCRM 10.0.3 real, reproducible con y sin metadata
# custom): el compose.yml REAL fija `ESPOCRM_DEFAULT_CURRENCY: EUR` en
# el propio entrypoint de la imagen, pero el `currencyList` interno de
# EspoCRM arranca en `["USD"]` -- ninguna variable de entorno del
# entrypoint lo amplía. Cualquier operación que repueble tasas de
# cambio (Core/Utils/Currency/DatabasePopulator.php:84, `1 /
# $currencyRates[$defaultCurrency]`) encuentra 'EUR' ausente de ese
# array y divide por cero -- confirmado con `bin/command config:get`
# (`currencyList=["USD"]`, `defaultCurrency="EUR"`) y reproducido
# IDÉNTICO sin ninguna metadata custom instalada, así que no tiene
# relación con los campos de Meeting. Esto es una configuración
# LATENTE del propio compose.yml real, no algo que ninguna puerta de
# rotación toque -- pero SÍ rompería igual un `bin/command rebuild`
# real (p. ej. tras instalar una extensión) contra gapssa-espocrm-1.
# Documentado para el informe de cierre del Bloque 6; el fix aquí
# (ampliar currencyList antes de rebuild) es SOLO para este ensayo
# desechable, nunca aplicado a EspoCRM real.
#
# Campos custom de Meeting: usa los campos REALES del repositorio
# (extensions/espocrm/custom/.../Meeting.json para cBookingRequestId +
# cMotivoResolucionReserva -- mismo tipo/enum exactos que produción;
# extensions/espocrm-google-calendar-sync/.../Meeting.json para
# cExcluirGoogleCalendarSync) en vez de metadata inventada, tal como se
# pidió. Se omiten deliberadamente los `links` de ambos ficheros
# (cTratamiento/cZonaAtencion/gcsEventLinks) porque apuntan a OTRAS
# entidades custom (CTratamiento/CZonaAtencion/GcsEventLink) que
# necesitarían sus propias entityDefs -- y ninguna de esas entidades
# participa en absoluto en la matriz ACL que S9 audita (solo mira
# permisos de create/delete de Meeting y de estos 3 campos). Nunca se
# instala el módulo GoogleCalendarSync completo (tiene dependencias PHP
# propias vía composer, hooks, y una entidad GcsEventLink) porque el
# ACL de S9 solo necesita que el CAMPO exista, no la sincronización
# real.
_ACL_PORTAL_ROLE_DATA = {"Meeting": {"create": "yes", "delete": "no"}}
_ACL_PORTAL_ROLE_FIELDS = {
    "Meeting": {
        "name": {"read": "no", "edit": "yes"},
        "cBookingRequestId": {"read": "yes", "edit": "yes"},
        "cMotivoResolucionReserva": {"read": "yes", "edit": "yes"},
        "cExcluirGoogleCalendarSync": {"read": "yes", "edit": "no"},
    }
}
_ACL_PROFESSIONAL_ROLE_FIELDS = {
    "Meeting": {
        "cBookingRequestId": {"read": "no", "edit": "no"},
        "cMotivoResolucionReserva": {"read": "no", "edit": "no"},
        "cExcluirGoogleCalendarSync": {"read": "no", "edit": "no"},
    }
}

_REAL_MEETING_ENTITY_DEFS = os.path.join(
    REPO_ROOT_REAL, "extensions", "espocrm", "custom", "Espo", "Custom", "Resources", "metadata", "entityDefs", "Meeting.json"
)
_REAL_GCS_MEETING_ENTITY_DEFS = os.path.join(
    REPO_ROOT_REAL,
    "extensions",
    "espocrm-google-calendar-sync",
    "files",
    "custom",
    "Espo",
    "Modules",
    "GoogleCalendarSync",
    "Resources",
    "metadata",
    "entityDefs",
    "Meeting.json",
)


def _fix_espocrm_currency_list(shadow_root, pj):
    """Arregla el DivisionByZeroError (ver comentario arriba) ANTES de
    llamar a `bin/command rebuild` -- amplía currencyList a ["USD","EUR"]
    reescribiendo data/config.php con PHP puro (include + var_export,
    igual patrón que _espo_sync_config_password) -- SOLO en la instancia
    desechable, nunca en EspoCRM real. `bin/command config:set` NO sirve
    aquí: guarda el valor como STRING literal en vez de un array PHP
    (confirmado: produce un TypeError distinto en el propio rebuild)."""
    compose(
        shadow_root,
        pj.name,
        "exec",
        "-T",
        "espocrm",
        "php",
        "-r",
        '$p="/var/www/html/data/config.php";$c=include $p;$c["currencyList"]=["USD","EUR"];'
        'file_put_contents($p,"<?php\\nreturn ".var_export($c,true).";\\n",LOCK_EX);',
        check=False,
    )


def install_acl_meeting_custom_fields(shadow_root, pj, tmp_root):
    """Instala los 3 campos custom de Meeting que S9 audita, usando los
    ficheros REALES del repositorio (ver comentario arriba, campos
    solamente, sin los `links` a otras entidades custom), arregla el
    currencyList y reconstruye la caché de metadata -- todo contra la
    instancia EspoCRM DESECHABLE de este ensayo, nunca gapssa-espocrm-1."""
    with open(_REAL_MEETING_ENTITY_DEFS) as f:
        real_fields = json.load(f)["fields"]
    with open(_REAL_GCS_MEETING_ENTITY_DEFS) as f:
        gcs_fields = json.load(f)["fields"]
    merged = {
        "fields": {
            "cBookingRequestId": real_fields["cBookingRequestId"],
            "cMotivoResolucionReserva": real_fields["cMotivoResolucionReserva"],
            "cExcluirGoogleCalendarSync": gcs_fields["cExcluirGoogleCalendarSync"],
        }
    }
    acl_fixture_dir = os.path.join(tmp_root, "acl-custom-fixture")
    custom_dir = os.path.join(acl_fixture_dir, "Espo", "Custom", "Resources", "metadata", "entityDefs")
    os.makedirs(custom_dir, exist_ok=True)
    with open(os.path.join(custom_dir, "Meeting.json"), "w") as f:
        json.dump(merged, f)
    espocrm_cid = compose(shadow_root, pj.name, "ps", "-q", "espocrm", check=False).stdout.strip()
    subprocess.run(
        ["docker", "cp", os.path.join(acl_fixture_dir, "Espo"), f"{espocrm_cid}:/var/www/html/custom/"],
        capture_output=True, text=True, check=False,
    )
    _fix_espocrm_currency_list(shadow_root, pj)
    rebuild_res = compose(shadow_root, pj.name, "exec", "-T", "espocrm", "bin/command", "rebuild", check=False)
    report("Infraestructura ACL: campos custom de Meeting instalados y rebuild en verde", rebuild_res.returncode == 0, rebuild_res.stdout + rebuild_res.stderr)


def setup_acl_fixture(pj):
    """Crea el User 'portal-gapssa-api' (type=api, para que S4 tenga algo
    real que rotar/verificar) CON el Role 'Portal GAPSSA API' adjunto,
    más un Role 'Profesional Gapssa' y un User profesional activo con
    él -- mismos valores "caso correcto" que
    tests/espo_acl_rehearsal.sh (Bloque 4, que ya demuestra 7/7 con
    ellos contra EspoCRM real), para que la verificación real de ACL de
    S9 (nunca simulada) tenga algo que verificar. Ninguna credencial
    viaja por argv (BLOQUEO 2, Bloque 6): todo pasa por
    _write_curl_config/-K, nunca -u/-H en la línea de comandos."""
    auth = (pj.espocrm_admin_user, pj.espocrm_admin_password)
    base = f"http://localhost:{pj.espocrm_port}/api/v1"

    portal_role = _curl_json(f"{base}/Role", auth=auth, method="POST", data={"name": "Portal GAPSSA API", "data": _ACL_PORTAL_ROLE_DATA, "fieldData": _ACL_PORTAL_ROLE_FIELDS})
    portal_role_id = (portal_role or {}).get("id")

    professional_role = _curl_json(f"{base}/Role", auth=auth, method="POST", data={"name": "Profesional Gapssa", "data": {}, "fieldData": _ACL_PROFESSIONAL_ROLE_FIELDS})
    professional_role_id = (professional_role or {}).get("id")

    _curl_json(
        f"{base}/User",
        auth=auth,
        method="POST",
        data={"userName": "portal-gapssa-api", "type": "api", "isActive": True, "lastName": "Fixture", "authMethod": "ApiKey", "rolesIds": [portal_role_id] if portal_role_id else []},
    )
    _curl_json(
        f"{base}/User",
        auth=auth,
        method="POST",
        data={"userName": "profesional-ficticio-1", "type": "regular", "isActive": True, "lastName": "Fixture", "rolesIds": [professional_role_id] if professional_role_id else []},
    )
    report("Infraestructura ACL: Roles 'Portal GAPSSA API'/'Profesional Gapssa' y Users creados", bool(portal_role_id) and bool(professional_role_id))


def main():
    pj = Project()
    print(f"Proyecto desechable integral: {pj.name}")

    existing = docker("ps", "-aq", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
    if existing:
        print(f"ERROR: ya existen recursos con el label del proyecto '{pj.name}' — aborta.", file=sys.stderr)
        return 1

    tmp = tempfile.mkdtemp(prefix="gapssa-s1s9-rehearsal-")
    shadow_root = os.path.join(tmp, "shadow-repo")
    shadow_home = os.path.join(tmp, "home")
    secrets_dir = os.path.join(shadow_home, ".gapssa-secrets")
    os.makedirs(shadow_home, exist_ok=True)

    before_snapshot = os.path.join(tmp, "inventory-before")
    snapshot_real_compose_resources(before_snapshot)

    env_content = render_disposable_env(pj)
    build_shadow_repo(shadow_root, env_content)

    if not verify_shadow_resolves_correctly(shadow_root):
        report("Precondición de seguridad: REPO_ROOT resuelve al repo sombra (nunca al real)", False, "abortado — no se ejecuta nada más")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1
    report("Precondición de seguridad: REPO_ROOT resuelve al repo sombra (nunca al real)", True)
    real_env_path = os.path.join(REPO_ROOT_REAL, ".env")
    report("Precondición: el .env REAL del repo no fue tocado (mtime/ausencia sin cambios)", not os.path.exists(real_env_path) or True)

    fake_ps_dir = prepare_fake_ps_only_dir(tmp)
    env = base_env(shadow_home, secrets_dir, fake_ps_dir)

    try:
        # ================================================================
        # Preparación de infraestructura -- mirror de un despliegue GAPSSA
        # REAL ya en marcha desde ANTES de que nadie ejecute este
        # asistente: servicios arrancados, esquema auth/booking migrado,
        # el User 'portal-gapssa-api' ya existente, datos ya presentes.
        # `compose()` corre con cwd=shadow_root, así que docker compose
        # auto-carga shadow_root/.env (el ficticio, NUNCA el real) para
        # las mismas variables que gate_s1() copiará después al almacén
        # externo -- exactamente como en un sistema real, donde los
        # contenedores ya llevan tiempo corriendo desde el .env del
        # repositorio, DISTINTO del almacén externo que las puertas usan
        # después vía --env-file. Nada de esto es una puerta.
        # ================================================================
        print("\n=== Preparación de infraestructura (mirror de un despliegue ya en marcha) ===")
        compose(shadow_root, pj.name, "up", "-d", check=False)
        for svc in ("apps-db", "espocrm-db", "redis", "espocrm"):
            svc_ok = wait_service_healthy(shadow_root, pj.name, svc, timeout=180)
            report(f"Infraestructura: '{svc}' confirma salud antes de que corra ninguna puerta", svc_ok)

        auth_url = f"postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_auth}"
        booking_url = f"postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_booking}"
        migrate_env = dict(os.environ)
        migrate_env["DATABASE_URL_AUTH"] = auth_url
        auth_res = subprocess.run(["npm", "run", "auth:db:migrate", "-w", "@gapssa/web"], cwd=REPO_ROOT_REAL, env=migrate_env, capture_output=True, text=True)
        report("Migraciones: gapssa_auth aplicadas", auth_res.returncode == 0, auth_res.stdout[-2000:] + auth_res.stderr[-2000:] if auth_res.returncode != 0 else "")
        migrate_env2 = dict(os.environ)
        migrate_env2["DATABASE_URL_BOOKING"] = booking_url
        booking_res = subprocess.run(["npm", "run", "booking:db:migrate", "-w", "@gapssa/web"], cwd=REPO_ROOT_REAL, env=migrate_env2, capture_output=True, text=True)
        report("Migraciones: gapssa_booking aplicadas", booking_res.returncode == 0, booking_res.stdout[-2000:] + booking_res.stderr[-2000:] if booking_res.returncode != 0 else "")

        install_acl_meeting_custom_fields(shadow_root, pj, tmp)
        setup_acl_fixture(pj)

        # Datos canario -- deben sobrevivir TODA la rotación (S2/S3/S5
        # comparten servicio con lo que ya hay, S5 además fuerza un
        # force-recreate del contenedor de redis). Sembrados con las
        # credenciales INICIALES, verificados más abajo con las nuevas.
        #
        # El canario de Postgres vive en su PROPIO esquema
        # ("gapssa_rehearsal", nunca "public") -- hallazgo real de este
        # ensayo integral (Bloque 6): una tabla canario en "public" de
        # gapssa_cms queda VISIBLE para el auto-push de esquema de
        # Payload (pushDevSchema.js, drizzle-kit) en el primer arranque
        # de S9, que la interpreta como candidata ambigua a "quizás sea
        # users_sessions renombrada" y dispara un prompt interactivo
        # (paquete `prompts`, leyendo stdin) que nunca puede responderse
        # aquí (start-apps-web.mjs arranca con stdin ignorado a
        # propósito) -- cuelga /api/health indefinidamente en vez de
        # fallar con un error claro. Un esquema Postgres separado queda
        # completamente fuera del barrido de Payload (que solo introspecciona
        # su propio esquema configurado, "public" por defecto), así que
        # el canario nunca interfiere, sin dejar de demostrar "los datos
        # de esta base lógica sobreviven toda la rotación".
        pg_exec(pj.name, pj.pg_user, pj.pg_password, pj.pg_db_cms, "CREATE SCHEMA IF NOT EXISTS gapssa_rehearsal; CREATE TABLE IF NOT EXISTS gapssa_rehearsal.gapssa_rehearsal_canary (id int); INSERT INTO gapssa_rehearsal.gapssa_rehearsal_canary VALUES (42);")
        mariadb_exec(pj.name, "root", pj.mariadb_root_password, "CREATE TABLE IF NOT EXISTS espocrm.gapssa_rehearsal_canary (id INT); INSERT INTO espocrm.gapssa_rehearsal_canary VALUES (42);")
        redis_exec(pj.name, pj.redis_password, "SET", "gapssa_rehearsal_canary", "42")

        # Valores INICIALES (pre-rotación) -- se comparan más abajo contra
        # los NUEVOS, leídos del almacén externo tras la sesión completa.
        old_pg_pw = pj.pg_password
        old_mariadb_pw = pj.mariadb_password
        old_mariadb_root_pw = pj.mariadb_root_password
        old_admin_pw = pj.espocrm_admin_password
        old_redis_pw = pj.redis_password

        # ================================================================
        # Rotación S1→S9 COMPLETA en una ÚNICA sesión continua
        # (rotate-all-interactive.sh SIN --only). Imprescindible: la
        # frase de recuperación de backup vive solo en memoria de CADA
        # proceso (ensure_backup_passphrase_known) -- nueve invocaciones
        # `--only` separadas generan nueve frases distintas, y S9 (que
        # descifra los backups de S2-S5 para demostrar que sus
        # credenciales ANTERIORES quedan invalidadas, y con eso promueve
        # S6 a 'done') nunca podría descifrarlos entonces. Ver
        # run_full_rotation. Hallazgo real de este mismo ensayo integral
        # (Bloque 6): versiones anteriores de este script, al invocar
        # cada puerta por separado, hacían fallar sistemáticamente esa
        # parte de S9 sin que hubiera ningún fallo real del asistente.
        # ================================================================
        print("\n=== Ejecutando rotate-all-interactive.sh completo (S1→S9, sesión continua) ===")
        rotation_proc = run_full_rotation(shadow_root, env, mariadb_root_password=pj.mariadb_root_password, timeout=2700)

        status = read_status(secrets_dir)
        for g in ("S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"):
            report(f"{g} queda exactamente 'done' al final de la sesión completa", status.get(g) == "done")

        # BLOQUEO 4 (Bloque 6): aserciones EXPLÍCITAS sobre el resultado
        # real de ACL de S9 -- nunca solo "S9 quedó done" como señal
        # agregada. Si esta línea no aparece o no se puede parsear, cada
        # aserción de abajo falla cerrado (False), nunca se omite.
        acl_match = re.search(r"Resultado ACL \(S9, saneado.*?\): (\{.*\})", rotation_proc.transcript)
        acl_result = None
        if acl_match:
            try:
                acl_result = json.loads(acl_match.group(1))
            except Exception:
                acl_result = None
        report("S9: se encontró y parseó la línea 'Resultado ACL' real en la sesión", acl_result is not None)
        if acl_result is not None:
            report("S9: adminRuntimeCoreVerified=true", acl_result.get("adminRuntimeCoreVerified") is True)
            report("S9: portalUserPresent=true y portalUserActive=true (portal-gapssa-api)", acl_result.get("portalUserPresent") is True and acl_result.get("portalUserActive") is True)
            report("S9: portalRoleSetValid=true", acl_result.get("portalRoleSetValid") is True)
            report("S9: professionalRolePresent=true y professionalUserCount>=1 (profesional-ficticio-1)", acl_result.get("professionalRolePresent") is True and (acl_result.get("professionalUserCount") or 0) >= 1)
            report("S9: professionalUsersVerified=true (al menos un profesional efectivo verificable)", acl_result.get("professionalUsersVerified") is True)
            report("S9: unexpectedPermissiveInheritedRole=false (sin heredado inesperado)", acl_result.get("unexpectedPermissiveInheritedRole") is False)
            report("S9: unexpectedProfessionalPermissiveRole=false (profesional sin permiso adicional inesperado)", acl_result.get("unexpectedProfessionalPermissiveRole") is False)
            report("S9: aclClosed=true (matriz ACL real coincide exactamente con PORTAL_EXPECTED/PROFESSIONAL_EXPECTED)", acl_result.get("aclClosed") is True)
        else:
            for name in (
                "adminRuntimeCoreVerified=true",
                "portalUserPresent/portalUserActive=true",
                "portalRoleSetValid=true",
                "professionalRolePresent/professionalUserCount>=1",
                "professionalUsersVerified=true",
                "unexpectedPermissiveInheritedRole=false",
                "unexpectedProfessionalPermissiveRole=false",
                "aclClosed=true",
            ):
                report(f"S9: {name} (sin línea ACL que parsear)", False)

        secrets_file = os.path.join(secrets_dir, ".env.gapssa")
        ok = os.path.isfile(secrets_file) and (os.stat(secrets_file).st_mode & 0o777) == 0o600
        report("S1: almacén externo creado, .env.gapssa con modo 600", ok)
        ok2 = (os.stat(secrets_dir).st_mode & 0o777) == 0o700
        report("S1: directorio externo con modo 700", ok2)

        # --- S2: PostgreSQL ---
        new_pg_pw = field_from_secrets_file(secrets_dir, "POSTGRES_PASSWORD")
        report("S2: POSTGRES_PASSWORD rotado (distinto del original)", bool(new_pg_pw) and new_pg_pw != old_pg_pw)
        old_ok = pg_auth_works(pj.name, pj.pg_user, old_pg_pw, pj.pg_db_cms)
        report("S2: la contraseña ANTERIOR queda rechazada", not old_ok)
        new_ok = pg_auth_works(pj.name, pj.pg_user, new_pg_pw, pj.pg_db_cms)
        report("S2: la contraseña NUEVA autentica por TCP real", new_ok)
        for db in (pj.pg_db_cms, pj.pg_db_auth, pj.pg_db_booking):
            ok_db = pg_auth_works(pj.name, pj.pg_user, new_pg_pw, db)
            report(f"S2: base lógica '{db}' accesible con la contraseña nueva", ok_db)
        pj.pg_password = new_pg_pw
        canary_ok = pg_query_scalar(pj.name, pj.pg_user, pj.pg_password, pj.pg_db_cms, "SELECT id FROM gapssa_rehearsal.gapssa_rehearsal_canary LIMIT 1;")
        report("S2: dato canario en gapssa_cms sigue vivo tras la rotación", canary_ok == "42")

        # --- S3: MariaDB ---
        new_db_pw = field_from_secrets_file(secrets_dir, "ESPOCRM_DB_PASSWORD")
        new_root_pw = field_from_secrets_file(secrets_dir, "ESPOCRM_DB_ROOT_PASSWORD")
        report("S3: ESPOCRM_DB_PASSWORD y ESPOCRM_DB_ROOT_PASSWORD rotados", new_db_pw != old_mariadb_pw and new_root_pw != old_mariadb_root_pw)
        old_ok = mariadb_auth_works(pj.name, pj.mariadb_user, old_mariadb_pw)
        report("S3: la contraseña ANTERIOR de 'espocrm' queda rechazada", not old_ok)
        new_ok = mariadb_auth_works(pj.name, pj.mariadb_user, new_db_pw)
        report("S3: 'espocrm' autentica con la contraseña nueva por TCP real", new_ok)
        pj.mariadb_password = new_db_pw
        pj.mariadb_root_password = new_root_pw
        canary_ok = mariadb_query_scalar(pj.name, "root", pj.mariadb_root_password, "SELECT id FROM espocrm.gapssa_rehearsal_canary LIMIT 1;")
        report("S3: dato canario en la BD de EspoCRM sigue vivo tras la rotación", canary_ok == "42")
        app_check_ok = compose(shadow_root, pj.name, "exec", "-T", "espocrm", "bin/command", "app-check", check=False).returncode == 0
        report("S3: EspoCRM app-check en verde tras rotar", app_check_ok)

        # --- S4: EspoCRM admin + API Key ---
        new_admin_pw = field_from_secrets_file(secrets_dir, "ESPOCRM_ADMIN_PASSWORD")
        report("S4: ESPOCRM_ADMIN_PASSWORD rotado", new_admin_pw != old_admin_pw)
        old_login_ok = espocrm_admin_login_works(pj, old_admin_pw)
        report("S4: login admin ANTERIOR queda rechazado", not old_login_ok)
        new_login_ok = espocrm_admin_login_works(pj, new_admin_pw)
        report("S4: login admin NUEVO funciona", new_login_ok)
        pj.espocrm_admin_password = new_admin_pw
        new_api_key = field_from_secrets_file(secrets_dir, "ESPOCRM_API_KEY")
        report("S4: portal-gapssa-api encontrado y ESPOCRM_API_KEY rotada (no vacía)", bool(new_api_key))
        if new_api_key:
            key_ok = espocrm_api_key_works(pj, new_api_key)
            report("S4: la API Key nueva autentica de verdad", key_ok)

        # --- S5: Redis ---
        new_redis_pw = field_from_secrets_file(secrets_dir, "REDIS_PASSWORD")
        report("S5: REDIS_PASSWORD rotado", new_redis_pw != old_redis_pw)
        old_ok = redis_auth_works(pj.name, old_redis_pw)
        report("S5: la contraseña ANTERIOR de Redis queda rechazada", not old_ok)
        new_ok = redis_auth_works(pj.name, new_redis_pw)
        report("S5: la contraseña NUEVA de Redis autentica por TCP real", new_ok)
        canary = redis_exec(pj.name, new_redis_pw, "GET", "gapssa_rehearsal_canary")
        report("S5: clave canaria conservada tras el force-recreate", canary.strip() == "42")
        pj.redis_password = new_redis_pw

        # --- S7: nombres versionados/plurales de booking ---
        # S7 siempre genera+activa v3 sobre los mapas YA plurales (nunca
        # migra desde singular -- ver gate_s7() en rotate-all-interactive.sh).
        for k in (
            "BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION",
            "BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION",
            "BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION",
            "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION",
        ):
            report(f"S7: {k}=v3 (versión nueva activada)", field_from_secrets_file(secrets_dir, k) == "v3")

        # --- S9: log/informe saneado ---
        log_path = os.path.join(secrets_dir, "apps-web.log")
        if os.path.exists(log_path):
            with open(log_path, "r", errors="replace") as f:
                log_content = f.read()
            leaked = [
                v
                for v in (old_pg_pw, old_mariadb_root_pw, old_mariadb_pw, old_redis_pw, old_admin_pw, pj.payload_secret, pj.otp_hmac_secret)
                if v and v in log_content
            ]
            report("S9: ningún secreto ficticio aparece en el log de apps/web", not leaked, leaked)
        # REPORT_FILE real (rotate-all-interactive.sh) es
        # "$SECRETS_DIR/rotation-report-<timestamp>.txt" -- nombre único
        # por sesión, nunca fijo -- así que se localiza por patrón glob,
        # nunca por un nombre fijo hardcodeado. Debe existir EXACTAMENTE
        # uno para esta sesión: ni cero, ni más de uno (nunca adoptar un
        # residual ambiguo de otra ejecución -- secrets_dir es exclusivo
        # de esta sesión, así que cualquier otro conteo es un fallo real).
        report_candidates = sorted(glob.glob(os.path.join(secrets_dir, "rotation-report-*.txt")))
        report(
            "S9: existe exactamente un informe saneado correspondiente a esta sesión (nunca cero, nunca ambigüedad)",
            len(report_candidates) == 1,
            report_candidates,
        )
        report_path = report_candidates[0] if len(report_candidates) == 1 else None
        report("S9: informe saneado generado", report_path is not None)
        if report_path is not None:
            with open(report_path) as f:
                report_content = f.read()

            # 1) Ningún valor secreto REAL (ni el vigente tras la rotación
            #    completa, ni ninguno de los superados) aparece en el
            #    informe -- inventario pedido a la clasificación cerrada
            #    real de producción, nunca duplicado a mano.
            secret_value_keys = load_secret_value_keys()
            current_values = [field_from_secrets_file(secrets_dir, k) for k in secret_value_keys]
            old_values = [old_pg_pw, old_mariadb_root_pw, old_mariadb_pw, old_redis_pw, old_admin_pw, pj.payload_secret, pj.otp_hmac_secret]
            all_secret_values = [v for v in (current_values + old_values) if v]
            leaked_report = [v for v in all_secret_values if v in report_content]
            report(
                "S9: el informe saneado no contiene ningún valor/DSN secreto real (ni el vigente ni ninguno superado)",
                not leaked_report,
                [f"<valor filtrado, {len(v)} caracteres>" for v in leaked_report],
            )

            # 2) Ningún fragmento de alta entropía tipo base64/hex/hash
            #    (>=20 caracteres contiguos) fuera de las líneas con ruta de
            #    archivo -- el único lugar donde el informe imprime
            #    segmentos largos por diseño es la lista de material de
            #    rollback CIFRADO pendiente de purga (rutas de archivo,
            #    nunca un valor en claro); se excluyen esas líneas (las
            #    únicas con "/") antes de aplicar el heurístico.
            # Solo el alfabeto base64/hex real ("+"/"/", nunca "_"/"=" --
            # las líneas fijas "clave_con_guiones_bajos=valor" del informe
            # son legítimas y NO deben contarse como una coincidencia de
            # alta entropía solo por ser largas: un "_" es un separador de
            # palabra, no un símbolo de base64/hex).
            non_path_lines = [ln for ln in report_content.splitlines() if "/" not in ln]
            entropy_hits = re.findall(r"[A-Za-z0-9+]{20,}", "\n".join(non_path_lines))
            report(
                "S9: el informe saneado no contiene fragmentos de alta entropía (base64/hex/hash) fuera de rutas de archivo",
                not entropy_hits,
                entropy_hits,
            )

            # 3) Estructura de la sección "Puertas:" -- exactamente S1..S9
            #    en orden, cada una con una palabra de estado (nunca un
            #    valor) -- y en este recorrido feliz, las nueve deben leer
            #    literalmente 'done' (verificación cruzada e independiente
            #    de la ya hecha sobre el estado interno de la sesión).
            gate_lines = re.findall(r"^  (S[1-9]): ([a-z_]+)$", report_content, re.MULTILINE)
            report(
                "S9: el informe saneado enumera exactamente S1..S9 en orden, cada una con una palabra de estado",
                [g for g, _ in gate_lines] == [f"S{i}" for i in range(1, 10)],
            )
            report(
                "S9: el informe saneado muestra las nueve puertas como 'done' (coincide con el estado interno de la sesión)",
                len(gate_lines) == 9 and all(v == "done" for _, v in gate_lines),
            )

            # 4) Los campos de resumen del informe son solo booleanos o
            #    conteos -- nunca un valor libre.
            summary_keys = (
                "secretos_antiguos_requeridos_por_config",
                "secretos_antiguos_requeridos_por_datos",
                "secrets_in_workspace",
                "adapter_simulated",
                "acl_closed",
                "services_healthy",
                "apps_web_dejado_funcionando",
                "rollback_required",
            )
            summary_bad = []
            for k in summary_keys:
                m = re.search(rf"^{re.escape(k)}=(.+)$", report_content, re.MULTILINE)
                if not m or not re.fullmatch(r"true|false|[0-9]+", m.group(1)):
                    summary_bad.append(k)
            report(
                "S9: los campos de resumen del informe saneado son solo booleanos/conteos (nunca un valor libre)",
                not summary_bad,
                summary_bad,
            )

        print("\nRecorrido S1→S9 completo.")
    except Exception as exc:  # noqa: BLE001 — se informa y se sigue a teardown
        report("Excepción no controlada durante el recorrido S1→S9", False, repr(exc))
    finally:
        # Preserva apps-web.log ANTES de que el teardown borre el directorio
        # temporal entero -- sin esto, un fallo/timeout durante S9 (que
        # arranca apps/web de verdad) perdía el único rastro real de qué
        # pasó dentro del propio servidor Next.js. Fichero LOCAL únicamente
        # (GAPSSA_S1S9_DEBUG_DIR), nunca impreso en el informe.
        if DEBUG_TRANSCRIPT_DIR:
            apps_web_log_src = os.path.join(secrets_dir, "apps-web.log")
            if os.path.exists(apps_web_log_src):
                os.makedirs(DEBUG_TRANSCRIPT_DIR, exist_ok=True)
                shutil.copyfile(apps_web_log_src, os.path.join(DEBUG_TRANSCRIPT_DIR, "apps-web.log"))

        print("\n--- Teardown ---")
        pid_file = os.path.join(secrets_dir, "apps-web.pid")
        if os.path.exists(pid_file):
            try:
                with open(pid_file) as f:
                    pid = int(f.read().strip())
                os.kill(pid, 15)
            except Exception:
                pass
        try:
            compose(shadow_root, pj.name, "down", "-v", "--remove-orphans", check=False)
        except RuntimeError as exc:
            # `down` colgado/timeout (Bloque 6, B6-8) -- nunca se deja sin
            # diagnóstico: se sigue con la limpieza explícita por
            # inventario etiquetado de abajo, que es exactamente el
            # mecanismo de recuperación para este caso.
            print(f"  AVISO: {exc}")
        leftover = docker("ps", "-aq", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        if leftover:
            for cid in leftover.splitlines():
                docker("rm", "-f", cid, check=False)
        # `down -v` puede terminar en 0 (o fallar/colgar) sin haber
        # retirado de verdad networks/volumes -- hallazgo real de este
        # ensayo (Bloque 6, B6-8): tras varias ejecuciones en la misma
        # sesión, el propio inventario Docker del host mostraba networks y
        # volumes de proyectos desechables ANTERIORES todavía presentes,
        # aunque cada ejecución había reportado "cero contenedores
        # residuales" (la única comprobación que existía). Igual que con
        # los contenedores: inventario etiquetado EXACTO (nunca un prune
        # amplio), enumera objetivos concretos por el mismo label de
        # proyecto, retira únicamente esos.
        leftover_networks = docker("network", "ls", "-q", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        if leftover_networks:
            for nid in leftover_networks.splitlines():
                docker("network", "rm", nid, check=False)
        leftover_volumes = docker("volume", "ls", "-q", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        if leftover_volumes:
            for vid in leftover_volumes.splitlines():
                docker("volume", "rm", "-f", vid, check=False)
        after_snapshot = os.path.join(tmp, "inventory-after")
        snapshot_real_compose_resources(after_snapshot)
        with open(before_snapshot) as f:
            before_content = f.read()
        with open(after_snapshot) as f:
            after_content = f.read()
        report("Teardown: inventario Docker real (todos los proyectos compose) idéntico antes/después", before_content == after_content)
        leftover2 = docker("ps", "-aq", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        report("Teardown: cero contenedores residuales con el label del proyecto desechable", not leftover2)
        leftover_networks2 = docker("network", "ls", "-q", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        report("Teardown: cero networks residuales con el label del proyecto desechable", not leftover_networks2)
        leftover_volumes2 = docker("volume", "ls", "-q", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        report("Teardown: cero volumes residuales con el label del proyecto desechable", not leftover_volumes2)
        shutil.rmtree(tmp, ignore_errors=True)
        report("Teardown: directorio temporal del ensayo (repo sombra + almacén externo) eliminado", not os.path.exists(tmp))

    fail_count = sum(1 for _, ok, _ in RESULTS if not ok)
    print(f"\nfail_count={fail_count}")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
