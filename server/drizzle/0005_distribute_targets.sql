CREATE TABLE `distribute_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`primary_domain` text NOT NULL,
	`ip` text NOT NULL,
	`reload_mode` text,
	`container` text,
	`cert_dir` text,
	`first_seen_at` text NOT NULL,
	`last_sync_at` text,
	`last_sync_status` text,
	`last_sync_message` text,
	`sync_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distribute_targets_domain_ip_idx` ON `distribute_targets` (`primary_domain`,`ip`);
