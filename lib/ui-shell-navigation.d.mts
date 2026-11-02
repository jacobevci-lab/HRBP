export type PrimaryShellDestination = {
  id: "home" | "work" | "operations" | "people" | "insights" | "admin";
  slug: string;
  label: "home" | "work" | "operations" | "team" | "people" | "insights" | "admin";
};
export function primaryShellDestinations(input: {
  authenticated: boolean;
  role?: string | null;
  capabilities?: string[];
}): PrimaryShellDestination[];
export function roleWorkspacePreferences(role?: string | null): string[];
