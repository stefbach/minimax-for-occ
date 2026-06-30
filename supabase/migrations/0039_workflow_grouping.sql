-- 0037_workflow_grouping.sql
--
-- Presentation metadata for the automations list: a group heading and an
-- explicit sort order, so the OCC pipeline reads as two clear sections —
-- cron entry points vs the ordered sub-agents — instead of one flat,
-- alphabetically-sorted list (which mis-ordered the agents 2,3,4,5,6,7 when
-- they actually run 2,3,5,7,6,4). Both columns are nullable and backward
-- compatible: existing workflows simply fall into a default group.

ALTER TABLE org_workflows ADD COLUMN IF NOT EXISTS group_label text;
ALTER TABLE org_workflows ADD COLUMN IF NOT EXISTS sort_order int;
