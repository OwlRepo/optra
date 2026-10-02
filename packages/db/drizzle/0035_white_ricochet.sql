-- B8 follow-up (owner-approved 2026-10-03): names stored before B8 hold
-- busboy's latin1 reading of their UTF-8 bytes ("faÃ§ture-…"). Re-read those
-- bytes as UTF-8, the same rule decodeUploadFilename applies to new uploads.
-- Only the display `name` changes; storage keys and objects are untouched.
-- A row is changed only when every character is at most U+00FF, at least one
-- is above U+007F, and the bytes are valid UTF-8; correct names fail one of
-- those and stay as they are, so the migration is idempotent.
-- Rollback for a changed row: name = convert_from(convert_to(name, 'UTF8'), 'LATIN1').
DO $$
DECLARE
  target text;
  item record;
  restored text;
  changed integer;
BEGIN
  FOREACH target IN ARRAY ARRAY['purchase_orders', 'invoices', 'goods_receipts', 'catalogs'] LOOP
    changed := 0;
    FOR item IN EXECUTE format(
      'SELECT id, name FROM %I WHERE name ~ ''[\u0080-ÿ]'' AND name !~ ''[^\u0001-ÿ]''',
      target
    ) LOOP
      BEGIN
        restored := convert_from(convert_to(item.name, 'LATIN1'), 'UTF8');
      EXCEPTION WHEN others THEN
        restored := NULL;
      END;
      IF restored IS NOT NULL AND restored <> item.name THEN
        EXECUTE format('UPDATE %I SET name = $1 WHERE id = $2', target) USING restored, item.id;
        changed := changed + 1;
      END IF;
    END LOOP;
    RAISE NOTICE 'upload name backfill: % row(s) restored in %', changed, target;
  END LOOP;
END $$;
