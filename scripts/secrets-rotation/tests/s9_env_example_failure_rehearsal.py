#!/usr/bin/env python3
"""scripts/secrets-rotation/tests/s9_env_example_failure_rehearsal.py — Bloque 6

Ensayo REAL, desechable, del escenario dedicado pendiente que
`scripts/secrets-rotation/README.md` señalaba como no cubierto: `.env.example`
corrupto (una variable sensible con un valor que NO tiene forma de
placeholder) en el momento en que `gate_s9` de `rotate-all-interactive.sh`
lo verifica, sobre el script interactivo REAL bajo PTY (nunca una prueba
unitaria del helper por sí sola — eso vive en
`lib/verifyEnvExample.test.mjs`, que cubre ausente/ilegible/corrupto/
incompleto a nivel de algoritmo).

Reutiliza EXACTAMENTE la misma infraestructura y las mismas funciones que
`s1_s9_full_rehearsal.py` (Postgres 18 + MariaDB 11.4 + Redis 8 + EspoCRM
10.0.3 + apps/web real, todo desechable, mismo "repo sombra") — la ÚNICA
diferencia deliberada es que, antes de arrancar la sesión S1→S9, se
sustituye el `.env.example` del repo sombra (que por defecto es un
symlink al `.env.example` REAL, ver `SHADOW_LINK_ENTRIES` en
`s1_s9_full_rehearsal.py`) por un fichero REGULAR NUEVO con un valor
sensible sin forma de placeholder. Sustituir el symlink es seguro: borrar
un symlink nunca toca su destino, y escribir el fichero nuevo ocurre
DESPUÉS de borrarlo, nunca a través de él.

Se espera que S1-S8 completen exactamente igual que en el ensayo feliz
(nada antes de S9 lee `.env.example`), y que S9 falle cerrado en su propia
comprobación de `.env.example`: nunca se promociona a 'done', nunca se
genera un informe de éxito, el `.env*` real de la sesión queda restaurado
desde cuarentena (mismo camino que cualquier otro fallo de `checks_ok` de
S9), y el teardown deja el inventario Docker real idéntico antes/después.

Uso: python3 s9_env_example_failure_rehearsal.py
Salida: 0 si todo pasó (es decir, si el fallo esperado ocurrió tal y como
se exige), 1 si algo no ocurrió como se exige.
"""
import glob
import hashlib
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s1_s9_full_rehearsal as base  # noqa: E402

REPO_ROOT_REAL = base.REPO_ROOT_REAL
LABEL_KEY = base.LABEL_KEY
report = base.report


def _file_digest(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def corrupt_shadow_env_example(shadow_root):
    """Sustituye el `.env.example` del repo sombra (symlink al real) por
    un fichero REGULAR NUEVO con un valor sensible sin forma de
    placeholder -- `verifyEnvExample.mjs` debe rechazarlo. Borra el
    symlink primero (nunca escribe a través de él) -- el `.env.example`
    REAL del repositorio nunca se lee ni se escribe en este proceso."""
    p = os.path.join(shadow_root, ".env.example")
    if os.path.islink(p) or os.path.exists(p):
        os.remove(p)
    with open(p, "w", encoding="utf-8") as f:
        f.write("POSTGRES_PASSWORD=valor-real-con-pinta-de-secreto-no-es-un-placeholder\n")


def main():
    real_env_example = os.path.join(REPO_ROOT_REAL, ".env.example")
    real_env_example_digest_before = _file_digest(real_env_example)
    real_env_path = os.path.join(REPO_ROOT_REAL, ".env")
    real_env_existed_before = os.path.exists(real_env_path)

    pj = base.Project()
    print(f"Proyecto desechable (escenario .env.example): {pj.name}")

    existing = base.docker("ps", "-aq", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
    if existing:
        print(f"ERROR: ya existen recursos con el label del proyecto '{pj.name}' — aborta.", file=sys.stderr)
        return 1

    tmp = tempfile.mkdtemp(prefix="gapssa-s9-envexample-rehearsal-")
    shadow_root = os.path.join(tmp, "shadow-repo")
    shadow_home = os.path.join(tmp, "home")
    secrets_dir = os.path.join(shadow_home, ".gapssa-secrets")
    os.makedirs(shadow_home, exist_ok=True)

    before_snapshot = os.path.join(tmp, "inventory-before")
    base.snapshot_real_compose_resources(before_snapshot)

    env_content = base.render_disposable_env(pj)
    base.build_shadow_repo(shadow_root, env_content)

    if not base.verify_shadow_resolves_correctly(shadow_root):
        report("Precondición de seguridad: REPO_ROOT resuelve al repo sombra (nunca al real)", False, "abortado — no se ejecuta nada más")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1
    report("Precondición de seguridad: REPO_ROOT resuelve al repo sombra (nunca al real)", True)

    # --- ÚNICA diferencia deliberada respecto al ensayo feliz ---
    corrupt_shadow_env_example(shadow_root)
    shadow_example_path = os.path.join(shadow_root, ".env.example")
    shadow_example_ok = os.path.isfile(shadow_example_path) and not os.path.islink(shadow_example_path)
    report("Precondición: '.env.example' del repo sombra es ahora un fichero REGULAR corrupto (nunca el symlink al real)", shadow_example_ok)

    # Precondición reforzada (encontró un bug real la primera vez que
    # faltó): confirma, ANTES de arrancar la sesión, que
    # `lib/verifyEnvExample.mjs` invocado exactamente como lo invocará
    # `gate_s9` (misma ruta simbólica dentro del repo sombra, nunca la
    # ruta real) rechaza de verdad el fichero corrupto. Sin esta
    # precondición, un fallo silencioso del propio verificador (p. ej. su
    # guardia de auto-invocación rota contra rutas simbólicas — ver
    # `lib/verifyEnvExample.mjs`, corregido en este mismo ciclo) haría
    # que el resto del escenario "pasara" por una razón completamente
    # distinta a la que dice demostrar.
    import subprocess

    verify_res = subprocess.run(
        ["node", os.path.join(shadow_root, "scripts", "secrets-rotation", "lib", "verifyEnvExample.mjs"), shadow_example_path],
        capture_output=True, text=True,
    )
    report(
        "Precondición reforzada: verifyEnvExample.mjs, invocado EXACTAMENTE como lo hará gate_s9 (misma ruta simbólica del repo sombra), rechaza el fichero corrupto de verdad (exit!=0, ok:false)",
        verify_res.returncode != 0 and '"ok":false' in verify_res.stdout,
        f"exit={verify_res.returncode} stdout={verify_res.stdout!r} stderr={verify_res.stderr!r}",
    )

    fake_ps_dir = base.prepare_fake_ps_only_dir(tmp)
    env = base.base_env(shadow_home, secrets_dir, fake_ps_dir)

    try:
        print("\n=== Preparación de infraestructura (mirror de un despliegue ya en marcha) ===")
        base.compose(shadow_root, pj.name, "up", "-d", check=False)
        for svc in ("apps-db", "espocrm-db", "redis", "espocrm"):
            svc_ok = base.wait_service_healthy(shadow_root, pj.name, svc, timeout=180)
            report(f"Infraestructura: '{svc}' confirma salud antes de que corra ninguna puerta", svc_ok)

        auth_url = f"postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_auth}"
        booking_url = f"postgresql://{pj.pg_user}:{pj.pg_password}@localhost:{pj.pg_port}/{pj.pg_db_booking}"
        import subprocess

        migrate_env = dict(os.environ)
        migrate_env["DATABASE_URL_AUTH"] = auth_url
        auth_res = subprocess.run(["npm", "run", "auth:db:migrate", "-w", "@gapssa/web"], cwd=REPO_ROOT_REAL, env=migrate_env, capture_output=True, text=True)
        report("Migraciones: gapssa_auth aplicadas", auth_res.returncode == 0, auth_res.stdout[-2000:] + auth_res.stderr[-2000:] if auth_res.returncode != 0 else "")
        migrate_env2 = dict(os.environ)
        migrate_env2["DATABASE_URL_BOOKING"] = booking_url
        booking_res = subprocess.run(["npm", "run", "booking:db:migrate", "-w", "@gapssa/web"], cwd=REPO_ROOT_REAL, env=migrate_env2, capture_output=True, text=True)
        report("Migraciones: gapssa_booking aplicadas", booking_res.returncode == 0, booking_res.stdout[-2000:] + booking_res.stderr[-2000:] if booking_res.returncode != 0 else "")

        base.install_acl_meeting_custom_fields(shadow_root, pj, tmp)
        base.setup_acl_fixture(pj)

        print("\n=== Ejecutando rotate-all-interactive.sh completo (S1→S9) con '.env.example' corrupto ===")
        rotation_proc = base.run_full_rotation(shadow_root, env, mariadb_root_password=pj.mariadb_root_password, timeout=2700)

        status = base.read_status(secrets_dir)
        for g in ("S1", "S2", "S3", "S4", "S5", "S7", "S8"):
            report(f"{g} queda 'done' (nada antes de S9 lee .env.example, así que S1-S8 no deben verse afectados)", status.get(g) == "done")
        # S6 es un caso especial (ver README, tabla "Checklist saneado"):
        # queda 'prepared' hasta que S9 ejecuta su verificación dinámica
        # REAL (OTP/rate-limit/JWT), que ocurre DESPUÉS del arranque de
        # apps/web -- es decir, después de la comprobación de
        # '.env.example'. Como S9 falla ANTES de llegar ahí en este
        # escenario, S6 se queda legítimamente en 'prepared', nunca
        # 'done' -- eso es lo correcto, no una regresión.
        report("S6 queda 'prepared' (nunca 'done' — su verificación dinámica ocurre después del punto donde S9 falla en este escenario)", status.get("S6") == "prepared", f"S6={status.get('S6')}")

        s9_state = status.get("S9")
        report("S9 NUNCA se promociona a 'done' (contrato: .env.example roto -> S9 falla cerrado, nunca ignora el error)", s9_state != "done", f"S9={s9_state}")

        report(
            "S9 no ignora el error: aparece una línea de FALLO explícita sobre '.env.example' en la transcripción real",
            "Verificando .env.example" in rotation_proc.transcript and "FALLO" in rotation_proc.transcript.split("Verificando .env.example", 1)[1][:400],
        )

        # Bloque 6 (bug real encontrado por este mismo escenario, corregido
        # en rotate-all-interactive.sh): el '.env' real de la sesión, que
        # gate_s9 pone en cuarentena ANTES de comprobar '.env.example',
        # debe quedar RESTAURADO al workspace tras el fallo -- nunca
        # abandonado en ~/.gapssa-secrets/env-quarantine/.
        shadow_env_path = os.path.join(shadow_root, ".env")
        report(
            "El '.env' de la sesión queda RESTAURADO al workspace del repo sombra tras el fallo (nunca abandonado en cuarentena)",
            os.path.exists(shadow_env_path) and not os.path.islink(shadow_env_path),
        )
        quarantine_dir = os.path.join(secrets_dir, "env-quarantine")
        leftover_quarantine = os.listdir(quarantine_dir) if os.path.isdir(quarantine_dir) else []
        report(
            "El directorio de cuarentena queda VACÍO tras la restauración (nada abandonado ahí)",
            leftover_quarantine == [],
            leftover_quarantine,
        )

        report_candidates = sorted(glob.glob(os.path.join(secrets_dir, "rotation-report-*.txt")))
        report(
            "No se genera NINGÚN informe (ni de éxito ni ambiguo) — el fallo ocurre ANTES de la reserva/escritura del informe final",
            len(report_candidates) == 0,
            report_candidates,
        )

        exit_code = rotation_proc.proc.returncode
        contractually_blocked = s9_state != "done" and len(report_candidates) == 0
        report(
            "Salida distinta de cero, O estado bloqueado contractual (S9 != done y cero informes) -- el asistente permite 'continuar de todas formas' al ser S9 la última puerta, así que el exit code por sí solo no es fiable; el estado contractual sí",
            (exit_code != 0) or contractually_blocked,
            f"exit_code={exit_code} s9_state={s9_state} report_candidates={report_candidates}",
        )

        # --- cero modificación del entorno real: ni el .env.example real
        #     ni el .env real (que ni siquiera debería existir/tocarse)
        #     cambiaron durante todo este ensayo ---
        real_env_example_digest_after = _file_digest(real_env_example)
        report(
            "El '.env.example' REAL del repositorio queda byte a byte idéntico (nunca se leyó/escribió a través del symlink corrupto)",
            real_env_example_digest_before == real_env_example_digest_after,
        )
        real_env_existed_after = os.path.exists(real_env_path)
        report(
            "El '.env' real del repositorio no cambió de existencia (nunca tocado por este ensayo)",
            real_env_existed_before == real_env_existed_after,
        )

    finally:
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
            base.compose(shadow_root, pj.name, "down", "-v", "--remove-orphans", check=False)
        except RuntimeError as exc:
            print(f"  AVISO: {exc}")
        leftover = base.docker("ps", "-aq", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        if leftover:
            for cid in leftover.splitlines():
                base.docker("rm", "-f", cid, check=False)
        leftover_networks = base.docker("network", "ls", "-q", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        if leftover_networks:
            for nid in leftover_networks.splitlines():
                base.docker("network", "rm", nid, check=False)
        leftover_volumes = base.docker("volume", "ls", "-q", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        if leftover_volumes:
            for vid in leftover_volumes.splitlines():
                base.docker("volume", "rm", "-f", vid, check=False)
        after_snapshot = os.path.join(tmp, "inventory-after")
        base.snapshot_real_compose_resources(after_snapshot)
        with open(before_snapshot) as f:
            before_content = f.read()
        with open(after_snapshot) as f:
            after_content = f.read()
        report("Teardown: inventario Docker real (todos los proyectos compose) idéntico antes/después", before_content == after_content)
        leftover2 = base.docker("ps", "-aq", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        report("Teardown: cero contenedores residuales con el label del proyecto desechable", not leftover2)
        leftover_networks2 = base.docker("network", "ls", "-q", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        report("Teardown: cero networks residuales con el label del proyecto desechable", not leftover_networks2)
        leftover_volumes2 = base.docker("volume", "ls", "-q", "--filter", f"label={LABEL_KEY}={pj.name}", check=False).stdout.strip()
        report("Teardown: cero volumes residuales con el label del proyecto desechable", not leftover_volumes2)
        shutil.rmtree(tmp, ignore_errors=True)
        report("Teardown: directorio temporal del ensayo (repo sombra + almacén externo) eliminado", not os.path.exists(tmp))

    fail_count = sum(1 for _, ok, _ in base.RESULTS if not ok)
    print(f"\nfail_count={fail_count}")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
