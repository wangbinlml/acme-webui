ALTER TABLE `distribute_targets` ADD COLUMN `hostname` text;--> statement-breakpoint
ALTER TABLE `distribute_targets` ADD COLUMN `last_probe_at` text;--> statement-breakpoint
ALTER TABLE `distribute_targets` ADD COLUMN `last_probe_status` text;--> statement-breakpoint
ALTER TABLE `distribute_targets` ADD COLUMN `last_probe_message` text;
