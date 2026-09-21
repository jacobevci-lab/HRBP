import type { Metadata } from "next";
import "./globals.css";
import "./enterprise.css";
import "./recruiting.css";
import "./work-pay.css";
import "./growth.css";
import "./employee-services.css";
import "./governance-planning.css";

export const metadata: Metadata = {
  title: "HRBP One",
  description: "Enterprise Human Capital Management & HRBP Operating System"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
