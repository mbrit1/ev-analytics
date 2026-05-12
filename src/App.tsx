import { BatteryCharging } from 'lucide-react'

function App() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center gap-4 max-w-md w-full text-center">
        <div className="bg-blue-100 p-4 rounded-full">
          <BatteryCharging className="w-8 h-8 text-blue-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">EV Analytics</h1>
        <p className="text-slate-600">
          Your offline-first charging companion. Foundation is ready.
        </p>
        <div className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm font-medium text-slate-500">
          Phase 1: Foundation Complete
        </div>
      </div>
    </div>
  )
}

export default App
