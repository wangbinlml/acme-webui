ALTER TABLE `certificates` ADD `deploy_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `certificates` ADD `deploy_target_dir` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `deploy_mode` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `deploy_cmd` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `deploy_container` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `last_deploy_at` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `last_deploy_error` text;