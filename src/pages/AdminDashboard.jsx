import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import PricingView from '../views/PricingView'
import DriversView from '../views/DriversView'
import AuditView   from '../views/AuditView'
import logoUrl     from '../assets/texlag-logo.avif'

const SIDEBAR = [
  { key: 'pricing', label: 'Pricing Variables' },
  { key: 'drivers', label: 'Driver Management' },
  { key: 'audit',   label: 'Audit Trail' },
]

export default function AdminDashboard() {
  const { user, logout } = useAuth()
  const [section, setSection] = useState('pricing')

  return (
    <>
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav__inner">
          <div className="nav__brand">
            <img src={logoUrl} alt="TexLag Express" className="nav__logo" />
            <div className="nav__brand-info">
              <span className="nav__brand-name">TexLag Express</span>
              <span className="nav__brand-creds">USDOT: 3609656 | MC-1229052 | +1(832)-944-5199</span>
            </div>
          </div>

          <div className="nav__user">
            <span className="nav__user-name">{user.firstName} {user.lastName}</span>
            <span className="role-badge role-badge--admin">Admin</span>
            <button className="nav__logout" onClick={logout}>Sign out</button>
          </div>
        </div>
      </nav>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="dashboard">

        {/* Side nav */}
        <aside className="dashboard__sidebar">
          <p className="sidebar__section-label">Admin</p>
          <nav className="sidebar-nav">
            {SIDEBAR.map(({ key, label }) => (
              <button
                key={key}
                className={`sidebar-nav__item${section === key ? ' sidebar-nav__item--active' : ''}`}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="dashboard__content">
          {section === 'pricing' && <PricingView />}
          {section === 'drivers' && <DriversView />}
          {section === 'audit'   && <AuditView />}
        </main>

      </div>
    </>
  )
}
