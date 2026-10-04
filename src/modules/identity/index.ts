// Public barrel of the `identity` module — other modules import ONLY from here.
export { createWorkspace, listWorkspacesFor, assertMembership } from "./server/service";
export { users, workspaces, workspaceMembers, authenticated } from "./server/schema";
export { ensureLocalStudio, LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from "./server/local";
