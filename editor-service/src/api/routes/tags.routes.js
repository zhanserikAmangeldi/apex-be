import express from 'express';
import { tagRepository } from '../../db/repositories/index.js';
import { documentRepository } from '../../db/repositories/index.js';

const router = express.Router();

// Get all tags for a vault
router.get('/vaults/:vaultId/tags', async (req, res, next) => {
  try {
    const { vaultId } = req.params;
    const tags = await tagRepository.getTagsByVault(vaultId);
    res.json(tags);
  } catch (error) {
    next(error);
  }
});

// Create a new tag
router.post('/vaults/:vaultId/tags', async (req, res, next) => {
  try {
    const { vaultId } = req.params;
    const { name, color } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    
    const tag = await tagRepository.createTag(vaultId, name, color);
    res.status(201).json(tag);
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({ error: 'Tag with this name already exists in vault' });
    }
    next(error);
  }
});

// Update a tag
router.put('/tags/:tagId', async (req, res, next) => {
  try {
    const { tagId } = req.params;
    const { name, color } = req.body;
    
    const tag = await tagRepository.updateTag(tagId, name, color);
    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    
    res.json(tag);
  } catch (error) {
    next(error);
  }
});

// Delete a tag
router.delete('/tags/:tagId', async (req, res, next) => {
  try {
    const { tagId } = req.params;
    await tagRepository.deleteTag(tagId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Get tags for a document
router.get('/documents/:documentId/tags', async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const tags = await tagRepository.getDocumentTags(documentId);
    res.json(tags);
  } catch (error) {
    next(error);
  }
});

// Add tag to document
router.post('/documents/:documentId/tags/:tagId', async (req, res, next) => {
  try {
    const { documentId, tagId } = req.params;
    
    // Verify document exists
    const document = await documentRepository.getById(documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Verify tag exists
    const tag = await tagRepository.getTagById(tagId);
    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    
    await tagRepository.addTagToDocument(documentId, tagId);
    res.status(201).json({ message: 'Tag added to document' });
  } catch (error) {
    next(error);
  }
});

// Remove tag from document
router.delete('/documents/:documentId/tags/:tagId', async (req, res, next) => {
  try {
    const { documentId, tagId } = req.params;
    await tagRepository.removeTagFromDocument(documentId, tagId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Get documents by tag
router.get('/tags/:tagId/documents', async (req, res, next) => {
  try {
    const { tagId } = req.params;
    const documents = await tagRepository.getDocumentsByTag(tagId);
    res.json(documents);
  } catch (error) {
    next(error);
  }
});

export default router;
