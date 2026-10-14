# Netplain

See what your computer does on the network, in plain language — without `ipconfig`, `netstat` or Wireshark filters.

> Status: early development. Working now: **Network** (every adapter explained, Wi-Fi details, live traffic) and **Devices** (who is on your local network). Coming next: per-app connections and traffic, packets, usage history, alerts.

- **Plain language** in English and Uzbek: what a VirtualBox or WSL adapter is, whether your Wi-Fi security is fine, what a private address means.
- **Everything in one place**: adapters, Wi-Fi signal and band, IP / router / DNS, devices on your network and who made them.
- **Local only**: everything is read on your computer; Netplain sends nothing anywhere.

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

MIT
