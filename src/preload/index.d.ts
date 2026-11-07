import type { Bridge } from './index'

declare global {
  interface Window {
    kotkod: Bridge
  }
}
