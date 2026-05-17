import { useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage          from './pages/LoginPage'
import AdminDashboard     from './pages/AdminDashboard'
import DriverPortal       from './pages/DriverPortal'
import ChangePasswordPage from './pages/ChangePasswordPage'
import './index.css'

const ROLE_MAP = {
  admin:  AdminDashboard,
  driver: DriverPortal,
}

function AppRouter() {
  const { user, logout, mustChangePassword } = useAuth()

  // Evict tokens that carry an unrecognised role
  useEffect(() => {
    if (user && !ROLE_MAP[user.role]) logout()
  }, [user, logout])

  if (!user) return <LoginPage />

  // Block driver portal until temporary password is changed
  if (mustChangePassword && user.role === 'driver') {
    return <ChangePasswordPage />
  }

  const Portal = ROLE_MAP[user.role]
  return Portal ? <Portal /> : null
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  )
}
