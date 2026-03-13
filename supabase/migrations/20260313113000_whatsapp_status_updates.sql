-- Dedicated routine for WhatsApp outbound status events
-- - Links status event to outbound lead_messages via wa_message_id/external_message_id
-- - Applies monotonic status progression: pending < sent < delivered < read
-- - Does not increment unread counters or create synthetic inbound messages

ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS external_message_id text,
  ADD COLUMN IF NOT EXISTS wa_message_id text;

CREATE INDEX IF NOT EXISTS idx_lead_messages_org_wa_message_id
  ON public.lead_messages (organization_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_messages_org_external_message_id
  ON public.lead_messages (organization_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.register_whatsapp_status_update(
  _org_id uuid,
  _wa_message_id text,
  _external_message_id text,
  _status text,
  _status_at timestamptz,
  _payload jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _normalized_status text;
  _event_at timestamptz;
  _target_id uuid;
BEGIN
  _normalized_status := lower(trim(coalesce(_status, '')));
  _event_at := coalesce(_status_at, now());

  IF _normalized_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
    RETURN NULL;
  END IF;

  SELECT lm.id
  INTO _target_id
  FROM public.lead_messages lm
  WHERE lm.organization_id = _org_id
    AND lm.direction = 'outbound'
    AND (
      (_wa_message_id IS NOT NULL AND lm.wa_message_id = _wa_message_id)
      OR (_external_message_id IS NOT NULL AND lm.external_message_id = _external_message_id)
    )
  ORDER BY lm.created_at DESC
  LIMIT 1;

  IF _target_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.lead_messages lm
  SET
    wa_message_id = coalesce(lm.wa_message_id, _wa_message_id),
    external_message_id = coalesce(lm.external_message_id, _external_message_id),
    raw_payload = CASE
      WHEN _payload IS NULL THEN lm.raw_payload
      ELSE coalesce(lm.raw_payload, '{}'::jsonb) || jsonb_build_object('status_event', _payload)
    END,
    status = CASE
      WHEN _normalized_status = 'failed' AND lm.status NOT IN ('delivered', 'read') THEN 'failed'
      WHEN _normalized_status = 'read' THEN 'read'
      WHEN _normalized_status = 'delivered' AND lm.status <> 'read' THEN 'delivered'
      WHEN _normalized_status = 'sent' AND lm.status NOT IN ('delivered', 'read') THEN 'sent'
      ELSE lm.status
    END,
    sent_at = CASE
      WHEN _normalized_status = 'sent' THEN coalesce(lm.sent_at, _event_at)
      ELSE lm.sent_at
    END,
    delivered_at = CASE
      WHEN _normalized_status IN ('delivered', 'read') THEN coalesce(lm.delivered_at, _event_at)
      ELSE lm.delivered_at
    END,
    read_at = CASE
      WHEN _normalized_status = 'read' THEN coalesce(lm.read_at, _event_at)
      ELSE lm.read_at
    END
  WHERE lm.id = _target_id;

  RETURN _target_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_whatsapp_status_update(uuid, text, text, text, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_status_update(uuid, text, text, text, timestamptz, jsonb) TO service_role;
