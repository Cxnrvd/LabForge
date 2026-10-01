# Lab: Anatomy of a ransomware intrusion (Docker)

A fictional company, Harborline Logistics, is hit by a double-extortion ransomware attack.
Elasticsearch and Kibana hold about 24,000 synthetic events (Sysmon, Windows Security and System,
VPN and firewall). About 3,100 of them are the attack. Your job is to find it.

Everything is invented: hosts, users, and IPs from the documentation ranges (`203.0.113.0/24`,
`198.51.100.0/24`), domains under `.invalid`/`.example`. No real malware, no real organisation.

## Start it

1. Open `templates -> Ransomware Intrusion Hunt (Docker)` in LabForge and press **Build**
   (or `POST /api/v1/labs/build` with the template).
2. First build pulls the Elastic images and builds two small ones: allow 5 to 10 minutes. Later
   builds take about 2 minutes. Docker needs about 3 GB of free memory.
3. When the monitor shows all four containers `ready`:
   - Kibana: <http://127.0.0.1:5601> (Discover, data view **Harborline telemetry**, 17 saved
     searches named `01 ...` to `17 ...`)
   - Elasticsearch: <http://127.0.0.1:9200>
   - Analyst shell: `docker compose -p <project> exec analyst bash`, then `esq --help`
     (project name is in `<workspace>/.labforge-project`).
4. **Destroy** in the monitor removes containers, network and volumes and checks nothing is left.

Timestamps are generated relative to the moment the lab loads (the attack happens about a day
before). If the lab sits for more than 6 days, run
`docker compose -p <project> exec replay python /opt/labforge/entrypoint.py load --reset`.

## Hunt guide (what to ask the audience)

| # | Saved search | Question |
|---|---|---|
| 01 | VPN failed logins | Who is spraying, from where, against how many accounts? |
| 02 | VPN success from a new country | Which success followed the spray? |
| 03 | RDP from the VPN pool | Which host did they land on? |
| 04 | Discovery commands | What did they learn first? |
| 05 | certutil download | How did tooling arrive? Which certutil use is the decoy? |
| 06 | LSASS access | Which process touched LSASS, and what file did it write? |
| 07 | Kerberoasting | Which RC4 requests are real and which are a legacy app? |
| 08 to 10 | Admin RDP, new admin, ntdsutil | How did they become domain admin and persist? |
| 11 | Defender tampering | Which hosts lost protection? |
| 12 | PSEXESVC installs | Which installs are the attacker and which is IT patching? |
| 13, 14 | Exfil tool / firewall | How much left, to where? |
| 15 | Recovery inhibition | What did they delete before detonation? |
| 16 | Encryption | When did it start, which hosts, how many files? |
| 17 | Log clearing | What did they try to hide? |

Decoys on purpose: a vendor VPN login, `certutil -hashfile`, IT's PsExec on APP02, and RC4
tickets from a legacy SQL service. Calling them out is the best teaching moment.

## Answer key (presenter only)

Inside the replay container: `/data/answer-key.md` (readable timeline) and `/data/answer-key.json`
(every attack event id and stage).

`docker compose -p <project> exec replay cat /data/answer-key.md`

Attack timeline (UTC, relative to load): spray and first login, RDP to WS-ACC-014 within minutes,
discovery, certutil tooling, LDAP enumeration, LSASS dump (comsvcs MiniDump), Kerberoasting,
backup account use, domain admin + NTDS copy + rogue admin account, Defender tampering, PsExec
service installs, about 3 hours of staging and exfiltration to `198.51.100.77`, shadow copy and
catalog deletion, mass encryption (`.hlq1x`, ransom note), then log clearing.

## 45-minute run of show

- 0-5 Frame: what happened here is the typical shape of an intrusion. Show the Kibana timeline.
- 5-10 Build the lab live (or show it already up and the Build/Destroy buttons).
- 10-35 Hunt stages 01 to 12 with the audience calling the next question. Reveal a stage only
  after someone proposes the search.
- 35-42 Impact: exfil volume, recovery inhibition, encryption window, log clearing.
- 42-45 Detections you would write, and what would have stopped it at stage 01 to 03.

Have the lab running 15 minutes before you go live. Keep the answer key tab closed.
