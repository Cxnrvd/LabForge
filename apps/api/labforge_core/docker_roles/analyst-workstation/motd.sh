# Shown on interactive shells in the analyst workstation.
case $- in *i*) ;; *) return ;; esac
[ -n "$LABFORGE_MOTD_SHOWN" ] && return
export LABFORGE_MOTD_SHOWN=1
cat <<'TXT'

  LabForge analyst workstation
  ----------------------------
  Raw logs        /data/events.ndjson   (read-only, one JSON event per line)
  Search          esq 'event.code:4769 AND winlog.event_data.TicketEncryptionType:0x17'
  Count           esq --count 'event.dataset:"vpn.auth"'
  Group by field  esq --by source.ip 'event.action:"vpn-login-failed"'
  Choose columns  esq -f @timestamp,host.name,process.command_line 'process.name:"certutil.exe"'
  Kibana          see the lab README for the address on your machine
  Ground truth    /data/answer-key.md   (spoilers)

  Plain tools also work:  jq, rg, awk.   Example:
  rg -c '"event":\{"code":"1"' /data/events.ndjson

TXT
