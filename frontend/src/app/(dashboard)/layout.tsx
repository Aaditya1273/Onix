import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import './app.css'

// The application frame: one flat background, the dark sidebar inset on the left
// and the top bar above the page.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell relative h-screen overflow-hidden bg-[#f7f3ec]">
      <div className="h-full flex flex-col lg:flex-row overflow-hidden">
        <Sidebar />
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <TopBar />
          {/* relative: absolutely placed descendants (screen-reader labels, tooltips) stay inside this scroller instead of stretching the page */}
          <main className="dashboard-shell relative flex-1 min-h-0 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
