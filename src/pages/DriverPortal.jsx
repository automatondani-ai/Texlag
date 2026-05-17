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
            <span>TexLag Express</span>
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
