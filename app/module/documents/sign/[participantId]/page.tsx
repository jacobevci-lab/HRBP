import { AppShell } from "@/components/app-shell";
import { DocumentSignerParticipantConsole } from "@/components/document-signer-participant-console";
import { getDocumentSignerParticipantData } from "@/lib/document-signer-participant-data";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DocumentSignerParticipantPage({ params }: { params: Promise<{ participantId: string }> }) {
  const [{ participantId }, ctx] = await Promise.all([params, getServerRequestContext()]);
  if (!ctx) return <AppShell><section className="card module-table"><div className="empty-state"><h3>Authentication required</h3><p>Sign in with your employment identity to continue this document signature action.</p></div></section></AppShell>;

  const data = await getDocumentSignerParticipantData(ctx, participantId);
  if (!data) return <AppShell><section className="card module-table"><div className="empty-state"><h3>Signature action unavailable</h3><p>The participant is outside your signed employment identity or governed document scope. No broader participant lookup was attempted.</p></div></section></AppShell>;

  return <AppShell><DocumentSignerParticipantConsole data={data}/></AppShell>;
}
