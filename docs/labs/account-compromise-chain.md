# Lab: Account Compromise Chain (Docker, Wazuh SIEM)

Kill Chain / ATT&CK mapping and incident-response triage & containment. ~2 hours (10-15 min
live attack, remainder analysis).

Six containers on an isolated LabForge Docker network: `wazuh-indexer` + `wazuh-manager` +
`wazuh-dashboard` (split into three nodes because one container = one role, the same pattern as
the `elastic`/`kibana` split in the ransomware-intrusion lab), two one-shot helpers
(`wazuh-certgen`, `wazuh-secadmin`), and `victim` (sshd target running a Wazuh agent). The
attacker is the instructor's own Kali, outside the lab — see **Attacker** below.

## Workspace location

Before building, point LabForge's workspace root at the dedicated drive for this class
(`Settings -> Workspace` in the dashboard, or set `LABFORGE_WORKSPACE_ROOT` before starting the
API) to e.g. `E:\LABS\labforge\account-compromise-chain`, instead of LabForge's default
`.labforge/workspaces`. This is a one-time setting for the whole LabForge instance, not something
baked into the template — all generated compose files, volumes and build logs for whatever lab
you build next will land there until you change it back.

## Start it

1. Open `templates -> Account Compromise Chain (Docker, Wazuh SIEM)` in LabForge and press
   **Build** (provider is already `docker`; build order — indexer, then manager, then dashboard
   and victim — is handled automatically by each role's `depends_on`).
2. First build pulls the three Wazuh images (about 1.5 GB) and builds the `victim` image (adds
   the Wazuh APT repo and `wazuh-agent` package, about a minute). Allow 5-10 minutes first time,
   Wazuh's indexer+dashboard take a couple of minutes to report healthy even after the images are
   cached.
3. When the monitor shows all four services `ready`:
   - Dashboard: `https://127.0.0.1:<published-port>` (see the monitor/README for the exact
     port — self-signed certificate, your browser will warn). Login is the `wazuh-dashboard`
     node's credentials (`admin` / `LabForge!2026` in the bundled template).
   - Confirm `victim` shows **Active** under **Agents** before running the attack.

## Running the attack (live, in front of class)

From your own Kali, create `wordlist.txt` beforehand with 15-20 candidate passwords, the real
password (`password123`) placed somewhere in the middle, not first or last. `victim`'s SSH is
published on `127.0.0.1` (the host port is in the monitor/README, usually 22):

```
hydra -l jdoe -P wordlist.txt -s <ssh-host-port> ssh://127.0.0.1
```

Once Hydra reports the hit, SSH in manually as `jdoe` (`ssh -p <ssh-host-port> jdoe@127.0.0.1`, password `password123`)
and perform a quick privilege-escalation step:

```
sudo adduser backdoor_acct
```

or

```
sudo visudo        # append: jdoe ALL=(ALL) NOPASSWD: ALL
```

Both are watched by the agent's File Integrity Monitoring config (realtime on `/etc/passwd` and
`/etc/sudoers`), so this step also lights up in the dashboard instead of being a pure "the SIEM
didn't catch everything" gap.

## Evidence for students

Primary: Wazuh dashboard, **Security Events** (and **Agents > victim > Events**), filtered to the
`victim` agent and time-windowed to the attack run. Default Wazuh SSH/PAM rules fire on repeated
auth failures and the eventual success, each with a rule ID, severity and timestamp, often
pre-tagged with a MITRE ATT&CK technique.

Secondary (raw log vs. what Wazuh parsed — a good discussion point):

```
docker compose -p <project> exec victim bash
tail -f /var/log/auth.log
```

(`journalctl -u ssh` will **not** work here — `victim` is a bare container, not a VM with
systemd; this is the one behavioral gap from a real VM flagged in the plan's Docker-feasibility
check. `/var/log/auth.log` is populated normally because the `ssh-victim` role runs rsyslog
alongside sshd specifically to produce it.)

## Reset for a re-run

```
docker compose -p <project> up -d --force-recreate victim
```

`victim` carries no volume, so this is a byte-identical pre-attack state every time — the
Docker-native equivalent of the VM snapshot the original scenario file asked for (LabForge has no
VM/container snapshot feature today; confirmed with the instructor that a stateless recreate is
an acceptable substitute). Re-enrollment with the manager happens automatically on the next
start. `wazuh-manager`/`wazuh-indexer` do not need resetting between sections — old alerts stay
in the dashboard as history, useful for comparing two sections' runs side by side later.

## Mapping worksheet (student handout)

| Observed evidence | Kill Chain stage | ATT&CK technique (student fills in) |
|---|---|---|
| Hydra connection attempts (Wazuh: connection/auth events start appearing) | Reconnaissance / Delivery | |
| Repeated failed SSH logins (Wazuh: PAM/SSH authentication failure rule fires repeatedly) | Delivery | |
| Successful login (Wazuh: authentication success, often flagged anomalous after prior failures) | Exploitation / Initial Access | |
| New user or sudoers edit (Wazuh: FIM alert on `/etc/passwd` or `/etc/sudoers`) | Installation / Persistence, Privilege Escalation | |
| (student identifies what a C2/Actions-on-Objectives step would look like here) | Actions on Objectives | |

## Attacker

As the source scenario file asked, `attacker`/Kali is set up by the instructor and is not part
of this lab (an earlier build bundled a bare `kali-rolling` container; it had no desktop, so it
was removed). `victim`'s SSH port is published on `127.0.0.1` only (the `ssh-victim` role's
`ports`), so the attacking tool must run on the same machine as Docker, or reach it through a
port forward. A Kali VM on a separate virtual network cannot see a loopback-only port.

## Known gaps (not integration-tested against a live Docker engine)

- `wazuh-indexer`, `wazuh-manager` and `wazuh-dashboard` disable inter-node TLS
  (`DISABLE_SECURITY_PLUGIN=true` on the indexer) for lab simplicity — acceptable on an isolated
  Docker network, not a pattern to copy for anything internet-facing.
- Exact health-check commands/log lines for the Wazuh images are best-effort against the 4.9.0
  release notes, not verified against a running container; if a service reports unhealthy, check
  `docker compose -p <project> logs wazuh-manager` (etc.) first.
- No data volume is attached to any Wazuh node either, matching `victim`'s "reset = recreate"
  design — alerts persist for the life of the lab's `docker compose up`, but are lost on
  `docker compose down -v`.
