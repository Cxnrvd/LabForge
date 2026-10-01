# Running LabForge on a Windows PC

On a Windows host LabForge can build two kinds of labs from the same canvas:

| Lab type | Runs on | Good for |
|---|---|---|
| **VM labs** (provider `virtualbox` or `vmware`) | Vagrant plus VirtualBox or VMware Workstation | Windows and Linux guests together: workstations, servers, a domain controller, Kali, routers emulated on Ubuntu |
| **Docker labs** (provider `docker`) | Docker Desktop (WSL2) | SIEM, Linux services, the bundled ransomware-hunt and malware-triage labs |

A topology uses one provider, so a single lab is either all VMs or all containers.
Assumes an x86-64 PC. (Windows on ARM cannot run these x86 boxes.)

## 1. Install once

From an admin PowerShell. Check IDs with `winget search <name>` if one has moved.

```powershell
winget install Git.Git
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
winget install astral-sh.uv
winget install Hashicorp.Vagrant
winget install Oracle.VirtualBox        # or VMware Workstation, see below
winget install Docker.DockerDesktop     # only if you want Docker labs
corepack enable                          # gives you pnpm
```

Restart the terminal afterwards so `vagrant`, `VBoxManage` and `uv` are on PATH.

**VMware instead of VirtualBox:** install VMware Workstation, then

```powershell
vagrant plugin install vagrant-vmware-desktop
```

and install the Vagrant VMware Utility from HashiCorp's download page. Set the topology provider to VMware in LabForge.

### Hyper-V, WSL2 and Docker Desktop

Docker Desktop and WSL2 turn on the Windows hypervisor. VirtualBox can still run next to it, but it has to share the CPU features, so VMs start slower and occasionally fail with `VERR_NEM_VM_CREATE_FAILED`. Two ways out:

* use **VMware Workstation** for VM labs (it copes better with Hyper-V being on), or
* if you only need VMs for a while, turn Hyper-V off (`bcdedit /set hypervisorlaunchtype off`, reboot). This also stops Docker Desktop's WSL2 backend; `... auto` turns it back on.

LabForge detects this and shows a warning above the canvas.

## 2. Run LabForge natively

Run it directly on Windows, not with the repo's `docker compose up`. A containerised API cannot start Vagrant or reach your Docker engine.

```powershell
git clone https://github.com/Cxnrvd/LabForge.git C:\LabForge
cd C:\LabForge
pnpm install
uv venv
pnpm run setup
pnpm dev            # API on :8000, web on :3000
```

Keep the workspace path short. Vagrant and VirtualBox break on very long Windows paths:

```powershell
setx LABFORGE_WORKSPACE_ROOT C:\lf
```

(open a new terminal after `setx`).

## 3. Check the machine before you build

```powershell
cd apps\api
uv run python -m labforge_core.services.hostenv virtualbox   # or vmware
```

It prints what it found (Vagrant, VirtualBox, VMware plugin, whether Hyper-V is active, RAM) and exits non-zero with a plain message if something blocks a build. The same checks drive the banner in the web app.

## 4. Boxes (the VM images)

* Windows guests use unofficial evaluation boxes. They are large (several GB each) and their licence is a timed evaluation, roughly 90 to 180 days. Treat them as disposable.
* Before a build, LabForge picks a box that exists for your provider: one you already downloaded, else one Vagrant Cloud confirms, else it tells you what it tried. It tries `StefanScherer/*` first for Windows, then `gusztavvargadr/*`.
* To force a box:

  ```powershell
  setx LABFORGE_BOX_OVERRIDES "{\"windows_10\": \"myorg/win10-lab\"}"
  ```

  or add a local box: `vagrant box add --name myorg/win10-lab C:\boxes\win10.box`.
* Set `LABFORGE_VERIFY_BOXES=false` to skip the check (for offline use with boxes already downloaded).
* **Download the boxes before an event.** The first build of a Windows lab can spend most of an hour on downloads and first boot. Later builds reuse the downloaded box and use linked clones, so extra VMs from the same box are fast and small.

## 5. Sizing

LabForge warns when a lab asks for more than about 75% of your RAM or when disk is short.

| Lab | RAM it asks for |
|---|---|
| DFIR lab (Windows 10, Kali, Splunk) | about 10 GB |
| Ransomware hunt (Docker) | about 3 GB limit, 1.75 GB used |
| Malware triage (Docker) | under 1 GB |

Plan about 25 GB of disk per Windows guest plus 12 GB for the Linux boxes and tools.

## 6. Running it live

1. Build the lab the day before and confirm every machine reaches `ready` in the monitor.
2. Take a snapshot of each VM so you can reset between runs: `vagrant snapshot save <vm> clean`, later `vagrant snapshot restore <vm> clean`. (LabForge's Destroy removes the VMs and their snapshots, so use `vagrant halt` and `vagrant up` to keep a lab between sessions.)
3. Close heavy apps. A Google Meet screen share plus three VMs needs headroom.
4. Keep a short screen recording of the attack as a fallback.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `VERR_NEM_VM_CREATE_FAILED` or very slow VMs | Hyper-V/WSL2 conflict with VirtualBox. See above. |
| `Timed out while waiting for the machine to boot` on a Windows guest | First boot is slow. Generated Vagrantfiles allow 15 minutes; run `vagrant up` again to continue. |
| WinRM authentication errors | The box does not allow the plain-text WinRM login LabForge configures. Pick another box with `LABFORGE_BOX_OVERRIDES`. |
| VMs unreachable from the host | The lab network overlaps one your PC already uses. Change the network CIDR in the topology. LabForge warns when it sees this. |
| `bad interpreter: /bin/bash^M` in a Linux guest | Should not happen any more (LabForge writes LF endings), but check `git config core.autocrlf` if you copied scripts in by hand. |
| Windows Defender flags files | It scans your host folders. Exclude the workspace root (`C:\lf`) if it quarantines lab tooling. Offensive tools inside a guest are not scanned by the host. |

## What is verified

The Windows-specific logic (line endings, box choice, provider checks, stopping a build, the warnings) is covered by unit tests that simulate a Windows host. Generated Vagrantfiles and Linux provisioning scripts for every bundled template are syntax-checked with Ruby and bash. The actual VM boot on Windows has not been exercised from LabForge's development environment, which has no hypervisor, so the first real run on your PC is the final check. Run step 3 first.
