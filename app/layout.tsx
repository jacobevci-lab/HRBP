import type { Metadata } from "next";
import "./globals.css";
import "./enterprise.css";
import "./employee360.css";
import "./recruiting.css";
import "./work-pay.css";
import "./growth.css";
import "./employee-services.css";
import "./governance-planning.css";
import "./platform-admin.css";
import "./offboarding.css";
import "./auth.css";
import "./theme.css";

export const metadata: Metadata = {
  title: "HRBP One",
  description: "Enterprise Human Capital Management & HRBP Operating System"
};

const themeBootstrap = `
(function(){
  try {
    var stored = localStorage.getItem('hrbp-theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = 'light';
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }}/></head>
      <body>{children}</body>
    </html>
  );
}
