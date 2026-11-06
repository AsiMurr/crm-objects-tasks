-- =====================================================================
-- мини-CRM «Объекты и задачи»
-- Схема, роли, RLS-политики, валидация переходов, история.
-- =====================================================================

-- ---------- типы ----------
create type user_role   as enum ('manager', 'worker');
create type task_status as enum ('new', 'in_progress', 'on_review', 'accepted', 'rework');

-- ---------- профили ----------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text      not null,
  role       user_role not null,
  created_at timestamptz not null default now()
);

-- ---------- объекты ----------
create table objects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- задачи ----------
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  object_id   uuid not null references objects(id) on delete cascade,
  assignee_id uuid references profiles(id),
  status      task_status not null default 'new',
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);

create index tasks_object_idx   on tasks(object_id);
create index tasks_assignee_idx on tasks(assignee_id);

-- ---------- история ----------
create table task_history (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references tasks(id) on delete cascade,
  from_status task_status,
  to_status   task_status not null,
  comment     text,
  changed_by  uuid not null references profiles(id),
  changed_at  timestamptz not null default now()
);

create index task_history_task_idx on task_history(task_id, changed_at);

-- =====================================================================
-- Вспомогательные функции.
-- SECURITY DEFINER: выполняются с правами владельца и не попадают
-- под RLS, иначе политики, которые их вызывают, уходили бы в рекурсию.
-- =====================================================================

create or replace function app_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $fn$
  select role from profiles where id = auth.uid();
$fn$;

create or replace function is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((select role = 'manager' from profiles where id = auth.uid()), false);
$fn$;

-- есть ли у текущего пользователя хотя бы одна задача на объекте
create or replace function has_task_in_object(p_object_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from tasks
    where object_id = p_object_id
      and assignee_id = auth.uid()
  );
$fn$;

-- =====================================================================
-- Таблица допустимых переходов.
-- Единственный источник правды: её использует и RPC, и интерфейс.
-- =====================================================================

create table status_transitions (
  from_status      task_status not null,
  to_status        task_status not null,
  actor            user_role   not null,
  requires_comment boolean     not null default false,
  primary key (from_status, to_status, actor)
);

insert into status_transitions (from_status, to_status, actor, requires_comment) values
  ('new',         'in_progress', 'worker',  false),
  ('in_progress', 'on_review',   'worker',  false),
  ('on_review',   'accepted',    'manager', false),
  ('on_review',   'rework',      'manager', true),
  ('rework',      'in_progress', 'worker',  false);

alter table status_transitions enable row level security;

create policy "transitions readable by authenticated"
  on status_transitions for select
  to authenticated
  using (true);

-- =====================================================================
-- Смена статуса. Только эта функция имеет право менять tasks.status.
-- Проверяет: роль, назначение исполнителя, допустимость перехода,
-- обязательность комментария. Пишет историю.
-- =====================================================================

create or replace function change_task_status(
  p_task_id  uuid,
  p_status   task_status,
  p_comment  text default null
)
returns tasks
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_task  tasks;
  v_from  task_status;
  v_role  user_role;
  v_rule  status_transitions;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;

  select role into v_role from profiles where id = v_actor;
  if v_role is null then
    raise exception 'Профиль не найден' using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task_id;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  v_from := v_task.status;

  -- исполнитель может трогать только свою задачу
  if v_role = 'worker' and v_task.assignee_id is distinct from v_actor then
    raise exception 'Задача назначена не вам' using errcode = '42501';
  end if;

  -- переход должен существовать в таблице правил для этой роли
  select * into v_rule
  from status_transitions
  where from_status = v_from
    and to_status   = p_status
    and actor       = v_role;

  if not found then
    raise exception 'Переход % -> % недоступен для роли %',
      v_from, p_status, v_role using errcode = '42501';
  end if;

  if v_rule.requires_comment and coalesce(btrim(p_comment), '') = '' then
    raise exception 'Для этого перехода обязателен комментарий' using errcode = '22023';
  end if;

  -- разрешаем триггеру пропустить именно этот UPDATE
  perform set_config('app.status_change', 'on', true);

  update tasks
     set status = p_status
   where id = p_task_id
  returning * into v_task;

  perform set_config('app.status_change', 'off', true);

  insert into task_history (task_id, from_status, to_status, comment, changed_by)
  values (p_task_id, v_from, p_status, nullif(btrim(p_comment), ''), v_actor);

  return v_task;
end;
$fn$;

-- =====================================================================
-- Триггеры-сторожа
-- =====================================================================

-- 1. Статус нельзя поменять прямым UPDATE в обход change_task_status.
create or replace function guard_task_status_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.status_change', true), 'off') <> 'on' then
    raise exception 'Статус меняется только через change_task_status()'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

create trigger tasks_guard_status
  before update on tasks
  for each row execute function guard_task_status_update();

-- 2. Первая запись истории при создании задачи.
create or replace function log_task_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into task_history (task_id, from_status, to_status, comment, changed_by)
  values (new.id, null, new.status, null, new.created_by);
  return new;
end;
$fn$;

create trigger tasks_log_created
  after insert on tasks
  for each row execute function log_task_created();

-- 3. История неизменяема: запрет UPDATE и DELETE на уровне самой таблицы,
--    то есть и в обход RLS, и для прямых запросов.
create or replace function forbid_history_change()
returns trigger
language plpgsql
as $fn$
begin
  -- Единственное исключение: запись уходит каскадом вместе с задачей.
  -- Если задачи в этот момент уже нет, значит удаляют её, а не историю.
  if tg_op = 'DELETE' and not exists (select 1 from tasks where id = old.task_id) then
    return old;
  end if;

  raise exception 'Историю нельзя изменять или удалять' using errcode = '42501';
end;
$fn$;

create trigger task_history_immutable
  before update or delete on task_history
  for each row execute function forbid_history_change();

-- =====================================================================
-- RLS
-- =====================================================================

alter table profiles     enable row level security;
alter table objects      enable row level security;
alter table tasks        enable row level security;
alter table task_history enable row level security;

-- ---------- profiles ----------
-- Имя и роль коллег видны всем, кто вошёл: исполнителю нужно знать,
-- кто поставил задачу и кто написал замечание. Чувствительных данных
-- в таблице нет, а менять её нельзя никому.
create policy "profiles select"
  on profiles for select
  to authenticated
  using (true);

-- менять профили из приложения нельзя: политик insert/update/delete нет.

-- ---------- objects ----------
create policy "objects select"
  on objects for select
  to authenticated
  using (is_manager() or has_task_in_object(id));

create policy "objects insert"
  on objects for insert
  to authenticated
  with check (is_manager() and created_by = auth.uid());

create policy "objects update"
  on objects for update
  to authenticated
  using (is_manager())
  with check (is_manager());

create policy "objects delete"
  on objects for delete
  to authenticated
  using (is_manager());

-- ---------- tasks ----------
create policy "tasks select"
  on tasks for select
  to authenticated
  using (is_manager() or assignee_id = auth.uid());

create policy "tasks insert"
  on tasks for insert
  to authenticated
  with check (is_manager() and created_by = auth.uid() and status = 'new');

-- UPDATE доступен только постановщику (правка полей задачи).
-- У исполнителя UPDATE-политики нет вовсе: сменить статус он может
-- только через change_task_status(), которая идёт с правами владельца.
create policy "tasks update"
  on tasks for update
  to authenticated
  using (is_manager())
  with check (is_manager());

create policy "tasks delete"
  on tasks for delete
  to authenticated
  using (is_manager());

-- ---------- task_history ----------
-- читать может тот, кто видит задачу; писать напрямую нельзя никому
create policy "history select"
  on task_history for select
  to authenticated
  using (
    exists (
      select 1 from tasks t
      where t.id = task_history.task_id
        and (is_manager() or t.assignee_id = auth.uid())
    )
  );

-- =====================================================================
-- Права на функцию смены статуса
-- =====================================================================

revoke all on function change_task_status(uuid, task_status, text) from public;
grant execute on function change_task_status(uuid, task_status, text) to authenticated;
