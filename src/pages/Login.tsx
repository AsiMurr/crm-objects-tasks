import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await signIn(email.trim(), password)
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1>Вход в CRM</h1>
        <p className="muted">Объекты и задачи</p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </label>

        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>

        <p className="muted small">
          Регистрация закрыта. Учётные записи создаёт администратор.
        </p>
      </form>
    </div>
  )
}
