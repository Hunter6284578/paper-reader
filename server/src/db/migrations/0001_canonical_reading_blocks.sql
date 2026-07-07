ALTER TABLE `highlights` ADD `block_id` integer;
--> statement-breakpoint
CREATE INDEX `idx_highlights_block` ON `highlights` (`block_id`);
--> statement-breakpoint
UPDATE `highlights`
SET `block_id` = (
  SELECT b.id
  FROM paragraphs p
  JOIN document_blocks b
    ON b.paper_id = p.paper_id AND b.block_index = p.paragraph_index
  WHERE p.id = highlights.paragraph_id AND p.paper_id = highlights.paper_id
)
WHERE `block_id` IS NULL AND `paragraph_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `translations`
SET `source_type` = 'block',
    `source_id` = COALESCE((
      SELECT b.id
      FROM paragraphs p
      JOIN document_blocks b
        ON b.paper_id = p.paper_id AND b.block_index = p.paragraph_index
      WHERE p.id = translations.source_id AND p.paper_id = translations.paper_id
    ), `source_id`)
WHERE `source_type` = 'paragraph'
  AND EXISTS (
    SELECT 1 FROM paragraphs p JOIN document_blocks b
      ON b.paper_id = p.paper_id AND b.block_index = p.paragraph_index
    WHERE p.id = translations.source_id AND p.paper_id = translations.paper_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM translations existing
    WHERE existing.source_type = 'block'
      AND existing.source_id = (
        SELECT b.id FROM paragraphs p JOIN document_blocks b
          ON b.paper_id = p.paper_id AND b.block_index = p.paragraph_index
        WHERE p.id = translations.source_id AND p.paper_id = translations.paper_id
      )
  );
