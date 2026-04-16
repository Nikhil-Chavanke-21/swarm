import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const { initDatabase, getDatabase } = (() => {
  let client: SupabaseClient | null = null

  return {
    initDatabase(url: string, anonKey: string): SupabaseClient {
      client = createClient(url, anonKey)
      return client
    },
    getDatabase(): SupabaseClient {
      if (!client) {
        throw new Error('Database not initialized. Call initDatabase() first.')
      }
      return client
    }
  }
})()
