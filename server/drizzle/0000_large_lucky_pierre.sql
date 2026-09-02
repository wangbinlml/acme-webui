CREATE TABLE `certificates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`primary_domain` text NOT NULL,
	`domains` text NOT NULL,
	`ca` text DEFAULT 'letsencrypt' NOT NULL,
	`key_type` text DEFAULT 'ec-256' NOT NULL,
	`challenge_type` text DEFAULT 'dns01' NOT NULL,
	`dns_provider_id` integer,
	`status` text DEFAULT 'issuing' NOT NULL,
	`auto_renew` integer DEFAULT true NOT NULL,
	`renew_before_days` integer DEFAULT 30 NOT NULL,
	`cert_path` text,
	`key_path` text,
	`issued_at` text,
	`expires_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dns_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`credentials` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`certificate_id` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
