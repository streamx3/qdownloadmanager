#!/usr/bin/env python3
"""Executable checks of the proposed catalog contract; no product integration."""
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCHEMA = (Path(__file__).resolve().parents[1] / 'docs/database/schema.sql').read_text()


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)
        self.db.execute("INSERT INTO catalog VALUES (1, 'test-library', '2026-11-01T00:00:00Z')")
        self.db.execute("INSERT INTO roots(label,absolute_path,case_sensitive) VALUES ('Art','/example/art',1)")
        self.db.execute("INSERT INTO images(title) VALUES ('First')")
        self.db.execute("INSERT INTO image_versions(image_id,version_number,byte_size,md5) VALUES (1,1,3,?)", (b'a'*16,))

    def tearDown(self):
        self.db.close()

    def add_file(self, path, version=1):
        self.db.execute('INSERT INTO files(root_id,version_id,relative_path,path_key,name,name_key) VALUES (1,?,?,?,?,?)',
                        (version, path, path, path.rsplit('/', 1)[-1], path.rsplit('/', 1)[-1]))

    def test_locations_and_moves_preserve_metadata(self):
        self.add_file('a.png'); self.add_file('nested/copy.png')
        self.db.execute("INSERT INTO image_notes(image_id,body) VALUES (1,'Keep this note')")
        self.db.execute("UPDATE files SET relative_path='moved.png', path_key='moved.png', name='moved.png', name_key='moved.png' WHERE id=1")
        self.assertEqual(self.db.execute('SELECT count(*) FROM files WHERE version_id=1').fetchone()[0], 2)
        self.assertEqual(self.db.execute('SELECT body FROM image_notes WHERE image_id=1').fetchone()[0], 'Keep this note')
        with self.assertRaises(sqlite3.IntegrityError): self.add_file('moved.png')
        for path in ['../escape.png', '/absolute.png', 'a/../../escape.png', 'C:/x.png']:
            with self.assertRaises(sqlite3.IntegrityError): self.add_file(path)

    def test_hashes_do_not_merge_images(self):
        self.db.execute("INSERT INTO images(title) VALUES ('Different identity')")
        self.db.execute('INSERT INTO image_versions(image_id,version_number,byte_size,md5) VALUES (2,1,3,?)', (b'a'*16,))
        self.assertEqual(self.db.execute('SELECT count(*) FROM image_versions WHERE md5=?', (b'a'*16,)).fetchone()[0], 2)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO image_versions(image_id,version_number,byte_size,md5) VALUES (1,2,3,X'AB')")

    def test_tags_and_synonyms_share_identity(self):
        self.db.execute('INSERT INTO tags DEFAULT VALUES')
        self.db.execute("INSERT INTO tag_names(tag_id,name,name_key,is_canonical) VALUES (1,'Cat','cat',1),(1,'Kitty','kitty',0)")
        self.db.execute("INSERT INTO image_tags(image_id,tag_id) SELECT 1,tag_id FROM tag_names WHERE name_key='kitty'")
        self.assertEqual(self.db.execute('SELECT tag_id FROM image_tags WHERE image_id=1').fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('INSERT INTO image_tags VALUES (1,1,CURRENT_TIMESTAMP)')
        self.db.execute('INSERT INTO tags DEFAULT VALUES')
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("INSERT INTO tag_names(tag_id,name,name_key,is_canonical) VALUES (2,'Kitty','kitty',1)")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("INSERT INTO tag_names(tag_id,name,name_key,is_canonical) VALUES (1,'Feline','feline',1)")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('INSERT INTO image_tags(image_id,tag_id) VALUES (999,1)')

    def test_edits_keep_image_notes_and_references(self):
        self.add_file('art.png')
        self.db.execute("INSERT INTO image_notes(image_id,body) VALUES (1,'My note')")
        self.db.execute('INSERT INTO image_versions(image_id,version_number,byte_size) VALUES (1,2,5)')
        self.db.execute('UPDATE files SET version_id=2 WHERE id=1')
        self.assertEqual(self.db.execute('SELECT body FROM image_notes WHERE image_id=1').fetchone()[0], 'My note')
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('DELETE FROM image_versions WHERE id=2')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_two_connections_detect_conflicting_edits(self):
        # Rollback journaling is sufficient for this contract test even if the
        # test Python embeds an older SQLite; production WAL version is gated.
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'catalog.sqlite')
            first = sqlite3.connect(path); second = sqlite3.connect(path)
            try:
                first.executescript(SCHEMA)
                first.execute('PRAGMA journal_mode=DELETE')
                second.execute('PRAGMA foreign_keys=ON')
                first.execute('INSERT INTO images DEFAULT VALUES')
                first.execute("INSERT INTO image_notes(image_id,body) VALUES (1,'Original')"); first.commit()
                revision = second.execute('SELECT revision FROM image_notes WHERE id=1').fetchone()[0]
                first.execute("UPDATE image_notes SET body='First edit',revision=revision+1 WHERE id=1 AND revision=1"); first.commit()
                stale = second.execute("UPDATE image_notes SET body='Stale edit',revision=revision+1 WHERE id=1 AND revision=?", (revision,))
                self.assertEqual(stale.rowcount, 0)
                self.assertEqual(second.execute('SELECT body FROM image_notes WHERE id=1').fetchone()[0], 'First edit')
            finally:
                second.close(); first.close()


if __name__ == '__main__': unittest.main()
