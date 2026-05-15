import { useAuth } from '../context/AuthContext'
import QuoteView from '../views/QuoteView'

export default function DriverPortal() {
  const { user, logout } = useAuth()

  return (
    <>
      <nav className="nav">
        <div className="nav__inner">
          <span className="nav__brand">TexLag Express</span>

          <div className="nav__user">
            <span className="nav__user-name">{user.firstName} {user.lastName}</span>
            <span className="role-badge role-badge--driver">Driver</span>
            <button className="nav__logout" onClick={logout}>Sign out</button>
          </div>
        </div>
      </nav>

      <QuoteView />
    </>
  )
}
