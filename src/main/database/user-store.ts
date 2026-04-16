import ElectronStore from 'electron-store'
import { v4 as uuid } from 'uuid'

const Store = (ElectronStore as any).default || ElectronStore

export const { getUserId } = (() => {
  let cachedUserId: string | null = null

  return {
    getUserId(): string {
      if (cachedUserId) return cachedUserId

      const store = new Store({ name: 'swarm-user' })
      let userId = store.get('userId') as string | undefined

      if (!userId) {
        userId = uuid()
        store.set('userId', userId)
        store.set('createdAt', new Date().toISOString())
      }

      cachedUserId = userId
      return userId
    }
  }
})()
