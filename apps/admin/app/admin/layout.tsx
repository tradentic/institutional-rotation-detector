import Link from 'next/link'
import { LayoutDashboard, Workflow, MessageSquare, Monitor, FolderOpen } from 'lucide-react'

interface AdminLayoutProps {
  children: React.ReactNode
}

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { name: 'Workflows', href: '/admin/workflows', icon: Workflow },
  { name: 'Q&A', href: '/admin/qa', icon: MessageSquare },
  { name: 'Monitor', href: '/admin/monitor', icon: Monitor },
  { name: 'Results', href: '/admin/results', icon: FolderOpen },
]

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-slate-900">
                Institutional Rotation Detector
              </h1>
              <span className="ml-3 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                Admin
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 min-h-[calc(100vh-4rem)] bg-white border-r border-slate-200">
          <nav className="p-4 space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-slate-700 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
