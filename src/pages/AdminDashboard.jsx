import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import QuoteView   from '../views/QuoteView'
import PricingView from '../views/PricingView'
import DriversView from '../views/DriversView'

const SIDEBAR = [
  { key: 'pricing', label: 'Pricing Variables' },
  { key: 'drivers', label: 'Driver Management' },
]

export default function AdminDashboard() {
  const { user, logout } = useAuth()
  const [topView,     setTopView]     = useState('quote')   // 'quote' | 'admin'
  const [adminSection, setAdminSection] = useState('pricing')

  return (
    <>
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav__inner">
          <span className="nav__brand">TexLag Express</span>

          <div className="nav__links">
            <button
              className={`nav__link${topView === 'quote' ? ' nav__link--active' : ''}`}
              onClick={() => setTopView('quote')}
            >
              Quote
            </button>
            <button
              className={`nav__link${topView === 'admin' ? ' nav__link--active' : ''}`}
              onClick={() => setTopView('admin')}
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

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      {topView === 'quote' ? (
        <QuoteView />
      ) : (
        <div className="dashboard">

          {/* Side nav */}
          <aside className="dashboard__sidebar">
            <p className="sidebar__section-label">Admin</p>
            <nav className="sidebar-nav">
              {SIDEBAR.map(({ key, label }) => (
                <button
                  key={key}
                  className={`sidebar-nav__item${adminSection === key ? ' sidebar-nav__item--active' : ''}`}
                  onClick={() => setAdminSection(key)}
                >
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Main content */}
          <main className="dashboard__content">
            {adminSection === 'pricing' ? <PricingView /> : <DriversView />}
          </main>

        </div>
      )}
    </>
  )
}
