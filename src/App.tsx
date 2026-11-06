import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ROLE_LABEL } from './lib/types'
import Login from './pages/Login'
import Objects from './pages/Objects'
import ObjectCard from './pages/ObjectCard'
import TaskCard from './pages/TaskCard'
import MyTasks from './pages/MyTasks'

function Shell() {
  const { session, profile, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div className="login-wrap">
        <p className="muted">Загрузка…</p>
      </div>
    )
  }

  if (!session) return <Login />

  if (!profile) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Профиль не найден</h1>
          <p className="muted">
            Учётная запись есть, но для неё не заведён профиль с ролью.
            Обратитесь к администратору.
          </p>
          <button onClick={() => void signOut()}>Выйти</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <header className="topbar">
        <nav>
          <Link to="/objects">Объекты</Link>
          {profile.role === 'worker' && <Link to="/my">Мои задачи</Link>}
        </nav>
        <div className="user">
          <span>
            {profile.full_name}
            <span className="muted small"> · {ROLE_LABEL[profile.role]}</span>
          </span>
          <button className="ghost" onClick={() => void signOut()}>
            Выйти
          </button>
        </div>
      </header>

      <main className="wrap">
        <Routes>
          <Route path="/objects" element={<Objects />} />
          <Route path="/objects/:id" element={<ObjectCard />} />
          <Route path="/tasks/:id" element={<TaskCard />} />
          <Route path="/my" element={<MyTasks />} />
          <Route
            path="*"
            element={
              <Navigate to={profile.role === 'worker' ? '/my' : '/objects'} replace />
            }
          />
        </Routes>
      </main>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  )
}
