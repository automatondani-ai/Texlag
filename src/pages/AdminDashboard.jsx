import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import QuoteView from '../views/QuoteView'
import AdminView from '../views/AdminView'

export default function AdminDashboard() {
  const { user, logout } = useAuth()
  const [view, setView]  = useState('quote')

  return (
    <>
      <nav className="nav">
        <div className="nav__inner">
          <span className="nav__brand">TexLag Express</span>

          <div className="nav__links">
            <button
              className={`nav__link${view === 'quote' ? ' nav__link--active' : ''}`}
              onClick={() => setView('quote')}
            >
              Quote
            </button>
            <button
              className={`nav__link${view === 'admin' ? ' nav__link--active' : ''}`}
              onClick={() => setView('admin')}
            >
              Admin
            </button>
          </div>

          <div className="nav__user">
            <span className="nav__user-name">{user.firstName} {user.lastName}</span>
            <span className="role-badge role-badge--admin">Admin</span>
            <button className="nav__logout" onClick={logout}>Sign out</button>
          </div>
        </div>
      </nav>

      {view === 'quote' ? <QuoteView /> : <AdminView />}
    </>
  )
}
