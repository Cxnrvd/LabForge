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
    # True only when running the script leaves something actually exploitable reachable on the
    # lab network (a real vulnerable service, listening). False for a script that exists but only
    # installs attacker-side tooling, prints setup notes, or needs a manual step LabForge cannot
    # automate (Windows CVEs: there is no Windows-side curated provisioner, see
    # templates/provision_windows.ps1.j2, which only echoes these descriptions as notes).
    fully_provisioned: bool


_DESCRIPTIONS: dict[str, str] = {
    # Web / app server — fully provisioned: a real vulnerable service is stood up.
    "CVE-2021-44228": "Apache Log4j 2 JNDI lookup remote code execution (Log4Shell)",
    "CVE-2017-5638": "Apache Struts 2 Jakarta multipart parser RCE",
    "CVE-2022-22965": "Spring Framework data-binding RCE (Spring4Shell)",
    "CVE-2014-0160": "OpenSSL heartbeat memory disclosure (Heartbleed)",
    "CVE-2014-6271": "GNU bash environment variable RCE (Shellshock)",
    # Windows CVEs — notes only. LabForge has no Windows-side curated provisioner, so none of
    # these actually configure a vulnerable or exploitable target; the node just gets a comment
    # block in its log explaining what a real exercise would need.
    "CVE-2019-0708": "Microsoft RDP pre-authentication RCE (BlueKeep). Notes only: LabForge does not provision a vulnerable host",
    "CVE-2020-1472": "Netlogon elevation of privilege (Zerologon). Notes only: the unsafe DC setting is not applied by LabForge",
    "CVE-2023-23397": "Outlook NTLM relay via PidLidReminderFileParameter. Notes only: installs Responder and Impacket on the attacker, but Outlook/Office on the Windows victim must be set up by hand",
    # Not bundled at all (no provisioner script on disk) — picking these attaches a stub comment.
    "CVE-2017-0144": "Windows SMBv1 EternalBlue RCE",
    "CVE-2021-34527": "Windows Print Spooler RCE (PrintNightmare)",
    "CVE-2023-4966": "Citrix NetScaler ADC / Gateway buffer overflow (CitrixBleed)",
}

# Curated scripts that exist on disk but, by design, do not themselves leave a vulnerable service
# reachable on the lab network (see the comments in these scripts and the descriptions above).
_NOTES_ONLY: frozenset[str] = frozenset({"CVE-2019-0708", "CVE-2020-1472", "CVE-2023-23397"})


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
            fully_provisioned=normalized not in _NOTES_ONLY,
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
        fully_provisioned=False,
    )


def list_known_cves() -> list[str]:
    settings = get_settings()
    if not settings.provisioner_scripts_dir.exists():
        return []
    return sorted(p.stem.upper() for p in settings.provisioner_scripts_dir.glob("*.sh"))


def known_cve_descriptions() -> dict[str, str]:
    return dict(_DESCRIPTIONS)


def is_fully_provisioned(cve_id: str) -> bool:
    """True when the curated script for this CVE leaves a real vulnerable service reachable,
    rather than just notes or attacker-side tooling. False for a CVE with no curated script."""
    normalized = cve_id.upper()
    return normalized in set(list_known_cves()) and normalized not in _NOTES_ONLY


_ = Path  # keep import for type checkers if pruned later
