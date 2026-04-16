import type { SwarmAPI } from './index'

declare global {
  interface Window {
    api: SwarmAPI
  }
}
