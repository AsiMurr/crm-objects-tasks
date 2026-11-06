// Создаёт тестовых пользователей и наполняет базу.
// Запуск: node scripts/seed.mjs
//
// Пользователей создаём service_role-ключом (открытая регистрация выключена).
// А вот статусы задач двигаем уже обычным клиентом под логином каждого
// пользователя: так сиды заодно проверяют, что правила переходов работают.

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !ANON || !SERVICE) {
  console.error('Заполните .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const PASSWORD = 'Test1234!'

const USERS = [
  { email: 'manager@example.com',  full_name: 'Анна Петрова',    role: 'manager' },
  { email: 'worker1@example.com',  full_name: 'Игорь Сомов',     role: 'worker'  },
  { email: 'worker2@example.com',  full_name: 'Руслан Гафуров',  role: 'worker'  },
]

async function ensureUser({ email, full_name, role }) {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existing = list?.users?.find((u) => u.email === email)

  let id
  if (existing) {
    id = existing.id
    await admin.auth.admin.updateUserById(id, { password: PASSWORD })
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    id = data.user.id
  }

  const { error: pErr } = await admin
    .from('profiles')
    .upsert({ id, full_name, role }, { onConflict: 'id' })
  if (pErr) throw pErr

  console.log(`  ${role.padEnd(7)} ${email}  ${full_name}`)
  return id
}

async function signIn(email) {
  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`Вход ${email}: ${error.message}`)
  return client
}

async function move(client, taskId, status, comment = null) {
  const { error } = await client.rpc('change_task_status', {
    p_task_id: taskId,
    p_status: status,
    p_comment: comment,
  })
  if (error) throw new Error(`Переход в ${status}: ${error.message}`)
}

async function main() {
  console.log('Пользователи:')
  const ids = {}
  for (const u of USERS) ids[u.email] = await ensureUser(u)

  const manager = ids['manager@example.com']
  const worker1 = ids['worker1@example.com']
  const worker2 = ids['worker2@example.com']

  // чистим прошлые данные, чтобы сиды можно было гонять повторно
  await admin.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await admin.from('objects').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  console.log('\nОбъекты:')
  const objectRows = [
    { name: 'ЖК «Northern»,  корпус 3', address: 'Краснодар, ул. Российская, 74' },
    { name: 'Склад на Дмитриевской',    address: 'Краснодар, ул. Дмитриевская Дамба, 11' },
    { name: 'Офис «Атриум», 2 этаж',     address: 'Краснодар, ул. Красная, 176' },
  ].map((o) => ({ ...o, created_by: manager }))

  const { data: objects, error: oErr } = await admin
    .from('objects')
    .insert(objectRows)
    .select()
  if (oErr) throw oErr
  objects.forEach((o) => console.log(`  ${o.name}`))

  console.log('\nЗадачи:')
  const taskRows = [
    { title: 'Залить фундамент секции Б',      object_id: objects[0].id, assignee_id: worker1, description: 'Бетон М300, опалубку проверить перед заливкой.' },
    { title: 'Проверить армирование плиты',     object_id: objects[0].id, assignee_id: worker1, description: 'Шаг арматуры по проекту 200 мм.' },
    { title: 'Смонтировать стеллажи, ряд 1-4',  object_id: objects[1].id, assignee_id: worker2, description: null },
    { title: 'Заменить проводку в щитовой',     object_id: objects[1].id, assignee_id: worker2, description: 'Кабель ВВГнг 3х2.5.' },
    { title: 'Демонтаж старых перегородок',     object_id: objects[2].id, assignee_id: worker1, description: null },
    { title: 'Подобрать подрядчика на фасад',   object_id: objects[2].id, assignee_id: null,    description: 'Нужно три коммерческих предложения.' },
  ].map((t) => ({ ...t, created_by: manager, status: 'new' }))

  const { data: tasks, error: tErr } = await admin.from('tasks').insert(taskRows).select()
  if (tErr) throw tErr

  const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]))

  const mClient = await signIn('manager@example.com')
  const w1Client = await signIn('worker1@example.com')
  const w2Client = await signIn('worker2@example.com')

  // Задача 1: прошла полный круг с возвратом на доработку
  const t1 = byTitle['Залить фундамент секции Б'].id
  await move(w1Client, t1, 'in_progress')
  await move(w1Client, t1, 'on_review')
  await move(mClient,  t1, 'rework', 'Нет фото опалубки до заливки. Приложите и верните на проверку.')
  await move(w1Client, t1, 'in_progress')
  await move(w1Client, t1, 'on_review')
  await move(mClient,  t1, 'accepted')

  // Задача 2: сейчас в работе
  const t2 = byTitle['Проверить армирование плиты'].id
  await move(w1Client, t2, 'in_progress')

  // Задача 3: ждёт проверки
  const t3 = byTitle['Смонтировать стеллажи, ряд 1-4'].id
  await move(w2Client, t3, 'in_progress')
  await move(w2Client, t3, 'on_review')

  // Задача 4: вернули на доработку
  const t4 = byTitle['Заменить проводку в щитовой'].id
  await move(w2Client, t4, 'in_progress')
  await move(w2Client, t4, 'on_review')
  await move(mClient,  t4, 'rework', 'Сечение кабеля не соответствует проекту, нужен 3х4.')

  // Задача 5 остаётся новой, задача 6 без исполнителя

  for (const t of tasks) {
    const { data } = await admin.from('tasks').select('status').eq('id', t.id).single()
    console.log(`  ${data.status.padEnd(12)} ${t.title}`)
  }

  console.log('\nГотово. Пароль для всех: ' + PASSWORD)
}

main().catch((e) => {
  console.error('\nОшибка:', e.message)
  process.exit(1)
})
