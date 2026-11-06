// Проверка защиты в обход интерфейса.
// Запуск: node scripts/security-check.mjs  (после seed.mjs)
//
// Скрипт ходит в Supabase напрямую, как это сделал бы человек
// с консолью браузера: своим токеном, но мимо нашего приложения.
// Каждая проверка должна закончиться отказом со стороны базы.

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = 'Test1234!'

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let passed = 0
let failed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  OK   ${name}`)
  } else {
    failed++
    console.log(`  ПРОВАЛ  ${name}${detail ? '  — ' + detail : ''}`)
  }
}

async function signIn(email) {
  const c = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`Вход ${email}: ${error.message}`)
  return c
}

async function main() {
  const anon = createClient(URL, ANON)
  const manager = await signIn('manager@example.com')
  const w1 = await signIn('worker1@example.com')
  const w2 = await signIn('worker2@example.com')

  const { data: me1 } = await w1.auth.getUser()
  const w1Id = me1.user.id

  // задача исполнителя 2 — для исполнителя 1 она чужая
  const { data: foreign } = await admin
    .from('tasks')
    .select('*')
    .eq('title', 'Смонтировать стеллажи, ряд 1-4')
    .single()

  // своя задача исполнителя 1, сейчас в статусе «В работе»
  const { data: own } = await admin
    .from('tasks')
    .select('*')
    .eq('title', 'Проверить армирование плиты')
    .single()

  console.log('\nДоступ к данным')

  {
    const { data } = await anon.from('tasks').select('*')
    check('аноним не видит задачи', (data ?? []).length === 0)
  }

  {
    const { data } = await w1.from('tasks').select('*')
    const mine = (data ?? []).every((t) => t.assignee_id === w1Id)
    check('исполнитель видит только свои задачи', mine, `получено ${data?.length ?? 0}`)
  }

  {
    const { data } = await w1.from('tasks').select('*').eq('id', foreign.id)
    check('чужая задача не читается по прямому id', (data ?? []).length === 0)
  }

  {
    const { data } = await w1.from('objects').select('*')
    const names = (data ?? []).map((o) => o.name)
    check(
      'исполнитель не видит чужие объекты',
      !names.includes('Склад на Дмитриевской'),
      names.join(', '),
    )
  }

  {
    const { data } = await manager.from('tasks').select('*')
    check('постановщик видит все задачи', (data ?? []).length === 6, `получено ${data?.length ?? 0}`)
  }

  console.log('\nИзменение чужих данных')

  {
    const { error, data } = await w1
      .from('tasks')
      .update({ title: 'взломано' })
      .eq('id', foreign.id)
      .select()
    check('исполнитель не может править чужую задачу', !!error || (data ?? []).length === 0)
  }

  {
    const { error, data } = await w1
      .from('tasks')
      .update({ title: 'переименовано' })
      .eq('id', own.id)
      .select()
    check('исполнитель не может править даже свою задачу', !!error || (data ?? []).length === 0)
  }

  console.log('\nПереходы статусов')

  {
    const { error } = await w1.rpc('change_task_status', {
      p_task_id: own.id,
      p_status: 'accepted',
      p_comment: null,
    })
    check('исполнитель не может принять задачу сам', !!error, error?.message)
  }

  {
    const { error } = await w1.rpc('change_task_status', {
      p_task_id: foreign.id,
      p_status: 'in_progress',
      p_comment: null,
    })
    check('исполнитель не может двигать чужую задачу', !!error, error?.message)
  }

  {
    // прямой UPDATE статуса мимо change_task_status
    const { error, data } = await w1
      .from('tasks')
      .update({ status: 'accepted' })
      .eq('id', own.id)
      .select()
    check('статус нельзя сменить прямым UPDATE', !!error || (data ?? []).length === 0)
  }

  {
    const { error, data } = await admin
      .from('tasks')
      .update({ status: 'accepted' })
      .eq('id', own.id)
      .select()
    check(
      'даже service_role не может сменить статус в обход функции',
      !!error,
      error?.message,
    )
  }

  {
    const { data: onReview } = await admin
      .from('tasks')
      .select('*')
      .eq('status', 'on_review')
      .limit(1)
      .single()

    const { error } = await manager.rpc('change_task_status', {
      p_task_id: onReview.id,
      p_status: 'rework',
      p_comment: '   ',
    })
    check('возврат на доработку без комментария не проходит', !!error, error?.message)
  }

  console.log('\nИстория')

  {
    const { data: row } = await admin.from('task_history').select('*').limit(1).single()

    const { error: uErr, data: uData } = await manager
      .from('task_history')
      .update({ comment: 'подделка' })
      .eq('id', row.id)
      .select()
    check('историю нельзя изменить', !!uErr || (uData ?? []).length === 0)

    const { error: dErr, data: dData } = await manager
      .from('task_history')
      .delete()
      .eq('id', row.id)
      .select()
    check('историю нельзя удалить', !!dErr || (dData ?? []).length === 0)

    const { error: iErr } = await manager.from('task_history').insert({
      task_id: row.task_id,
      from_status: 'new',
      to_status: 'accepted',
      changed_by: row.changed_by,
    })
    check('в историю нельзя дописать запись вручную', !!iErr, iErr?.message)

    const { error: aErr } = await admin
      .from('task_history')
      .update({ comment: 'подделка' })
      .eq('id', row.id)
    check('историю не меняет даже service_role', !!aErr, aErr?.message)
  }

  console.log('\nПрофили и роли')

  {
    const { error, data } = await w1
      .from('profiles')
      .update({ role: 'manager' })
      .eq('id', w1Id)
      .select()
    check('исполнитель не может повысить себе роль', !!error || (data ?? []).length === 0)
  }

  {
    const { data } = await w1.from('profiles').select('*')
    check('исполнитель не видит чужие профили', (data ?? []).length === 1, `получено ${data?.length ?? 0}`)
  }

  console.log(`\nИтог: пройдено ${passed}, провалено ${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\nОшибка:', e.message)
  process.exit(1)
})
