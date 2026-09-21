import { Activity, BadgeDollarSign, BarChart3, BookOpenCheck, BriefcaseBusiness, Building2, CalendarDays, ChartNoAxesCombined, CircleHelp, ClipboardCheck, ContactRound, FileKey2, FileText, GraduationCap, HeartHandshake, LayoutDashboard, Network, PackageCheck, PanelsTopLeft, ReceiptText, Settings, ShieldCheck, Sparkles, Target, TimerReset, UserRoundSearch, UsersRound, Workflow } from "lucide-react";

export type NavItem = { label: string; slug: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; badge?: string };
export type NavGroup = { label: string; items: NavItem[] };

export const navigation: NavGroup[] = [
  { label: "Workspace", items: [
    { label: "Command Center", slug: "dashboard", icon: LayoutDashboard },
    { label: "People", slug: "people", icon: UsersRound },
    { label: "Organization", slug: "organization", icon: Network },
    { label: "Employee 360", slug: "employee-360", icon: ContactRound }
  ]},
  { label: "Hire & onboard", items: [
    { label: "Recruiting", slug: "recruiting", icon: UserRoundSearch, badge: "12" },
    { label: "Onboarding", slug: "onboarding", icon: PackageCheck, badge: "8" },
    { label: "Positions", slug: "positions", icon: BriefcaseBusiness }
  ]},
  { label: "Work & pay", items: [
    { label: "Time & Attendance", slug: "time-attendance", icon: TimerReset },
    { label: "Leave", slug: "leave", icon: CalendarDays },
    { label: "Payroll", slug: "payroll", icon: ReceiptText },
    { label: "Compensation", slug: "compensation", icon: BadgeDollarSign },
    { label: "Benefits", slug: "benefits", icon: HeartHandshake }
  ]},
  { label: "Grow & retain", items: [
    { label: "Performance", slug: "performance", icon: Target },
    { label: "Talent", slug: "talent", icon: ChartNoAxesCombined },
    { label: "Succession", slug: "succession", icon: Activity },
    { label: "Skills & Learning", slug: "learning", icon: GraduationCap },
    { label: "Engagement", slug: "engagement", icon: BarChart3 }
  ]},
  { label: "Employee services", items: [
    { label: "Employee Relations", slug: "employee-relations", icon: ShieldCheck, badge: "3" },
    { label: "HR Service", slug: "hr-service", icon: CircleHelp },
    { label: "Documents", slug: "documents", icon: FileText },
    { label: "Policies", slug: "policies", icon: BookOpenCheck }
  ]},
  { label: "Plan & automate", items: [
    { label: "Workforce Planning", slug: "workforce-planning", icon: Building2 },
    { label: "People Analytics", slug: "analytics", icon: PanelsTopLeft },
    { label: "AI Assistant", slug: "ai-assistant", icon: Sparkles },
    { label: "Workflows", slug: "workflows", icon: Workflow }
  ]},
  { label: "Governance", items: [
    { label: "Privacy & Compliance", slug: "privacy", icon: FileKey2 },
    { label: "Audit", slug: "audit", icon: ClipboardCheck },
    { label: "Settings", slug: "settings", icon: Settings }
  ]}
];
