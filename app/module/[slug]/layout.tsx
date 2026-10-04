import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { navigation } from "@/lib/navigation";

const moduleSlugs = new Set(navigation.flatMap(group => group.items.map(item => item.slug)));

/** Validate the route catalog without interpreting arbitrary paths as modules. */
export default async function ModuleLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug === "dashboard") redirect("/");
  if (slug !== "notifications" && !moduleSlugs.has(slug)) notFound();
  return children;
}
