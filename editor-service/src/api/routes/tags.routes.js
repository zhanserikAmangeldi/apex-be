import express from 'express';
import { tagRepository } from '../../db/repositories/index.js';
import { documentRepository } from '../../db/repositories/index.js';

const router = express.Router();

router.get('/vaults/:vaultId/tags', async (req, res, next) => {
  try {
    const { vaultId } = req.params;
    const tags = await tagRepository.getTagsByVault(vaultId);
    res.json(tags);
  } catch (error) {
    next(error);
  }
});

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

router.delete('/tags/:tagId', async (req, res, next) => {
  try {
    const { tagId } = req.params;
    await tagRepository.deleteTag(tagId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get('/documents/:documentId/tags', async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const tags = await tagRepository.getDocumentTags(documentId);
    res.json(tags);
  } catch (error) {
    next(error);
  }
});

router.post('/documents/:documentId/tags/:tagId', async (req, res, next) => {
  try {
    const { documentId, tagId } = req.params;
    
    const document = await documentRepository.getById(documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
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

router.delete('/documents/:documentId/tags/:tagId', async (req, res, next) => {
  try {
    const { documentId, tagId } = req.params;
    await tagRepository.removeTagFromDocument(documentId, tagId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

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
