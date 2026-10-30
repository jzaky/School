-- Tool definition pinning (docs/TOOL_PINNING.md): the approved fingerprint of a tool's definition and the
-- connector version it came from, plus a pending change waiting for a person. Row-level security on tools
-- already covers the new column.
ALTER TABLE "tools" ADD COLUMN "definition_pin" JSONB NOT NULL DEFAULT '{}';
