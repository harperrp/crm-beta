-- Add WhatsApp instance traceability to legacy lead_messages records
ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS instance_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_messages_instance_id_fkey'
  ) THEN
    ALTER TABLE public.lead_messages
      ADD CONSTRAINT lead_messages_instance_id_fkey
      FOREIGN KEY (instance_id)
      REFERENCES public.whatsapp_instances(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_messages_instance_id
  ON public.lead_messages(instance_id);
