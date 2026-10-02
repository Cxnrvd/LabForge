"""First-boot files for Windows guests (dockurr/windows runs them from /oem after setup).

install.bat lays down fictional documents, then hands over to setup.ps1, which installs Sysmon
and Winlogbeat when the lab has an Elasticsearch node to ship to. Every download is best effort:
a failure is written to C:\\labforge-setup.log and never stops the guest from becoming usable.
Everything here is fictional lab content.
"""

from __future__ import annotations

SYSMON_URL = "https://download.sysinternals.com/files/Sysmon.zip"
WINLOGBEAT_VERSION = "8.15.3"
WINLOGBEAT_URL = (
    f"https://artifacts.elastic.co/downloads/beats/winlogbeat/winlogbeat-{WINLOGBEAT_VERSION}-windows-x86_64.zip"
)

# A small Sysmon configuration: process creation, network connections, file creation,
# process access (LSASS), registry run keys and DNS. Enough for the hunts in the lab docs.
SYSMON_CONFIG = """<Sysmon schemaversion="4.90">
  <EventFiltering>
    <ProcessCreate onmatch="exclude" />
    <NetworkConnect onmatch="exclude" />
    <FileCreate onmatch="include">
      <TargetFilename condition="contains">\\Users\\Public\\</TargetFilename>
      <TargetFilename condition="contains">\\Temp\\</TargetFilename>
    </FileCreate>
    <ProcessAccess onmatch="include">
      <TargetImage condition="end with">lsass.exe</TargetImage>
    </ProcessAccess>
    <RegistryEvent onmatch="include">
      <TargetObject condition="contains">\\CurrentVersion\\Run</TargetObject>
    </RegistryEvent>
    <DnsQuery onmatch="exclude" />
  </EventFiltering>
</Sysmon>
"""


def install_bat(*, with_setup: bool) -> str:
    lines = [
        "@echo off",
        "rem LabForge: first-boot setup for a Windows lab guest (fictional data only).",
        'set "D=C:\\Users\\Public\\Documents\\Finance"',
        'mkdir "%D%" 2>nul',
        'echo Q3 freight invoices - fictional lab data > "%D%\\invoices-q3.txt"',
        'echo Payroll summary - fictional lab data > "%D%\\payroll-summary.txt"',
        'echo Customer contracts - fictional lab data > "%D%\\contracts.txt"',
        'echo LabForge guest ready > "C:\\labforge-ready.txt"',
    ]
    if with_setup:
        lines += [
            'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" >> "C:\\labforge-setup.log" 2>&1',
        ]
    lines.append("")
    return "\r\n".join(lines)


def setup_ps1(*, hostname: str, elastic_ip: str) -> str:
    """Install Sysmon and Winlogbeat, pointing Winlogbeat at ``elastic_ip``."""
    return "\r\n".join(
        [
            "$ErrorActionPreference = 'Continue'",
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
            "$work = 'C:\\LabForge\\tools'",
            "New-Item -ItemType Directory -Force -Path $work | Out-Null",
            "function Step($name, [scriptblock]$body) {",
            "  Write-Host \"[$(Get-Date -Format s)] $name\"",
            "  try { & $body } catch { Write-Host \"  failed: $_\" }",
            "}",
            "",
            "Step 'Sysmon' {",
            f"  Invoke-WebRequest -UseBasicParsing -Uri '{SYSMON_URL}' -OutFile \"$work\\Sysmon.zip\"",
            "  Expand-Archive -Force \"$work\\Sysmon.zip\" \"$work\\sysmon\"",
            "  @'",
            *SYSMON_CONFIG.rstrip("\n").split("\n"),
            "'@ | Set-Content -Encoding ASCII \"$work\\sysmon.xml\"",
            "  & \"$work\\sysmon\\Sysmon64.exe\" -accepteula -i \"$work\\sysmon.xml\"",
            "}",
            "",
            "Step 'Winlogbeat' {",
            f"  Invoke-WebRequest -UseBasicParsing -Uri '{WINLOGBEAT_URL}' -OutFile \"$work\\winlogbeat.zip\"",
            "  $dest = 'C:\\Program Files\\Winlogbeat'",
            "  Expand-Archive -Force \"$work\\winlogbeat.zip\" \"$work\\wlb\"",
            "  $src = Get-ChildItem \"$work\\wlb\" | Select-Object -First 1",
            "  New-Item -ItemType Directory -Force -Path $dest | Out-Null",
            "  Copy-Item -Recurse -Force \"$($src.FullName)\\*\" $dest",
            "  @'",
            "winlogbeat.event_logs:",
            "  - name: Security",
            "  - name: System",
            "  - name: Application",
            "  - name: Microsoft-Windows-Sysmon/Operational",
            "  - name: Microsoft-Windows-PowerShell/Operational",
            "output.elasticsearch:",
            f"  hosts: [\"http://{elastic_ip}:9200\"]",
            "  index: \"winlogbeat-labforge-%{+yyyy.MM.dd}\"",
            "setup.template.name: \"winlogbeat-labforge\"",
            "setup.template.pattern: \"winlogbeat-labforge-*\"",
            "setup.ilm.enabled: false",
            "processors:",
            "  - add_fields:",
            "      target: ''",
            "      fields:",
            f"        host.lab_name: {hostname}",
            "'@ | Set-Content -Encoding ASCII \"$dest\\winlogbeat.yml\"",
            "  & \"$dest\\install-service-winlogbeat.ps1\"",
            "  Start-Service winlogbeat",
            "}",
            "",
            "Write-Host 'LabForge setup finished'",
            "",
        ]
    )
