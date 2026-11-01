-- DRAFT: reviewable schema only. The downloader does not open this database.
-- Fresh databases only; schema version 1. See README.md for the writer contract.
-- SQL syntax requires SQLite >= 3.37; production WAL must use a patched runtime.
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
BEGIN IMMEDIATE;
PRAGMA application_id = 1363430729; -- QDMI
PRAGMA user_version = 1;

CREATE TABLE catalog (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    library_uuid TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
-- The creator inserts singleton=1 and a random UUID before publishing the DB.

CREATE TABLE roots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    absolute_path TEXT NOT NULL UNIQUE,
    case_sensitive INTEGER NOT NULL CHECK (case_sensitive IN (0,1)),
    online INTEGER NOT NULL DEFAULT 1 CHECK (online IN (0,1))
) STRICT;

CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT
) STRICT;

-- Immutable content revisions; hashes describe exact bytes, not rendered pixels.
-- Deliberately no UNIQUE(hash): collisions and independent imports are allowed.
CREATE TABLE image_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    md5 BLOB CHECK (md5 IS NULL OR length(md5) = 16),
    sha256 BLOB CHECK (sha256 IS NULL OR length(sha256) = 32),
    mime_type TEXT,
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (image_id, version_number)
) STRICT;
CREATE INDEX versions_md5_size ON image_versions(md5, byte_size) WHERE md5 IS NOT NULL;
CREATE INDEX versions_sha256_size ON image_versions(sha256, byte_size) WHERE sha256 IS NOT NULL;

CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE RESTRICT,
    version_id INTEGER NOT NULL REFERENCES image_versions(id) ON DELETE RESTRICT,
    relative_path TEXT NOT NULL CHECK (
        length(relative_path) > 0 AND substr(relative_path,1,1) <> '/'
        AND instr(relative_path, char(92)) = 0 AND instr(relative_path, char(0)) = 0
        AND instr(relative_path, ':') = 0 AND instr(relative_path, '//') = 0
        AND instr('/' || relative_path || '/', '/../') = 0
        AND instr('/' || relative_path || '/', '/./') = 0
        AND substr(relative_path,-1) <> '/'),
    path_key TEXT NOT NULL CHECK (length(path_key) > 0),
    name TEXT NOT NULL CHECK (length(name) > 0 AND instr(name, '/') = 0),
    name_key TEXT NOT NULL CHECK (length(name_key) > 0),
    mtime_ns INTEGER,
    state TEXT NOT NULL DEFAULT 'present' CHECK (state IN ('present','missing','unverified')),
    last_seen_at TEXT,
    UNIQUE (root_id, path_key)
) STRICT;
CREATE INDEX files_version ON files(version_id);
CREATE INDEX files_name ON files(root_id, name_key, state);

CREATE TABLE image_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX notes_image ON image_notes(image_id);

-- Alternative names for one image (not filesystem paths).
CREATE TABLE image_names (
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) > 0),
    name_key TEXT NOT NULL CHECK (length(name_key) > 0),
    PRIMARY KEY (image_id, name_key)
) STRICT;
CREATE INDEX image_names_lookup ON image_names(name_key);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
) STRICT;
-- Canonical labels and synonyms share one namespace: an alias cannot shadow
-- another tag's canonical name. Alias chains/cycles cannot occur.
CREATE TABLE tag_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) > 0),
    name_key TEXT NOT NULL UNIQUE CHECK (length(name_key) > 0),
    is_canonical INTEGER NOT NULL CHECK (is_canonical IN (0,1))
) STRICT;
CREATE UNIQUE INDEX tags_one_canonical_name ON tag_names(tag_id) WHERE is_canonical = 1;
CREATE INDEX tag_names_tag ON tag_names(tag_id);
-- Exactly one canonical name per tag at commit is a shared-writer invariant;
-- SQLite's partial unique index enforces at most one, not at least one.

CREATE TABLE image_tags (
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (image_id, tag_id)
) STRICT;
CREATE INDEX image_tags_tag ON image_tags(tag_id, image_id);

CREATE TABLE image_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    page_url TEXT,
    resource_url TEXT,
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX sources_image ON image_sources(image_id);

-- Keep the old ID resolvable after an explicit metadata merge. The shared writer
-- forbids cycles and flattens chains. Equal hashes never insert this automatically.
CREATE TABLE image_merges (
    old_image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE RESTRICT,
    kept_image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
    merged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (old_image_id <> kept_image_id)
) STRICT;
CREATE INDEX image_merges_kept ON image_merges(kept_image_id);
COMMIT;
