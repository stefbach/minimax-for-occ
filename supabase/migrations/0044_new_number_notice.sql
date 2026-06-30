-- Tracks the one-off "we've moved to a new WhatsApp/SMS number" notification so a
-- patient is never notified twice. Set when the notify-new-number route delivers
-- on at least one channel (WhatsApp or SMS).
ALTER TABLE leads_rdv ADD COLUMN IF NOT EXISTS new_number_notice_sent_at timestamptz;
