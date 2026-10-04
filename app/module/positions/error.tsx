"use client";

import { CoreWorkspaceError } from "@/components/core-workspace-error";

// Next handles redirects/not-found itself; ordinary render errors reach this UI.
export default function WorkspaceError() {
  return <CoreWorkspaceError slug="positions"/>;
}
