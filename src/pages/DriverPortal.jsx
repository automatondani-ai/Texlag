import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import DriverQuoteForm  from '../views/DriverQuoteForm'
import QuoteHistoryView from '../views/QuoteHistoryView'
import logoUrl from '../assets/texlag-logo.avif'

const TABS = [
  { key: 'form',    label: 'New Quote'      },
  { key: 'history', label: 'Quote History'  },
]

export default function DriverPortal() {
  const { user, logout } = useAuth()
  const [activeTab, setActiveTab] = useState('form')

  return (
    <>
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
            <span className="role-badge role-badge--driver">Driver</span>
            <button type="button" className="nav__logout" onClick={logout}>Sign out</button>
          </div>
        </div>
      </nav>

      {/* ── Portal tab bar ────────────────────────────────────────────────── */}
      <div className="portal-tabs">
        <div className="portal-tabs__inner">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={`portal-tab${activeTab === t.key ? ' portal-tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      {activeTab === 'form'    && <DriverQuoteForm />}
      {activeTab === 'history' && <QuoteHistoryView />}
    </>
  )
}
