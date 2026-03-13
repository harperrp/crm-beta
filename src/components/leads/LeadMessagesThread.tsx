import { useLeadMessages } from "@/hooks/useFinanceQueries";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Image, Mic, FileText, SmilePlus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "@/providers/OrgProvider";
import { queryKeys } from "@/lib/queryKeys";

const typeIcons: Record<string, any> = {
  text: MessageCircle,
  image: Image,
  audio: Mic,
  video: FileText,
  document: FileText,
  reaction: SmilePlus,
  sticker: SmilePlus,
};

interface LeadMessagesThreadProps {
  leadId: string;
}

export function LeadMessagesThread({ leadId }: LeadMessagesThreadProps) {
  const { activeOrgId } = useOrg();
  const { data: messages = [], isLoading } = useLeadMessages(
    leadId,
    activeOrgId
  );
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`lead-messages-${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lead_messages",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          const payloadOrgId =
            payload.new?.organization_id ?? payload.old?.organization_id;

          if (activeOrgId && payloadOrgId && payloadOrgId !== activeOrgId) {
            return;
          }

          qc.invalidateQueries({
            queryKey: queryKeys.leadMessages(leadId, activeOrgId),
            exact: true,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, activeOrgId, qc]);

  if (isLoading) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Carregando mensagens...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-30" />
        Nenhuma mensagem do WhatsApp ainda
      </div>
    );
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-3 p-4">
        {messages.map((msg: any) => {
          const Icon = typeIcons[msg.message_type] || MessageCircle;
          const isInbound = msg.direction === "inbound";

          return (
            <div
              key={msg.id}
              className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 text-sm ${
                  isInbound
                    ? "border bg-muted"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                <div className="mb-1 flex items-center gap-1">
                  <Icon className="h-3 w-3" />
                  <Badge variant="outline" className="px-1 py-0 text-[10px]">
                    {msg.message_type}
                  </Badge>
                </div>

                <p className="whitespace-pre-wrap break-words">
                  {msg.message_text}
                </p>

                <div
                  className={`mt-1 text-[10px] opacity-60 ${
                    isInbound ? "text-left" : "text-right"
                  }`}
                >
                  {format(parseISO(msg.created_at), "dd/MM HH:mm", {
                    locale: ptBR,
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}