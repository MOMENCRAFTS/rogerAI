-- ─── Migration 006: PTT Network (roger_contacts, relay_messages, roger_channels) ─
-- Run: supabase db push  OR  paste into Supabase SQL Editor

-- ─── Roger Channels ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roger_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group', 'open')),
  owner_id    uuid REFERENCES auth.users ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Channel Members ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id  uuid NOT NULL REFERENCES roger_channels ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- ─── Roger Contacts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roger_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  contact_id    uuid REFERENCES auth.users ON DELETE SET NULL,
  display_name  text NOT NULL,                    -- how the owner refers to them ("Ahmad", "Mom")
  handle        text,                              -- their callsign / invite email before acceptance
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'blocked')),
  invited_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id)
);

-- ─── Relay Messages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relay_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      uuid REFERENCES roger_channels ON DELETE SET NULL,
  sender_id       uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  recipient_id    uuid REFERENCES auth.users ON DELETE SET NULL,  -- null = group channel
  transcript      text NOT NULL,
  roger_summary   text,                           -- GPT-4o summary for long messages
  audio_url       text,                           -- Supabase Storage path (optional)
  priority        text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('normal', 'urgent', 'emergency')),
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'delivered', 'read', 'deferred')),
  deferred_until  timestamptz,
  intent          text,                           -- e.g. RELAY_SEND, ETA_UPDATE
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  read_at         timestamptz
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_relay_messages_recipient
  ON relay_messages (recipient_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_relay_messages_sender
  ON relay_messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_roger_contacts_user
  ON roger_contacts (user_id, status);

CREATE INDEX IF NOT EXISTS idx_channel_members_user
  ON channel_members (user_id);

-- ─── RLS Policies ─────────────────────────────────────────────────────────────
ALTER TABLE roger_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE roger_channels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members   ENABLE ROW LEVEL SECURITY;

-- roger_contacts: owner sees their own contacts
CREATE POLICY "contacts_select" ON roger_contacts
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = contact_id);
CREATE POLICY "contacts_insert" ON roger_contacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contacts_update" ON roger_contacts
  FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = contact_id);
CREATE POLICY "contacts_delete" ON roger_contacts
  FOR DELETE USING (auth.uid() = user_id);

-- relay_messages: sender or recipient can see message
CREATE POLICY "relay_select" ON relay_messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY "relay_insert" ON relay_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "relay_update" ON relay_messages
  FOR UPDATE USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- roger_channels: owner or member
CREATE POLICY "channels_select" ON roger_channels
  FOR SELECT USING (
    auth.uid() = owner_id OR
    EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = roger_channels.id AND cm.user_id = auth.uid())
  );
CREATE POLICY "channels_insert" ON roger_channels
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "channels_update" ON roger_channels
  FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "channels_delete" ON roger_channels
  FOR DELETE USING (auth.uid() = owner_id);

-- channel_members: members see their own memberships
CREATE POLICY "members_select" ON channel_members
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "members_insert" ON channel_members
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM roger_channels rc WHERE rc.id = channel_id AND rc.owner_id = auth.uid())
  );
CREATE POLICY "members_delete" ON channel_members
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Realtime ─────────────────────────────────────────────────────────────────
-- Enable Realtime for relay_messages so recipients get instant push
ALTER PUBLICATION supabase_realtime ADD TABLE relay_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE roger_contacts;
