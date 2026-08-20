#!/usr/bin/env python3
"""Scenario tests for rotate-all-interactive.sh — drives the REAL script
(copied into an isolated fixture tree) through a real pseudo-terminal,
with fake docker/curl/npx on PATH ahead of the real ones. Never touches
real Docker, Postgres, MariaDB, Redis, EspoCRM, or the real .env/HOME.

Usage: python3 run_scenarios.py
Exit code 0 = every scenario passed, 1 = at least one failed.
"""
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
import time

shlexquote = shlex.quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_driver import PtyProcess  # noqa: E402

REAL_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SECRETS_ROTATION_DIR = os.path.dirname(REAL_SCRIPT_DIR)
REAL_REPO_ROOT = os.path.dirname(os.path.dirname(SECRETS_ROTATION_DIR))
FAKE_BIN = os.path.join(REAL_SCRIPT_DIR, "fake-bin")

RESULTS = []


def report(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    status = "ok  " if ok else "FAIL"
    print(f"{status} - {name}")
    if not ok and detail:
        print(textwrap.indent(detail, "        "))


FIXTURE_ENV = {
    "COMPOSE_PROJECT_NAME": "gapssafixture",
    "POSTGRES_USER": "gapssa_apps",
    "POSTGRES_DB": "gapssa_cms",
    "POSTGRES_IMAGE": "postgres:18-alpine",
    "POSTGRES_PASSWORD": "fixture-initial-pg-password-000",
    "DATABASE_URL_AUTH": "postgresql://gapssa_apps:fixture-initial-pg-password-000@localhost:5433/gapssa_auth",
    "DATABASE_URL_BOOKING": "postgresql://gapssa_apps:fixture-initial-pg-password-000@localhost:5433/gapssa_booking",
    "DATABASE_URL_CMS": "postgresql://gapssa_apps:fixture-initial-pg-password-000@localhost:5433/gapssa_cms",
    "ESPOCRM_DB_IMAGE": "mariadb:11.4",
    "ESPOCRM_DB_NAME": "espocrm",
    "ESPOCRM_DB_USER": "espocrm",
    "ESPOCRM_DB_PASSWORD": "fixture-initial-espocrm-db-pw",
    "ESPOCRM_DB_ROOT_PASSWORD": "fixture-initial-root-pw",
    "ESPOCRM_ADMIN_USERNAME": "admin",
    "ESPOCRM_ADMIN_PASSWORD": "fixture-initial-admin-pw",
    "ESPOCRM_HTTP_PORT": "18081",
    "ESPOCRM_API_KEY": "fixture-initial-api-key",
    "REDIS_PASSWORD": "fixture-initial-redis-pw",
    "REDIS_URL": "redis://:fixture-initial-redis-pw@localhost:6380",
    "PAYLOAD_SECRET": "fixture-initial-payload-secret-000000000000",
    "OTP_HMAC_SECRET": "fixture-initial-otp-secret-00000000000000000",
    "AUTH_RATE_LIMIT_HMAC_SECRET": "fixture-initial-ratelimit-secret-0000000000",
    "BOOKING_FIELD_ENCRYPTION_KEYS": '{"v1":"Zml4dHVyZS1pbml0aWFsLWFlcy1rZXktMDAwMDAwMDA="}',
    "BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION": "v1",
    "BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS": '{"v1":"Zml4dHVyZS1pbml0aWFsLWZwLWtleS0wMDAwMDAwMDA="}',
    "BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION": "v1",
    # BLOQUE 6 (corrección sobre BLOQUE 2): current_secrets_schema_version()
    # (rotate-all-interactive.sh) YA NO infiere la versión de si S7 ya
    # corrió en esta sesión -- delega en
    # lib/detectSecretsSchemaVersion.mjs, que inspecciona el CONTENIDO
    # real del archivo (gate_s7() nunca migra singular->plural, solo
    # activa una v3 nueva sobre mapas YA plurales, así que basarse en el
    # estado de S7 podía quedar permanentemente desincronizado del
    # contenido real -- hallazgo del ensayo integral). Este fixture usa
    # a propósito los nombres SINGULARES de booking-email/access-token,
    # así que current_secrets_schema_version() evalúa a "legacy-pre-s7"
    # por ESE contenido -- y ESE esquema exige, precisamente, esos
    # nombres singulares (los plurales/versionados son exclusivos de
    # "active" y se rechazarían aquí como mezcla legacy/active). Si
    # algún escenario futuro necesita representar un estado "active",
    # debe construir su propio fixture (write_active_env_file) en vez de
    # mutar este.
    "BOOKING_EMAIL_LOOKUP_HMAC_SECRET": "fixture-initial-email-hmac-secret-000000000",
    "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET": "fixture-initial-access-token-secret-0000000",
    "BOOKING_INTERNAL_API_SECRET": "fixture-initial-internal-api-secret-00000000",
    "ESPO_BOOKING_ADAPTER": "simulated",
}


def write_env_file(path):
    with open(path, "w", encoding="utf-8") as f:
        for k, v in FIXTURE_ENV.items():
            f.write(f"{k}={v}\n")


def write_active_env_file(path):
    """Como write_env_file, pero con los 2 secretos de booking en su
    forma PLURAL/versionada ("active") en vez de la singular legacy que
    usa FIXTURE_ENV por defecto (necesaria para scenario_backup_schema_tagging,
    que empieza deliberadamente en formato legacy-pre-s7). Necesaria para
    cualquier escenario que invoque scripts/secrets-rotation/lib/loadSecretsEnv.mjs
    de verdad (BLOQUE 3: cualquier sonda real de S6/S7 vía run-tsx.mjs) —
    su SECRETS_FILE_KEY_INVENTORY closed-list solo conoce los nombres
    "active", nunca los legacy singulares (igual que un $SECRETS_FILE
    real recién creado por S1 a partir de .env.example, que ya nace en
    formato "active")."""
    active = dict(FIXTURE_ENV)
    active.pop("BOOKING_EMAIL_LOOKUP_HMAC_SECRET", None)
    active.pop("BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET", None)
    active["BOOKING_EMAIL_LOOKUP_HMAC_SECRETS"] = '{"v1":"Zml4dHVyZS1pbml0aWFsLWVtYWlsLWhtYWMtMDAwMDAwMDA="}'
    active["BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION"] = "v1"
    active["BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS"] = '{"v1":"Zml4dHVyZS1pbml0aWFsLWF0LWtleS0wMDAwMDAwMDAwMA=="}'
    active["BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION"] = "v1"
    with open(path, "w", encoding="utf-8") as f:
        for k, v in active.items():
            f.write(f"{k}={v}\n")


def build_fixture_repo(root):
    """Copia scripts/secrets-rotation/*.sh + lib*.sh a $root/scripts/secrets-rotation
    (para que REPO_ROOT del script bajo prueba resuelva a $root) y crea un
    .env de fixture (valores obviamente falsos, nunca reales)."""
    dest_sr = os.path.join(root, "scripts", "secrets-rotation")
    os.makedirs(dest_sr, exist_ok=True)
    for name in ("rotate-all-interactive.sh", "01-init-external-store.sh", "02-generate-secret.sh", "lib.sh"):
        shutil.copy2(os.path.join(SECRETS_ROTATION_DIR, name), os.path.join(dest_sr, name))
        os.chmod(os.path.join(dest_sr, name), 0o755)
    # BLOQUE 2: rotate-all-interactive.sh invoca `node "$SCRIPT_DIR/lib/*.mjs"`
    # (digestStream/extractEnvValueFromStdin/writeRestorePayload/fsyncPath) —
    # sin copiar lib/ aquí, esas llamadas fallarían dentro del árbol fixture
    # (que resuelve $SCRIPT_DIR a esta copia, no al repositorio real).
    src_lib = os.path.join(SECRETS_ROTATION_DIR, "lib")
    dest_lib = os.path.join(dest_sr, "lib")
    if os.path.isdir(dest_lib):
        shutil.rmtree(dest_lib)
    shutil.copytree(src_lib, dest_lib)
    # BLOQUE 3: rotate-all-interactive.sh invoca las sondas permanentes
    # bajo probes/ — sin copiarlas aquí, gate_s6()/gate_s7() fallarían
    # "script permanente ausente" en CUALQUIER escenario que las alcance.
    src_probes = os.path.join(SECRETS_ROTATION_DIR, "probes")
    dest_probes = os.path.join(dest_sr, "probes")
    if os.path.isdir(dest_probes):
        shutil.rmtree(dest_probes)
    shutil.copytree(src_probes, dest_probes)
    os.makedirs(os.path.join(root, "apps", "web"), exist_ok=True)
    write_env_file(os.path.join(root, ".env"))
    link_real_node_modules(root)
    return dest_sr


def link_real_node_modules(root):
    """Symlink de node_modules/ REAL (tsx ya instalado) dentro del
    fixture — nunca Docker/Postgres/Redis reales, solo la herramienta de
    build que el propio checkout ya trae instalada, exactamente igual
    que el arnés ya asume disponibles bash/python3/openssl del sistema.
    Sin esto, run-tsx.mjs fallaría cerrado (por diseño, nunca `npx`) en
    cualquier escenario que invoque una sonda real de S6/S7."""
    real_node_modules = os.path.join(REAL_REPO_ROOT, "node_modules")
    dest = os.path.join(root, "node_modules")
    if os.path.isdir(real_node_modules) and not os.path.exists(dest):
        os.symlink(real_node_modules, dest)


def seed_rotation_status(secrets_dir, gate, state):
    """Escribe `.rotation-status` a mano con GATE=STATE — mismo formato
    literal que gapssa_secrets_state_set (lib.sh) ya produce."""
    os.makedirs(secrets_dir, exist_ok=True)
    os.chmod(secrets_dir, 0o700)
    status_file = os.path.join(secrets_dir, ".rotation-status")
    with open(status_file, "w", encoding="utf-8") as f:
        f.write(f"{gate}={state}\n")
    os.chmod(status_file, 0o600)
    return status_file


def plant_s6_artifact(secrets_dir, *, valid=True):
    """Escribe a mano un artefacto de S6 en $SECRETS_DIR/tmp/s6-otp-probe.json
    — mismo esquema cerrado que secureArtifact.mts exige (schemaVersion=1,
    claves exactas subjectRef/code/payloadJwt). `valid=False` añade un
    campo adicional no permitido, para que inspectArtifact lo rechace
    como 'invalid' sin tocarlo."""
    tmp_dir = os.path.join(secrets_dir, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    os.chmod(tmp_dir, 0o700)
    artifact_path = os.path.join(tmp_dir, "s6-otp-probe.json")
    payload = {
        "schemaVersion": 1,
        "subjectRef": "s6-fixture-test:0000000000",
        "code": "000000",
        "payloadJwt": "aGVhZGVy.Ym9keQ.c2ln",
    }
    if not valid:
        payload["extraField"] = "campo-no-permitido"
    with open(artifact_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(payload))
    os.chmod(artifact_path, 0o600)
    return artifact_path


def seed_docker_state(state_dir):
    os.makedirs(state_dir, exist_ok=True)

    def put(name, value):
        with open(os.path.join(state_dir, name), "w", encoding="utf-8") as f:
            f.write(value)

    put("pg_password", FIXTURE_ENV["POSTGRES_PASSWORD"])
    put("mariadb_pw_root", FIXTURE_ENV["ESPOCRM_DB_ROOT_PASSWORD"])
    put("mariadb_pw_espocrm", FIXTURE_ENV["ESPOCRM_DB_PASSWORD"])
    put("redis_password", FIXTURE_ENV["REDIS_PASSWORD"])
    put("espocrm_admin_pw_admin", FIXTURE_ENV["ESPOCRM_ADMIN_PASSWORD"])
    put("espocrm_api_key", FIXTURE_ENV["ESPOCRM_API_KEY"])


def base_env(fixture_home, secrets_dir, docker_state, transcript_path):
    env = dict(os.environ)
    env["HOME"] = fixture_home
    env["GAPSSA_SECRETS_DIR"] = secrets_dir
    env["ROTACION_GAPSSA_FUERA_DEL_HARNESS"] = "SI"
    env["PATH"] = FAKE_BIN + os.pathsep + env["PATH"]
    env["FAKE_DOCKER_STATE"] = docker_state
    env["FAKE_DOCKER_TRANSCRIPT"] = transcript_path
    # Vaciar cualquier variable sospechosa heredada de esta propia sesión de
    # pruebas (que corre, irónicamente, dentro de Claude Code) — si no se
    # limpian aquí, la guardia de la capa 2 rechazaría el proceso hijo.
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


def read_transcript(path):
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def assert_no_secret_in_transcript(transcript, secrets, label):
    leaked = [s for s in secrets if s and s in transcript]
    if leaked:
        report(label, False, f"valores secretos aparecieron en el transcript de argv: {leaked!r}")
        return False
    report(label, True)
    return True


def respond_to_backup_passphrase_prompt(p):
    """La PRIMERA puerta de cada proceso que crea un backup real dispara
    ensure_backup_passphrase_known() (rotate-all-interactive.sh) — elige
    "generar una frase aleatoria" (recomendado) y pulsa Enter tras verla,
    una vez por proceso (procesos posteriores del mismo test reutilizan
    $BACKUP_PASSPHRASE ya fijada, sin volver a preguntar)."""
    p.expect(r"\¿Generar una frase aleatoria segura ahora \(recomendado\)\?")
    p.expect(r"\[si/no/salir\]")
    p.send_line("si")
    p.expect(r"Pulsa Enter cuando lo hayas hecho")
    p.send_line("")


# ---------------------------------------------------------------------------
# Escenario 1 — S1 solo: crea el almacén, copia .env, marca 'done'.
# ---------------------------------------------------------------------------
def scenario_s1_only():
    name = "Escenario S1 solo: crea almacén externo y copia .env"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s1-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")

        env = base_env(home, secrets_dir, state, transcript)
        p = PtyProcess(
            ["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"],
            env=env,
            cwd=repo,
        )
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"Puerta S1")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return

        ok = True
        secrets_file = os.path.join(secrets_dir, ".env.gapssa")
        status_file = os.path.join(secrets_dir, ".rotation-status")
        if not os.path.isfile(secrets_file):
            report(name + " — crea .env.gapssa", False, "no existe")
            ok = False
        else:
            mode = stat.S_IMODE(os.stat(secrets_file).st_mode)
            if mode != 0o600:
                report(name + " — modo 600", False, f"modo real={oct(mode)}")
                ok = False
        dir_mode = stat.S_IMODE(os.stat(secrets_dir).st_mode)
        if dir_mode != 0o700:
            report(name + " — dir modo 700", False, f"modo real={oct(dir_mode)}")
            ok = False
        if os.path.isfile(status_file):
            with open(status_file) as f:
                content = f.read()
            if "S1=done" not in content:
                report(name + " — estado S1=done", False, content)
                ok = False
        else:
            report(name + " — archivo de estado existe", False, "no existe")
            ok = False
        if ok:
            report(name, True)
        p.close()


# ---------------------------------------------------------------------------
# Escenario 2 — S1+S2: rota Postgres de verdad (contra el docker falso),
# confirma que la anterior queda rechazada y que ningún secreto aparece en
# argv de docker.
# ---------------------------------------------------------------------------
def scenario_s1_s2_rotate_postgres():
    name = "Escenario S1+S2: rota POSTGRES_PASSWORD, anterior queda rechazada, sin secretos en argv"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s2-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)

        env = base_env(home, secrets_dir, state, transcript)
        p = PtyProcess(
            ["bash", os.path.join(sr_dir, "rotate-all-interactive.sh")],
            env=env,
            cwd=repo,
        )
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            # S1
            p.expect(r"Puerta S1")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            # S2
            p.expect(r"Puerta S2")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            respond_to_backup_passphrase_prompt(p)
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"Puerta S2 completada")
            # S3 — decline (no queremos avanzar más en este escenario)
            p.expect(r"Puerta S3")
            p.expect(r"\[si/no/salir\]")
            p.send_line("salir")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return

        secrets_file = os.path.join(secrets_dir, ".env.gapssa")
        new_pw = None
        if os.path.isfile(secrets_file):
            with open(secrets_file) as f:
                for line in f:
                    if line.startswith("POSTGRES_PASSWORD="):
                        new_pw = line.strip().split("=", 1)[1]
        ok = True
        if not new_pw or new_pw == FIXTURE_ENV["POSTGRES_PASSWORD"]:
            report(name + " — POSTGRES_PASSWORD cambió", False, f"valor nuevo={new_pw!r}")
            ok = False
        else:
            report(name + " — POSTGRES_PASSWORD cambió", True)

        transcript_text = read_transcript(transcript)
        if not assert_no_secret_in_transcript(
            transcript_text, [FIXTURE_ENV["POSTGRES_PASSWORD"], new_pw], name + " — ningún secreto en argv de docker"
        ):
            ok = False

        status_file = os.path.join(secrets_dir, ".rotation-status")
        if os.path.isfile(status_file):
            with open(status_file) as f:
                content = f.read()
            if "S2=done" not in content:
                report(name + " — estado S2=done", False, content)
                ok = False
            else:
                report(name + " — estado S2=done", True)
        if ok:
            report(name, True)
        p.close()


# ---------------------------------------------------------------------------
# Escenario 3 — Ctrl-C durante S2: la puerta debe quedar 'rollback_required',
# nunca 'done' ni silenciosamente 'pending'.
# ---------------------------------------------------------------------------
def scenario_ctrl_c_mid_gate():
    name = "Escenario Ctrl-C durante S2: estado queda 'rollback_required'"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-sigint-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)

        env = base_env(home, secrets_dir, state, transcript)
        p = PtyProcess(
            ["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"],
            env=env,
            cwd=repo,
        )
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"Puerta S1")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        # Segunda invocación: entra en S2 y la interrumpimos a mitad con
        # Ctrl-C justo después de confirmar la puerta (en applying/verifying).
        p2 = PtyProcess(
            ["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S2"],
            env=env,
            cwd=repo,
        )
        try:
            p2.expect("Escribe exactamente")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"Puerta S2")
            p2.expect(r"\[si/no/salir\]")
            p2.send_line("si")
            respond_to_backup_passphrase_prompt(p2)
            # enter_gate("S2") ya corrió para este punto (state=applying,
            # backup ya tomado) — 02-generate-secret.sh vuelve a pedir la
            # frase de confirmación y se queda BLOQUEADO esperándola. Es un
            # punto de interrupción determinista: interrumpimos aquí, sin
            # responder, garantizando que el estado real en ese instante es
            # 'applying', nunca 'pending' ni 'done'.
            p2.expect("confirmo fuera de claude code")
            p2.sigint()
            p2.wait(timeout=10)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p2.close()
            return
        p2.close()

        status_file = os.path.join(secrets_dir, ".rotation-status")
        ok = True
        if os.path.isfile(status_file):
            with open(status_file) as f:
                content = f.read()
            if "S2=rollback_required" not in content and "S2=done" not in content:
                # Aceptamos también S2=done si la interrupción llegó ya tarde
                # (después de completar) — lo único inaceptable es quedar
                # silenciosamente en 'applying' o volver a 'pending'.
                report(name, False, f"estado inesperado tras Ctrl-C: {content}")
                ok = False
            elif "S2=applying" in content:
                report(name, False, f"quedó en 'applying' sin resolver tras Ctrl-C: {content}")
                ok = False
            else:
                report(name, True, f"estado final: {content.strip()}")
        else:
            report(name, False, "no existe archivo de estado")
            ok = False


# ---------------------------------------------------------------------------
# Escenario 4 — resumibilidad: re-ejecutar tras Ctrl-C detecta
# 'rollback_required' y ofrece restaurar, sin perder el trabajo previo.
# ---------------------------------------------------------------------------
def scenario_resume_after_interrupt():
    name = "Escenario reanudación: relanzar tras interrupción detecta 'rollback_required' y ofrece restaurar"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-resume-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación)", False, str(exc))
            p.close()
            return
        p.close()

        os.makedirs(os.path.join(secrets_dir), exist_ok=True)
        with open(os.path.join(secrets_dir, ".rotation-status"), "a") as f:
            f.write("S2=rollback_required\n")

        p2 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S2"], env=env, cwd=repo)
        try:
            p2.expect("Escribe exactamente")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"rollback_required")
            p2.expect(r"\[si/no/salir\]")
            p2.send_line("no")  # no intentar restaurar (no hay backup real en este escenario)
            p2.expect(r"\[si/no/salir\]")
            p2.send_line("salir")
            p2.wait(timeout=10)
            report(name, True)
        except TimeoutError as exc:
            report(name, False, str(exc))
        p2.close()


# ---------------------------------------------------------------------------
# Escenario 5 — HOME con espacios.
# ---------------------------------------------------------------------------
def scenario_home_with_spaces():
    name = "Escenario HOME con espacios en la ruta: S1 funciona igual"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-spaces-") as tmp:
        repo = os.path.join(tmp, "repo with spaces")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home with spaces")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")

        env = base_env(home, secrets_dir, state, transcript)
        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        p.close()

        ok = os.path.isfile(os.path.join(secrets_dir, ".env.gapssa"))
        report(name, ok, "" if ok else "no se creó .env.gapssa bajo un HOME con espacios")


# ---------------------------------------------------------------------------
# Escenario 6 — --only con puerta desconocida sale con error, sin ejecutar nada.
# ---------------------------------------------------------------------------
def scenario_unknown_gate():
    name = "Escenario --only con puerta desconocida: sale con error"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-unknown-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        env = base_env(home, secrets_dir, state, transcript)
        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S99"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            rc = p.wait(timeout=10)
            report(name, rc != 0, f"exit code={rc}")
        except TimeoutError as exc:
            report(name, False, str(exc))
        p.close()


# ---------------------------------------------------------------------------
# Escenario Bloque 5 — S9 rechaza el nuevo estado 'forward_recovery_required'
# exactamente igual que cualquier otro estado no-'done' — nunca lo confunde
# con una rotación completa solo porque el archivo y el servidor quedaron
# coordinados con un valor NUEVO (en vez de uno antiguo).
# ---------------------------------------------------------------------------
def scenario_s9_rejects_forward_recovery_required():
    name = "Escenario S9 (Bloque 5): rechaza 'forward_recovery_required' igual que cualquier estado de recuperación"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s9-forward-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        os.makedirs(secrets_dir, exist_ok=True)
        os.chmod(secrets_dir, 0o700)
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        env = base_env(home, secrets_dir, state, transcript)

        status_file = os.path.join(secrets_dir, ".rotation-status")
        with open(status_file, "w", encoding="utf-8") as f:
            for gate, gate_state in [("S1", "done"), ("S2", "done"), ("S3", "done"), ("S4", "forward_recovery_required"), ("S5", "done"), ("S6", "done"), ("S7", "done"), ("S8", "done")]:
                f.write(f"{gate}={gate_state}\n")
        os.chmod(status_file, 0o600)

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S9"], env=env, cwd=repo)
        ok = True
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"BLOQUEADO: faltan puertas por completar")
            rc = p.wait(timeout=10)
            if rc == 0:
                report(name + " — código de salida no-cero", False, f"exit code={rc}")
                ok = False
            else:
                report(name + " — código de salida no-cero", True)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        p.close()

        with open(status_file) as f:
            content = f.read()
        if "S9=done" in content:
            report(name + " — S9 nunca queda 'done' con S4 en forward_recovery_required", False, content)
            ok = False
        else:
            report(name + " — S9 nunca queda 'done' con S4 en forward_recovery_required", True)
        if "S4=forward_recovery_required" not in content:
            report(name + " — el estado de S4 no se tocó (S9 nunca lo reescribe al bloquear)", False, content)
            ok = False
        else:
            report(name + " — el estado de S4 no se tocó (S9 nunca lo reescribe al bloquear)", True)
        if ok:
            report(name, True)


# ---------------------------------------------------------------------------
# Escenario Bloque 5 — S3: divergencia REAL entre archivo y servidor tras
# restaurar (a diferencia del escenario de arriba, aquí SÍ se fuerza que el
# servidor "ya tenga" una credencial distinta a la restaurada, manipulando
# directamente el estado del docker falso entre el backup y la restauración
# — la única forma determinista de forzar esa divergencia con este arnés,
# ya que el punto de interrupción de _interrupt_gate_after_backup es
# siempre ANTES de que el propio script llegue a aplicar nada). Cubre
# ambas ramas: contraseña root declinada -> server_coordination_required;
# contraseña root proporcionada -> reconciliación real y recovery_required
# (ejercita el helper _mariadb_apply_password_via_auth de verdad, a través
# del docker falso extendido en Bloque 5).
# ---------------------------------------------------------------------------
def _run_s3_divergence_case(name_suffix, provide_root_password, expected_final_state):
    name = f"Escenario S3 (Bloque 5) divergencia real: {name_suffix}"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s3-divergence-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)
        passphrase = f"frase-divergencia-s3-{name_suffix.replace(' ', '-')[:20]}"

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        def type_root_password(p):
            p.expect(r"Contrase.a ROOT actual de MariaDB:")
            p.send_line(FIXTURE_ENV["ESPOCRM_DB_ROOT_PASSWORD"])

        try:
            _interrupt_gate_after_backup(sr_dir, env, repo, "S3", passphrase, extra_before_sigint=type_root_password)
        except TimeoutError as exc:
            report(name + " (interrupción S3)", False, str(exc))
            return

        # Simula que el ALTER USER de 'root' YA se aplicó en el servidor real
        # antes de la interrupción (el archivo, tras restaurar, seguirá
        # teniendo la contraseña ANTIGUA — divergencia real y determinista).
        # Diverge ROOT (no espocrm): es la única forma de que
        # _recovery_evidence_s3 llegue a preguntar la contraseña root —  si
        # root ya coincidiera, la reconciliación de espocrm procedería sola,
        # sin preguntar nada (root_restored_works=true ya basta como
        # credencial de autenticación).
        diverged_password = "root-pw-ya-rotada-en-servidor-antes-de-interrumpir"
        with open(os.path.join(state, "mariadb_pw_root"), "w", encoding="utf-8") as f:
            f.write(diverged_password)

        p3 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S3"], env=env, cwd=repo)
        try:
            p3.expect("Escribe exactamente")
            p3.send_line("confirmo fuera de claude code")
            p3.expect(r"rollback_required")
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("si")
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("si")
            respond_with_fixed_backup_passphrase(p3, passphrase)
            p3.expect(r"restore_atomic=true")
            p3.expect(r"Contrase.a ROOT actual de MariaDB \(Enter para omitir")
            if provide_root_password:
                # El operador debe conocer la contraseña ACTUAL del
                # servidor (la divergida), nunca la antigua que el archivo
                # restaurado ya tenía — ese es justo el punto del aviso.
                p3.send_line(diverged_password)
            else:
                p3.send_line("")
            p3.expect(rf"server_reconciliation_state={expected_final_state}")
            p3.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p3.close()
            return
        p3.close()

        ok = True
        status_file = os.path.join(secrets_dir, ".rotation-status")
        with open(status_file) as f:
            content = f.read()
        if f"S3={expected_final_state}" not in content:
            report(name + f" — estado final S3={expected_final_state}", False, content)
            ok = False
        else:
            report(name + f" — estado final S3={expected_final_state}", True)

        transcript_text = read_transcript(transcript)
        if not assert_no_secret_in_transcript(
            transcript_text,
            [FIXTURE_ENV["ESPOCRM_DB_ROOT_PASSWORD"], FIXTURE_ENV["ESPOCRM_DB_PASSWORD"], diverged_password, passphrase],
            name + " — ningún secreto (ni la contraseña root reintroducida) en argv de docker",
        ):
            ok = False

        if provide_root_password:
            # Reconciliación real: la contraseña de 'root' (restaurada en
            # el archivo) debe haber quedado reaplicada de verdad en el
            # servidor, reemplazando a la divergida.
            applied = ""
            try:
                with open(os.path.join(state, "mariadb_pw_root"), encoding="utf-8") as f:
                    applied = f.read()
            except OSError:
                pass
            if applied == FIXTURE_ENV["ESPOCRM_DB_ROOT_PASSWORD"]:
                report(name + " — la contraseña de 'root' quedó reaplicada de verdad en el servidor", True)
            else:
                report(name + " — la contraseña de 'root' quedó reaplicada de verdad en el servidor", False, f"estado final del docker falso: '{applied}'")
                ok = False

        if ok:
            report(name, True)


def scenario_s3_divergence_root_declined():
    _run_s3_divergence_case("contraseña root declinada", False, "server_coordination_required")


def scenario_s3_divergence_root_provided():
    _run_s3_divergence_case("contraseña root proporcionada -> reconciliación real", True, "recovery_required")


# ---------------------------------------------------------------------------
# Escenario Bloque 4 — S9 nunca ejecuta la verificación de ACL (ni ningún
# otro paso) mientras falte cualquier puerta anterior. No hay infraestructura
# real de Postgres/MariaDB/Redis/EspoCRM en este arnés (fake-bin/docker no
# es una base de datos real) — igual que el resto de este fichero, que
# nunca hace avanzar un escenario hasta S6-S9 real (ver comentario más
# abajo, línea ~1320), así que la prueba de extremo a extremo de la ACL
# real vive en scripts/secrets-rotation/tests/espo_acl_rehearsal.sh (REST
# real contra una instancia EspoCRM 10.0.3 desechable) — más fiel que un
# mock de curl aquí. Este escenario cubre lo que SÍ es honesto probar con
# el arnés PTY: el guardián "faltan puertas" de gate_s9 nunca se salta, y
# el helper de ACL nunca llega a ejecutarse en ese caso.
# ---------------------------------------------------------------------------
def scenario_s9_blocked_without_prior_gates():
    name = "Escenario S9: bloquea de inmediato si falta cualquier puerta anterior (nunca llega a verificar ACL)"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s9-blocked-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        env = base_env(home, secrets_dir, state, transcript)
        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S9"], env=env, cwd=repo)
        ok = True
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"BLOQUEADO: faltan puertas por completar")
            rc = p.wait(timeout=10)
            if rc == 0:
                report(name + " — código de salida no-cero", False, f"exit code={rc}")
                ok = False
            else:
                report(name + " — código de salida no-cero", True)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        p.close()

        status_file = os.path.join(secrets_dir, ".rotation-status")
        content = read_transcript(status_file) if os.path.exists(status_file) else ""
        if "S9=done" in content:
            report(name + " — S9 nunca queda 'done' sin las puertas previas", False, content)
            ok = False
        else:
            report(name + " — S9 nunca queda 'done' sin las puertas previas", True)

        transcript_text = read_transcript(transcript)
        if 'aclClosed' in transcript_text or '"portalUserPresent"' in transcript_text:
            report(name + " — nunca se invoca el helper de ACL antes de superar el guardián de puertas previas", False, "el transcript de curl/docker contiene actividad de la verificación de ACL")
            ok = False
        else:
            report(name + " — nunca se invoca el helper de ACL antes de superar el guardián de puertas previas", True)
        if ok:
            report(name, True)


def scenario_s1_s3_mariadb():
    name = "Escenario S1+S3: enumera cuentas reales, rota ambas contraseñas MariaDB, anterior rechazada"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s3-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        p2 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S3"], env=env, cwd=repo)
        try:
            p2.expect("Escribe exactamente")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"\[si/no/salir\]")
            p2.send_line("si")
            respond_to_backup_passphrase_prompt(p2)
            p2.expect(r"Contrase.a ROOT actual de MariaDB:")
            p2.send_line(FIXTURE_ENV["ESPOCRM_DB_ROOT_PASSWORD"])
            p2.expect("confirmo fuera de claude code")
            p2.send_line("confirmo fuera de claude code")
            p2.expect("confirmo fuera de claude code")
            p2.send_line("confirmo fuera de claude code")
            p2.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p2.close()
            return
        p2.close()

        secrets_file = os.path.join(secrets_dir, ".env.gapssa")
        vals = {}
        with open(secrets_file) as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    vals[k] = v

        ok = True
        if vals.get("ESPOCRM_DB_PASSWORD") == FIXTURE_ENV["ESPOCRM_DB_PASSWORD"]:
            report(name + " — ESPOCRM_DB_PASSWORD cambió", False, "no cambió")
            ok = False
        else:
            report(name + " — ESPOCRM_DB_PASSWORD cambió", True)
        if vals.get("ESPOCRM_DB_ROOT_PASSWORD") == FIXTURE_ENV["ESPOCRM_DB_ROOT_PASSWORD"]:
            report(name + " — ESPOCRM_DB_ROOT_PASSWORD cambió", False, "no cambió")
            ok = False
        else:
            report(name + " — ESPOCRM_DB_ROOT_PASSWORD cambió", True)

        transcript_text = read_transcript(transcript)
        if not assert_no_secret_in_transcript(
            transcript_text,
            [FIXTURE_ENV["ESPOCRM_DB_ROOT_PASSWORD"], FIXTURE_ENV["ESPOCRM_DB_PASSWORD"], vals.get("ESPOCRM_DB_PASSWORD"), vals.get("ESPOCRM_DB_ROOT_PASSWORD")],
            name + " — ningún secreto en argv de docker (incluida la contraseña root escrita por stdin)",
        ):
            ok = False

        with open(os.path.join(secrets_dir, ".rotation-status")) as f:
            content = f.read()
        if "S3=done" not in content:
            report(name + " — estado S3=done", False, content)
            ok = False
        else:
            report(name + " — estado S3=done", True)
        if ok:
            report(name, True)


def scenario_s1_s4_espocrm():
    name = "Escenario S1+S4: rota admin (bin/command) + API Key (REST) sin edición manual, anterior rechazada"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s4-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        p2 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S4"], env=env, cwd=repo)
        try:
            p2.expect("Escribe exactamente")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"\[si/no/salir\]")
            p2.send_line("si")
            respond_to_backup_passphrase_prompt(p2)
            p2.expect("confirmo fuera de claude code")
            p2.send_line("confirmo fuera de claude code")
            p2.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p2.close()
            return
        p2.close()

        secrets_file = os.path.join(secrets_dir, ".env.gapssa")
        vals = {}
        with open(secrets_file) as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    vals[k] = v

        ok = True
        if vals.get("ESPOCRM_ADMIN_PASSWORD") == FIXTURE_ENV["ESPOCRM_ADMIN_PASSWORD"]:
            report(name + " — ESPOCRM_ADMIN_PASSWORD cambió", False, "no cambió")
            ok = False
        else:
            report(name + " — ESPOCRM_ADMIN_PASSWORD cambió", True)
        if vals.get("ESPOCRM_API_KEY") == FIXTURE_ENV["ESPOCRM_API_KEY"]:
            report(name + " — ESPOCRM_API_KEY cambió (vía REST, sin edición manual)", False, "no cambió")
            ok = False
        else:
            report(name + " — ESPOCRM_API_KEY cambió (vía REST, sin edición manual)", True)

        transcript_text = read_transcript(transcript)
        if not assert_no_secret_in_transcript(
            transcript_text,
            [FIXTURE_ENV["ESPOCRM_ADMIN_PASSWORD"], vals.get("ESPOCRM_ADMIN_PASSWORD"), FIXTURE_ENV["ESPOCRM_API_KEY"], vals.get("ESPOCRM_API_KEY")],
            name + " — ningún secreto en argv de curl/docker",
        ):
            ok = False

        with open(os.path.join(secrets_dir, ".rotation-status")) as f:
            content = f.read()
        if "S4=done" not in content:
            report(name + " — estado S4=done", False, content)
            ok = False
        else:
            report(name + " — estado S4=done", True)
        if ok:
            report(name, True)


def snapshot_tree(root):
    """Punto 1 del mensaje original: --dry-run nunca debe cambiar el
    almacén externo — "demuestra identidad", no solo "no hay ficheros
    nuevos". Devuelve {ruta relativa: (modo, sha256 del contenido)} para
    CADA fichero bajo `root` — comparado byte a byte, no solo por nombre."""
    import hashlib

    snapshot = {}
    if not os.path.isdir(root):
        return snapshot
    for dirpath, _dirnames, filenames in os.walk(root):
        for fname in filenames:
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, root)
            try:
                mode = stat.S_IMODE(os.stat(full).st_mode)
                with open(full, "rb") as f:
                    digest = hashlib.sha256(f.read()).hexdigest()
                snapshot[rel] = (mode, digest)
            except OSError:
                continue
    return snapshot


def scenario_dry_run_identity_s2():
    name = "Escenario dry-run S2: identidad exacta del almacén externo antes/después (nunca escribe nada real)"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-dryrun-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        env = base_env(home, secrets_dir, state, transcript)

        # Bootstrapea el almacén con un S1 REAL (fuera de medición) — el
        # dry-run de S2 se mide sobre un almacén ya existente y con
        # secretos reales dentro, el caso que de verdad importa.
        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        before = snapshot_tree(secrets_dir)
        if not before:
            report(name, False, "el almacén externo quedó vacío tras S1 — no se puede medir identidad sobre nada")
            return

        p2 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S2", "--dry-run"], env=env, cwd=repo)
        try:
            p2.expect("Escribe exactamente")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"\[si/no/salir\]")
            p2.send_line("si")
            p2.wait(timeout=10)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p2.close()
            return
        p2.close()

        after = snapshot_tree(secrets_dir)
        if before == after:
            report(name, True)
        else:
            added = set(after) - set(before)
            removed = set(before) - set(after)
            changed = {k for k in set(before) & set(after) if before[k] != after[k]}
            report(
                name,
                False,
                f"el almacén externo cambió durante --dry-run — añadidos={added} eliminados={removed} modificados={changed}",
            )


# ---------------------------------------------------------------------------
# BLOQUE 2 — restauración real: backup+restauración end-to-end contra el
# script real (nunca solo las funciones bash sueltas), watcher de
# ausencia de texto plano durante todo el ciclo, huérfanos no adoptados.
# ---------------------------------------------------------------------------


def respond_with_fixed_backup_passphrase(p, passphrase):
    """Como respond_to_backup_passphrase_prompt, pero fija una frase de
    recuperación CONOCIDA (en vez de generarla al azar) — imprescindible
    cuando una prueba necesita recordar la frase entre dos invocaciones
    DISTINTAS del proceso (rearrancar tras una interrupción real) para
    poder descifrar más tarde el backup real creado por la primera."""
    p.expect(r"\¿Generar una frase aleatoria segura ahora \(recomendado\)\?")
    p.expect(r"\[si/no/salir\]")
    p.send_line("no")
    p.expect(r"Introduce tu frase de recuperación")
    p.send_line(passphrase)
    p.expect(r"Rep.*confirmar")
    p.send_line(passphrase)


def _interrupt_gate_after_backup(sr_dir, env, repo, gate, passphrase, extra_before_sigint=None):
    """Arranca `--only <gate>`, confirma, fija la frase FIJA, y lo
    interrumpe con Ctrl-C justo cuando 02-generate-secret.sh se queda
    esperando su propia reconfirmación del harness — el mismo punto
    determinista que usa scenario_ctrl_c_mid_gate. Para ese momento,
    enter_gate(gate) ya corrió: state=applying y el backup REAL de esa
    puerta ya existe en disco."""
    p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", gate], env=env, cwd=repo)
    p.expect("Escribe exactamente")
    p.send_line("confirmo fuera de claude code")
    p.expect(rf"Puerta {gate}")
    p.expect(r"\[si/no/salir\]")
    p.send_line("si")
    respond_with_fixed_backup_passphrase(p, passphrase)
    if extra_before_sigint:
        extra_before_sigint(p)
    p.expect("confirmo fuera de claude code")
    p.sigint()
    p.wait(timeout=10)
    p.close()


def scenario_restore_real_backup_success_recovery_required():
    name = "Escenario restauración real (S2): backup real + coordinación con éxito -> recovery_required"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-restore-s2-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)
        passphrase = "frase-de-prueba-fija-para-S2-000AB"

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        try:
            _interrupt_gate_after_backup(sr_dir, env, repo, "S2", passphrase)
        except TimeoutError as exc:
            report(name + " (interrupción S2)", False, str(exc))
            return

        status_file = os.path.join(secrets_dir, ".rotation-status")
        with open(status_file) as f:
            content = f.read()
        if "S2=rollback_required" not in content:
            report(name + " (precondición: S2=rollback_required tras Ctrl-C)", False, content)
            return
        report(name + " (precondición: S2=rollback_required tras Ctrl-C)", True)

        p3 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S2"], env=env, cwd=repo)
        try:
            p3.expect("Escribe exactamente")
            p3.send_line("confirmo fuera de claude code")
            p3.expect(r"rollback_required")
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("si")  # confirm_gate: intentar restaurar
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("si")  # restore_secrets_file_from_latest_backup: confirmación real
            respond_with_fixed_backup_passphrase(p3, passphrase)
            p3.expect(r"restore_atomic=true")
            p3.expect(r"server_reconciliation_state=recovery_required")
            p3.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p3.close()
            return
        p3.close()

        ok = True
        with open(status_file) as f:
            content = f.read()
        if "S2=recovery_required" not in content:
            report(name + " — estado final S2=recovery_required", False, content)
            ok = False
        else:
            report(name + " — estado final S2=recovery_required", True)

        secrets_file = os.path.join(secrets_dir, ".env.gapssa")
        with open(secrets_file) as f:
            restored = f.read()
        if f"POSTGRES_PASSWORD={FIXTURE_ENV['POSTGRES_PASSWORD']}" not in restored:
            report(name + " — el fichero restaurado contiene la contraseña ORIGINAL", False, restored)
            ok = False
        else:
            report(name + " — el fichero restaurado contiene la contraseña ORIGINAL", True)
        if "__GAPSSA_BACKUP_SCHEMA_VERSION__" in restored:
            report(name + " — la etiqueta de esquema NUNCA llega al .env.gapssa restaurado", False, restored)
            ok = False
        else:
            report(name + " — la etiqueta de esquema NUNCA llega al .env.gapssa restaurado", True)

        mode = stat.S_IMODE(os.stat(secrets_file).st_mode)
        if mode != 0o600:
            report(name + " — modo 600 tras restaurar", False, oct(mode))
            ok = False
        else:
            report(name + " — modo 600 tras restaurar", True)

        leftovers = [f for f in os.listdir(secrets_dir) if ".restore-" in f]
        if leftovers:
            report(name + " — sin temporales huérfanos tras el mv", False, str(leftovers))
            ok = False
        else:
            report(name + " — sin temporales huérfanos tras el mv", True)

        transcript_text = read_transcript(transcript)
        if not assert_no_secret_in_transcript(
            transcript_text,
            [FIXTURE_ENV["POSTGRES_PASSWORD"], passphrase],
            name + " — sin secretos ni frase de recuperación en argv",
        ):
            ok = False

        if ok:
            report(name, True)


def scenario_restore_real_backup_s3_recovery_required():
    name = "Escenario restauración real (S3): backup real + AMBAS credenciales (root+espocrm) siguen coincidiendo -> recovery_required"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-restore-s3-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)
        passphrase = "frase-de-prueba-fija-para-S3-000CD"

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        def type_root_password(p):
            p.expect(r"Contrase.a ROOT actual de MariaDB:")
            p.send_line(FIXTURE_ENV["ESPOCRM_DB_ROOT_PASSWORD"])

        try:
            _interrupt_gate_after_backup(sr_dir, env, repo, "S3", passphrase, extra_before_sigint=type_root_password)
        except TimeoutError as exc:
            report(name + " (interrupción S3)", False, str(exc))
            return

        status_file = os.path.join(secrets_dir, ".rotation-status")
        with open(status_file) as f:
            content = f.read()
        if "S3=rollback_required" not in content:
            report(name + " (precondición: S3=rollback_required tras Ctrl-C)", False, content)
            return

        p3 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S3"], env=env, cwd=repo)
        try:
            p3.expect("Escribe exactamente")
            p3.send_line("confirmo fuera de claude code")
            p3.expect(r"rollback_required")
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("si")
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("si")
            respond_with_fixed_backup_passphrase(p3, passphrase)
            p3.expect(r"restore_atomic=true")
            # Ninguna credencial llegó a aplicarse antes de la interrupción
            # (el Ctrl-C ocurre mientras 02-generate-secret.sh espera SU
            # PROPIA reconfirmación, antes de escribir nada) — tras
            # restaurar, el archivo coincide exactamente con lo que el
            # servidor YA tenía, así que la evidencia de ambos sub-secretos
            # (root Y espocrm) sale "ya coordinado" sin necesitar ningún
            # ALTER USER real ni volver a pedir la contraseña root.
            p3.expect(r"server_reconciliation_state=recovery_required")
            p3.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p3.close()
            return
        p3.close()

        ok = True
        with open(status_file) as f:
            content = f.read()
        if "S3=recovery_required" not in content:
            report(name + " — estado final S3=recovery_required", False, content)
            ok = False
        else:
            report(name + " — estado final S3=recovery_required", True)
        if "S3=server_coordination_required" in content:
            report(name + " — nunca queda en server_coordination_required cuando ambas credenciales ya coincidían", False, content)
            ok = False

        if ok:
            report(name, True)


def scenario_orphan_restore_tmp_not_adopted():
    name = "Escenario huérfano de restauración: se detecta, nunca se adopta automáticamente, decisión explícita"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-orphan-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)
        passphrase = "frase-de-prueba-fija-huerfano-000E"

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        try:
            _interrupt_gate_after_backup(sr_dir, env, repo, "S2", passphrase)
        except TimeoutError as exc:
            report(name + " (interrupción S2)", False, str(exc))
            return

        # Planta un huérfano — mismo patrón de nombre que usa
        # gapssa_secrets_mktemp_secure_same_dir/restore_tmp_glob:
        # ".<basename-de-.env.gapssa>.restore-XXXXXXXX" — la plantilla
        # antepone un "." literal al nombre base ".env.gapssa" (que YA
        # empieza por punto), de ahí el DOBLE punto inicial.
        orphan_path = os.path.join(secrets_dir, "..env.gapssa.restore-DEADBEEF")
        orphan_content = "CONTENIDO-HUERFANO-NUNCA-DEBE-LEERSE-NI-ADOPTARSE"
        with open(orphan_path, "w") as f:
            f.write(orphan_content)
        os.chmod(orphan_path, 0o600)

        p3 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S2"], env=env, cwd=repo)
        try:
            p3.expect("Escribe exactamente")
            p3.send_line("confirmo fuera de claude code")
            p3.expect(r"rollback_required")
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("si")
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("si")
            # ensure_backup_passphrase_known + backup_secrets_file
            # "pre-restore-S2" corren ANTES del escaneo de huérfanos (ver
            # restore_secrets_file_from_latest_backup) — la frase se pide
            # primero, el aviso de huérfano llega después.
            respond_with_fixed_backup_passphrase(p3, passphrase)
            p3.expect(r"fichero.*hu.rfano")
            p3.expect(r"\[si/no/salir\]")
            p3.send_line("no")  # decisión EXPLÍCITA: no adoptar, cancelar
            p3.wait(timeout=10)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p3.close()
            return
        p3.close()

        ok = True
        if not os.path.isfile(orphan_path):
            report(name + " — el huérfano NO se borra automáticamente al declinar", False, "desapareció")
            ok = False
        else:
            with open(orphan_path) as f:
                still = f.read()
            if still != orphan_content:
                report(name + " — el contenido del huérfano no se ha tocado", False, "contenido cambió")
                ok = False
            else:
                report(name + " — el huérfano declinado permanece intacto (nunca adoptado)", True)

        with open(os.path.join(secrets_dir, ".rotation-status")) as f:
            content = f.read()
        if "S2=recovery_required" in content or "S2=server_coordination_required" in content:
            report(name + " — la restauración NO avanzó mientras el huérfano seguía sin resolver", False, content)
            ok = False

        if ok:
            report(name, True)


def scenario_backup_rehearsal_no_plaintext_watcher():
    name = "Escenario watcher: ningún fichero de texto plano aparece en el almacén externo durante S1+S2"
    import threading
    import time

    SUSPECT_MARKERS = ("rehearsal", "restore-tmp", ".restore.")

    with tempfile.TemporaryDirectory(prefix="gapssa-rot-watcher-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)

        seen_files = set()
        stop_flag = threading.Event()

        def watch():
            while not stop_flag.is_set():
                for root, _dirs, files in os.walk(secrets_dir):
                    for fn in files:
                        seen_files.add(os.path.join(os.path.relpath(root, secrets_dir), fn))
                time.sleep(0.02)

        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            stop_flag.set()
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        p2 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S2"], env=env, cwd=repo)
        try:
            p2.expect("Escribe exactamente")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"\[si/no/salir\]")
            p2.send_line("si")
            respond_to_backup_passphrase_prompt(p2)
            p2.expect("confirmo fuera de claude code")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"Puerta S2 completada")
            p2.wait(timeout=15)
        except TimeoutError as exc:
            stop_flag.set()
            report(name, False, str(exc))
            p2.close()
            return
        p2.close()
        stop_flag.set()
        watcher.join(timeout=2)

        ok = True
        suspects = [f for f in seen_files if any(m in f for m in SUSPECT_MARKERS)]
        if suspects:
            report(name + " — ningún fichero de ensayo/restauración efímero visible en disco", False, str(suspects))
            ok = False
        else:
            report(name + " — ningún fichero de ensayo/restauración efímero visible en disco", True)

        # Cero bytes del secreto ANTERIOR (pre-S2) en ningún fichero salvo
        # el propio .env.gapssa LEGÍTIMO en el momento en que aún no se
        # había rotado (ese SÍ debe contenerlo, es el archivo real) —
        # cualquier OTRO fichero (backups cifrados incluidos: su contenido
        # debe ser indistinguible de ruido, nunca contener el plaintext).
        secret = FIXTURE_ENV["POSTGRES_PASSWORD"].encode()
        leaked_files = []
        for rel in seen_files:
            if rel in (".env.gapssa", os.path.join(".", ".env.gapssa")):
                continue
            full = os.path.join(secrets_dir, rel)
            if not os.path.isfile(full):
                continue
            try:
                with open(full, "rb") as f:
                    data = f.read()
            except OSError:
                continue
            if secret in data:
                leaked_files.append(rel)
        if leaked_files:
            report(name + " — cero bytes del secreto en disco (fuera del propio .env.gapssa final)", False, str(leaked_files))
            ok = False
        else:
            report(name + " — cero bytes del secreto en disco (fuera del propio .env.gapssa final)", True)

        if ok:
            report(name, True)


# ---------------------------------------------------------------------------
# BLOQUE 2 (corrección) — pruebas NO interactivas que invocan funciones
# bash directamente (sourcing el script real con su última línea `main`
# recortada, para no disparar gapssa_secrets_require_interactive_confirmation
# ni el bucle de puertas) — nunca via PTY, porque no hace falta
# interactividad para lo que prueban. Nunca avanzan a S6-S9 real ni tocan
# Docker/servicios reales.
# ---------------------------------------------------------------------------


def _write_trimmed_script(sr_dir, dest_path):
    """Copia rotate-all-interactive.sh SIN su última línea (`main`) — así
    se puede `source` para invocar funciones sueltas sin disparar el
    arranque interactivo completo."""
    with open(os.path.join(sr_dir, "rotate-all-interactive.sh"), encoding="utf-8") as f:
        lines = f.readlines()
    with open(dest_path, "w", encoding="utf-8") as f:
        f.writelines(lines[:-1])


def scenario_recover_old_secret_value_no_plaintext_watcher():
    name = "Escenario watcher: recover_old_secret_value() nunca escribe el valor a un fichero regular"
    import threading
    import time

    with tempfile.TemporaryDirectory(prefix="gapssa-rot-recoverwatch-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state = os.path.join(tmp, "docker-state")
        seed_docker_state(state)
        env = base_env(home, secrets_dir, state, transcript)
        passphrase = "frase-de-prueba-fija-recover-000AB"

        # S1 + S2 reales (crea el almacén y un backup real de S2) con
        # frase FIJA, para poder reutilizarla luego en la invocación no
        # interactiva de recover_old_secret_value().
        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S1"], env=env, cwd=repo)
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")
            p.send_line("confirmo fuera de claude code")
            p.wait(timeout=10)
        except TimeoutError as exc:
            report(name + " (preparación S1)", False, str(exc))
            p.close()
            return
        p.close()

        p2 = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S2"], env=env, cwd=repo)
        try:
            p2.expect("Escribe exactamente")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"Puerta S2")
            p2.expect(r"\[si/no/salir\]")
            p2.send_line("si")
            respond_with_fixed_backup_passphrase(p2, passphrase)
            p2.expect("confirmo fuera de claude code")
            p2.send_line("confirmo fuera de claude code")
            p2.expect(r"Puerta S2 completada")
            p2.wait(timeout=15)
        except TimeoutError as exc:
            report(name + " (preparación S2)", False, str(exc))
            p2.close()
            return
        p2.close()

        trimmed = os.path.join(sr_dir, "trimmed.sh")
        _write_trimmed_script(sr_dir, trimmed)

        seen_files = set()
        stop_flag = threading.Event()

        def watch():
            while not stop_flag.is_set():
                for root, _dirs, files in os.walk(secrets_dir):
                    for fn in files:
                        seen_files.add(os.path.join(os.path.relpath(root, secrets_dir), fn))
                time.sleep(0.02)

        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()

        script = f"""
set -euo pipefail
export GAPSSA_SECRETS_DIR={shlexquote(secrets_dir)}
set --
source {shlexquote(trimmed)}
BACKUP_PASSPHRASE={shlexquote(passphrase)}
recover_old_secret_value S2 POSTGRES_PASSWORD
"""
        res = subprocess.run(["bash", "-c", script], env=env, cwd=repo, capture_output=True, text=True, timeout=20)
        stop_flag.set()
        watcher.join(timeout=2)

        ok = True
        recovered = res.stdout
        if res.returncode != 0 or recovered != FIXTURE_ENV["POSTGRES_PASSWORD"]:
            report(name + " — recupera el valor ORIGINAL correcto", False, f"rc={res.returncode} stdout={recovered!r} stderr={res.stderr!r}")
            ok = False
        else:
            report(name + " — recupera el valor ORIGINAL correcto", True)

        suspects = [f for f in seen_files if "recover" in f.lower() or "value" in f.lower()]
        if suspects:
            report(name + " — cero ficheros regulares nuevos relacionados con la recuperación", False, str(suspects))
            ok = False
        else:
            report(name + " — cero ficheros regulares nuevos relacionados con la recuperación", True)

        secret_bytes = FIXTURE_ENV["POSTGRES_PASSWORD"].encode()
        leaked = []
        for rel in seen_files:
            full = os.path.join(secrets_dir, rel)
            if not os.path.isfile(full):
                continue
            try:
                with open(full, "rb") as f:
                    data = f.read()
            except OSError:
                continue
            if secret_bytes in data:
                leaked.append(rel)
        if leaked:
            report(name + " — cero bytes del secreto recuperado en cualquier fichero del almacén", False, str(leaked))
            ok = False
        else:
            report(name + " — cero bytes del secreto recuperado en cualquier fichero del almacén", True)

        if not assert_no_secret_in_transcript(res.stdout + res.stderr, [passphrase], name + " — la frase de recuperación nunca aparece en stdout/stderr"):
            ok = False

        if ok:
            report(name, True)


def scenario_backup_schema_tagging():
    name = "Escenario etiquetado de esquema: legacy-pre-s7 antes de S7, active tras S7 (contenido migrado)"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-schematag-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        os.makedirs(secrets_dir)
        os.chmod(secrets_dir, 0o700)
        secrets_file = os.path.join(secrets_dir, ".env.gapssa")
        write_env_file(secrets_file)
        os.chmod(secrets_file, 0o600)
        env = base_env(home, secrets_dir, os.path.join(tmp, "docker-state"), os.path.join(tmp, "transcript.log"))
        trimmed = os.path.join(sr_dir, "trimmed.sh")
        _write_trimmed_script(sr_dir, trimmed)
        passphrase = "frase-de-prueba-fija-schematag-00AB"

        script = f"""
set -euo pipefail
export GAPSSA_SECRETS_DIR={shlexquote(secrets_dir)}
set --
source {shlexquote(trimmed)}
BACKUP_PASSPHRASE={shlexquote(passphrase)}

echo "PRE_S7_VERSION=$(current_secrets_schema_version)"
backup_secrets_file S2 "$(current_secrets_schema_version)"
latest="$(ls -t "$BACKUP_DIR"/S2-*.env.gapssa.enc | head -n1)"
passfile_pre=$(mktemp)
printf '%s' "$BACKUP_PASSPHRASE" >"$passfile_pre"
echo "PRE_S7_TAG=$(openssl enc -d -aes-256-cbc -pbkdf2 -in "$latest" -pass "file:$passfile_pre" | head -n1)"
rm -f "$passfile_pre"

# Simula lo que S7 haría de verdad: migra los nombres singulares a
# plurales/versionados en el propio $SECRETS_FILE y marca la puerta
# S7 como completada — SOLO entonces current_secrets_schema_version()
# debe pasar a "active", y SOLO entonces un backup nuevo debe validar
# y etiquetarse como tal (si el contenido no hubiera migrado de
# verdad, backup_secrets_file lo habría rechazado). grep -v + heredoc
# en vez de sed: evita las diferencias de sintaxis de sed entre BSD
# (macOS) y GNU para insertar una línea nueva en la sustitución.
grep -v '^BOOKING_EMAIL_LOOKUP_HMAC_SECRET=' "$SECRETS_FILE" | grep -v '^BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET=' >"${{SECRETS_FILE}}.new"
cat >>"${{SECRETS_FILE}}.new" <<'EOF2'
BOOKING_EMAIL_LOOKUP_HMAC_SECRETS={{"v1":"x"}}
BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION=v1
BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS={{"v1":"x"}}
BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION=v1
EOF2
mv "${{SECRETS_FILE}}.new" "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"
state_set S7 done

echo "POST_S7_VERSION=$(current_secrets_schema_version)"
backup_secrets_file S2 "$(current_secrets_schema_version)"
latest2="$(ls -t "$BACKUP_DIR"/S2-*.env.gapssa.enc | head -n1)"
passfile_post=$(mktemp)
printf '%s' "$BACKUP_PASSPHRASE" >"$passfile_post"
echo "POST_S7_TAG=$(openssl enc -d -aes-256-cbc -pbkdf2 -in "$latest2" -pass "file:$passfile_post" | head -n1)"
rm -f "$passfile_post"
"""
        res = subprocess.run(["bash", "-c", script], env=env, cwd=repo, capture_output=True, text=True, timeout=20)
        out = res.stdout
        ok = True
        if res.returncode != 0:
            report(name, False, f"rc={res.returncode} stdout={out!r} stderr={res.stderr!r}")
            return

        if "PRE_S7_VERSION=legacy-pre-s7" in out:
            report(name + " — antes de S7: current_secrets_schema_version()=legacy-pre-s7", True)
        else:
            report(name + " — antes de S7: current_secrets_schema_version()=legacy-pre-s7", False, out)
            ok = False

        if "PRE_S7_TAG=__GAPSSA_BACKUP_SCHEMA_VERSION__=legacy-pre-s7" in out:
            report(name + " — backup pre-S7 etiquetado legacy-pre-s7", True)
        else:
            report(name + " — backup pre-S7 etiquetado legacy-pre-s7", False, out)
            ok = False

        if "POST_S7_VERSION=active" in out:
            report(name + " — tras S7 (contenido migrado): current_secrets_schema_version()=active", True)
        else:
            report(name + " — tras S7 (contenido migrado): current_secrets_schema_version()=active", False, out)
            ok = False

        if "POST_S7_TAG=__GAPSSA_BACKUP_SCHEMA_VERSION__=active" in out:
            report(name + " — backup post-S7 etiquetado active", True)
        else:
            report(name + " — backup post-S7 etiquetado active", False, out)
            ok = False

        if ok:
            report(name, True)


# ---------------------------------------------------------------------------
# BLOQUE 3 — política de reejecución de S6 ante un artefacto existente:
# absent siempre procede; valid+prepared bloquea (S9 debe consumirlo);
# valid+cualquier otro estado bloquea y CONSERVA (nunca se retira en
# automático); invalid siempre bloquea y conserva. Ejecuta la sonda REAL
# `s6ArtifactMaintenance.mts` (vía el tsx real, symlink de node_modules)
# — sin necesitar apps/web/src ni Postgres/Redis, porque esa sonda solo
# importa su propio módulo hermano secureArtifact.mts.
# ---------------------------------------------------------------------------
_S6_BLOCKING_STATES = [
    "pending",
    "applying",
    "verifying",
    "rollback_required",
    "recovery_required",
    "server_coordination_required",
    "blocked",
    "failed",
    "done",
]


def _drive_confirm_gate_s6(p, state):
    p.expect(r"Puerta S6")
    if state == "rollback_required":
        p.expect(r"quedó en 'rollback_required'")
        p.expect(r"\[si/no/salir\]")
        p.send_line("no")
    elif state == "done":
        p.expect(r"ya está marcada 'done'")
        p.expect(r"\[si/no/salir\]")
        p.send_line("si")
    elif state == "recovery_required":
        p.expect(r"quedó en 'recovery_required'")
    elif state == "server_coordination_required":
        p.expect(r"quedó en 'server_coordination_required'")
    elif state == "blocked":
        p.expect(r"quedó 'blocked'")
    p.expect(r"¿Ejecutar la puerta S6 ahora\?")
    p.expect(r"\[si/no/salir\]")
    p.send_line("si")


def _run_s6_once(tmp_root, state, artifact_kind):
    """artifact_kind: 'absent' | 'valid' | 'invalid'. Devuelve (rc, p, secrets_dir, secrets_file, artifact_path_or_None)."""
    repo = os.path.join(tmp_root, "repo")
    os.makedirs(repo)
    sr_dir = build_fixture_repo(repo)
    home = os.path.join(tmp_root, "home")
    os.makedirs(home)
    secrets_dir = os.path.join(home, ".gapssa-secrets")
    transcript = os.path.join(tmp_root, "transcript.log")
    state_dir = os.path.join(tmp_root, "docker-state")
    seed_docker_state(state_dir)

    secrets_file = os.path.join(secrets_dir, ".env.gapssa")
    os.makedirs(secrets_dir, exist_ok=True)
    os.chmod(secrets_dir, 0o700)
    write_active_env_file(secrets_file)
    os.chmod(secrets_file, 0o600)
    seed_rotation_status(secrets_dir, "S6", state)

    artifact_path = None
    if artifact_kind == "valid":
        artifact_path = plant_s6_artifact(secrets_dir, valid=True)
    elif artifact_kind == "invalid":
        artifact_path = plant_s6_artifact(secrets_dir, valid=False)

    env = base_env(home, secrets_dir, state_dir, transcript)
    p = PtyProcess(
        ["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S6"],
        env=env,
        cwd=repo,
    )
    p.expect("Escribe exactamente")
    p.send_line("confirmo fuera de claude code")
    _drive_confirm_gate_s6(p, state)
    rc = p.wait(timeout=20)
    return rc, p, secrets_dir, secrets_file, artifact_path


def scenario_s6_artifact_reexecution_policy():
    for state in _S6_BLOCKING_STATES:
        name = f"Escenario S6 (artefacto VÁLIDO existente, estado={state}): bloquea, conserva, no genera secretos, no llega a done"
        with tempfile.TemporaryDirectory(prefix="gapssa-rot-s6pol-") as tmp:
            try:
                rc, p, secrets_dir, secrets_file, artifact_path = _run_s6_once(tmp, state, "valid")
            except TimeoutError as exc:
                report(name, False, str(exc))
                continue
            ok = True
            if not os.path.isfile(artifact_path):
                report(name + " — artefacto NO eliminado", False, "el artefacto desapareció")
                ok = False
            status_file = os.path.join(secrets_dir, ".rotation-status")
            with open(status_file) as f:
                status_content = f.read()
            if f"S6={state}" not in status_content:
                report(name + " — estado de S6 sin modificar", False, status_content)
                ok = False
            if "S6=done" in status_content and state != "done":
                report(name + " — nunca pasa a done", False, status_content)
                ok = False
            with open(secrets_file) as f:
                secrets_after = f.read()
            for var in ("PAYLOAD_SECRET", "OTP_HMAC_SECRET", "AUTH_RATE_LIMIT_HMAC_SECRET"):
                if f"{var}={FIXTURE_ENV[var]}" not in secrets_after:
                    report(name + f" — {var} NO regenerado", False, "el valor cambió inesperadamente")
                    ok = False
            if "BLOQUEADA" not in p.transcript:
                report(name + " — mensaje de bloqueo mostrado", False, p.transcript[-2000:])
                ok = False
            if rc == 0:
                report(name + " — código de salida no-cero", False, f"rc={rc}")
                ok = False
            p.close()
            if ok:
                report(name, True)

    for state in ["pending", "failed"]:
        name = f"Escenario S6 (artefacto INVÁLIDO existente, estado={state}): bloquea, conserva sin tocar, exige inspección manual"
        with tempfile.TemporaryDirectory(prefix="gapssa-rot-s6inv-") as tmp:
            try:
                rc, p, secrets_dir, secrets_file, artifact_path = _run_s6_once(tmp, state, "invalid")
            except TimeoutError as exc:
                report(name, False, str(exc))
                continue
            ok = True
            if not os.path.isfile(artifact_path):
                report(name + " — artefacto NO eliminado", False, "el artefacto inválido desapareció")
                ok = False
            with open(artifact_path) as f:
                content_after = f.read()
            if "extraField" not in content_after:
                report(name + " — contenido del artefacto sin modificar", False, content_after)
                ok = False
            status_file = os.path.join(secrets_dir, ".rotation-status")
            with open(status_file) as f:
                status_content = f.read()
            if f"S6={state}" not in status_content:
                report(name + " — estado de S6 sin modificar", False, status_content)
                ok = False
            if rc == 0:
                report(name + " — código de salida no-cero", False, f"rc={rc}")
                ok = False
            p.close()
            if ok:
                report(name, True)

    name = "Escenario S6 (SIN artefacto previo): la inspección no bloquea, el estado de S6 no queda tocado por la sola inspección"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s6abs-") as tmp:
        try:
            # 'prepared' + absent no es alcanzable de forma realista (si
            # gate_s6 completó alguna vez, el artefacto existe hasta que
            # S9 lo retira) — se usa 'pending' para demostrar que
            # 'absent' dejar pasar la inspección (no bloquea), sin
            # depender de Postgres/Redis reales para completar el resto
            # de la puerta.
            rc, p, secrets_dir, secrets_file, artifact_path = _run_s6_once(tmp, "pending", "absent")
        except TimeoutError as exc:
            report(name, False, str(exc))
        else:
            ok = "BLOQUEADA" not in p.transcript
            if not ok:
                report(name, False, p.transcript[-2000:])
            else:
                report(name, True)
            p.close()


# ---------------------------------------------------------------------------
# BLOQUE 3 — fallo cerrado si falta un script permanente (aquí:
# s6ArtifactMaintenance.mts, borrado deliberadamente de la copia fixture
# tras build_fixture_repo).
# ---------------------------------------------------------------------------
def scenario_s6_missing_probe_script_fails_closed():
    name = "Escenario S6: falta el script permanente s6ArtifactMaintenance.mts -> falla cerrado, nunca crashea sin control"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-s6missing-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fixture_repo(repo)
        missing = os.path.join(sr_dir, "probes", "s6ArtifactMaintenance.mts")
        os.remove(missing)

        home = os.path.join(tmp, "home")
        os.makedirs(home)
        secrets_dir = os.path.join(home, ".gapssa-secrets")
        transcript = os.path.join(tmp, "transcript.log")
        state_dir = os.path.join(tmp, "docker-state")
        seed_docker_state(state_dir)
        secrets_file = os.path.join(secrets_dir, ".env.gapssa")
        os.makedirs(secrets_dir, exist_ok=True)
        os.chmod(secrets_dir, 0o700)
        write_active_env_file(secrets_file)
        os.chmod(secrets_file, 0o600)

        env = base_env(home, secrets_dir, state_dir, transcript)
        p = PtyProcess(
            ["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S6"],
            env=env,
            cwd=repo,
        )
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"Puerta S6")
            p.expect(r"¿Ejecutar la puerta S6 ahora\?")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            rc = p.wait(timeout=20)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        ok = rc != 0
        if not ok:
            report(name, False, f"rc={rc} (se esperaba no-cero)")
        else:
            report(name, True, f"rc={rc}")
        p.close()


# ---------------------------------------------------------------------------
# Corrección "dry-run fresco S1->S9" — Escenarios A-F. Fixture propio
# (nunca el .env de FIXTURE_ENV): simula una máquina/usuario fresco con
# ~/.gapssa-secrets inexistente y un ".env real" que en realidad es una
# TRAMPA con un valor centinela — cualquier lectura real de su contenido
# (bug de la clase que motivó esta corrección) hace fallar el escenario
# en vez de pasar en silencio. Nunca usa infraestructura real (Docker
# real, EspoCRM real): --dry-run nunca debería necesitarla, y estos
# escenarios existen precisamente para demostrar eso.
# ---------------------------------------------------------------------------

DRY_RUN_TRAP_SENTINEL = "THIS-IS-THE-REAL-ENV-SENTINEL-NEVER-READ-ME-fresh-dry-run-6f1a9c"
REAL_STORE_SENTINEL = "REAL-PREEXISTING-STORE-SENTINEL-NEVER-ADOPT-OR-READ-ME-8b3e2d"

ALL_GATES = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"]


def write_trap_env_file(path):
    """El ".env" TRAMPA de los escenarios A-F: nunca tiene forma de
    fixture completo (SECRETS_FILE_KEY_INVENTORY) a propósito -- si algún
    camino de código llegara a copiarlo o parsearlo de verdad, el
    resultado sería observable como un error o como el centinela
    apareciendo donde no debe, nunca como un .env.gapssa "por casualidad
    válido"."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"POSTGRES_PASSWORD={DRY_RUN_TRAP_SENTINEL}\n")
        f.write(f"ESPOCRM_DB_ROOT_PASSWORD={DRY_RUN_TRAP_SENTINEL}\n")
        f.write(f"REDIS_PASSWORD={DRY_RUN_TRAP_SENTINEL}\n")
    os.chmod(path, 0o600)


def build_fresh_dryrun_fixture_repo(root):
    """Como build_fixture_repo, más lo que --dry-run necesita para NUNCA
    tocar el .env real: scripts/checkpoint-validation/generate-synthetic-env.sh
    (invocado por rotate-all-interactive.sh en dry-run para servir
    valores sintéticos vía field_from_secrets_file) y .env.example (su
    única fuente de claves — plantilla versionable, nunca un secreto).
    Sustituye el .env de fixture normal (FIXTURE_ENV, con valores
    "fixture-initial-...") por el .env TRAMPA de arriba."""
    dest_sr = build_fixture_repo(root)
    dest_cv = os.path.join(root, "scripts", "checkpoint-validation")
    os.makedirs(dest_cv, exist_ok=True)
    shutil.copy2(
        os.path.join(REAL_REPO_ROOT, "scripts", "checkpoint-validation", "generate-synthetic-env.sh"),
        os.path.join(dest_cv, "generate-synthetic-env.sh"),
    )
    os.chmod(os.path.join(dest_cv, "generate-synthetic-env.sh"), 0o755)
    shutil.copy2(os.path.join(REAL_REPO_ROOT, ".env.example"), os.path.join(root, ".env.example"))
    write_trap_env_file(os.path.join(root, ".env"))
    return dest_sr


def seed_real_preexisting_store(secrets_dir):
    """Escenario F: simula un almacén externo REAL, de una rotación
    previa ya completa (las 9 puertas 'done', backups presentes), bajo el
    HOME temporal del propio escenario -- nunca el HOME real. Un
    --dry-run posterior en un PROCESO NUEVO nunca debe leer el contenido
    de $secrets_dir/.env.gapssa (centinela propio, distinto del .env
    TRAMPA del repositorio) ni adoptar su '.rotation-status' real como si
    esta sesión de dry-run lo hubiera producido -- el estado virtual de
    cada proceso nuevo siempre empieza vacío, por diseño."""
    os.makedirs(secrets_dir, exist_ok=True)
    os.chmod(secrets_dir, 0o700)
    status_file = os.path.join(secrets_dir, ".rotation-status")
    with open(status_file, "w", encoding="utf-8") as f:
        for g in ALL_GATES:
            f.write(f"{g}=done\n")
    os.chmod(status_file, 0o600)
    secrets_file = os.path.join(secrets_dir, ".env.gapssa")
    with open(secrets_file, "w", encoding="utf-8") as f:
        f.write(f"POSTGRES_PASSWORD={REAL_STORE_SENTINEL}\n")
        f.write(f"ESPOCRM_DB_ROOT_PASSWORD={REAL_STORE_SENTINEL}\n")
        f.write("COMPOSE_PROJECT_NAME=gapssa-real-preexisting\n")
    os.chmod(secrets_file, 0o600)
    backup_dir = os.path.join(secrets_dir, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    os.chmod(backup_dir, 0o700)
    backup_file = os.path.join(backup_dir, "S1-20260101T000000Z-deadbeef.env.gapssa.enc")
    with open(backup_file, "wb") as f:
        f.write(os.urandom(64))
    os.chmod(backup_file, 0o600)


def _auto_pilot_dry_run(p, timeout=180):
    """Piloto automático para un --dry-run completo (sin --only):
    responde 'si' a cada '¿Ejecutar la puerta ... ahora?' y la frase de
    confirmación del harness a cada 'Escribe exactamente' (una por
    invocación de 01-init-external-store.sh/02-generate-secret.sh dentro
    de cada puerta) -- NUNCA a un prompt de contraseña real: si uno
    apareciera bajo --dry-run (justo el bug de gate_s3 corregido en esta
    misma corrección), el bucle se queda sin patrón que reconocer y el
    escenario expira por timeout en vez de alimentarle una respuesta a
    ciegas, hacièndolo visible como fallo."""
    deadline = time.time() + timeout
    last_len = 0
    while time.time() < deadline:
        p.read_available(timeout=0.5)
        if p.proc.poll() is not None:
            return
        new_text = p.transcript[last_len:]
        if re.search(r"Escribe exactamente", new_text):
            p.send_line("confirmo fuera de claude code")
            last_len = len(p.transcript)
        elif re.search(r"\[si/no/salir\]", new_text):
            p.send_line("si")
            last_len = len(p.transcript)
        elif re.search(r"Pulsa Enter cuando lo hayas hecho", new_text):
            p.send_line("")
            last_len = len(p.transcript)
    raise TimeoutError(f"auto-pilot dry-run: timeout tras {timeout}s (ningún patrón reconocido -- posible prompt real inesperado bajo --dry-run).\n--- transcript ---\n{p.transcript}")


def _dry_run_fresh_env(tmp):
    """HOME temporal fresco + GAPSSA_SECRETS_DIR bajo él (inexistente al
    empezar) -- nunca el HOME real del operador."""
    home = os.path.join(tmp, "home")
    os.makedirs(home)
    secrets_dir = os.path.join(home, ".gapssa-secrets")
    transcript = os.path.join(tmp, "fake-cmd-transcript.log")
    state = os.path.join(tmp, "docker-state")
    return home, secrets_dir, base_env(home, secrets_dir, state, transcript), transcript


# --- Escenario A -----------------------------------------------------------
def scenario_dry_run_fresh_A_full_traversal():
    name = "Escenario A (dry-run fresco): usuario fresco S1->S9 completo respondiendo 'si', cero artefactos"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-freshdry-a-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fresh_dryrun_fixture_repo(repo)
        env_before = snapshot_tree(repo)
        home, secrets_dir, env, _transcript = _dry_run_fresh_env(tmp)

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--dry-run"], env=env, cwd=repo)
        try:
            _auto_pilot_dry_run(p, timeout=240)
            rc = p.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        p.close()

        ok = True
        if rc != 0:
            report(name + " — código de salida 0", False, f"rc={rc}")
            ok = False
        else:
            report(name + " — código de salida 0", True)
        if os.path.exists(secrets_dir):
            report(name + " — ~/.gapssa-secrets nunca se crea", False, "el directorio existe tras el dry-run")
            ok = False
        else:
            report(name + " — ~/.gapssa-secrets nunca se crea", True)
        for g in ALL_GATES:
            if f"{g}=simulated_ok" not in p.transcript:
                report(name + f" — {g}=simulated_ok en el resumen final", False, "ausente del resumen")
                ok = False
        if "ready_for_real_run=true" not in p.transcript:
            report(name + " — ready_for_real_run=true en el resumen", False, "ausente")
            ok = False
        if not assert_no_secret_in_transcript(p.transcript, [DRY_RUN_TRAP_SENTINEL], name + " — el centinela del .env TRAMPA nunca aparece en stdout/stderr"):
            ok = False
        env_after = snapshot_tree(repo)
        # Solo comparamos los ficheros que YA existían antes (el propio
        # dry-run puede crear ficheros efímeros propios del arnés, p.ej.
        # bajo TMPDIR -- fuera de `repo` -- pero nunca debe MODIFICAR
        # ninguno de los que ya estaban, en particular ".env").
        changed = {k for k in env_before if k in env_after and env_before[k] != env_after[k]}
        removed = {k for k in env_before if k not in env_after}
        if changed or removed:
            report(name + " — ningún fichero preexistente del repo (incluido .env) se modifica", False, f"modificados={changed} eliminados={removed}")
            ok = False
        else:
            report(name + " — ningún fichero preexistente del repo (incluido .env) se modifica", True)
        if ok:
            report(name, True)


# --- Escenario B -------------------------------------------------------
def scenario_dry_run_fresh_B_skip_s1_blocks_s2():
    name = "Escenario B (dry-run fresco): --only S2 --dry-run sin S1 previo en esta sesión -> falla por estado VIRTUAL ausente, nunca exige el artefacto físico"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-freshdry-b-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fresh_dryrun_fixture_repo(repo)
        home, secrets_dir, env, _transcript = _dry_run_fresh_env(tmp)

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--only", "S2", "--dry-run"], env=env, cwd=repo)
        ok = True
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect(r"ERROR: \[dry-run\].*no existe \(ni siquiera de forma simulada\)")
            rc = p.wait(timeout=10)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        p.close()
        if rc == 0:
            report(name + " — código de salida no-cero", False, f"rc={rc}")
            ok = False
        else:
            report(name + " — código de salida no-cero", True)
        if os.path.exists(secrets_dir):
            report(name + " — ~/.gapssa-secrets nunca se crea", False, "existe")
            ok = False
        else:
            report(name + " — ~/.gapssa-secrets nunca se crea", True)
        if ok:
            report(name, True)


# --- Escenario C -------------------------------------------------------
def scenario_dry_run_fresh_C_s1_accepted_s2_no_physical_requirement():
    name = "Escenario C (dry-run fresco): S1 aceptada en esta misma sesión -> S2 continúa sin exigir .env.gapssa físico"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-freshdry-c-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fresh_dryrun_fixture_repo(repo)
        home, secrets_dir, env, _transcript = _dry_run_fresh_env(tmp)

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--dry-run"], env=env, cwd=repo)
        ok = True
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"Puerta S1")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")  # guardia propia de 01-init-external-store.sh
            p.send_line("confirmo fuera de claude code")
            p.expect(r"Puerta S2")
            p.expect(r"\[si/no/salir\]")
            p.send_line("si")
            p.expect("confirmo fuera de claude code")  # guardia propia de 02-generate-secret.sh
            p.send_line("confirmo fuera de claude code")
            p.expect(r"Puerta S3", timeout=20)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        s2_section = p.transcript.split("Puerta S2", 1)[-1].split("Puerta S3", 1)[0]
        p.sigint()
        p.wait(timeout=10)
        p.close()

        if "no existe" in s2_section and "Ejecuta primero la puerta S1" in s2_section:
            report(name + " — S2 nunca exige el artefacto físico de S1 dentro de la misma sesión", False, s2_section)
            ok = False
        else:
            report(name + " — S2 nunca exige el artefacto físico de S1 dentro de la misma sesión", True)
        if "estado quedaría: S2=done" not in s2_section:
            report(name + " — S2 llega a 'done' (simulado)", False, s2_section)
            ok = False
        else:
            report(name + " — S2 llega a 'done' (simulado)", True)
        if os.path.exists(secrets_dir):
            report(name + " — ~/.gapssa-secrets nunca se crea", False, "existe")
            ok = False
        else:
            report(name + " — ~/.gapssa-secrets nunca se crea", True)
        if ok:
            report(name, True)


# --- Escenario D -------------------------------------------------------
def scenario_dry_run_fresh_D_zero_mutating_commands():
    name = "Escenario D (dry-run fresco): S1->S9 simulated_ok, CERO invocaciones reales de docker/curl, cero secretos generados"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-freshdry-d-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fresh_dryrun_fixture_repo(repo)
        home, secrets_dir, env, fake_cmd_transcript = _dry_run_fresh_env(tmp)

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--dry-run"], env=env, cwd=repo)
        try:
            _auto_pilot_dry_run(p, timeout=240)
            rc = p.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        p.close()

        ok = True
        if rc != 0:
            report(name + " — código de salida 0", False, f"rc={rc}")
            ok = False
        for g in ALL_GATES:
            if f"{g}=simulated_ok" not in p.transcript:
                report(name + f" — {g}=simulated_ok", False, "ausente")
                ok = False
        # fake-bin/docker y fake-bin/curl registran CUALQUIER invocación
        # (incluso de solo-lectura) en este único fichero -- vacío/ausente
        # es la única evidencia aceptable de "cero invocaciones reales".
        fake_log = read_transcript(fake_cmd_transcript)
        if fake_log.strip():
            report(name + " — cero invocaciones a docker/curl (fake-bin, argv completo)", False, fake_log)
            ok = False
        else:
            report(name + " — cero invocaciones a docker/curl (fake-bin, argv completo)", True)
        if os.path.exists(secrets_dir):
            report(name + " — ~/.gapssa-secrets nunca se crea (cero secretos escritos)", False, "existe")
            ok = False
        else:
            report(name + " — ~/.gapssa-secrets nunca se crea (cero secretos escritos)", True)
        if ok:
            report(name, True)


# --- Escenario E -------------------------------------------------------
def scenario_dry_run_fresh_E_exit_via_salir():
    name = "Escenario E (dry-run fresco): responder 'salir' termina limpiamente, cero residuos"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-freshdry-e-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fresh_dryrun_fixture_repo(repo)
        home, secrets_dir, env, _transcript = _dry_run_fresh_env(tmp)
        tmp_root_before = {f for f in os.listdir(tempfile.gettempdir()) if f.startswith("gapssa-dryrun-synth.")}

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--dry-run"], env=env, cwd=repo)
        ok = True
        try:
            p.expect("Escribe exactamente")
            p.send_line("confirmo fuera de claude code")
            p.expect(r"Puerta S1")
            p.expect(r"\[si/no/salir\]")
            p.send_line("salir")
            rc = p.wait(timeout=10)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        p.close()

        if rc != 0:
            report(name + " — código de salida 0", False, f"rc={rc}")
            ok = False
        else:
            report(name + " — código de salida 0", True)
        if "Saliendo por decisión tuya" not in p.transcript:
            report(name + " — mensaje de salida limpia", False, "ausente")
            ok = False
        else:
            report(name + " — mensaje de salida limpia", True)
        if os.path.exists(secrets_dir):
            report(name + " — ~/.gapssa-secrets nunca se crea", False, "existe")
            ok = False
        else:
            report(name + " — ~/.gapssa-secrets nunca se crea", True)
        tmp_root_after = {f for f in os.listdir(tempfile.gettempdir()) if f.startswith("gapssa-dryrun-synth.")}
        stray = tmp_root_after - tmp_root_before
        if stray:
            report(name + " — cero temporales sintéticos huérfanos bajo TMPDIR", False, f"{stray}")
            ok = False
        else:
            report(name + " — cero temporales sintéticos huérfanos bajo TMPDIR", True)
        if ok:
            report(name, True)


# --- Escenario F -------------------------------------------------------
def scenario_dry_run_fresh_F_preexisting_real_store_not_adopted():
    name = "Escenario F (dry-run fresco): almacén real preexistente bajo HOME temporal -- nunca leído, nunca adoptado como estado ejecutado"
    with tempfile.TemporaryDirectory(prefix="gapssa-rot-freshdry-f-") as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        sr_dir = build_fresh_dryrun_fixture_repo(repo)
        home, secrets_dir, env, _transcript = _dry_run_fresh_env(tmp)
        seed_real_preexisting_store(secrets_dir)
        before = snapshot_tree(secrets_dir)
        if not before:
            report(name, False, "el almacén real preexistente quedó vacío -- no se puede medir identidad sobre nada")
            return

        p = PtyProcess(["bash", os.path.join(sr_dir, "rotate-all-interactive.sh"), "--dry-run"], env=env, cwd=repo)
        try:
            _auto_pilot_dry_run(p, timeout=240)
            p.wait(timeout=15)
        except TimeoutError as exc:
            report(name, False, str(exc))
            p.close()
            return
        p.close()

        ok = True
        if not assert_no_secret_in_transcript(p.transcript, [REAL_STORE_SENTINEL], name + " — el centinela del almacén real preexistente nunca aparece"):
            ok = False
        after = snapshot_tree(secrets_dir)
        if before != after:
            added = set(after) - set(before)
            removed = set(before) - set(after)
            changed = {k for k in set(before) & set(after) if before[k] != after[k]}
            report(name + " — el almacén real preexistente queda byte a byte intacto", False, f"añadidos={added} eliminados={removed} modificados={changed}")
            ok = False
        else:
            report(name + " — el almacén real preexistente queda byte a byte intacto", True)
        if "Puerta S1" not in p.transcript:
            report(name + " — la sesión simula S1 igualmente, nunca se salta por el 'done' real preexistente", False, "no se vio 'Puerta S1'")
            ok = False
        else:
            report(name + " — la sesión simula S1 igualmente, nunca se salta por el 'done' real preexistente", True)
        for g in ALL_GATES:
            if f"{g}=simulated_ok" not in p.transcript:
                report(name + f" — {g}=simulated_ok pese al almacén real preexistente", False, "ausente")
                ok = False
        if ok:
            report(name, True)


def main():
    if not os.access("/bin/bash", os.X_OK):
        print("bash no disponible — abortando", file=sys.stderr)
        sys.exit(1)

    scenario_s1_only()
    scenario_s1_s2_rotate_postgres()
    scenario_s1_s3_mariadb()
    scenario_s1_s4_espocrm()
    scenario_ctrl_c_mid_gate()
    scenario_resume_after_interrupt()
    scenario_home_with_spaces()
    scenario_unknown_gate()
    scenario_dry_run_identity_s2()
    scenario_restore_real_backup_success_recovery_required()
    scenario_restore_real_backup_s3_recovery_required()
    scenario_orphan_restore_tmp_not_adopted()
    scenario_backup_rehearsal_no_plaintext_watcher()
    scenario_recover_old_secret_value_no_plaintext_watcher()
    scenario_backup_schema_tagging()
    scenario_s6_artifact_reexecution_policy()
    scenario_s6_missing_probe_script_fails_closed()
    scenario_s9_blocked_without_prior_gates()
    scenario_s9_rejects_forward_recovery_required()
    scenario_s3_divergence_root_declined()
    scenario_s3_divergence_root_provided()
    scenario_dry_run_fresh_A_full_traversal()
    scenario_dry_run_fresh_B_skip_s1_blocks_s2()
    scenario_dry_run_fresh_C_s1_accepted_s2_no_physical_requirement()
    scenario_dry_run_fresh_D_zero_mutating_commands()
    scenario_dry_run_fresh_E_exit_via_salir()
    scenario_dry_run_fresh_F_preexisting_real_store_not_adopted()

    print()
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print(f"PASS={passed} FAIL={failed}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
