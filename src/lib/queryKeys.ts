export const queryKeys = {
  leadMessages: (leadId: string | null | undefined, orgId: string | null | undefined) =>
    ["lead_messages", leadId, orgId] as const,
  whatsappConversations: (orgId: string | null | undefined) =>
    ["whatsapp_conversations", orgId] as const,
};
