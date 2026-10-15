"""Build entry point for labs that start from golden images.

``python -m labforge_core.services.build_steps <workspace> <compose up args...>`` first copies each
golden disk into the lab's storage volume (printing progress to the build log), then runs the
normal ``docker compose up``. Labs without golden images never go through here.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    workspace = Path(argv[1])
    up = argv[2:]
    seeds_file = workspace / ".labforge-seeds.json"
    if seeds_file.exists():
        from labforge_core.services import images

        for seed in json.loads(seeds_file.read_text(encoding="utf-8")):
            what = f"golden image {seed['golden']}" if "golden" in seed else f"{seed['base']} installer"
            print(f"[labforge] copying {what} for {seed['host']} ...", flush=True)
            try:
                if "golden" in seed:
                    volume = images.seed_volume(seed["project"], seed["host"], seed["golden"])
                else:
                    volume = images.seed_base_volume(seed["project"], seed["host"], seed["base"])
            except images.ImageError as exc:
                print(f"[labforge] ERROR {exc}", flush=True)
                return 1
            print(f"[labforge] {volume} ready", flush=True)
    return subprocess.call(up, cwd=str(workspace))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
