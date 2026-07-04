CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`references` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_paper` ON `chat_messages` (`paper_id`);--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`section_title` text,
	`page_number` integer,
	`block_id` integer,
	`token_count` integer,
	`embedding` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chunks_paper` ON `chunks` (`paper_id`);--> statement-breakpoint
CREATE TABLE `device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`label` text DEFAULT 'Android device' NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_tokens_token_hash_unique` ON `device_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `dict_cache` (
	`word` text PRIMARY KEY NOT NULL,
	`response` text NOT NULL,
	`cached_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`block_index` integer NOT NULL,
	`block_type` text NOT NULL,
	`section_title` text,
	`content` text,
	`processed_content` text,
	`page_number` integer,
	`bbox` text,
	`asset_path` text,
	`caption` text,
	`char_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_blocks_paper_idx` ON `document_blocks` (`paper_id`,`block_index`);--> statement-breakpoint
CREATE INDEX `idx_document_blocks_paper` ON `document_blocks` (`paper_id`);--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`page_number` integer,
	`paragraph_id` integer,
	`position` text NOT NULL,
	`type` text DEFAULT 'highlight' NOT NULL,
	`color` text DEFAULT '#FFEB3B' NOT NULL,
	`comment` text,
	`selected_text` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_highlights_paper` ON `highlights` (`paper_id`);--> statement-breakpoint
CREATE TABLE `model_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`encrypted_api_key` text,
	`iv` text,
	`auth_tag` text,
	`model` text DEFAULT 'deepseek-chat' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `page_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`image_path` text NOT NULL,
	`width` integer,
	`height` integer,
	`file_size` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_page_images_paper_page` ON `page_images` (`paper_id`,`page_number`);--> statement-breakpoint
CREATE INDEX `idx_page_images_paper` ON `page_images` (`paper_id`);--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer,
	`page_count` integer,
	`abstract` text,
	`authors` text,
	`doi` text,
	`tags` text,
	`status` text DEFAULT 'unread' NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`paragraph_status` text DEFAULT 'pending' NOT NULL,
	`processing_error` text,
	`content_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_papers_status` ON `papers` (`status`);--> statement-breakpoint
CREATE TABLE `paragraphs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`section_title` text,
	`paragraph_index` integer NOT NULL,
	`content` text NOT NULL,
	`processed_content` text,
	`char_count` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_paragraphs_paper` ON `paragraphs` (`paper_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paragraphs_paper_idx` ON `paragraphs` (`paper_id`,`paragraph_index`);--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_processing_jobs_paper` ON `processing_jobs` (`paper_id`);--> statement-breakpoint
CREATE INDEX `idx_processing_jobs_status` ON `processing_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `reading_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`blocks_read` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reading_sessions_paper` ON `reading_sessions` (`paper_id`);--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`vocab_id` integer NOT NULL,
	`grade` text NOT NULL,
	`response_time_ms` integer,
	`reviewed_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`vocab_id`) REFERENCES `vocab_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_review_events_vocab` ON `review_events` (`vocab_id`);--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vocab_id` integer NOT NULL,
	`quality` integer NOT NULL,
	`prev_interval` real,
	`new_interval` real,
	`prev_ease_factor` real,
	`new_ease_factor` real,
	`response_time_ms` integer,
	`reviewed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`vocab_id`) REFERENCES `vocab_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_review_vocab` ON `review_logs` (`vocab_id`);--> statement-breakpoint
CREATE INDEX `idx_review_date` ON `review_logs` (`reviewed_at`);--> statement-breakpoint
CREATE TABLE `sentences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`paragraph_id` integer NOT NULL,
	`sentence_index` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paragraph_id`) REFERENCES `paragraphs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sentences_paragraph` ON `sentences` (`paragraph_id`);--> statement-breakpoint
CREATE TABLE `study_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`new_words_count` integer DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_study_logs_date` ON `study_logs` (`date`);--> statement-breakpoint
CREATE TABLE `translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`original_text` text NOT NULL,
	`translated_text` text NOT NULL,
	`model` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_translations_source` ON `translations` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_translations_paper` ON `translations` (`paper_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vocab_contexts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vocab_id` integer NOT NULL,
	`paper_id` text,
	`paper_title` text,
	`sentence` text NOT NULL,
	`page_number` integer,
	`block_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`vocab_id`) REFERENCES `vocab_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_vocab_contexts_vocab` ON `vocab_contexts` (`vocab_id`);--> statement-breakpoint
CREATE TABLE `vocab_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`phonetic` text,
	`audio_url` text,
	`part_of_speech` text,
	`definition_en` text,
	`definition_cn` text,
	`example_sentence` text,
	`source_paper_id` text,
	`context_sentence` text,
	`learned_at` text,
	`word_roots` text,
	`mnemonic` text,
	`repetitions` integer DEFAULT 0 NOT NULL,
	`interval_days` real DEFAULT 0 NOT NULL,
	`ease_factor` real DEFAULT 2.5 NOT NULL,
	`due_date` text DEFAULT (datetime('now')) NOT NULL,
	`last_review_at` text,
	`total_reviews` integer DEFAULT 0 NOT NULL,
	`correct_reviews` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`source_paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vocab_word` ON `vocab_items` (`word`);--> statement-breakpoint
CREATE INDEX `idx_vocab_due` ON `vocab_items` (`due_date`,`status`);