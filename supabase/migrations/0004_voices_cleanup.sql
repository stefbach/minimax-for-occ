-- Remove the seeded "preset" voice IDs from migration 0002 — they were
-- legacy speech-01 IDs that are not guaranteed to work with newer models.
-- Users will populate the catalog with their own clones from Voice Studio.

delete from public.voices
where source = 'preset'
  and voice_id in ('male-qn-qingse', 'female-shaonv', 'female-yujie', 'male-qn-jingying');
