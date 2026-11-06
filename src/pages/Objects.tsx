import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { ObjectRow } from '../lib/types'

export default function Objects() {
  const { profile } = useAuth()
  const isManager = profile?.role === 'manager'

  const [rows, setRows] = useState<ObjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('objects')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) setError(error.message)
    else setRows((data as ObjectRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function addObject(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)

    const { error } = await supabase.from('objects').insert({
      name: name.trim(),
      address: address.trim(),
      created_by: profile.id,
    })

    if (error) {
      setError(error.message)
      return
    }
    setName('')
    setAddress('')
    setAdding(false)
    void load()
  }

  if (loading) return <p className="muted">Загрузка…</p>

  return (
    <section>
      <div className="row-between">
        <h1>Объекты</h1>
        {isManager && (
          <button onClick={() => setAdding((v) => !v)}>
            {adding ? 'Отмена' : 'Добавить объект'}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {adding && (
        <form className="card form-inline" onSubmit={addObject}>
          <label>
            Название
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Адрес
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </label>
          <button type="submit">Создать</button>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="muted">
          {isManager
            ? 'Объектов пока нет.'
            : 'Вам не назначено задач ни на одном объекте.'}
        </p>
      ) : (
        <ul className="list">
          {rows.map((o) => (
            <li key={o.id} className="card">
              <Link to={`/objects/${o.id}`} className="title-link">
                {o.name}
              </Link>
              <div className="muted">{o.address}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
