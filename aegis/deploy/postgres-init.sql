-- Creates the non-owner application role on first start. The password is replaced by the migrate
-- job when AEGIS_APP_PASSWORD differs (see packages/db/scripts/migrate.ts).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_app') THEN
    CREATE ROLE aegis_app LOGIN PASSWORD 'aegis_app_dev' NOBYPASSRLS;
  END IF;
END $$;
