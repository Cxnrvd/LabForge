import shutil

from labforge_core.services import compose_generator as cg
from labforge_core.services import workspace
from labforge_core.services.template_loader import list_templates

topo = next(t for t in list_templates() if t.id == "account-compromise-chain")
files, artifacts = cg.build_bundle(topo, project="account-compromise-chain")
print("warnings:", artifacts.warnings)
out = workspace.root() / "account-compromise-chain-1"
for sub in ("env", "build"):
    p = out / sub
    if p.exists():
        shutil.rmtree(p)
for rel, content in files.items():
    p = out / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        p.write_bytes(content)
    else:
        p.write_text(content, encoding="utf-8")
print("regenerated", out)
