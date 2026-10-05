# USB wifi adapter compatibility (VirtualBox passthrough)

What we've actually verified, on real hardware, passing a USB wifi adapter
through to a Debian 12 Vagrant/VirtualBox guest for the `hostapd` role. Not a
general compatibility database — just the two chipsets tested against this
exact lab, kept honest rather than extrapolated.

## Before anything else: the VirtualBox Extension Pack

USB passthrough without the (separately licensed, Oracle PUEL) Extension
Pack only gets a USB 1.1 (OHCI) controller. A USB 2.0 adapter still shows up
in the guest, but its endpoints get forced into full-speed mode and the
driver often never finishes bringing up a usable wireless interface —
confirmed on this exact setup. Install the Extension Pack matching your
VirtualBox version from virtualbox.org/wiki/Downloads first; LabForge's
generator checks for it and only enables the USB 2.0 controller when it's
actually present (see `hostenv.virtualbox_extpack_installed()`).

## Tested chipsets

| Chipset | USB ID | Driver that works | Notes |
|---|---|---|---|
| MediaTek MT7610U (e.g. some Alfa AC-class dongles) | `0e8d:7610` | `mt76x0u` (mainline, mac80211) | Works out of the box on a fresh Debian 12 box — no extra steps. |
| Realtek RTL8188EU (common on cheap TP-Link-class dongles) | `0bda:0179` | `8188eu` (aircrack-ng community fork, **not** Debian's bundled `r8188eu`) | Debian's own `r8188eu` module only exposes legacy Wireless Extensions — hostapd requires `nl80211` and silently can't use it. The `hostapd` role now detects this exact USB ID and builds the working driver automatically (kernel/headers upgrade + DKMS build), but needs one reboot to take effect — see the note below. |

## The Realtek RTL8188EU fix, in short

The `hostapd` role's install script now:
1. Checks `lsusb` for `0bda:0179`.
2. If found, installs the latest kernel + matching headers + build tools.
3. Blacklists the stock `r8188eu` driver.
4. Clones and DKMS-builds `github.com/aircrack-ng/rtl8188eus` — the
   actively maintained fork built for exactly this pentest use case
   (supports `managed`, `AP`, `monitor`, `IBSS` over real `nl80211`).

This can't finish in one `vagrant up` because the new kernel needs a reboot
to actually load, and forcing an uncoordinated reboot mid-provision would
break Vagrant's own success/failure detection. Instead, the first
provisioning run ends with a line telling you to run `vagrant reload
<hostname>` then `vagrant provision <hostname>` once. **Do this the night
before a demo, not on stage** — it's a few minutes of mostly-unattended
compiling (single-threaded on a default-sized VM), and you want it already
verified working before an audience is watching.

## If you're using a different adapter

If `iw dev` shows the interface but `iw list` / `iw phy` doesn't show `AP`
under "Supported interface modes" — or `iw dev` shows nothing at all despite
`ip link` showing the interface (a classic sign of a WEXT-only driver, same
symptom as the Realtek case above) — that chipset's driver doesn't support
AP mode under Linux as currently loaded. Two things worth checking before
assuming the hardware itself can't do it:
- `dmesg`/`journalctl -k` for which driver actually bound to the device —
  a chipset can have both a bad stock driver and a working community one.
- Whether a newer out-of-tree driver exists for that chipset (search
  `<chipset> linux driver mac80211` — the aircrack-ng org hosts several).

If you add support for a new chipset to the `hostapd` role, please add a row
to the table above with what you actually verified — this file is only
useful if it stays honest about what's tested vs. assumed.
