import {
  Activity, BarChart3, AlertTriangle, Shield, FileCheck, Zap, Cpu, Settings, HelpCircle, Network, GitBranch, History,
  ShieldCheck, Scissors, Gauge, Sparkles, Clock, FlaskConical, Plug, Brain, Radio, Landmark, Sigma, Wallet,
} from 'lucide-react'

// The application's navigation, shared by the sidebar and the top bar's tabs.
export type NavItem = { label: string; href: string; icon: React.ElementType; external?: boolean }
export type NavGroup = { id: string; label: string; icon: React.ElementType; items: NavItem[] }

// What VIGIL decides and why: always in view.
export const primary: NavItem[] = [
  { label: 'Overview',    href: '/evidence',          icon: Sigma },
  { label: 'Decisions',   href: '/decisions',         icon: Scissors },
  { label: 'Playground',  href: '/playground',        icon: FlaskConical },
  { label: 'Autonomy',    href: '/autonomy',          icon: ShieldCheck },
  { label: 'Risk',        href: '/risk',              icon: Gauge },
  // Rendered by the Go server (internal/web) and shown inside the dashboard frame.
  { label: 'Time Travel', href: '/time-travel',       icon: Clock },
  { label: 'Reveal',      href: '/reveal',            icon: Sparkles },
]

// Everything else, grouped and folded.
export const groups: NavGroup[] = [
  { id: 'graph', label: 'Graph memory', icon: Brain, items: [
    { label: 'Ontology',        href: '/ontology',        icon: Network },
    { label: 'Blast Radius',    href: '/blast-radius',    icon: GitBranch },
    { label: 'Memory Timeline', href: '/memory-timeline', icon: History },
  ] },
  { id: 'runtime', label: 'Runtime', icon: Radio, items: [
    { label: 'Mission Control', href: '/mission-control', icon: Activity },
    { label: 'Cost Firewall',   href: '/cost-firewall',   icon: Wallet },
    { label: 'Agent DNA',       href: '/agent-dna',       icon: BarChart3 },
    { label: 'Incidents',       href: '/incidents',       icon: AlertTriangle },
  ] },
  { id: 'govern', label: 'Governance', icon: Landmark, items: [
    { label: 'Policies',     href: '/policies',   icon: Shield },
    { label: 'Governance',   href: '/governance', icon: FileCheck },
    { label: 'Model Router', href: '/models',     icon: Cpu },
    { label: 'Plugins',      href: '/plugins',    icon: Zap },
  ] },
]

export const footer: NavItem[] = [
  { label: 'Connect an agent', href: '/connect',  icon: Plug },
  { label: 'Settings',         href: '/settings', icon: Settings },
  { label: 'Help',             href: 'https://github.com/Aaditya1273/Onix', icon: HelpCircle, external: true },
]

export const allPages = [...primary, ...groups.flatMap(g => g.items), ...footer]

// Sub-tabs for pages long enough to need them (three or more sections). The top
// bar shows these; the page shows one tab's sections at a time. Pages not listed
// here are short and get a breadcrumb instead.
export type PageTab = { id: string; label: string }
export const pageTabs: Record<string, PageTab[]> = {
  '/evidence': [
    { id: 'summary', label: 'Summary' }, { id: 'sessions', label: 'Sessions' },
    { id: 'signals', label: 'Signals' }, { id: 'timing', label: 'Graph & cuts' },
  ],
  '/playground': [{ id: 'attack', label: 'Attack' }, { id: 'recent', label: 'Recent attempts' }],
  '/plugins': [{ id: 'connect', label: 'Connect' }, { id: 'sessions', label: 'Sessions' }, { id: 'calls', label: 'Live tool calls' }],
  '/incidents': [{ id: 'stopped', label: 'Stopped calls' }, { id: 'agents', label: 'Agents' }, { id: 'detectors', label: 'Detectors' }],
  '/autonomy': [{ id: 'earned', label: 'Earned autonomy' }, { id: 'stops', label: 'Stops & chain' }],
  '/reveal': [{ id: 'summary', label: 'Summary' }, { id: 'autonomy', label: 'Autonomy & spend' }, { id: 'all', label: 'Every decision' }],
}

/** Where a page sits, for the breadcrumb: its group (if any) and its own label. */
export function crumbs(pathname: string): string[] {
  const g = groups.find(x => x.items.some(i => i.href === pathname))
  const p = allPages.find(i => i.href === pathname)
  return [g?.label, p?.label].filter(Boolean) as string[]
}
