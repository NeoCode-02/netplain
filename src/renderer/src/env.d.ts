/// <reference types="vite/client" />
import type { Bridge } from '../../preload/index'

declare global {
  interface Window {
    netplain: Bridge
  }
}
