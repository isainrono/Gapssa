#!/usr/bin/env python3
"""scripts/secrets-rotation/tests/s7_atomic_rotation_rehearsal.py — Bloque 10

Validación DEDICADA de gate_s7() (rotate-all-interactive.sh) contra
Postgres 18 + Redis 8 + MariaDB 11.4 + EspoCRM 10.0.3 DESECHABLES REALES
(mismo proyecto/infra que tests/s1_s9_full_rehearsal.py — reutiliza sus
funciones, nunca las duplica), con filas de `booking_request_records`/
`pending_guest_identities`/`pending_authenticated_contact_details`
SINTÉTICAS pero REALES sembradas con las funciones de producción
(server/crypto/fieldCrypto.ts, server/booking/identityFingerprint.ts,
server/booking/accessToken.ts, hmacSubjectId) vía probes/s7TestFixture*.mts
— nunca datos copiados de GAPSSA real, nunca el almacén real, nunca
Postgres/Redis reales.

gate_s7() se conduce SIEMPRE por PTY real (`--only S7` contra
rotate-all-interactive.sh real) — nunca invocando sus helpers bash por
separado. Los failpoints de escritura
(GAPSSA_ROTATION_TEST_FAILPOINT/GAPSSA_ROTATION_TEST_MIGRATION_PAUSE,
lib/atomicSecretsFileMutate.mjs / probes/s7MigrateAndAudit.mts) están
deshabilitados por defecto, exigen GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL
con el patrón cerrado de un proyecto desechable, y abortan (nunca se
ignoran en silencio) si apuntan al almacén real.

Uso: python3 s7_atomic_rotation_rehearsal.py
Salida: 0 si todo pasó, 1 si algo falló (ver "FAIL").
"""
import json
import os
import re
import secrets as pysecrets
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_driver import PtyProcess  # noqa: E402
import s1_s9_full_rehearsal as base  # noqa: E402 — reutiliza infra/ACL/migraciones, nunca las duplica.

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


GATE_TIMEOUT_SECONDS = 180
_GATE_MARKER_RE = re.compile(r"Puerta (S\d) —")
_S7_CONFIRM_RE = re.compile(r"¿Ejecutar la puerta S7 ahora\?")


def drive_until_s7_confirm(p, mariadb_root_password, timeout=1800):
    """Variante de s1_s9_full_rehearsal.auto_pilot() que responde TODOS los
    prompts conocidos de S1-S6 exactamente igual, pero se DETIENE (nunca
    responde) en cuanto aparece el prompt de confirmación de S7 —
    devuelve con el proceso VIVO, parado justo antes de que gate_s7()
    haga nada. El llamador decide entonces si continuar (respondiendo
    "si") o cerrar limpiamente con SIGINT (S7 ni siquiera ha llamado a
    enter_gate todavía -> ningún backup tomado, ningún estado tocado,
    interrupción totalmente segura)."""
    handlers = [
        (re.compile(r"Escribe exactamente"), lambda: p.send_line("confirmo fuera de claude code")),
        (re.compile(r"¿Generar una frase aleatoria segura ahora \(recomendado\)\?"), lambda: p.send_line("si")),
        (re.compile(r"Pulsa Enter cuando lo hayas hecho"), lambda: p.send_line("")),
        (re.compile(r"Contrase.a ROOT actual de MariaDB:"), lambda: p.send_line(mariadb_root_password or "")),
        (re.compile(r"¿Ejecutar la puerta \w+ ahora\?"), lambda: p.send_line("si")),
    ]
    start = time.time()
    last_len = 0
    current_gate = "(preparación/S1)"
    gate_started_at = start
    while True:
        now = time.time()
        if now - start >= timeout:
            raise TimeoutError(f"drive_until_s7_confirm: tope agotado tras {timeout}s. Puerta actual: {current_gate}.")
        if now - gate_started_at >= GATE_TIMEOUT_SECONDS:
            raise TimeoutError(f"drive_until_s7_confirm: tope POR PUERTA agotado ({GATE_TIMEOUT_SECONDS}s) en {current_gate}.")
        p.read_available(timeout=2)
        if p.proc.poll() is not None:
            raise RuntimeError(f"drive_until_s7_confirm: el proceso terminó antes de llegar a S7 (código {p.proc.returncode}).")
        new_text = p.transcript[last_len:]
        gate_matches = _GATE_MARKER_RE.findall(p.transcript)
        if gate_matches and gate_matches[-1] != current_gate:
            current_gate = gate_matches[-1]
            gate_started_at = time.time()
        if current_gate == "S7" and _S7_CONFIRM_RE.search(new_text):
            return
        for pattern, action in handlers:
            m = pattern.search(new_text)
            if m:
                action()
                last_len = len(p.transcript)
                break


def pin_temp_next_to(target_path, label):
    """Mismo contrato que gapssa_secrets_mktemp_secure_same_dir (lib.sh) —
    ver tests/run_scenarios.py::pin_temp_next_to, duplicado aquí a
    propósito (ficheros de prueba independientes, sin import cruzado)."""
    d = os.path.dirname(target_path)
    base_name = os.path.basename(target_path)
    fd, tmp_path = tempfile.mkstemp(prefix=f".{base_name}.{label}-", dir=d)
    os.close(fd)
    os.chmod(tmp_path, 0o600)
    st = os.stat(tmp_path)
    return tmp_path, str(st.st_dev), str(st.st_ino), str(st.st_uid), oct(stat.S_IMODE(st.st_mode))[2:]


def atomic_mutate(secrets_file, schema_version, mutations, extra_env=None):
    """Invoca lib/atomicSecretsFileMutate.mjs DIRECTAMENTE (la misma
    herramienta real que gate_s7() usa) — para preparar fixtures de
    prueba (p. ej. inyectar v2 en los 4 mapas) reutilizando la
    herramienta de producción en vez de escribir el archivo a mano."""
    tmp_path, dev, ino, uid, mode = pin_temp_next_to(secrets_file, "fixture-prep")
    script = os.path.join(SECRETS_ROTATION_DIR, "lib", "atomicSecretsFileMutate.mjs")
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    res = subprocess.run(
        ["node", script, secrets_file, tmp_path, dev, ino, uid, mode, schema_version],
        input=json.dumps(mutations),
        capture_output=True, text=True, env=env,
    )
    if res.returncode not in (0, 20) and os.path.exists(tmp_path):
        os.remove(tmp_path)
    return res


def run_tsx_json(shadow_root, secrets_file, script_relpath, args, stdin_obj, disposable_label, extra_env=None):
    """Invoca una sonda .mts vía lib/run-tsx.mjs (el mismo lanzador real
    que gate_s7() usa) y parsea su stdout como JSON — nunca una
    reimplementación de la lógica de la sonda en Python."""
    run_tsx = os.path.join(SECRETS_ROTATION_DIR, "lib", "run-tsx.mjs")
    script = os.path.join(SECRETS_ROTATION_DIR, script_relpath)
    env = dict(os.environ)
    env["GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL"] = disposable_label
    if extra_env:
        env.update(extra_env)
    res = subprocess.run(
        ["node", run_tsx, shadow_root, secrets_file, script, *args],
        input=json.dumps(stdin_obj) if stdin_obj is not None else None,
        capture_output=True, text=True, env=env, cwd=shadow_root, timeout=60,
    )
    if res.returncode != 0:
        raise RuntimeError(f"{script_relpath} falló (rc={res.returncode}): stderr={res.stderr!r}")
    return json.loads(res.stdout)


def save_checkpoint(secrets_dir, checkpoint_dir):
    os.makedirs(checkpoint_dir, exist_ok=True)
    shutil.copy2(os.path.join(secrets_dir, ".env.gapssa"), os.path.join(checkpoint_dir, "env.gapssa"))
    shutil.copy2(os.path.join(secrets_dir, ".rotation-status"), os.path.join(checkpoint_dir, "rotation-status"))


def restore_checkpoint(secrets_dir, checkpoint_dir):
    shutil.copy2(os.path.join(checkpoint_dir, "env.gapssa"), os.path.join(secrets_dir, ".env.gapssa"))
    os.chmod(os.path.join(secrets_dir, ".env.gapssa"), 0o600)
    shutil.copy2(os.path.join(checkpoint_dir, "rotation-status"), os.path.join(secrets_dir, ".rotation-status"))


# =====================================================================
# Reproducción del incidente real 2026-08-21 (Bloque 11): un esquema de
# `gapssa_booking` con las migraciones 0007/0008 (email_lookup_hmac_key_version/
# access_token_key_version) SIN aplicar. drizzle-orm no ofrece una forma
# de aplicar "solo hasta la migración N" contra un `migrationsFolder` real
# (readMigrationFiles siempre lee la carpeta COMPLETA que se le pasa) --
# así que para reproducir el esquema VIEJO exacto se construye una carpeta
# de migraciones TRUNCADA (copia real de los .sql/_journal.json del propio
# repositorio, solo hasta el índice pedido -- nunca inventados) y se aplica
# con el MISMO `migrate()` de drizzle-orm/node-postgres/migrator (nunca
# una reimplementación), vía un script Node desechable ejecutado con el
# node_modules real del monorepo (cwd=REPO_ROOT_REAL). Nunca toca el
# checkout real (ni siquiera de lectura fuera de copiar bytes ya
# versionados), nunca la base real.
# =====================================================================

REAL_BOOKING_MIGRATIONS_DIR = os.path.join(REPO_ROOT_REAL, "apps", "web", "drizzle", "booking", "migrations")


def build_truncated_booking_migrations_dir(tmp_root, up_to_count):
    """Copia REAL (nunca inventada) de las primeras `up_to_count` entradas
    del journal real de gapssa_booking + sus .sql — reproduce el esquema
    EXACTO en el que estaba la base real en el incidente 2026-08-21 (7 de
    9 migraciones aplicadas, 0007/0008 pendientes)."""
    with open(os.path.join(REAL_BOOKING_MIGRATIONS_DIR, "meta", "_journal.json"), encoding="utf-8") as f:
        journal = json.load(f)
    truncated_entries = journal["entries"][:up_to_count]
    assert len(truncated_entries) == up_to_count, f"journal real tiene menos de {up_to_count} entradas"

    out_dir = os.path.join(tmp_root, f"booking-migrations-truncated-{up_to_count}")
    os.makedirs(os.path.join(out_dir, "meta"), exist_ok=True)
    with open(os.path.join(out_dir, "meta", "_journal.json"), "w", encoding="utf-8") as f:
        json.dump({**journal, "entries": truncated_entries}, f)
    for entry in truncated_entries:
        tag = entry["tag"]
        shutil.copy2(os.path.join(REAL_BOOKING_MIGRATIONS_DIR, f"{tag}.sql"), os.path.join(out_dir, f"{tag}.sql"))
    return out_dir


def apply_migrations_with_folder(booking_url, migrations_folder):
    """Aplica `migrations_folder` contra `booking_url` con el MISMO
    `migrate()` real de drizzle-orm/node-postgres/migrator (nunca
    reimplementado) -- usado SOLO para preparar el esquema VIEJO del
    fixture (nunca para el paso real que gate_s7a() ejerce, que usa
    runBookingMigrations()/la carpeta REAL completa vía su propio probe)."""
    script = f"""
import {{ migrate }} from 'drizzle-orm/node-postgres/migrator'
import {{ drizzle }} from 'drizzle-orm/node-postgres'
import {{ Pool }} from 'pg'
const pool = new Pool({{ connectionString: process.argv[2] }})
const db = drizzle(pool)
await migrate(db, {{ migrationsFolder: process.argv[3] }})
await pool.end()
console.log('applied')
"""
    # dir=HERE (nunca el temp del sistema): resolución ESM de Node camina
    # hacia ARRIBA desde la ruta del propio fichero que importa buscando
    # node_modules -- un temp fuera del monorepo nunca encuentra
    # drizzle-orm/pg (hallazgo real de la primera ejecución de este bloque).
    tmp_script = tempfile.NamedTemporaryFile(mode="w", suffix=".mjs", delete=False, dir=HERE)
    try:
        tmp_script.write(script)
        tmp_script.close()
        res = subprocess.run(
            ["node", tmp_script.name, booking_url, migrations_folder],
            cwd=REPO_ROOT_REAL, capture_output=True, text=True, timeout=60,
        )
        if res.returncode != 0:
            raise RuntimeError(f"apply_migrations_with_folder falló (rc={res.returncode}): stderr={res.stderr!r}")
    finally:
        os.unlink(tmp_script.name)


def run_only_gate(shadow_root, env, gate, extra_env=None, timeout=180, on_output=None, extra_handlers=None):
    """Lanza `rotate-all-interactive.sh --only <gate>` REAL vía PTY — nunca
    una simulación que invoque helpers bash por separado. Responde los
    prompts genéricos conocidos (más los específicos de `extra_handlers`,
    p. ej. la frase de confirmación propia de S7A); `on_output(p, new_text)`
    (opcional) se llama en cada iteración con el texto nuevo, para que el
    llamante pueda decidir cuándo mandar SIGINT (los escenarios de
    interrupción lo usan). Devuelve el PtyProcess ya cerrado (o SIGKILLed
    por un failpoint, en cuyo caso `.proc.returncode`/`.signal` refleja
    eso)."""
    script = os.path.join(shadow_root, "scripts", "secrets-rotation", "rotate-all-interactive.sh")
    full_env = dict(env)
    if extra_env:
        full_env.update(extra_env)
    p = PtyProcess(["bash", script, "--only", gate], env=full_env, cwd=shadow_root)
    handlers = [
        (re.compile(r"Escribe exactamente 'confirmo fuera de claude code'"), lambda: p.send_line("confirmo fuera de claude code")),
        (re.compile(r"¿Generar una frase aleatoria segura ahora \(recomendado\)\?"), lambda: p.send_line("si")),
        (re.compile(r"Pulsa Enter cuando lo hayas hecho"), lambda: p.send_line("")),
        (re.compile(r"La puerta S7 ya está marcada 'done'\. ¿Repetirla de todos modos\?"), lambda: p.send_line("si")),
    ]
    if extra_handlers:
        handlers = list(extra_handlers) + handlers
    # Genérico "¿Ejecutar la puerta X ahora?" DEBE evaluarse último — algunas
    # puertas (S3A/S7A) tienen SU PROPIA confirmación previa independiente
    # (ask_yes_no + frase exacta) que debe responderse primero.
    handlers.append((re.compile(r"¿Ejecutar la puerta \w+ ahora\?"), lambda: p.send_line("si")))
    start = time.time()
    last_len = 0
    try:
        while True:
            if time.time() - start >= timeout:
                raise TimeoutError(f"run_only_gate({gate}): tope agotado tras {timeout}s. Transcript reciente:\n{p.transcript[last_len:][-2000:]}")
            p.read_available(timeout=1)
            new_text = p.transcript[last_len:]
            if new_text and on_output:
                stop = on_output(p, new_text)
                last_len = len(p.transcript)
                if stop:
                    break
            if p.proc.poll() is not None:
                break
            for pattern, action in handlers:
                m = pattern.search(new_text)
                if m:
                    action()
                    last_len = len(p.transcript)
                    break
            else:
                last_len = len(p.transcript)
        p.wait(timeout=20)
    except TimeoutError:
        raise
    finally:
        p.close()
    return p


def run_only_s7(shadow_root, env, extra_env=None, expect_prompt_answers=True, timeout=180, on_output=None):
    return run_only_gate(shadow_root, env, "S7", extra_env=extra_env, timeout=timeout, on_output=on_output)


def run_only_s7a(shadow_root, env, extra_env=None, timeout=180, on_output=None):
    """`--only S7A` — responde también su confirmación PREVIA e
    INDEPENDIENTE (ask_yes_no genérico + frase exacta 'confirmo
    migraciones s7a', ver gate_s7a()) vía `on_output`, ya que esos
    prompts necesitan el `PtyProcess` que `run_only_gate` crea
    internamente."""
    def on_output_wrapper(p, new_text):
        if re.search(r"¿Confirmas que quieres comprobar/aplicar las migraciones pendientes de gapssa_booking ahora \(S7A\)\?", new_text):
            p.send_line("si")
        elif re.search(r"Escribe exactamente 'confirmo migraciones s7a'", new_text):
            p.send_line("confirmo migraciones s7a")
        if on_output:
            return on_output(p, new_text)
        return False

    return run_only_gate(shadow_root, env, "S7A", extra_env=extra_env, timeout=timeout, on_output=on_output_wrapper)


# =====================================================================
# Especificaciones de fila de fixture (ver probes/s7TestFixtureSeed.mts)
# =====================================================================

def guest_row(aes="v1", fp="v1", at="v1", email="v1", status="pending_verification", corrupt=False):
    return {"kind": "guest", "aesVersion": aes, "fingerprintVersion": fp, "accessTokenVersion": at, "emailHmacVersion": email, "status": status, "corrupt": corrupt}


def authenticated_row(aes="v1", fp="v1", status="pending_verification", corrupt=False):
    return {"kind": "authenticated", "aesVersion": aes, "fingerprintVersion": fp, "status": status, "corrupt": corrupt}


# =====================================================================
# main()
# =====================================================================

def main():
    global FAIL_FAST_ABORTED
    pj = base.Project()
    print(f"Proyecto desechable (Bloque 10, validación dedicada de S7): {pj.name}")

    existing = base.docker("ps", "-aq", "--filter", f"label={base.LABEL_KEY}={pj.name}", check=False).stdout.strip()
    if existing:
        print(f"ERROR: ya existen recursos con el label del proyecto '{pj.name}' — aborta.", file=sys.stderr)
        return 1

    tmp = tempfile.mkdtemp(prefix="gapssa-s7-atomic-rehearsal-")
    shadow_root = os.path.join(tmp, "shadow-repo")
    shadow_home = os.path.join(tmp, "home")
    secrets_dir = os.path.join(shadow_home, ".gapssa-secrets")
    os.makedirs(shadow_home, exist_ok=True)
    checkpoint_dir = os.path.join(tmp, "checkpoint-post-s6-plus-v2")

    before_snapshot = os.path.join(tmp, "inventory-before")
    base.snapshot_real_compose_resources(before_snapshot)

    env_content = base.render_disposable_env(pj)
    base.build_shadow_repo(shadow_root, env_content)
    if not base.verify_shadow_resolves_correctly(shadow_root):
        report("Precondición de seguridad: REPO_ROOT resuelve al repo sombra (nunca al real)", False, "abortado")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1
    report("Precondición de seguridad: REPO_ROOT resuelve al repo sombra (nunca al real)", True)

    fake_ps_dir = base.prepare_fake_ps_only_dir(tmp)
    env = base.base_env(shadow_home, secrets_dir, fake_ps_dir)

    secrets_file = os.path.join(secrets_dir, ".env.gapssa")

    try:
        # ================================================================
        # Infraestructura desechable — MISMA secuencia que
        # s1_s9_full_rehearsal.py (reutilizada, nunca duplicada): compose
        # up, salud, migraciones auth/booking, fixture ACL de S4/S9.
        # ================================================================
        print("\n=== Preparación de infraestructura ===")
        base.compose(shadow_root, pj.name, "up", "-d", check=False)
        for svc in ("apps-db", "espocrm-db", "redis", "espocrm"):
            svc_ok = base.wait_service_healthy(shadow_root, pj.name, svc, timeout=180)
            report(f"Infraestructura: '{svc}' confirma salud", svc_ok)

        auth_url = f"postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_auth}"
        booking_url = f"postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_booking}"
        migrate_env = dict(os.environ)
        migrate_env["DATABASE_URL_AUTH"] = auth_url
        auth_res = subprocess.run(["npm", "run", "auth:db:migrate", "-w", "@gapssa/web"], cwd=REPO_ROOT_REAL, env=migrate_env, capture_output=True, text=True)
        report("Migraciones: gapssa_auth aplicadas", auth_res.returncode == 0, auth_res.stderr[-1500:] if auth_res.returncode != 0 else "")

        # ================================================================
        # Bloque 11 (incidente real 2026-08-21) — preparación para los
        # Escenarios G/H/G' (más abajo, DESPUÉS de la sesión S1→S6 real:
        # tanto gate_s7()::preflight como gate_s7a() importan
        # server/env.ts, que exige el env COMPLETO válido — incluido
        # ESPOCRM_API_KEY, que solo existe tras S4 real — así que
        # '--only S7'/'--only S7A' no pueden invocarse de forma
        # significativa antes de que la sesión S1→S6 termine; hallazgo
        # real de la primera ejecución de este bloque). En vez de migrar
        # gapssa_booking COMPLETO de entrada, primero se aplica SOLO hasta
        # la migración 0006 (journal real truncado — reproduce
        # EXACTAMENTE el esquema en el que estaba la base real cuando
        # ocurrió el incidente: 0007/0008 pendientes) — la sesión S1→S6
        # de abajo nunca toca gapssa_booking, así que corre igual de bien
        # contra este esquema viejo.
        # ================================================================
        print("\n=== Preparación esquema VIEJO (Bloque 11): solo 0000-0006 aplicadas ===")
        old_schema_dir = build_truncated_booking_migrations_dir(tmp, up_to_count=7)
        apply_migrations_with_folder(booking_url, old_schema_dir)
        report("Esquema VIEJO preparado: gapssa_booking tiene exactamente 7 migraciones aplicadas (0007/0008 pendientes)", True)

        base.install_acl_meeting_custom_fields(shadow_root, pj, tmp)
        base.setup_acl_fixture(pj)

        # ================================================================
        # S1→S6 REALES, sesión continua, detenida justo antes de que S7
        # haga nada (nunca --only por puerta aquí: la frase de
        # recuperación de backup vive solo en memoria del proceso, mismo
        # motivo que s1_s9_full_rehearsal.py::run_full_rotation).
        # ================================================================
        print("\n=== S1→S6 reales (sesión continua, detenida antes de S7) ===")
        script = os.path.join(shadow_root, "scripts", "secrets-rotation", "rotate-all-interactive.sh")
        p = PtyProcess(["bash", script], env=env, cwd=shadow_root)
        try:
            drive_until_s7_confirm(p, mariadb_root_password=pj.mariadb_root_password, timeout=900)
            p.sigint()
            p.wait(timeout=15)
        finally:
            p.close()

        status = base.read_status(secrets_dir)
        for g in ("S1", "S2", "S3", "S4", "S5"):
            report(f"Precondición: {g}=done tras la preparación S1-S6", status.get(g) == "done", status)
        report("Precondición: S6=prepared tras la preparación S1-S6 (verificación dinámica real la hace S9, fuera de alcance de este bloque)", status.get("S6") == "prepared", status)
        report("Precondición: S7 sigue 'pending' (nunca tocado por la interrupción limpia antes de enter_gate)", status.get("S7") in (None, "pending"), status)

        # v2 en los 4 mapas versionados — simula un almacén que YA pasó por
        # una rotación anterior incompleta (v1+v2 conviviendo), usando la
        # MISMA herramienta atómica real (nunca escrito a mano).
        v2_mutations = [
            {"op": "json-map-generate", "key": "BOOKING_FIELD_ENCRYPTION_KEYS", "versionKey": "v2", "bytes": 32, "format": "base64"},
            {"op": "json-map-generate", "key": "BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS", "versionKey": "v2", "bytes": 32, "format": "base64"},
        ]
        res = atomic_mutate(secrets_file, "active", v2_mutations)
        report("Preparación: v2 añadido a los 2 mapas que lo necesitan (AES, fingerprint) con la herramienta atómica real", res.returncode == 0, res.stderr)

        save_checkpoint(secrets_dir, checkpoint_dir)
        report("Checkpoint post-S6(+v2) guardado", os.path.exists(os.path.join(checkpoint_dir, "env.gapssa")))

        s7_env = dict(env)
        s7_env["GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL"] = pj.name

        def seed(rows):
            return run_tsx_json(shadow_root, secrets_file, "probes/s7TestFixtureSeed.mts", [], {"rows": rows}, pj.name)

        def verify(rows):
            return run_tsx_json(shadow_root, secrets_file, "probes/s7TestFixtureVerify.mts", [], {"rows": rows}, pj.name)

        def counts(versions):
            return run_tsx_json(shadow_root, secrets_file, "probes/s7TestFixtureCounts.mts", [], {"versions": versions}, pj.name)

        def resolve(booking_request_id):
            return run_tsx_json(shadow_root, secrets_file, "probes/s7TestFixtureResolve.mts", [booking_request_id], None, pj.name)

        def reset_booking_tables():
            # Vía el mismo cliente Drizzle real que el resto de sondas
            # (nunca pg_exec/docker run psql, cuyo resultado no se
            # comprobaba — bug real encontrado por este mismo bloque: un
            # TRUNCATE fallido ahí se descartaba en silencio y dejaba
            # filas de un escenario anterior contaminando el siguiente).
            # La propia sonda verifica recuento cero antes de devolver
            # éxito — nunca "se ejecutó sin error" a secas.
            result = run_tsx_json(shadow_root, secrets_file, "probes/s7TestFixtureReset.mts", [], None, pj.name)
            if not result.get("truncated"):
                raise RuntimeError(f"reset_booking_tables: la sonda no confirmó recuento cero: {result}")

        def active_version_map():
            content = base.read_secrets_file(secrets_dir)
            out = {}
            for key in ("BOOKING_FIELD_ENCRYPTION_KEYS", "BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS", "BOOKING_EMAIL_LOOKUP_HMAC_SECRETS", "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS"):
                val = base.field_from_secrets_file(secrets_dir, key)
                out[key] = sorted(json.loads(val).keys()) if val else []
            return out

        def v3_value_of(mapkey):
            val = base.field_from_secrets_file(secrets_dir, mapkey)
            return json.loads(val).get("v3") if val else None

        # ============================================================
        # Escenario G — gate_s7() bloquea LIMPIAMENTE por preflight contra
        # el esquema VIEJO real (0007/0008 pendientes, preparado arriba) —
        # SIN generar ni activar v3 en ningún mapa, SIN tocar Postgres.
        # Escenario H — gate_s7a() aplica EXACTAMENTE las migraciones que
        # faltan con el runner oficial, tras un backup estructural
        # verificado, y confirma los invariantes del backfill de 0008.
        # Escenario G' — tras S7A, gate_s7() ya NO bloquea por esquema
        # (preflight ready=true) — interrumpida DELIBERADAMENTE justo
        # después (nunca se deja completar aquí: el checkpoint post-S6 de
        # arriba debe seguir sirviendo, sin cambios, a los Escenarios A-F).
        # ============================================================
        print("\n=== Escenario G: gate_s7() bloquea por preflight contra el esquema VIEJO (cero mutación) ===")
        restore_checkpoint(secrets_dir, checkpoint_dir)
        reset_booking_tables()
        env_snapshot_before_g = base.read_secrets_file(secrets_dir)
        p_g = run_only_gate(shadow_root, env, "S7", timeout=120)
        status_g = base.read_status(secrets_dir)
        report("Escenario G: S7 termina 'blocked' (preflight — nunca 'failed', nunca 'done')", status_g.get("S7") == "blocked", {"status": status_g, "tail": p_g.transcript[-2500:]})
        report("Escenario G: el mensaje de bloqueo apunta a S7A", "S7A" in p_g.transcript[-3000:], p_g.transcript[-3000:])
        env_snapshot_after_g = base.read_secrets_file(secrets_dir)
        report("Escenario G: el archivo externo queda BYTE A BYTE intacto (v3 JAMÁS se generó/activó — preflight corta ANTES de la primera mutación)", env_snapshot_before_g == env_snapshot_after_g, "difiere")
        maps_g = active_version_map()
        for key, versions in maps_g.items():
            report(f"Escenario G: {key} NUNCA contiene v3", "v3" not in versions, versions)

        print("\n=== Escenario H: gate_s7a() aplica las migraciones que faltan, verifica, y deja listo ===")
        p_h = run_only_s7a(shadow_root, env, timeout=180)
        status_h = base.read_status(secrets_dir)
        report("Escenario H: S7A termina 'done'", status_h.get("S7A") == "done", {"status": status_h, "tail": p_h.transcript[-2500:]})
        report("Escenario H: S7A creó un backup estructural verificado", "backup estructural verificado" in p_h.transcript, p_h.transcript[-3000:])
        report("Escenario H: S7A aplicó las migraciones con el runner oficial", "migraciones aplicadas" in p_h.transcript, p_h.transcript[-3000:])
        report("Escenario H: S7A verificó los invariantes del backfill", '"invariantsOk":true' in p_h.transcript, p_h.transcript[-3000:])
        env_snapshot_after_h = base.read_secrets_file(secrets_dir)
        report("Escenario H: S7A NUNCA tocó \\$SECRETS_FILE (archivo externo byte a byte intacto)", env_snapshot_after_g == env_snapshot_after_h, "difiere")

        # Reejecución de S7A tras quedar 'done': el propio preflight ya
        # informa ready=true -> no-op explícito, nunca reaplica nada.
        p_h2 = run_only_s7a(shadow_root, env, timeout=60)
        report("Escenario H (reejecución tras 'done'): S7A no vuelve a aplicar nada (mensaje explícito de 'nada que hacer')", "nada que hacer" in p_h2.transcript, p_h2.transcript[-2000:])

        print("\n=== Escenario G' (tras S7A): gate_s7() ya NO bloquea por esquema — preflight ready=true ===")
        preflight_ready_seen = {"value": False}

        def on_output_g2(p, new_text, seen=preflight_ready_seen):
            if not seen["value"] and re.search(r"Esquema real de gapssa_booking listo", new_text):
                seen["value"] = True
                p.sigint()
            return False

        run_only_gate(shadow_root, env, "S7", timeout=60, on_output=on_output_g2)
        report("Escenario G' (tras S7A): el mensaje de preflight 'listo' SÍ apareció (el bloqueo del Escenario G ya no ocurre)", preflight_ready_seen["value"])
        status_g2 = base.read_status(secrets_dir)
        report("Escenario G' (tras S7A): S7 pasa de 'blocked' a 'rollback_required' (interrumpida DESPUÉS del preflight, nunca vuelve a bloquearse por esquema)", status_g2.get("S7") == "rollback_required", status_g2)

        # Restaura el checkpoint (estado + archivo) para que los
        # Escenarios A-F de abajo arranquen EXACTAMENTE igual que si
        # G/H/G' nunca se hubieran ensayado.
        restore_checkpoint(secrets_dir, checkpoint_dir)
        report("Escenario G' (limpieza): checkpoint post-S6(+v2) restaurado — S7 vuelve a 'pending'", base.read_status(secrets_dir).get("S7") in (None, "pending"), base.read_status(secrets_dir))

        # ============================================================
        # Escenario A — camino feliz completo, sin interrupción.
        # ============================================================
        print("\n=== Escenario A: camino feliz completo ===")
        restore_checkpoint(secrets_dir, checkpoint_dir)
        reset_booking_tables()
        # Camino feliz = las 5 familias pueden retirar limpiamente. AES y
        # email-lookup son independientes del status (migran siempre); pero
        # fingerprint/access-token SOLO se retiran cuando ya no queda
        # ninguna solicitud SIN RESOLVER que los referencie (por diseño,
        # ver rotationSafetyChecks.ts) — así que el camino feliz real usa
        # solicitudes YA resueltas (típico: rotar bastante después de que
        # el negocio ya se completó), nunca 'pending_verification' viva.
        seed_result = seed([guest_row(aes="v1", fp="v1", status="resolved"), guest_row(aes="v2", fp="v2", status="resolved"), authenticated_row(aes="v1", fp="v1", status="resolved"), authenticated_row(aes="v2", fp="v2", status="resolved")])
        rows_a = seed_result["created"]

        p = run_only_s7(shadow_root, s7_env, timeout=180)
        transcript_a = p.transcript
        status = base.read_status(secrets_dir)
        report("Escenario A: S7 termina exactamente 'done'", status.get("S7") == "done", status)
        maps = active_version_map()
        report("Escenario A: los 4 mapas quedan SOLO con v3 (v1/v2 retirados)", all(v == ["v3"] for v in maps.values()), maps)
        for key in ("BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION", "BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION", "BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION", "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION"):
            report(f"Escenario A: {key}=v3", base.field_from_secrets_file(secrets_dir, key) == "v3")
        c = counts(["v1", "v2"])
        report("Escenario A: recuentos frescos en cero para v1/v2 en las 4 familias", all(x.get("v1", 0) == 0 and x.get("v2", 0) == 0 for x in c.values()), c)
        verify_rows = [{"kind": r["kind"], "identityId": r["identityId"]} for r in rows_a]
        vres = verify(verify_rows)
        report("Escenario A: TODAS las filas descifran y son lógicamente equivalentes con el mapa FINAL (solo v3)", vres["allOk"], vres)
        report("Escenario A: TODAS las filas quedaron en keyVersion=v3 tras retirar", all(kv == "v3" for r in vres["rows"] for kv in r["keyVersions"].values()), vres)
        report("Escenario A: isValidInternalApiSecret verificado (nuevo aceptado, anterior rechazado, ausente rechazado) — SOLO a nivel de función real, NUNCA una petición HTTP contra apps/web real (que no arranca hasta S9)", '"newAccepted":true' in transcript_a and '"oldRejected":true' in transcript_a and '"absentRejected":true' in transcript_a, transcript_a[-3000:])

        v3_by_map_a = {k: v3_value_of(k) for k in maps}

        # Reejecución idempotente — S7 ya 'done', repetirla no debe
        # regenerar v3 en ningún mapa.
        p2 = run_only_s7(shadow_root, s7_env, timeout=120)
        status2 = base.read_status(secrets_dir)
        report("Escenario A (reejecución): S7 sigue 'done'", status2.get("S7") == "done", status2)
        v3_by_map_a2 = {k: v3_value_of(k) for k in maps}
        report("Escenario A (reejecución): v3 NUNCA cambia en ningún mapa (idempotente, sin generar otro v3)", v3_by_map_a == v3_by_map_a2, {"antes": v3_by_map_a, "despues": v3_by_map_a2})

        # ============================================================
        # Escenario I (Bloque 11, incidente real 2026-08-21) — corte real
        # (SIGKILL) DESPUÉS de que v3 quede activo en los 4 mapas
        # versionados, ANTES de la primera consulta real de
        # probes/s7MigrateAndAudit.mts (el punto EXACTO del incidente
        # real, reproducido con el mismo failpoint de auto-SIGKILL que
        # Escenario E/F ya prueban para otras fronteras). Demuestra que
        # gate_s7() queda en 'forward_recovery_required' (nunca 'failed'
        # simple) y que reanudar completa la rotación normalmente, sin
        # regenerar v3.
        # ============================================================
        print("\n=== Escenario I: SIGKILL real justo antes de la primera consulta de migración (v3 ya activo) ===")
        restore_checkpoint(secrets_dir, checkpoint_dir)
        reset_booking_tables()
        seed_result_i = seed([guest_row(aes="v1", fp="v1", status="resolved"), guest_row(aes="v2", fp="v2", status="resolved")])
        rows_i = seed_result_i["created"]

        crash_env_i = {
            "GAPSSA_ROTATION_TEST_MIGRATION_PAUSE": "before-migration",
            "GAPSSA_ROTATION_TEST_MIGRATION_CRASH": "1",
            "GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL": pj.name,
        }
        p_i = run_only_s7(shadow_root, s7_env, extra_env=crash_env_i, timeout=60)
        report("Escenario I: la puerta termina en fallo limpio (rc != 0) tras el SIGKILL real del proceso de migración, ANTES de su primera consulta", p_i.proc.returncode != 0, f"returncode={p_i.proc.returncode}")
        status_i_crash = base.read_status(secrets_dir)
        report("Escenario I: S7 queda 'forward_recovery_required' tras el corte — NUNCA 'failed' simple, NUNCA 'rollback_required' (el corte es un fallo real DENTRO de la puerta, no una señal externa al proceso bash)", status_i_crash.get("S7") == "forward_recovery_required", status_i_crash)
        maps_i_crash = active_version_map()
        report("Escenario I: v3 SÍ quedó activo en los 4 mapas versionados pese al corte (la frontera ya se había cruzado)", all("v3" in v for v in maps_i_crash.values()), maps_i_crash)
        for key in ("BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION", "BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION", "BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION", "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION"):
            report(f"Escenario I: {key}=v3 pese al corte", base.field_from_secrets_file(secrets_dir, key) == "v3")
        report("Escenario I: v1/v2 SIGUEN presentes (convivencia dual — nada se retiró, la migración/reindexado nunca llegó a su primera consulta)", "v1" in maps_i_crash["BOOKING_FIELD_ENCRYPTION_KEYS"] and "v2" in maps_i_crash["BOOKING_FIELD_ENCRYPTION_KEYS"], maps_i_crash)
        v3_i_before_resume = {k: v3_value_of(k) for k in maps_i_crash}
        env_snapshot_i_crash = base.read_secrets_file(secrets_dir)

        p_i2 = run_only_s7(shadow_root, s7_env, timeout=180)
        status_i2 = base.read_status(secrets_dir)
        report("Escenario I (reanudación): S7 termina 'done'", status_i2.get("S7") == "done", status_i2)
        v3_i_after_resume = {k: v3_value_of(k) for k in maps_i_crash}
        report("Escenario I (reanudación): v3 NUNCA cambia en ningún mapa (reanuda desde el v3 existente, nunca regenera)", v3_i_before_resume == v3_i_after_resume, {"antes": v3_i_before_resume, "despues": v3_i_after_resume})
        verify_rows_i = [{"kind": r["kind"], "identityId": r["identityId"]} for r in rows_i]
        vres_i = verify(verify_rows_i)
        report("Escenario I (reanudación): todas las filas descifran con el mapa FINAL (solo v3)", vres_i["allOk"], vres_i)
        report("Escenario I: en ningún momento se OFRECIÓ restaurar un backup (el prompt '¿Intentar restaurar el backup...' es EXCLUSIVO de la rama no-S7 de confirm_gate — nunca debe aparecer aquí)", "Intentar restaurar el backup" not in p_i.transcript and "Intentar restaurar el backup" not in p_i2.transcript, "prompt de restauración de backup encontrado en el transcript")

        # ============================================================
        # Escenario B — fila corrupta/no descifrable.
        # ============================================================
        print("\n=== Escenario B: fila corrupta/no descifrable ===")
        restore_checkpoint(secrets_dir, checkpoint_dir)
        reset_booking_tables()
        seed_result_b = seed([guest_row(aes="v1", fp="v1"), guest_row(aes="v1", fp="v1", corrupt=True)])
        rows_b = seed_result_b["created"]
        control_row = rows_b[0]
        corrupt_row = rows_b[1]

        p = run_only_s7(shadow_root, s7_env, timeout=180)
        status = base.read_status(secrets_dir)
        report("Escenario B: la migración falla CERRADA — S7 NUNCA queda 'done'", status.get("S7") != "done", status)
        # Bloque 11: el fallo real de descifrado ocurre DENTRO de
        # probes/s7MigrateAndAudit.mts, DESPUÉS de que v3 ya quedara
        # activo en los 4 mapas (generar+activar ya corrieron antes de
        # invocar esta sonda) — la frontera de _s7_leave_forward_recovery_required
        # ya se cruzó, así que el estado correcto es 'forward_recovery_required',
        # nunca 'failed' simple (que antes de este bloque sugería, de
        # forma incorrecta, que reintentar desde cero era equivalente a
        # reanudar).
        report("Escenario B: S7 queda 'forward_recovery_required' (fallo real de migración DESPUÉS de activar v3, distinto de 'blocked' y de 'failed' simple)", status.get("S7") == "forward_recovery_required", status)
        maps_b = active_version_map()
        report("Escenario B: NINGUNA clave antigua se retira — v1 sigue presente en BOOKING_FIELD_ENCRYPTION_KEYS (mapa dual permanece)", "v1" in maps_b["BOOKING_FIELD_ENCRYPTION_KEYS"], maps_b)
        vres_control = verify([{"kind": "guest", "identityId": control_row["identityId"]}])
        report("Escenario B: la fila VÁLIDA sigue descifrable y lógicamente equivalente (ninguna fila válida se pierde/queda ilegible)", vres_control["allOk"], vres_control)
        vres_corrupt = verify([{"kind": "guest", "identityId": corrupt_row["identityId"], "expectCorrupt": True}])
        report("Escenario B: la fila corrupta SIGUE sin descifrar (nunca se 'arregla' ni se pierde en silencio)", vres_corrupt["allOk"], vres_corrupt)

        # ============================================================
        # Escenario C — retiro bloqueado + resolución + reejecución.
        # ============================================================
        print("\n=== Escenario C: retiro bloqueado, resuelto, reejecutado ===")
        restore_checkpoint(secrets_dir, checkpoint_dir)
        reset_booking_tables()
        seed_result_c = seed([guest_row(aes="v1", fp="v1", status="resolved"), guest_row(aes="v1", fp="v1", status="pending_approval")])
        rows_c = seed_result_c["created"]
        blocker_booking_request_id = rows_c[1]["bookingRequestId"]

        p = run_only_s7(shadow_root, s7_env, timeout=180)
        status = base.read_status(secrets_dir)
        report("Escenario C: S7 termina 'blocked' (una familia con dependiente vivo)", status.get("S7") == "blocked", {"status": status, "transcript_tail": p.transcript[-3000:]} if status.get("S7") != "blocked" else status)
        maps_c = active_version_map()
        report("Escenario C: BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS retiene v1 (mapa dual — fingerprint bloqueado)", "v1" in maps_c["BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS"], maps_c)
        report("Escenario C: BOOKING_FIELD_ENCRYPTION_KEYS SÍ retira v1 (AES no depende del status vivo/resuelto)", maps_c["BOOKING_FIELD_ENCRYPTION_KEYS"] == ["v3"], maps_c)
        v3_fp_before = v3_value_of("BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS")

        resolve(blocker_booking_request_id)
        p2 = run_only_s7(shadow_root, s7_env, timeout=120)
        status2 = base.read_status(secrets_dir)
        report("Escenario C (tras resolver el bloqueo): S7 termina 'done'", status2.get("S7") == "done", status2)
        maps_c2 = active_version_map()
        report("Escenario C (tras resolver): BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS ahora SOLO v3", maps_c2["BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS"] == ["v3"], maps_c2)
        v3_fp_after = v3_value_of("BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS")
        report("Escenario C: v3 de fingerprint NUNCA cambió entre el bloqueo y la reejecución tras resolver", v3_fp_before == v3_fp_after, {"antes": v3_fp_before, "despues": v3_fp_after})

        save_checkpoint(secrets_dir, os.path.join(tmp, "checkpoint-c-resolved-done"))

        # ============================================================
        # Escenario E — corte real (SIGKILL) DURANTE el retiro de una
        # familia, vía el mismo failpoint de escritura ya probado a nivel
        # de primitiva, ahora disparado dentro de gate_s7() REAL.
        # Reutiliza el checkpoint de C justo ANTES de resolver el bloqueo
        # (generar/activar/migrar ya son no-op en la reejecución; el
        # ÚNICO escrito real que queda es el retiro de fingerprint).
        # ============================================================
        print("\n=== Escenario E: SIGKILL real durante el retiro de una familia (failpoint de escritura) ===")
        restore_checkpoint(secrets_dir, checkpoint_dir)
        reset_booking_tables()
        seed_result_e = seed([guest_row(aes="v1", fp="v1", status="resolved"), guest_row(aes="v1", fp="v1", status="pending_approval")])
        blocker_booking_request_id_e = seed_result_e["created"][1]["bookingRequestId"]
        p_e1 = run_only_s7(shadow_root, s7_env, timeout=180)  # deja S7 en 'blocked', igual que C.
        status_e1 = base.read_status(secrets_dir)
        report("Escenario E: precondición — S7 queda 'blocked' antes de ensayar el corte", status_e1.get("S7") == "blocked", {"status": status_e1, "transcript_tail": p_e1.transcript[-2000:]})
        resolve(blocker_booking_request_id_e)
        maps_e_before = active_version_map()
        env_snapshot_before = base.read_secrets_file(secrets_dir)

        # El SIGKILL solo mata al hijo Node (atomicSecretsFileMutate.mjs) —
        # bash lo ve como un exit code no-cero de la sustitución de
        # comando ($rc=137), lo captura con la comprobación normal de
        # _s7_apply_mutations y llama a _s7_leave_forward_recovery_required
        # "S7" (Bloque 11 — este corte ocurre reti­rando fingerprint,
        # MUY por detrás de la frontera de activación de v3) — el
        # proceso bash termina de forma ORDENADA con exit != 0, nunca
        # colgado ni el intérprete completo abatido por la señal (esa es
        # justo la garantía que se está demostrando: el corte real ocurre
        # DENTRO de la escritura atómica, y gate_s7() lo convierte en un
        # fallo limpio y reanudable, nunca en un estado ambiguo).
        crash_env = {"GAPSSA_ROTATION_TEST_FAILPOINT": "after-fsync-before-rename", "GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL": pj.name}
        p = run_only_s7(shadow_root, s7_env, extra_env=crash_env, timeout=60)
        report("Escenario E: la puerta termina en fallo limpio (rc != 0) tras el SIGKILL real del escritor atómico durante el retiro", p.proc.returncode != 0, f"returncode={p.proc.returncode}")
        status_e_crash = base.read_status(secrets_dir)
        report("Escenario E: S7 queda 'forward_recovery_required' tras el corte (nunca 'done' con una escritura a medias, nunca 'failed' simple — v3 ya activo)", status_e_crash.get("S7") == "forward_recovery_required", status_e_crash)
        env_snapshot_after_crash = base.read_secrets_file(secrets_dir)
        report("Escenario E: el archivo externo queda BYTE A BYTE intacto tras el corte (rename nunca llegó a ejecutarse)", env_snapshot_before == env_snapshot_after_crash, "difiere")
        maps_e_after_crash = active_version_map()
        report("Escenario E: mapa dual conservado tras el corte (fingerprint sigue con v1)", "v1" in maps_e_after_crash["BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS"], maps_e_after_crash)

        p2 = run_only_s7(shadow_root, s7_env, timeout=120)
        status_e2 = base.read_status(secrets_dir)
        report("Escenario E (reanudación tras el corte): S7 termina 'done'", status_e2.get("S7") == "done", status_e2)
        maps_e_final = active_version_map()
        report("Escenario E (reanudación): fingerprint ahora SOLO v3", maps_e_final["BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS"] == ["v3"], maps_e_final)

        # ============================================================
        # Escenario D — SIGINT REAL en cada frontera de gate_s7() (vía
        # PTY, el proceso completo, nunca un helper aislado).
        # ============================================================
        boundaries = [
            ("after-generar-v3", re.compile(r"generar-v3:")),
            ("after-activar-v3", re.compile(r"activar-v3:")),
            ("during-migration", re.compile(r"GAPSSA_ROTATION_TEST_MIGRATION_PAUSE_REACHED=after-aes-v1")),
            ("after-migrate-before-retire", re.compile(r"Resultado \(solo conteos/booleanos")),
        ]
        for boundary_name, marker_re in boundaries:
            print(f"\n=== Escenario D ({boundary_name}): SIGINT real en esta frontera ===")
            restore_checkpoint(secrets_dir, checkpoint_dir)
            reset_booking_tables()
            # status="resolved": la reanudación sin interrumpir debe llegar
            # a 'done' de verdad (las 5 familias retiran limpio) — mismo
            # motivo que el Escenario A.
            seed_result_d = seed([guest_row(aes="v1", fp="v1", status="resolved"), guest_row(aes="v2", fp="v2", status="resolved")])
            rows_d = seed_result_d["created"]

            extra_env_d = {}
            if boundary_name == "during-migration":
                extra_env_d = {"GAPSSA_ROTATION_TEST_MIGRATION_PAUSE": "after-aes-v1", "GAPSSA_ROTATION_TEST_MIGRATION_PAUSE_MS": "6000", "GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL": pj.name}

            sigint_sent = {"value": False}

            def on_output(p, new_text, marker_re=marker_re, sigint_sent=sigint_sent):
                if not sigint_sent["value"] and marker_re.search(new_text):
                    p.sigint()
                    sigint_sent["value"] = True
                return False

            run_only_s7(shadow_root, s7_env, extra_env=extra_env_d, timeout=60, on_output=on_output)
            report(f"Escenario D ({boundary_name}): la interrupción SÍ se disparó (el marcador de esta frontera apareció de verdad)", sigint_sent["value"])
            status_d = base.read_status(secrets_dir)
            report(f"Escenario D ({boundary_name}): S7 queda 'rollback_required' tras la interrupción", status_d.get("S7") == "rollback_required", status_d)
            maps_d = active_version_map()
            report(f"Escenario D ({boundary_name}): ningún mapa quedó vacío/corrupto tras la interrupción", all(len(v) >= 1 for v in maps_d.values()), maps_d)
            verify_rows_d = [{"kind": r["kind"], "identityId": r["identityId"]} for r in rows_d]
            vres_d = verify(verify_rows_d)
            report(f"Escenario D ({boundary_name}): todas las filas siguen descifrables tras la interrupción", vres_d["allOk"], vres_d)

            # Reanudación hacia delante: relanzar sin interrumpir debe
            # llegar a 'done' y v3 debe ser el MISMO en cada mapa donde ya
            # existiera antes de la interrupción (nunca regenerado).
            v3_before_resume = {k: v3_value_of(k) for k in maps_d if v3_value_of(k) is not None}
            run_only_s7(shadow_root, s7_env, timeout=120)
            status_d2 = base.read_status(secrets_dir)
            report(f"Escenario D ({boundary_name}, reanudación): S7 termina 'done'", status_d2.get("S7") == "done", status_d2)
            v3_after_resume = {k: v3_value_of(k) for k in v3_before_resume}
            report(f"Escenario D ({boundary_name}, reanudación): v3 no cambia para ningún mapa que ya lo tuviera antes de interrumpir", v3_before_resume == v3_after_resume, {"antes": v3_before_resume, "despues": v3_after_resume})
            vres_d2 = verify(verify_rows_d)
            report(f"Escenario D ({boundary_name}, reanudación): todas las filas descifran con el mapa FINAL", vres_d2["allOk"], vres_d2)

        # ============================================================
        # Escenario F — corte tras rotar BOOKING_INTERNAL_API_SECRET,
        # antes de verificarlo: demuestra que ni consumidores ni almacén
        # quedan descoordinados (el valor en disco SIEMPRE es completo —
        # ya probado por el failpoint de escritura — y SIEMPRE se
        # reverifica antes de 'done' en la reanudación).
        # ============================================================
        print("\n=== Escenario F: corte tras rotar BOOKING_INTERNAL_API_SECRET, antes de verificarlo ===")
        restore_checkpoint(secrets_dir, os.path.join(tmp, "checkpoint-c-resolved-done"))
        # Resetea la BD: el checkpoint solo fija el archivo externo (Bloque
        # 10 encontró exactamente este bug) — sin esto, filas que dejó el
        # último escenario D (cifradas bajo SU PROPIO v3, un valor real
        # distinto aunque comparta la misma etiqueta "v3") quedarían
        # ilegibles con el v3 de ESTE checkpoint y bloquearían AES sin
        # relación alguna con lo que este escenario prueba de verdad
        # (rotación de BOOKING_INTERNAL_API_SECRET, sin filas).
        reset_booking_tables()
        old_internal_secret = base.field_from_secrets_file(secrets_dir, "BOOKING_INTERNAL_API_SECRET")

        crash_env_f = {"GAPSSA_ROTATION_TEST_FAILPOINT": "after-rename", "GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL": pj.name}
        p = run_only_s7(shadow_root, s7_env, extra_env=crash_env_f, timeout=60)
        report("Escenario F: la puerta termina en fallo limpio (rc != 0) — bash nunca puede distinguir 'el rename sí ocurrió' de un corte real, así que trata el hijo muerto como fallo pase lo que pase", p.proc.returncode != 0)
        status_f_crash = base.read_status(secrets_dir)
        # Bloque 11: BOOKING_INTERNAL_API_SECRET se rota DESPUÉS de que v3
        # ya sea la versión activa de los 4 mapas — la frontera ya se
        # cruzó, así que 'forward_recovery_required', nunca 'failed'.
        report("Escenario F: S7 queda 'forward_recovery_required' tras el corte (nunca 'done' con un secreto sin verificar, nunca 'failed' simple — v3 ya activo)", status_f_crash.get("S7") == "forward_recovery_required", status_f_crash)
        mid_internal_secret = base.field_from_secrets_file(secrets_dir, "BOOKING_INTERNAL_API_SECRET")
        report("Escenario F: el valor en disco tras el corte es COMPLETO y distinto del anterior (nunca parcial — atomicidad ya probada a nivel de primitiva; el rename SÍ llegó a ejecutarse antes del corte)", mid_internal_secret != old_internal_secret and len(mid_internal_secret) > 0)

        p2 = run_only_s7(shadow_root, s7_env, timeout=120)
        transcript_f2 = p2.transcript
        status_f2 = base.read_status(secrets_dir)
        report("Escenario F (reanudación): S7 termina 'done' — el secreto que quedó SIN verificar se rota de nuevo y SÍ se verifica antes de 'done'", status_f2.get("S7") == "done", status_f2)
        final_internal_secret = base.field_from_secrets_file(secrets_dir, "BOOKING_INTERNAL_API_SECRET")
        report("Escenario F (reanudación): el secreto interno vuelve a rotar (no-idempotente por diseño — nunca reutiliza el valor sin verificar del corte)", final_internal_secret != mid_internal_secret)
        report("Escenario F (reanudación): verificación real registrada (nuevo aceptado/anterior rechazado/ausente rechazado)", '"newAccepted":true' in transcript_f2 and '"oldRejected":true' in transcript_f2 and '"absentRejected":true' in transcript_f2, transcript_f2[-3000:])

        # ================================================================
        # Teardown.
        # ================================================================
        print("\n--- Teardown ---")
    finally:
        base.compose(shadow_root, pj.name, "down", "-v", "--remove-orphans", check=False, timeout=180)
        for kind, flag in (("containers", "ps"), ("networks", "network"), ("volumes", "volume")):
            if flag == "ps":
                leftover = base.docker("ps", "-aq", "--filter", f"label={base.LABEL_KEY}={pj.name}", check=False).stdout.strip()
            else:
                leftover = base.docker(flag, "ls", "-q", "--filter", f"label={base.LABEL_KEY}={pj.name}", check=False).stdout.strip()
            report(f"Teardown: cero {kind} residuales con el label del proyecto desechable", leftover == "", leftover)
        after_snapshot = os.path.join(tmp, "inventory-after")
        base.snapshot_real_compose_resources(after_snapshot)
        with open(before_snapshot) as f1, open(after_snapshot) as f2:
            same_inventory = f1.read() == f2.read()
        report("Teardown: inventario Docker real (todos los proyectos compose) idéntico antes/después", same_inventory)
        shutil.rmtree(tmp, ignore_errors=True)
        report("Teardown: directorio temporal del ensayo eliminado", not os.path.exists(tmp))

    print()
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print(f"PASS={passed} FAIL={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
