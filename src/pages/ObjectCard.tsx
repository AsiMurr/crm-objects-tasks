import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  STATUS_LABEL,
  type ObjectRow,
  type Profile,
  type Task,
} from '../lib/types'

export default function ObjectCard() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const isManager = profile?.role === 'manager'

  const [object, setObject] = useState<ObjectRow | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [workers, setWorkers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')

  async function load() {
    if (!id) return
    setLoading(true)

    const [objRes, taskRes] = await Promise.all([
      supabase.from('objects').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('tasks')
        .select('*')
        .eq('object_id', id)
        .order('created_at', { ascending: true }),
    ])

    if (objRes.error) setError(objRes.error.message)
    setObject((objRes.data as ObjectRow) ?? null)
    setTasks((taskRes.data as Task[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  useEffect(() => {
    if (!isManager) return
    supabase
      .from('profiles')
      .select('*')
      .eq('role', 'worker')
      .then(({ data }) => setWorkers((data as Profile[]) ?? []))
  }, [isManager])

  async function addTask(e: FormEvent) {
    e.preventDefault()
    if (!profile || !id) return
    setError(null)

    const { error } = await supabase.from('tasks').insert({
      title: title.trim(),
      description: description.trim() || null,
      object_id: id,
      assignee_id: assignee || null,
      status: 'new',
      created_by: profile.id,
    })

    if (error) {
      setError(error.message)
      return
    }
    setTitle('')
    setDescription('')
    setAssignee('')
    setAdding(false)
    void load()
  }

  if (loading) return <p className="muted">Загрузка…</p>
  if (!object) return <p className="muted">Объект не найден или недоступен.</p>

  return (
    <section>
      <Link to="/objects" className="back">
        ← К списку объектов
      </Link>

      <div className="row-between">
        <div>
          <h1>{object.name}</h1>
          <p className="muted">{object.address}</p>
        </div>
        {isManager && (
          <button onClick={() => setAdding((v) => !v)}>
            {adding ? 'Отмена' : 'Добавить задачу'}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {adding && (
        <form className="card form-stack" onSubmit={addTask}>
          <label>
            Название задачи
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            Описание
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <label>
            Исполнитель
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Не назначен</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Создать задачу</button>
        </form>
      )}

      <h2>Задачи</h2>
      {tasks.length === 0 ? (
        <p className="muted">Задач нет.</p>
      ) : (
        <ul className="list">
          {tasks.map((t) => (
            <li key={t.id} className="card row-between">
              <Link to={`/tasks/${t.id}`} className="title-link">
                {t.title}
              </Link>
              <span className={`badge badge-${t.status}`}>
                {STATUS_LABEL[t.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
