import type { Collector } from './common'
import { linux } from './linux'
import { mac } from './mac'
import { win } from './win'

export const collector: Collector = process.platform === 'win32' ? win : process.platform === 'darwin' ? mac : linux
