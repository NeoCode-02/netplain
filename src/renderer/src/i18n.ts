import { useSyncExternalStore } from 'react'

const en = {
  lang: 'English',
  nav: { network: 'Network', connections: 'Connections', devices: 'Devices', settings: 'Settings' },
  kind: { wifi: 'Wi-Fi', ethernet: 'Ethernet', virtual: 'Virtual', vpn: 'VPN', bluetooth: 'Bluetooth', cellular: 'Mobile', loopback: 'Loopback', other: 'Other' },
  /** What each kind of adapter is, for someone who has never opened ipconfig. */
  what: {
    wifi: 'Wireless adapter: connects this computer to Wi-Fi networks.',
    ethernet: 'Wired network port: a cable to a router, switch or wall socket.',
    virtualbox: 'VirtualBox’s private network between this computer and its virtual machines. It does not lead to the internet.',
    vmware: 'VMware’s private network between this computer and its virtual machines.',
    wsl: 'Virtual network for WSL, the Linux that runs inside Windows.',
    hyperv: 'Hyper-V virtual switch for virtual machines and containers.',
    docker: 'Virtual network that Docker containers use.',
    wifiDirect: 'Wi-Fi Direct: links devices without a router (screen casting, Mobile hotspot). Usually idle.',
    awdl: 'Apple Wireless Direct Link: used by AirDrop and AirPlay.',
    bridge: 'Bridge: joins several networks into one.',
    virtual: 'Virtual adapter made by software; there is no cable or antenna behind it.',
    openvpn: 'OpenVPN adapter (TAP): when the VPN is on, traffic goes through an encrypted tunnel.',
    wireguard: 'WireGuard VPN tunnel: traffic goes encrypted to the VPN server.',
    tailscale: 'Tailscale: a private network between your own devices.',
    vpn: 'VPN adapter: traffic goes through an encrypted tunnel to another server.',
    bluetooth: 'Network over Bluetooth, e.g. sharing a phone’s internet.',
    cellular: 'Mobile internet through a SIM card or modem.',
    other: 'Other network adapter.'
  },
  network: {
    title: 'Network',
    wifiSummary: (ssid: string, via: string) => `You are on the Wi-Fi network “${ssid}”. Internet traffic goes through ${via}.`,
    wiredSummary: (via: string) => `Internet traffic goes through ${via}.`,
    vpnSummary: (via: string) => `A VPN is on: internet traffic goes through ${via}.`,
    offline: 'No adapter can reach the internet right now.',
    loading: 'Reading network adapters…',
    download: 'Download',
    upload: 'Upload',
    peak: (v: string) => `Peak this minute: ${v}`,
    chartLabel: (down: string, up: string) => `Traffic over the last minute. Now: download ${down}, upload ${up}.`,
    secondsAgo: (s: number) => (s === 0 ? 'now' : `${s} s ago`),
    ip: 'IP address',
    gateway: 'Router (gateway)',
    gatewayNote: 'The device that passes your traffic on to the internet.',
    dns: 'DNS servers',
    dnsNote: 'They turn names like google.com into IP addresses.',
    mac: 'MAC address',
    macNote: 'The adapter’s hardware ID on the local network.',
    assigned: 'Address set',
    dhcp: 'Automatically (DHCP)',
    manual: 'Manually',
    linkSpeed: 'Link speed',
    ipv6: 'IPv6',
    none: '—',
    address: {
      apipa: 'Self-assigned: no DHCP server answered, so this adapter has no internet.',
      private: 'Private address: visible only inside this network. Your router shares one public address for everyone.',
      cgnat: 'Shared address range (100.64.0.0/10) used by carriers and some VPNs.',
      public: 'Public address: reachable from the internet.'
    },
    wifi: 'Wi-Fi',
    ssid: 'Network',
    ssidHidden: 'Hidden by the OS',
    signal: 'Signal',
    band: 'Band',
    channel: 'Channel',
    standard: 'Standard',
    security: 'Security',
    rate: 'Link rate',
    quality: { excellent: 'Excellent', good: 'Good', fair: 'Fair', weak: 'Weak' },
    bandNote: {
      '2.4': '2.4 GHz reaches farther through walls but is slower and more crowded.',
      '5': '5 GHz is faster but weakens through walls.',
      '6': '6 GHz (Wi-Fi 6E/7) is the newest and fastest, with a short range.'
    },
    authNote: {
      strong: 'Modern, strong encryption.',
      ok: 'Encrypted; fine for home use.',
      weak: 'Weak or no encryption: people nearby may see your traffic.'
    },
    others: 'Other adapters',
    inactive: (n: number) => `Not in use (${n})`,
    role: { internet: 'Internet', local: 'Local only', down: 'Off' },
    localOnly: 'Connected, but without a way to the internet (no gateway): it only reaches devices on its own network.',
    down: 'Not connected right now.'
  },
  devices: {
    title: 'Devices',
    lead: 'Devices on your local networks that this computer has talked to recently.',
    scan: 'Scan network',
    scanning: 'Scanning…',
    scanNote: 'Scanning sends one tiny packet to every address of your local network (/24) so that devices answer. Nothing leaves your network.',
    router: 'Router',
    routerNote: 'Your gateway to the internet.',
    randomMac: 'Private MAC',
    randomNote: 'Phones and laptops use a random MAC on each network for privacy, so the maker is hidden.',
    vmNote: 'A virtual machine or container running on this computer.',
    unknown: 'Unknown maker',
    noVendors: 'Install Wireshark to see who made each device.',
    count: (n: number) => (n === 1 ? '1 device' : `${n} devices`),
    empty: 'No devices seen yet',
    emptyBody: 'Scan the network to find the devices around you.',
    device: 'Device',
    ip: 'IP address',
    mac: 'MAC address'
  },
  settings: {
    title: 'Settings',
    theme: 'Theme',
    themes: { system: 'System', light: 'Light', dark: 'Dark' },
    language: 'Language',
    about: 'About',
    version: (v: string) => `Netplain ${v}`,
    privacy: 'Everything here is read on this computer. Netplain only goes online when you press a button that says so.',
    geo: 'Location database',
    geoWhy: 'Shows which country and company an internet address belongs to. Downloaded once from db-ip.com (free, about 9 MB); after that every lookup stays on this computer.',
    geoReady: (date: string) => `DB-IP Lite, built ${date}`,
    geoMissing: 'Not downloaded yet',
    geoDownload: 'Download (≈9 MB)',
    geoUpdate: 'Update',
    geoBusy: 'Downloading…',
    geoCredit: 'IP geolocation by DB-IP (CC BY 4.0)'
  },
  connections: {
    title: 'Connections',
    summary: (apps: number, places: number) => `${apps === 1 ? '1 app is' : `${apps} apps are`} talking to ${places === 1 ? '1 place' : `${places} places`} on the internet.`,
    mostly: (names: string) => `Most connections go to ${names}.`,
    none: 'No app is talking to the internet right now.',
    loading: 'Reading connections…',
    search: 'Search apps, sites, companies, IPs',
    scope: { internet: 'Internet', local: 'Local', all: 'All' },
    count: (n: number) => (n === 1 ? '1 connection' : `${n} connections`),
    address: 'Address',
    company: 'Company',
    service: 'Service',
    state: 'State',
    nothing: 'Nothing matches.',
    geoBanner: 'Download the free location database to see which country and company each address belongs to.',
    listening: 'Open ports',
    listeningLead: 'Programs on this computer waiting for others to connect.',
    exposed: 'Open to the network',
    exposedNote: 'Other devices on your network can try to connect.',
    localOnly: 'This computer only',
    noListening: 'No program is waiting for connections.',
    windowsOwn: 'Windows’s own service; the firewall normally guards it',
    limits: 'Very short connections may come and go between refreshes.',
    limitsUnix: 'Only your own user’s programs are listed unless Netplain runs as administrator.',
    states: {
      established: 'Connected',
      listen: 'Waiting',
      time_wait: 'Closing',
      close_wait: 'Closing',
      fin_wait: 'Closing',
      last_ack: 'Closing',
      closing: 'Closing',
      closed: 'Closed',
      syn_sent: 'Connecting',
      syn_received: 'Connecting',
      bound: 'Open',
      other: '—'
    } as Record<string, string>
  },
  /** Windows system processes that have no description of their own. */
  procs: {
    Idle: 'Recently closed (Windows)',
    System: 'Windows (system)',
    svchost: 'Windows services',
    lsass: 'Windows sign-in and security',
    spoolsv: 'Printing',
    wininit: 'Windows start-up',
    services: 'Windows service manager'
  } as Record<string, string>,
  services: {
    https: ['HTTPS', 'Encrypted web traffic'],
    quic: ['QUIC (HTTP/3)', 'Encrypted web traffic over UDP'],
    http: ['HTTP', 'Unencrypted web: others on the network could read it'],
    httpAlt: ['HTTP (8080)', 'Web on a spare port, usually unencrypted'],
    dns: ['DNS', 'Looking up names, unencrypted'],
    dot: ['DNS over TLS', 'Encrypted name lookups'],
    ssh: ['SSH', 'Encrypted remote terminal'],
    ftp: ['FTP', 'File transfer, unencrypted'],
    telnet: ['Telnet', 'Remote terminal, unencrypted'],
    mail: ['Mail', 'Sending or reading e-mail, encrypted'],
    mailPlain: ['Mail', 'Reading e-mail, possibly unencrypted'],
    rdp: ['Remote Desktop', 'Remote control of a Windows computer'],
    smb: ['File sharing', 'Windows shared folders and printers (SMB)'],
    rpc: ['Windows RPC', 'Windows services talking to each other'],
    push: ['Push notifications', 'App notifications from Google or Apple'],
    chat: ['Chat', 'Messaging (XMPP)'],
    calls: ['Calls', 'Finding a route for voice and video calls'],
    ntp: ['Time sync', 'Keeping the clock right'],
    mdns: ['Nearby devices', 'Finding printers and devices nearby (mDNS)'],
    ssdp: ['Nearby devices', 'Finding TVs and media devices (UPnP)'],
    db: ['Database', 'A database server'],
    delivery: ['Delivery Optimization', 'Windows sharing updates with other computers'],
    cdp: ['Connected devices', 'Windows phone link and nearby sharing'],
    wsd: ['Device discovery', 'Windows finding network printers and scanners'],
    dev: ['Development server', 'Probably a program you are building']
  } as Record<string, [string, string]>,
  errors: {
    E_COLLECT: 'Can’t read the network adapters right now. Retrying…',
    E_OFFLINE: 'There is no network connection to scan.',
    E_NOT_PRIVATE: 'Only private local networks (home or office) are scanned.',
    E_BAD_ARGS: 'The request was not valid.',
    E_GEO_DOWNLOAD: 'The location database could not be downloaded. Check the internet connection and try again.',
    unknown: (m: string) => `Something went wrong: ${m}`
  }
}

export type Dict = typeof en

const uz: Dict = {
  lang: 'O‘zbekcha',
  nav: { network: 'Tarmoq', connections: 'Ulanishlar', devices: 'Qurilmalar', settings: 'Sozlamalar' },
  kind: { wifi: 'Wi-Fi', ethernet: 'Ethernet', virtual: 'Virtual', vpn: 'VPN', bluetooth: 'Bluetooth', cellular: 'Mobil', loopback: 'Loopback', other: 'Boshqa' },
  what: {
    wifi: 'Simsiz adapter: kompyuterni Wi-Fi tarmoqlariga ulaydi.',
    ethernet: 'Simli tarmoq porti: router, switch yoki devordagi rozetkaga kabel.',
    virtualbox: 'VirtualBox’ning ichki tarmog‘i: shu kompyuter va virtual mashinalar orasida. Internetga olib chiqmaydi.',
    vmware: 'VMware’ning ichki tarmog‘i: shu kompyuter va virtual mashinalar orasida.',
    wsl: 'WSL (Windows ichidagi Linux) uchun virtual tarmoq.',
    hyperv: 'Hyper-V virtual kommutatori: virtual mashinalar va konteynerlar uchun.',
    docker: 'Docker konteynerlari ishlatadigan virtual tarmoq.',
    wifiDirect: 'Wi-Fi Direct: qurilmalarni routersiz ulaydi (ekranni uzatish, Mobile hotspot). Odatda ishlatilmaydi.',
    awdl: 'Apple Wireless Direct Link: AirDrop va AirPlay uchun.',
    bridge: 'Ko‘prik: bir nechta tarmoqni bittaga birlashtiradi.',
    virtual: 'Dastur yaratgan virtual adapter: ortida kabel ham, antenna ham yo‘q.',
    openvpn: 'OpenVPN adapteri (TAP): VPN yoqilganda trafik shifrlangan tunnel orqali o‘tadi.',
    wireguard: 'WireGuard VPN tunneli: trafik shifrlangan holda VPN serverga boradi.',
    tailscale: 'Tailscale: o‘z qurilmalaringiz orasidagi shaxsiy tarmoq.',
    vpn: 'VPN adapteri: trafik shifrlangan tunnel orqali boshqa serverga boradi.',
    bluetooth: 'Bluetooth orqali tarmoq, masalan telefon internetini ulashish.',
    cellular: 'SIM karta yoki modem orqali mobil internet.',
    other: 'Boshqa tarmoq adapteri.'
  },
  network: {
    title: 'Tarmoq',
    wifiSummary: (ssid, via) => `Siz “${ssid}” Wi-Fi tarmog‘iga ulangansiz. Internet trafigi ${via} orqali o‘tadi.`,
    wiredSummary: (via) => `Internet trafigi ${via} orqali o‘tadi.`,
    vpnSummary: (via) => `VPN yoqilgan: internet trafigi ${via} orqali o‘tadi.`,
    offline: 'Hozir hech bir adapter internetga chiqa olmayapti.',
    loading: 'Tarmoq adapterlari o‘qilmoqda…',
    download: 'Yuklab olish',
    upload: 'Yuborish',
    peak: (v) => `Shu daqiqadagi eng yuqori: ${v}`,
    chartLabel: (down, up) => `Oxirgi bir daqiqadagi trafik. Hozir: yuklab olish ${down}, yuborish ${up}.`,
    secondsAgo: (s) => (s === 0 ? 'hozir' : `${s} s oldin`),
    ip: 'IP manzil',
    gateway: 'Router (gateway)',
    gatewayNote: 'Trafikingizni internetga uzatadigan qurilma.',
    dns: 'DNS serverlar',
    dnsNote: 'google.com kabi nomlarni IP manzilga aylantiradi.',
    mac: 'MAC manzil',
    macNote: 'Adapterning lokal tarmoqdagi apparat raqami.',
    assigned: 'Manzil berilishi',
    dhcp: 'Avtomatik (DHCP)',
    manual: 'Qo‘lda',
    linkSpeed: 'Ulanish tezligi',
    ipv6: 'IPv6',
    none: '—',
    address: {
      apipa: 'O‘zi tanlagan manzil: DHCP server javob bermadi, shu sabab bu adapterda internet yo‘q.',
      private: 'Xususiy manzil: faqat shu tarmoq ichida ko‘rinadi. Router hamma uchun bitta umumiy manzildan foydalanadi.',
      cgnat: 'Umumiy manzillar oralig‘i (100.64.0.0/10): provayderlar va ba’zi VPN’lar ishlatadi.',
      public: 'Ommaviy manzil: internetdan ko‘rinadi.'
    },
    wifi: 'Wi-Fi',
    ssid: 'Tarmoq',
    ssidHidden: 'OS yashirgan',
    signal: 'Signal',
    band: 'Diapazon',
    channel: 'Kanal',
    standard: 'Standart',
    security: 'Himoya',
    rate: 'Ulanish tezligi',
    quality: { excellent: 'A’lo', good: 'Yaxshi', fair: 'O‘rtacha', weak: 'Kuchsiz' },
    bandNote: {
      '2.4': '2.4 GHz devorlardan yaxshiroq o‘tadi, lekin sekinroq va gavjumroq.',
      '5': '5 GHz tezroq, lekin devorlardan o‘tganda susayadi.',
      '6': '6 GHz (Wi-Fi 6E/7) eng yangi va eng tez, lekin yaqin masofaga yetadi.'
    },
    authNote: {
      strong: 'Zamonaviy, kuchli shifrlash.',
      ok: 'Shifrlangan; uy uchun yetarli.',
      weak: 'Shifrlash kuchsiz yoki yo‘q: yaqindagilar trafikingizni ko‘rishi mumkin.'
    },
    others: 'Boshqa adapterlar',
    inactive: (n) => `Ishlatilmayapti (${n})`,
    role: { internet: 'Internet', local: 'Faqat lokal', down: 'O‘chiq' },
    localOnly: 'Ulangan, lekin internetga yo‘li (gateway) yo‘q: faqat o‘z tarmog‘idagi qurilmalarga yetadi.',
    down: 'Hozir ulanmagan.'
  },
  devices: {
    title: 'Qurilmalar',
    lead: 'Lokal tarmoqlardagi, kompyuteringiz yaqinda gaplashgan qurilmalar.',
    scan: 'Tarmoqni skanerlash',
    scanning: 'Skanerlanmoqda…',
    scanNote: 'Skanerlash lokal tarmog‘ingizdagi (/24) har bir manzilga bitta kichik paket yuboradi, shunda qurilmalar javob beradi. Hech narsa tarmog‘ingizdan tashqariga chiqmaydi.',
    router: 'Router',
    routerNote: 'Internetga chiqish eshigingiz.',
    randomMac: 'Shaxsiy MAC',
    randomNote: 'Telefon va noutbuklar maxfiylik uchun har bir tarmoqda tasodifiy MAC ishlatadi, shuning uchun ishlab chiqaruvchi ko‘rinmaydi.',
    vmNote: 'Shu kompyuterda ishlayotgan virtual mashina yoki konteyner.',
    unknown: 'Noma’lum ishlab chiqaruvchi',
    noVendors: 'Qurilmani kim ishlab chiqarganini ko‘rish uchun Wireshark o‘rnating.',
    count: (n) => `${n} ta qurilma`,
    empty: 'Hali qurilma ko‘rinmadi',
    emptyBody: 'Atrofingizdagi qurilmalarni topish uchun tarmoqni skanerlang.',
    device: 'Qurilma',
    ip: 'IP manzil',
    mac: 'MAC manzil'
  },
  settings: {
    title: 'Sozlamalar',
    theme: 'Mavzu',
    themes: { system: 'Tizim', light: 'Yorug‘', dark: 'Qorong‘i' },
    language: 'Til',
    about: 'Dastur haqida',
    version: (v) => `Netplain ${v}`,
    privacy: 'Bu yerdagi hamma narsa shu kompyuterning o‘zida o‘qiladi. Netplain internetga faqat siz shuni aytadigan tugmani bosganingizda chiqadi.',
    geo: 'Joylashuv bazasi',
    geoWhy: 'Internet manzili qaysi davlat va kompaniyaga tegishli ekanini ko‘rsatadi. db-ip.com dan bir marta yuklanadi (bepul, taxminan 9 MB); keyin har bir tekshiruv shu kompyuterda qoladi.',
    geoReady: (date) => `DB-IP Lite, ${date} holatiga`,
    geoMissing: 'Hali yuklanmagan',
    geoDownload: 'Yuklab olish (≈9 MB)',
    geoUpdate: 'Yangilash',
    geoBusy: 'Yuklanmoqda…',
    geoCredit: 'IP joylashuvi: DB-IP (CC BY 4.0)'
  },
  connections: {
    title: 'Ulanishlar',
    summary: (apps, places) => `${apps} ta ilova internetdagi ${places} ta manzil bilan bog‘langan.`,
    mostly: (names) => `Ko‘pchiligi: ${names}.`,
    none: 'Hozir hech bir ilova internet bilan gaplashmayapti.',
    loading: 'Ulanishlar o‘qilmoqda…',
    search: 'Ilova, sayt, kompaniya yoki IP qidiring',
    scope: { internet: 'Internet', local: 'Lokal', all: 'Hammasi' },
    count: (n) => `${n} ta ulanish`,
    address: 'Manzil',
    company: 'Kompaniya',
    service: 'Xizmat',
    state: 'Holat',
    nothing: 'Hech narsa topilmadi.',
    geoBanner: 'Har bir manzil qaysi davlat va kompaniyaga tegishli ekanini ko‘rish uchun bepul joylashuv bazasini yuklab oling.',
    listening: 'Ochiq portlar',
    listeningLead: 'Shu kompyuterda boshqalar ulanishini kutayotgan dasturlar.',
    exposed: 'Tarmoqqa ochiq',
    exposedNote: 'Tarmog‘ingizdagi boshqa qurilmalar ulanishga urinishi mumkin.',
    localOnly: 'Faqat shu kompyuter',
    noListening: 'Hech bir dastur ulanish kutmayapti.',
    windowsOwn: 'Windows’ning o‘z xizmati; odatda xavfsizlik devori himoya qiladi',
    limits: 'Juda qisqa ulanishlar yangilanishlar orasida ko‘rinmay qolishi mumkin.',
    limitsUnix: 'Netplain administrator sifatida ishlamasa, faqat o‘z foydalanuvchingiz dasturlari ko‘rinadi.',
    states: {
      established: 'Ulangan',
      listen: 'Kutmoqda',
      time_wait: 'Yopilmoqda',
      close_wait: 'Yopilmoqda',
      fin_wait: 'Yopilmoqda',
      last_ack: 'Yopilmoqda',
      closing: 'Yopilmoqda',
      closed: 'Yopilgan',
      syn_sent: 'Ulanmoqda',
      syn_received: 'Ulanmoqda',
      bound: 'Ochiq',
      other: '—'
    }
  },
  procs: {
    Idle: 'Yaqinda yopilgan (Windows)',
    System: 'Windows (tizim)',
    svchost: 'Windows xizmatlari',
    lsass: 'Windows kirish va xavfsizlik',
    spoolsv: 'Chop etish',
    wininit: 'Windows ishga tushishi',
    services: 'Windows xizmatlar boshqaruvchisi'
  },
  services: {
    https: ['HTTPS', 'Shifrlangan veb trafik'],
    quic: ['QUIC (HTTP/3)', 'UDP orqali shifrlangan veb trafik'],
    http: ['HTTP', 'Shifrlanmagan veb: tarmoqdagilar o‘qishi mumkin'],
    httpAlt: ['HTTP (8080)', 'Qo‘shimcha portdagi veb, odatda shifrlanmagan'],
    dns: ['DNS', 'Nomlarni qidirish, shifrlanmagan'],
    dot: ['DNS over TLS', 'Shifrlangan nom qidirish'],
    ssh: ['SSH', 'Shifrlangan masofaviy terminal'],
    ftp: ['FTP', 'Fayl uzatish, shifrlanmagan'],
    telnet: ['Telnet', 'Masofaviy terminal, shifrlanmagan'],
    mail: ['Pochta', 'Xat yuborish yoki o‘qish, shifrlangan'],
    mailPlain: ['Pochta', 'Xat o‘qish, shifrlanmagan bo‘lishi mumkin'],
    rdp: ['Masofaviy ish stoli', 'Windows kompyuterni masofadan boshqarish'],
    smb: ['Fayl almashish', 'Windows umumiy papkalari va printerlar (SMB)'],
    rpc: ['Windows RPC', 'Windows xizmatlarining o‘zaro aloqasi'],
    push: ['Push bildirishnomalar', 'Google yoki Apple’dan ilova bildirishnomalari'],
    chat: ['Chat', 'Xabar almashish (XMPP)'],
    calls: ['Qo‘ng‘iroqlar', 'Ovozli va video qo‘ng‘iroq uchun yo‘l topish'],
    ntp: ['Vaqt', 'Soatni to‘g‘ri ushlab turish'],
    mdns: ['Yaqin qurilmalar', 'Yaqindagi printer va qurilmalarni topish (mDNS)'],
    ssdp: ['Yaqin qurilmalar', 'Televizor va media qurilmalarni topish (UPnP)'],
    db: ['Ma’lumotlar bazasi', 'Ma’lumotlar bazasi serveri'],
    delivery: ['Delivery Optimization', 'Windows yangilanishlarini boshqa kompyuterlar bilan ulashish'],
    cdp: ['Bog‘langan qurilmalar', 'Windows telefon aloqasi va yaqin atrofga ulashish'],
    wsd: ['Qurilmalarni topish', 'Windows tarmoqdagi printer va skanerlarni qidiradi'],
    dev: ['Dasturlash serveri', 'Ehtimol siz yozayotgan dastur']
  },
  errors: {
    E_COLLECT: 'Tarmoq adapterlarini hozir o‘qib bo‘lmayapti. Qayta urinilmoqda…',
    E_OFFLINE: 'Skanerlash uchun tarmoq ulanishi yo‘q.',
    E_NOT_PRIVATE: 'Faqat xususiy lokal tarmoqlar (uy yoki ofis) skanerlanadi.',
    E_BAD_ARGS: 'So‘rov noto‘g‘ri.',
    E_GEO_DOWNLOAD: 'Joylashuv bazasini yuklab bo‘lmadi. Internet ulanishini tekshirib, qayta urinib ko‘ring.',
    unknown: (m) => `Nimadir xato ketdi: ${m}`
  }
}

export const LANGS = { en, uz }
export type Lang = keyof typeof LANGS

const KEY = 'netplain.lang'
const listeners = new Set<() => void>()

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'uz') return saved
  } catch {
    // storage unavailable: fall back to the system language
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('uz') ? 'uz' : 'en'
}

let current: Lang = initial()
if (typeof document !== 'undefined') document.documentElement.lang = current

export function setLang(l: Lang) {
  current = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    // not persisted; still applies for this session
  }
  document.documentElement.lang = l
  listeners.forEach((f) => f())
}

export const getLang = () => current

export function useT(): Dict {
  const lang = useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => current
  )
  return LANGS[lang]
}

/** An IPC error ("Error invoking remote method 'scan': Error: E_OFFLINE") in the reader's language. */
export function errText(t: Dict, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const code = /\bE_[A-Z_]+/.exec(msg)?.[0] as keyof Dict['errors'] | undefined
  const known = code && code !== 'unknown' ? t.errors[code] : undefined
  return typeof known === 'string' ? known : t.errors.unknown(msg.replace(/^Error invoking remote method '\w+': (Error: )?/, ''))
}
