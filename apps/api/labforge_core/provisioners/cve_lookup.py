"""Map CVE IDs to curated provisioner snippets.

For an unknown CVE we still emit a labelled block that downloads the NVD
metadata as a stub so the user knows where to fill in the exploit chain.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from labforge_core.settings import get_settings


@dataclass(frozen=True)
class CVEProvisioner:
    cve_id: str
    description: str
    script: str
    known: bool


_DESCRIPTIONS: dict[str, str] = {
    # Web / app server
    "CVE-2021-44228": "Apache Log4j 2 JNDI lookup remote code execution (Log4Shell)",
    "CVE-2017-5638": "Apache Struts 2 Jakarta multipart parser RCE",
    "CVE-2022-22965": "Spring Framework data-binding RCE (Spring4Shell)",
    # OS / protocol
    "CVE-2019-0708": "Microsoft RDP pre-authentication RCE (BlueKeep). Notes only: LabForge does not provision a vulnerable host",
    "CVE-2020-1472": "Netlogon elevation of privilege (Zerologon). Notes only: the unsafe DC setting is not applied by LabForge",
    "CVE-2014-0160": "OpenSSL heartbeat memory disclosure (Heartbleed)",
    "CVE-2014-6271": "GNU bash environment variable RCE (Shellshock)",
    "CVE-2017-0144": "Windows SMBv1 EternalBlue RCE",
    "CVE-2021-34527": "Windows Print Spooler RCE (PrintNightmare)",
    "CVE-2023-4966": "Citrix NetScaler ADC / Gateway buffer overflow (CitrixBleed)",
    # Mail / desktop
    "CVE-2023-23397": "Outlook NTLM relay via PidLidReminderFileParameter. Installs Responder and Impacket on the attacker only",
}


def _curated_script(cve_id: str) -> str | None:
    settings = get_settings()
    path = settings.provisioner_scripts_dir / f"{cve_id.lower()}.sh"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def resolve_cve_payload(cve_id: str) -> CVEProvisioner:
    normalized = cve_id.upper()
    script = _curated_script(normalized)
    description = _DESCRIPTIONS.get(normalized, f"Provisioner stub for {normalized}")
    if script is not None:
        return CVEProvisioner(
            cve_id=normalized,
            description=description,
            script=script,
            known=True,
        )
    stub = (
        f"# {normalized}: no curated provisioner is bundled.\n"
        f"# Edit this block to install the vulnerable software stack for {normalized}.\n"
        f"# Description: {description}\n"
        "# See https://nvd.nist.gov/vuln/detail/{cve_id} for affected versions.\n"
    ).replace("{cve_id}", normalized)
    return CVEProvisioner(
        cve_id=normalized,
        description=description,
        script=stub,
        known=False,
    )


def list_known_cves() -> list[str]:
    settings = get_settings()
    if not settings.provisioner_scripts_dir.exists():
        return []
    return sorted(p.stem.upper() for p in settings.provisioner_scripts_dir.glob("*.sh"))


def known_cve_descriptions() -> dict[str, str]:
    return dict(_DESCRIPTIONS)


_ = Path  # keep import for type checkers if pruned later
