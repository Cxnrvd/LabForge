"""Dump the canonical Pydantic schema to JSON Schema.

Used by the schema-sync CI check: we generate JSON Schema from Pydantic,
generate the same from Zod (via ``zod-to-json-schema``), and diff them.
If the diff is non-empty the build fails — that's the safety net for
"someone forgot to update the other side".

Run as:

    python -m labforge_schema.export_json_schema --out schema.json
"""

from __future__ import annotations

import argparse
import json
import sys

from labforge_schema import LabConfig


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="-", help="Output path or '-' for stdout")
    parser.add_argument(
        "--indent", type=int, default=2, help="JSON indent (default: 2)"
    )
    args = parser.parse_args(argv)

    schema = LabConfig.model_json_schema()
    body = json.dumps(schema, indent=args.indent, sort_keys=True)
    if args.out == "-":
        sys.stdout.write(body + "\n")
    else:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(body + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
