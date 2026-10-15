import { expect, it } from 'vitest'
import { desktopEntry } from './autostart'

it('writes a Linux autostart entry that quotes paths', () => {
  expect(desktopEntry(['/home/a b/Netplain.AppImage', '--hidden'])).toBe(
    '[Desktop Entry]\nType=Application\nName=Netplain\nExec="/home/a b/Netplain.AppImage" --hidden\nX-GNOME-Autostart-enabled=true\n'
  )
})
