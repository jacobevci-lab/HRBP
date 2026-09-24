import type { Metadata } from "next";
import "./globals.css";
import "./enterprise.css";
import "./employee360.css";
import "./recruiting.css";
import "./recruiting-ops.css";
import "./work-pay.css";
import "./growth.css";
import "./employee-services.css";
import "./governance-planning.css";
import "./platform-admin.css";
import "./offboarding.css";
import "./auth.css";
import "./theme.css";
import "./lifecycle.css";
import "./notifications.css";
import "./workflows.css";
import "./global-search.css";
import "./dashboard-actions.css";
import "./settings-live.css";
import "./settings-connections.css";
import "./warm-enterprise.css";
import "./warm-enterprise-polish.css";
import "./warm-enterprise-unified.css";

export const metadata: Metadata = {
  title: "HRBP One",
  description: "Enterprise Human Capital Management & HRBP Operating System"
};

const uiBootstrap = `
(function(){
  try {
    var storedTheme = localStorage.getItem('hrbp-theme');
    var theme = storedTheme === 'dark' || storedTheme === 'light'
      ? storedTheme
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;

    var cookieMatch = document.cookie.match(/(?:^|; )hrbp-locale=([^;]+)/);
    var cookieLocale = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
    var storedLocale = localStorage.getItem('hrbp-locale');
    var locale = storedLocale === 'tr' || storedLocale === 'en'
      ? storedLocale
      : (cookieLocale === 'tr' || cookieLocale === 'en' ? cookieLocale : (navigator.language.toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en'));
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  } catch (_) {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.lang = 'en';
    document.documentElement.dataset.locale = 'en';
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: uiBootstrap }}/></head>
      <body>{children}</body>
    </html>
  );
}
