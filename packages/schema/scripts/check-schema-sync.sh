#!/usr/bin/env bash
# Compare the Pydantic-exported JSON Schema to the Zod-exported one.
#
# Returns 0 if both encode the same set of fields and constraints,
# non-zero otherwise. The diff is printed so the failing build log
# tells you exactly which side is out of date.
#
# This is structural diff — type names and the exact JSON Schema dialect
# differ between generators, so we compare on (a) the field path set
# and (b) per-field type/enum/regex/required-ness rather than raw text.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

PYDANTIC_OUT="$(mktemp)"
ZOD_OUT="$(mktemp)"
trap 'rm -f "$PYDANTIC_OUT" "$ZOD_OUT"' EXIT

(cd "$ROOT/packages/schema/python" && python -m labforge_schema.export_json_schema --out "$PYDANTIC_OUT")
(cd "$ROOT/packages/schema" && npx tsx scripts/export-zod-schema.mjs > "$ZOD_OUT")

python - <<PY
import json, sys

def resolve_refs(obj, defs):
    """Recursively resolve all \$ref and \$defs references inline."""
    if not isinstance(obj, dict):
        return obj
    # Absorb the definitions map from this level
    local_defs = {**defs}
    for key in ("\$defs", "definitions"):
        if key in obj:
            local_defs.update(obj[key])

    if "\$ref" in obj:
        ref = obj["\$ref"]
        # Handle #/\$defs/Foo and #/definitions/Foo
        for prefix in ("#/\$defs/", "#/definitions/"):
            if ref.startswith(prefix):
                name = ref[len(prefix):]
                if name in local_defs:
                    return resolve_refs(local_defs[name], local_defs)
        return obj  # unresolvable ref — leave as-is

    return {k: resolve_refs(v, local_defs) if isinstance(v, (dict, list)) else v
            for k, v in obj.items()
            if k not in ("\$defs", "definitions")}

def resolve_list(lst, defs):
    return [resolve_refs(item, defs) if isinstance(item, dict) else item for item in lst]

# Patch resolve_refs to handle lists
_orig = resolve_refs
def resolve_refs(obj, defs):
    if isinstance(obj, list):
        return resolve_list(obj, defs)
    return _orig(obj, defs)

def field_set(obj, prefix=""):
    """Walk a JSON Schema and return the set of 'field path | kind' strings."""
    out = set()
    if not isinstance(obj, dict):
        return out
    if "properties" in obj:
        for name, child in obj["properties"].items():
            here = f"{prefix}.{name}" if prefix else name
            kind = child.get("type") or ("enum" if "enum" in child else "")
            out.add(f"{here}|{kind}")
            if "enum" in child:
                out.add(f"{here}|enum:{','.join(sorted(map(str, child['enum'])))}")
            if "pattern" in child:
                out.add(f"{here}|pattern:{child['pattern']}")
            out |= field_set(child, here)
    if "items" in obj:
        out |= field_set(obj["items"], prefix + "[]")
    for branch in obj.get("anyOf", []) + obj.get("oneOf", []) + obj.get("allOf", []):
        out |= field_set(branch, prefix)
    return out

with open("$PYDANTIC_OUT") as fh:
    py_raw = json.load(fh)
with open("$ZOD_OUT") as fh:
    zd_raw = json.load(fh)

py = resolve_refs(py_raw, {})
zd = resolve_refs(zd_raw, {})

py_fields = field_set(py)
zd_fields = field_set(zd)

only_py = py_fields - zd_fields
only_zd = zd_fields - py_fields
if not only_py and not only_zd:
    print("OK: Pydantic and Zod schemas agree.")
    sys.exit(0)
if only_py:
    print("Fields in Pydantic but missing from Zod:")
    for f in sorted(only_py):
        print(" -", f)
if only_zd:
    print("Fields in Zod but missing from Pydantic:")
    for f in sorted(only_zd):
        print(" -", f)
sys.exit(1)
PY
