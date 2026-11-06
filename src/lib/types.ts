export type UserRole = 'manager' | 'worker'

export type TaskStatus =
  | 'new'
  | 'in_progress'
  | 'on_review'
  | 'accepted'
  | 'rework'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  created_at: string
}

export interface ObjectRow {
  id: string
  name: string
  address: string
  created_by: string
  created_at: string
}

export interface Task {
  id: string
  title: string
  description: string | null
  object_id: string
  assignee_id: string | null
  status: TaskStatus
  created_by: string
  created_at: string
}

export interface TaskHistoryRow {
  id: number
  task_id: string
  from_status: TaskStatus | null
  to_status: TaskStatus
  comment: string | null
  changed_by: string
  changed_at: string
}

export interface StatusTransition {
  from_status: TaskStatus
  to_status: TaskStatus
  actor: UserRole
  requires_comment: boolean
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  on_review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
}

export const ROLE_LABEL: Record<UserRole, string> = {
  manager: 'Постановщик',
  worker: 'Исполнитель',
}
