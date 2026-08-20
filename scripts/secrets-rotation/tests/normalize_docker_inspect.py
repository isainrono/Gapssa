#!/usr/bin/env python3
"""Normaliza la salida de `docker inspect` (leída por stdin, un array JSON)
a líneas JSON ordenadas y deterministas — usado por disposable-infra.sh
para poder comparar (`diff`) el estado de los recursos reales de
`docker compose` antes/después de una ejecución de la infra desechable de
pruebas de rotación.

Solo campos ESTABLES (nunca "Status"/"RunningFor" de `docker ps`, que son
cadenas relativas al reloj y cambian solas con el paso del tiempo incluso
para un recurso que no se tocó): Id, nombre, State.Status/StartedAt/
FinishedAt, Mounts (Source/Destination/Name), redes (solo claves), Labels
(ordenadas — el orden de un mapa de Go no es determinista entre
invocaciones de `docker`).
"""
import json
import sys


def main() -> None:
    resources = json.load(sys.stdin)
    lines = []
    for d in resources:
        labels = d.get("Config", {}).get("Labels") or d.get("Labels") or {}
        normalized_labels = sorted(f"{k}={v}" for k, v in labels.items()) if isinstance(labels, dict) else []
        state = d.get("State", {})
        mounts = sorted(
            f"{m.get('Source')}::{m.get('Destination')}::{m.get('Name', '')}" for m in d.get("Mounts", [])
        )
        networks = sorted((d.get("NetworkSettings", {}) or {}).get("Networks", {}).keys())
        normalized = {
            "Id": d.get("Id"),
            "Name": d.get("Name"),
            "Status": state.get("Status"),
            "StartedAt": state.get("StartedAt"),
            "FinishedAt": state.get("FinishedAt"),
            "Mounts": mounts,
            "Networks": networks,
            "Labels": normalized_labels,
            "Driver": d.get("Driver"),
        }
        lines.append(json.dumps(normalized, sort_keys=True))
    for line in sorted(lines):
        print(line)


if __name__ == "__main__":
    main()
