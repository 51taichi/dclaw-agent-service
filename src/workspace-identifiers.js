export const DEFAULT_WORKSPACE_ID = "dingmai";

export function workspaceIdentifiers(workspaceId) {
  return {
    workspaceId,
    personId: `${workspaceId}-assistant`,
    websiteChannelId: `${workspaceId}-website`,
    miniappChannelId: `${workspaceId}-miniapp`,
    websiteDeploymentId: `${workspaceId}-website-assistant`,
    miniappDeploymentId: `${workspaceId}-miniapp-assistant`,
    websitePublicSlug: `${workspaceId}-assistant-web`,
    miniappPublicSlug: `${workspaceId}-assistant`,
    websiteAssistantAccountId: `${workspaceId}-website-company-assistant`,
    miniappAssistantAccountId: `${workspaceId}-miniapp-company-assistant`
  };
}

export const DEFAULT_WORKSPACE_IDENTIFIERS = workspaceIdentifiers(DEFAULT_WORKSPACE_ID);
