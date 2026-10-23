import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";
import styles from "@/components/dashboard-responsive.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  return (
    <AppShell>
      <div className={styles.dashboard}>
        <Dashboard />
      </div>
    </AppShell>
  );
}
