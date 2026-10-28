-- Raw evidence survives administrative removal of its distillation products.
ALTER TABLE trajectories ADD COLUMN distillation_blocked_reason text;
