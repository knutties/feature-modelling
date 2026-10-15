import { CreateWorkspaceCommand, type SuperpositionClient } from 'superposition-sdk';

/** Create the workspace, or do nothing if it is already there. */
export async function ensureWorkspace(
  client: SuperpositionClient,
  orgId: string,
  name: string,
  adminEmail: string,
): Promise<void> {
  try {
    await client.send(
      new CreateWorkspaceCommand({
        org_id: orgId,
        workspace_name: name,
        workspace_admin_email: adminEmail,
        workspace_status: 'ENABLED',
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Already there from an earlier run; that is the normal path.
    if (!/already exist|duplicate|unique/i.test(message)) throw error;
  }
}
