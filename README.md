# Netplain

See what your computer does on the network, in plain language — without `ipconfig`, `netstat` or Wireshark filters.

> Status: early development. Working now: **Overview** (what is happening, in sentences), **Network** (every adapter explained, Wi-Fi details, live traffic), **Apps** (data used by each app and where it went — needs Wireshark), **Packets** (every packet in plain words, Wireshark filters, full details, save as .pcapng or open in Wireshark), **Connections** (which app talks to which company and country, open ports) and **Devices** (who is on your local network). Also **History** (data per hour and day, per app and adapter, kept 90 days) and **Alerts** (new app online, new open port, unencrypted traffic, known-bad addresses with your own list or FireHOL level 1). **Tools** replace the terminal: "is the internet not working?" check (adapter → address → router → DNS → internet), ping, traceroute, DNS lookup, port check, public IP, and fixes (clear DNS cache, renew IP, restart adapter — the system asks for admin rights with its own window). **Security** (Windows): a "was I hacked?" check — antivirus, firewall, UAC, admins, unsigned startup programs and services, unsigned programs online, hosts redirects, proxy, DNS, updates — each explained, honest that no list proves a computer clean — plus Antivirus (Microsoft Defender: status, quick/full scan, threat history in plain words), Users (turn accounts off, remove admin rights, with lock-out protection), Services and Startup (Task Manager’s reversible switch). Changes ask for admin rights through Windows’s own prompt.

- **Plain language** in English and Uzbek: what a VirtualBox or WSL adapter is, whether your Wi-Fi security is fine, what a private address means.
- **Everything in one place**: adapters, Wi-Fi signal and band, IP / router / DNS, devices on your network and who made them.
- **Local only**: everything is read on your computer. Netplain goes online only when you press a button that says so (e.g. downloading the free location database).

## Requirements

- Windows 10/11, macOS or Linux.
- Optional: [Wireshark](https://www.wireshark.org/) — Netplain uses its engine (`tshark`) to name device makers now, and for per-app traffic and packets later. Without it, the Network page and the device list still work.

## Development

```bash
npm install
npm run dev
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e` (drives the built app on your real network and saves screenshots to `e2e/shots/`).

How data is read, per OS: Windows — .NET `NetworkInterface`, `netsh wlan`, `arp -a` (no admin rights); macOS — `ifconfig`, `netstat -ibn`, `networksetup`, `scutil`, `system_profiler`, `arp -an`; Linux — `/sys/class/net`, `/proc/net/*`, optional `nmcli`.

## License

MIT. IP geolocation by [DB-IP](https://db-ip.com) (CC BY 4.0), downloaded from inside the app.
