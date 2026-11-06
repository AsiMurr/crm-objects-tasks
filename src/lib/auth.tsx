import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from './types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  // Supabase обновляет токен сам и присылает новый объект сессии,
  // в том числе когда возвращаешься на вкладку. Пользователь при этом
  // тот же, поэтому следим за его id, а не за объектом сессии, —
  // иначе профиль перезагружался бы снова и снова.
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    // Экран загрузки показываем только при первом входе.
    // При обновлении токена данные на экране остаются на месте.
    setProfile((current) => {
      if (!current) setLoading(true)
      return current
    })

    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setProfile((data as Profile) ?? null)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return 'Неверный email или пароль'
    return null
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth вне AuthProvider')
  return ctx
}
