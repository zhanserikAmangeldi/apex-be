import pool from '../pool/index.js';

export class TagRepository {
  async createTag(vaultId, name, color = '#3B82F6') {
    const result = await pool.query(
      'INSERT INTO tags (vault_id, name, color) VALUES ($1, $2, $3) RETURNING *',
      [vaultId, name, color]
    );
    return result.rows[0];
  }

  async getTagsByVault(vaultId) {
    const result = await pool.query(
      'SELECT * FROM tags WHERE vault_id = $1 ORDER BY name',
      [vaultId]
    );
    return result.rows;
  }

  async getTagById(tagId) {
    const result = await pool.query('SELECT * FROM tags WHERE id = $1', [tagId]);
    return result.rows[0];
  }

  async updateTag(tagId, name, color) {
    const result = await pool.query(
      'UPDATE tags SET name = $1, color = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [name, color, tagId]
    );
    return result.rows[0];
  }

  async deleteTag(tagId) {
    await pool.query('DELETE FROM tags WHERE id = $1', [tagId]);
  }

  async addTagToDocument(documentId, tagId) {
    const result = await pool.query(
      'INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [documentId, tagId]
    );
    return result.rows[0];
  }

  async removeTagFromDocument(documentId, tagId) {
    await pool.query(
      'DELETE FROM document_tags WHERE document_id = $1 AND tag_id = $2',
      [documentId, tagId]
    );
  }

  async getDocumentTags(documentId) {
    const result = await pool.query(
      `SELECT t.* FROM tags t
       INNER JOIN document_tags dt ON t.id = dt.tag_id
       WHERE dt.document_id = $1
       ORDER BY t.name`,
      [documentId]
    );
    return result.rows;
  }

  async getDocumentsByTag(tagId) {
    const result = await pool.query(
      `SELECT d.* FROM documents d
       INNER JOIN document_tags dt ON d.id = dt.document_id
       WHERE dt.tag_id = $1`,
      [tagId]
    );
    return result.rows;
  }
}

export const tagRepository = new TagRepository();
