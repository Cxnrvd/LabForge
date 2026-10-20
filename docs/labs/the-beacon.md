# Lab: The Beacon (Persistence + C2 Detection)

Malware analysis fundamentals: persistence and C2 detection. ~2 hours: short live setup/attack
phase (that students never see), then analysis. Students do static + behavioral analysis
together.

One VM (`victim`) built by LabForge. `attacker` (Kali + Cobalt Strike, already licensed and set
up by the instructor) is entirely external — LabForge never touches it, same as the source
scenario file asked for. Expected at `192.168.150.20` on this lab's network; confirm the real
team-server IP/port with whoever set up Kali before class, since LabForge has no visibility into
that VM.

## Workspace

Builds land under `E:\LABS\labforge-workspaces\the-beacon-<n>\` automatically — `F:\Workspaces`
(LabForge's active workspace root) is already a junction onto `E:\LABS\labforge-workspaces`, so
no extra configuration is needed before building this template.

## Start it

1. Open `templates -> The Beacon (Persistence and C2 Detection)` in LabForge and press **Build**
   (provider is `vmware`; this needs VMware Workstation plus the paid
   `vagrant-vmware-desktop` plugin — same requirement `wifi-lab` already has).
2. `vagrant up` from the generated workspace folder. First run downloads the Ubuntu box
   (a few GB, cached after); provisioning installs `tcpdump` and `net-tools` and sets the
   static IP `192.168.150.10`.

## Network isolation (manual step)

LabForge's Vagrant path gives `victim` a `private_network` interface with the static IP, but
that is **not** a zero-NAT/zero-bridge VMnet by default — Vagrant/VMware's private network is
still typically NATed to the host. To make the segment genuinely isolated (no route to your real
network), open VMware Workstation's **Edit → Virtual Network Editor**, find the VMnet this VM's
private network landed on, and uncheck "Connect a host virtual adapter" / "NAT". Do this once;
it's a property of the VMnet, not something that needs repeating per class section.

Make sure `attacker`'s Kali VM is attached to that same VMnet so it can reach `192.168.150.10`
and `victim` can reach `192.168.150.20`.

## Deploying Beacon (fully manual — not scripted by LabForge)

LabForge's job stops at the base-provisioned VM above. Before class:

1. From the Cobalt Strike client, configure a **malleable C2 profile** with a long, predictable
   sleep/jitter interval — something you can time against a short `tcpdump` capture in front of
   the class, unlike Cobalt Strike's more evasive defaults.
2. Deploy the Beacon payload onto `victim` manually (delivery chain isn't this week's focus).
3. Wire Beacon's execution into a cron job or a systemd timer on `victim`, so the
   "diff against a clean baseline" exercise has something concrete to find.
4. Confirm from the Cobalt Strike client that Beacon is checking in before class starts.

## Snapshots (manual — LabForge has no snapshot automation)

LabForge does not automate VM snapshots for any provider, VMware included. Take both by hand
with `vmrun`, run from wherever VMware Workstation is installed (adjust the `.vmx` path to the
one `vagrant up` created under this lab's workspace folder):

```
vmrun snapshot "<path-to-victim>.vmx" clean-baseline
```

Take this **right after** step 1-2 above finish (base packages installed, static IP set,
nothing else) — this is what students diff against.

```
vmrun snapshot "<path-to-victim>.vmx" post-deployment
```

Take this once Beacon is running, persistence is wired in, and it's checking in to the team
server. This is the snapshot you revert to before each class section.

**Reset for a re-run:**

```
vmrun revertToSnapshot "<path-to-victim>.vmx" post-deployment   # routine re-run, same section setup
vmrun revertToSnapshot "<path-to-victim>.vmx" clean-baseline    # changing the C2 profile or persistence method
```

`attacker`'s team server state doesn't need resetting between runs — old sessions can stay in
its list for cross-section comparison.

## Running it live

Deploy and start Beacon before class starts; students should never see the deployment step, only
investigate the result. In class, hand students access to `victim` cold, no explanation of
what's running.

## What students do

1. **Find the persistence mechanism.** Diff `crontab -l` and `systemctl list-timers --all`
   (and `ps aux`/process tree) against the known-good `clean-baseline` state. They should land
   on the scheduled Beacon execution.
2. **Pull and triage the payload.** `file` on the Beacon binary/dropper, then `strings`, looking
   for a leaked team-server address/port, user-agent strings, or profile artifacts. First binary
   static-analysis exercise — guided, not fully self-directed, since it is a first look at malware.
3. **Catch the beacon pattern.** `netstat -tnp` / `ss -tnp` for the active outbound connection,
   then a short `tcpdump` capture timed against the configured sleep interval to see the
   periodic check-in.
4. **Write it up.** Persistence mechanism found, static analysis findings, beacon
   interval/destination, containment recommendation. Gives a follow-on attribution
   exercise the exact IOCs to reuse.

Recommended place for students' captured evidence, mirroring the source scenario's suggested
layout (not something LabForge generates — just a convention for this class):

```
E:\LABS\labforge-workspaces\the-beacon-<n>\
  captures\
    section-a-run1.pcap
  artifacts\
    beacon-payload-sample.bin
```

## Why Cobalt Strike instead of a toy script

A real red-team C2 implant raises realism but also raises what needs explaining: `strings`/`file`
still work (Beacon payloads often leak recognizable strings/config artifacts unless cleaned up),
but treat the static-analysis step as guided rather than fully self-directed. Worth narrating
explicitly in class — this is what a real red-team/APT-grade implant looks like versus a toy
script.
