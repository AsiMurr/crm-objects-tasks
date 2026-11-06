import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  STATUS_LABEL,
  type ObjectRow,
  type Profile,
  type StatusTransition,
  type Task,
  type TaskHistoryRow,
  type TaskStatus,
} from '../lib/types'

export default function TaskCard() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()

  const [task, setTask] = useState<Task | null>(null)
  const [object, setObject] = useState<ObjectRow | null>(null)
  const [history, setHistory] = useState<TaskHistoryRow[]>([])
  const [people, setPeople] = useState<Record<string, Profile>>({})
  const [rules, setRules] = useState<StatusTransition[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!id) return
    setLoading(true)

    const { data: taskData, error: taskErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (taskErr) setError(taskErr.message)
    const t = (taskData as Task) ?? null
    setTask(t)

    if (t) {
      const [objRes, histRes, peopleRes, ruleRes] = await Promise.all([
        supabase.from('objects').select('*').eq('id', t.object_id).maybeSingle(),
        supabase
          .from('task_history')
          .select('*')
          .eq('task_id', t.id)
          .order('changed_at', { ascending: true }),
        supabase.from('profiles').select('*'),
        supabase.from('status_transitions').select('*'),
      ])

      setObject((objRes.data as ObjectRow) ?? null)
      setHistory((histRes.data as TaskHistoryRow[]) ?? [])
      setRules((ruleRes.data as StatusTransition[]) ?? [])

      const map: Record<string, Profile> = {}
      for (const p of ((peopleRes.data as Profile[]) ?? [])) map[p.id] = p
      setPeople(map)
    }

    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  // Какие действия показать: берём те же правила, что действуют в базе.
  // Интерфейс лишь отражает их, решение всё равно принимает база.
  const actions = useMemo(() => {
    if (!task || !profile) return []
    const isAssignee = task.assignee_id === profile.id
    return rules.filter(
      (r) =>
        r.from_status === task.status &&
        r.actor === profile.role &&
        (profile.role === 'manager' || isAssignee),
    )
  }, [task, profile, rules])

  async function changeStatus(to: TaskStatus, requiresComment: boolean) {
    if (!task) return
    if (requiresComment && comment.trim() === '') {
      setError('Для возврата на доработку нужен комментарий')
      return
    }

    setBusy(true)
    setError(null)

    const { error } = await supabase.rpc('change_task_status', {
      p_task_id: task.id,
      p_status: to,
      p_comment: comment.trim() || null,
    })

    if (error) setError(error.message)
    else setComment('')

    setBusy(false)
    void load()
  }

  function nameOf(userId: string | null) {
    if (!userId) return 'не назначен'
    return people[userId]?.full_name ?? 'другой пользователь'
  }

  if (loading) return <p className="muted">Загрузка…</p>
  if (!task) return <p className="muted">Задача не найдена или недоступна.</p>

  const needsComment = actions.some((a) => a.requires_comment)

  return (
    <section>
      {object && (
        <Link to={`/objects/${object.id}`} className="back">
          ← {object.name}
        </Link>
      )}

      <div className="row-between">
        <h1>{task.title}</h1>
        <span className={`badge badge-${task.status}`}>
          {STATUS_LABEL[task.status]}
        </span>
      </div>

      <div className="card">
        <dl className="props">
          <dt>Объект</dt>
          <dd>{object?.name ?? '—'}</dd>
          <dt>Исполнитель</dt>
          <dd>{nameOf(task.assignee_id)}</dd>
          <dt>Автор</dt>
          <dd>{nameOf(task.created_by)}</dd>
          <dt>Создана</dt>
          <dd>{new Date(task.created_at).toLocaleString('ru-RU')}</dd>
        </dl>
        {task.description && <p className="desc">{task.description}</p>}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2>Действия</h2>
        {actions.length === 0 ? (
          <p className="muted">
            Сейчас вам недоступны действия по этой задаче.
          </p>
        ) : (
          <>
            {needsComment && (
              <label>
                Комментарий
                <textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Обязателен при возврате на доработку"
                />
              </label>
            )}
            <div className="actions">
              {actions.map((a) => (
                <button
                  key={a.to_status}
                  disabled={busy}
                  onClick={() => changeStatus(a.to_status, a.requires_comment)}
                >
                  {STATUS_LABEL[a.to_status]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>История</h2>
        <ol className="history">
          {history.map((h) => (
            <li key={h.id}>
              <span className="muted small">
                {new Date(h.changed_at).toLocaleString('ru-RU')}
              </span>
              <div>
                <b>{nameOf(h.changed_by)}</b>
                {h.from_status
                  ? ` · ${STATUS_LABEL[h.from_status]} → ${STATUS_LABEL[h.to_status]}`
                  : ` · создание задачи (${STATUS_LABEL[h.to_status]})`}
              </div>
              {h.comment && <div className="comment">{h.comment}</div>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
