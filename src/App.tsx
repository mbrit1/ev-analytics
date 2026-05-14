import { BatteryCharging, Loader2, LogOut } from 'lucide-react'
import { useAuth } from './features/auth/hooks/useAuth'
import { LoginForm } from './features/auth/components/LoginForm'
import { supabase } from './lib/supabase'

function App() {
  const { user, loading } = useAuth()

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center gap-4 max-w-md w-full text-center">
        <div className="bg-blue-100 p-4 rounded-full">
          <BatteryCharging className="w-8 h-8 text-blue-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">EV Analytics</h1>
        <p className="text-slate-600">
          Welcome, {user.email}
        </p>
        <div className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm font-medium text-slate-500">
          Authenticated & Ready
        </div>
        <button
          onClick={handleLogout}
          className="mt-4 flex items-center text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </button>
      </div>
    </div>
  )
}

export default App
