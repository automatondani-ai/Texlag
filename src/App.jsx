import { useState } from 'react'
import QuoteView from './views/QuoteView'
import AdminView from './views/AdminView'
import './index.css'

export default function App() {
  const [view, setView] = useState('quote')

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
        </div>
      </nav>

      {view === 'quote' ? <QuoteView /> : <AdminView />}
    </>
  )
}
