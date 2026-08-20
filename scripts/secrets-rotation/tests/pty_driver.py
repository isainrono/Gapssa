#!/usr/bin/env python3
"""PTY-based driver for scenario tests of rotate-all-interactive.sh.

The script under test requires a real TTY on stdin AND stdout (part of the
harness guard, verified deliberately — see lib.sh) and cannot be driven
through a plain pipe. This module opens a pseudo-terminal, spawns the
script attached to it, and drives it with an expect/send loop, exactly
like a human typing into Terminal.app would.

Never touches real Docker/Postgres/MariaDB/Redis/EspoCRM — the tests that
use this driver put fake binaries (docker/curl/npx) earlier on PATH.
"""
import os
import pty
import re
import select
import signal
import subprocess
import sys
import time


class PtyProcess:
    def __init__(self, argv, env, cwd=None):
        self.master_fd, slave_fd = pty.openpty()
        self.proc = subprocess.Popen(
            argv,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=env,
            cwd=cwd,
            start_new_session=True,
        )
        os.close(slave_fd)
        self.transcript = ""
        # Posición hasta la que ya se ha "consumido" el transcript en
        # expect() — cada expect() exitoso solo busca en texto GENUINAMENTE
        # NUEVO desde el match anterior, nunca en todo el acumulado. Sin
        # esto, un expect() posterior podía volver a encontrar una frase que
        # ya apareció antes (p. ej. la propia frase de confirmación aparece
        # dentro del texto instructivo del primer prompt), desincronizando
        # toda la conversación con el proceso.
        self._consumed_until = 0

    def read_available(self, timeout=0.3):
        chunk = b""
        end = time.time() + timeout
        while time.time() < end:
            r, _, _ = select.select([self.master_fd], [], [], 0.05)
            if self.master_fd in r:
                try:
                    data = os.read(self.master_fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                chunk += data
            elif chunk:
                break
        text = chunk.decode("utf-8", errors="replace")
        self.transcript += text
        return text

    def expect(self, pattern, timeout=15):
        """Poll until `pattern` (regex) appears in the NEW portion of the
        transcript (since the last successful expect()), or raise
        TimeoutError. Returns matched text. Advances the consumed-position
        marker past the match on success, so the next expect() never
        re-matches old output (e.g. the confirmation phrase appearing
        inside the prompt's own instructional text)."""
        end = time.time() + timeout
        regex = re.compile(pattern)
        while time.time() < end:
            self.read_available(timeout=0.5)
            new_text = self.transcript[self._consumed_until :]
            m = regex.search(new_text)
            if m:
                self._consumed_until += m.end()
                return m.group(0)
            if self.proc.poll() is not None:
                self.read_available(timeout=0.3)
                new_text = self.transcript[self._consumed_until :]
                m = regex.search(new_text)
                if m:
                    self._consumed_until += m.end()
                    return m.group(0)
                raise TimeoutError(
                    f"proceso terminó (exit={self.proc.returncode}) antes de ver /{pattern}/.\n--- transcript ---\n{self.transcript}"
                )
        raise TimeoutError(f"timeout esperando /{pattern}/.\n--- transcript (nuevo desde el último match) ---\n{self.transcript[self._consumed_until:]}")

    def send_line(self, line):
        os.write(self.master_fd, (line + "\n").encode("utf-8"))

    def sigint(self):
        os.killpg(os.getpgid(self.proc.pid), signal.SIGINT)

    def wait(self, timeout=20):
        # Nunca usar subprocess.wait() a secas: si el hijo escribe más de lo
        # que cabe en el buffer del pty y nadie lo drena mientras tanto,
        # el hijo se bloquea en write() esperando espacio — un deadlock
        # clásico de pty. Se drena activamente mientras se espera.
        end = time.time() + timeout
        while time.time() < end:
            self.read_available(timeout=0.3)
            rc = self.proc.poll()
            if rc is not None:
                self.read_available(timeout=0.3)
                return rc
        self.proc.kill()
        return self.proc.wait(timeout=5)

    def close(self):
        # BLOQUEO 3 (Bloque 6): cerrar solo el fd maestro NO mata al hijo de
        # forma fiable (confirmado con una prueba real: un proceso colgado
        # seguía vivo tras close() sin esto) -- start_new_session=True lo
        # puso en su PROPIO grupo de procesos, así que hay que matar ese
        # grupo explícitamente (SIGKILL, nunca esperar a que reaccione) para
        # garantizar que ni él ni sus hijos (docker/curl/npm que haya
        # lanzado) queden huérfanos cuando close() se llama tras un timeout
        # en vez de tras una salida natural ya esperada con wait().
        try:
            if self.proc.poll() is None:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
                self.proc.wait(timeout=5)
        except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
            pass
        try:
            os.close(self.master_fd)
        except OSError:
            pass
