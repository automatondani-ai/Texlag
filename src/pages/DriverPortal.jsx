import { useAuth } from '../context/AuthContext'
import DriverQuoteForm from '../views/DriverQuoteForm'
import logoUrl from '../assets/texlag-logo.avif'

export default function DriverPortal() {
  const { user, logout } = useAuth()

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
            <button className="nav__logout" onClick={logout}>Sign out</button>
          </div>
        </div>
      </nav>

      <DriverQuoteForm />
    </>
  )
}
