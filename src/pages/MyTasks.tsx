import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { STATUS_LABEL, type ObjectRow, type Task } from '../lib/types'

export default function MyTasks() {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [objects, setObjects] = useState<Record<string, ObjectRow>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('assignee_id', profile!.id)
        .order('created_at', { ascending: true })

      if (cancelled) return
      const rows = (data as Task[]) ?? []
      setTasks(rows)

      const { data: objs } = await supabase.from('objects').select('*')
      const map: Record<string, ObjectRow> = {}
      for (const o of ((objs as ObjectRow[]) ?? [])) map[o.id] = o
      setObjects(map)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [profile])

  if (loading) return <p className="muted">Загрузка…</p>

  return (
    <section>
      <h1>Мои задачи</h1>
      {tasks.length === 0 ? (
        <p className="muted">На вас пока нет задач.</p>
      ) : (
        <ul className="list">
          {tasks.map((t) => (
            <li key={t.id} className="card row-between">
              <div>
                <Link to={`/tasks/${t.id}`} className="title-link">
                  {t.title}
                </Link>
                <div className="muted small">
                  {objects[t.object_id]?.name ?? ''}
                </div>
              </div>
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
