import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY. Скопируйте .env.example в .env и заполните.',
  )
}

// В браузер уходит только публичный anon-ключ.
// Он безопасен сам по себе: все права разграничены политиками RLS в базе.
export const supabase = createClient(url, anonKey)
