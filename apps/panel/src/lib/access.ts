import { prisma } from './prisma';
import { AuthPayload, FULL_ADMIN_ROLES } from './auth';

/** SUPERADMIN / ADMIN — full access to every node and to admin management. */
export function isFullAdmin(payload: AuthPayload): boolean {
  return FULL_ADMIN_ROLES.includes(payload.role);
}

/**
 * The node ids a user may access. Returns null for a full admin (= all nodes).
 * For a MANAGER it reads the current ManagerNode assignments from the DB (the
 * JWT is never trusted for this — assignments can change within a token's life).
 */
export async function accessibleNodeIds(payload: AuthPayload): Promise<string[] | null> {
  if (isFullAdmin(payload)) return null;
  const rows = await prisma.managerNode.findMany({
    where: { adminId: payload.sub },
    select: { nodeId: true },
  });
  return rows.map((r) => r.nodeId);
}

/** Whether the user may access a specific node. */
export async function canAccessNode(payload: AuthPayload, nodeId: string): Promise<boolean> {
  if (isFullAdmin(payload)) return true;
  const row = await prisma.managerNode.findUnique({
    where: { adminId_nodeId: { adminId: payload.sub, nodeId } },
    select: { id: true },
  });
  return !!row;
}

/**
 * A Prisma `where` fragment restricting clients to those a manager created.
 * Full admins get `{}` (all clients). Spread into client list/count queries.
 */
export function clientOwnershipWhere(payload: AuthPayload): { createdById?: string } {
  return isFullAdmin(payload) ? {} : { createdById: payload.sub };
}

/**
 * Resolve a client and check access. Full admins may access any client; a
 * MANAGER may only access clients THEY created. `exists` distinguishes
 * "not found" (→ 404) from "found but forbidden".
 */
export async function checkClientAccess(
  payload: AuthPayload,
  clientId: string,
): Promise<{ exists: boolean; allowed: boolean; nodeId?: string }> {
  const client = await prisma.vpnClient.findUnique({
    where: { id: clientId },
    select: { nodeId: true, createdById: true },
  });
  if (!client) return { exists: false, allowed: false };
  const allowed = isFullAdmin(payload) ? true : client.createdById === payload.sub;
  return { exists: true, allowed, nodeId: client.nodeId };
}
