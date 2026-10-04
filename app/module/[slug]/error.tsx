"use client";

import { ModuleWorkspaceError } from "@/components/module-workspace-error";

// Keep framework redirects/not-found separate from ordinary render failures.
export default function WorkspaceError() {
  return <ModuleWorkspaceError/>;
}
