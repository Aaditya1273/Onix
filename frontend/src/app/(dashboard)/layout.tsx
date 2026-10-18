import { Sidebar } from '@/components/Sidebar'
import './app.css'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell flex flex-col lg:flex-row h-screen overflow-hidden" style={{ background: 'var(--paper)' }}>
      <Sidebar />
      <main className="dashboard-shell flex-1 min-h-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
