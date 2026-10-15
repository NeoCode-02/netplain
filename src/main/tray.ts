import { Menu, nativeImage, Notification, Tray } from 'electron'
import fs from 'node:fs'
import { bits } from '../shared/format'
import t16 from '../../resources/tray-16.png?asset'
import t24 from '../../resources/tray-24.png?asset'
import t32 from '../../resources/tray-32.png?asset'
import m22 from '../../resources/trayTemplate-22.png?asset'
import m44 from '../../resources/trayTemplate-44.png?asset'

export type UiLang = 'en' | 'uz'

const TEXT = {
  en: {
    open: 'Open Netplain',
    watch: 'Watch traffic',
    quit: 'Quit Netplain',
    rate: (down: string, up: string) => `Netplain\n↓ ${down}   ↑ ${up}`,
    hidden: ['Netplain keeps running', 'It keeps watching your network from the tray. To quit, use the tray icon’s menu.']
  },
  uz: {
    open: 'Netplain’ni ochish',
    watch: 'Trafikni kuzatish',
    quit: 'Netplain’dan chiqish',
    rate: (down: string, up: string) => `Netplain\n↓ ${down}   ↑ ${up}`,
    hidden: ['Netplain ishlashda davom etadi', 'U tarmog‘ingizni tray’dan kuzatib turadi. Chiqish uchun tray belgisining menyusidan foydalaning.']
  }
}

/** The app's mark: in colour on Windows and Linux; a template (black, tinted by the system) in the macOS menu bar. */
function icon() {
  const img = nativeImage.createEmpty()
  const reps: [string, number][] = process.platform === 'darwin' ? [[m22, 1], [m44, 2]] : [[t16, 1], [t24, 1.5], [t32, 2]]
  for (const [file, scaleFactor] of reps) img.addRepresentation({ scaleFactor, buffer: fs.readFileSync(file) })
  if (process.platform === 'darwin') img.setTemplateImage(true)
  return img
}

interface Deps {
  show(): void
  quit(): void
  capture(): boolean
  setCapture(on: boolean): void
}

/** The tray (notification area / menu bar) icon: live speed in its tooltip, and a small menu. */
export function createTray(d: Deps) {
  let lang: UiLang = 'en'
  let tip = ''
  const tray = new Tray(icon())
  const menu = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: TEXT[lang].open, click: d.show },
        { label: TEXT[lang].watch, type: 'checkbox', checked: d.capture(), click: (item) => d.setCapture(item.checked) },
        { type: 'separator' },
        { label: TEXT[lang].quit, click: d.quit }
      ])
    )
  tray.setToolTip('Netplain')
  // Windows and Linux open the window on a click; macOS shows the menu.
  tray.on('click', d.show)
  menu()

  return {
    setLang(l: UiLang) {
      lang = l
      menu()
    },
    /** The capture was switched elsewhere (Settings): the checkbox follows. */
    refresh: menu,
    rate(down: number, up: number) {
      const s = TEXT[lang].rate(bits(down), bits(up))
      if (s !== tip) tray.setToolTip((tip = s))
    },
    /** Said once, the first time the window is closed to the tray. */
    tellHidden() {
      const [title, body] = TEXT[lang].hidden
      if (Notification.isSupported()) new Notification({ title, body }).show()
    },
    destroy: () => tray.destroy()
  }
}
