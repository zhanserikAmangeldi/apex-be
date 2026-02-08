import { Router } from 'express';
import { authenticateToken } from '../middleware/index.js';
import { validateBody, validateParams } from '../validation/index.js';
import {
    initiateAttachmentUploadSchema,
    attachmentIdParamSchema,
} from '../validation/schemas.js';
import { attachmentRepository, documentRepository } from '../../db/repositories/index.js';
import { minioService } from '../../storage/minio.service.js';
import { config } from '../../config/index.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../middleware/index.js';
import { apiLogger, logAudit } from '../../services/logger.service.js';
import crypto from 'crypto';

const router = Router();

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_MIME_TYPES = [
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
    
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    
    // Text
    'text/plain',
    'text/csv',
    'text/html',
    'text/css',
    'text/javascript',
    'text/markdown',
    'text/xml',
    
    // Code
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    
    // Archives
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-tar',
    'application/gzip',
    'application/x-7z-compressed',
    
    // Media
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    
    // Other
    'application/octet-stream', // Generic binary
];

/**
 * POST /attachments/initiate - Initiate attachment upload
 */
router.post('/initiate',
    authenticateToken,
    validateBody(initiateAttachmentUploadSchema),
    async (req, res, next) => {
        try {
            const { documentId, filename, mimeType, size } = req.body;

            // Validate file size
            if (size > MAX_FILE_SIZE) {
                throw new ValidationError(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
            }

            // Validate MIME type
            if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
                apiLogger.warn('Rejected file upload - unsupported MIME type', {
                    mimeType,
                    filename,
                    userId: req.user.userId
                });
                throw new ValidationError(`File type "${mimeType}" is not allowed. Please upload a supported file type.`);
            }

            // Check document access
            const hasAccess = await documentRepository.checkWriteAccess(documentId, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

            // Generate unique attachment ID and MinIO path
            const attachmentId = crypto.randomUUID();
            const fileExtension = filename.split('.').pop();
            const minioPath = `${documentId}/${attachmentId}.${fileExtension}`;

            // Create attachment record
            const attachment = await attachmentRepository.create(
                documentId,
                filename,
                minioPath,
                mimeType,
                size,
                req.user.userId
            );

            logAudit('attachment_initiated', req.user.userId, {
                attachmentId: attachment.id,
                documentId,
                filename,
                size
            });

            // Return upload endpoint instead of presigned URL
            res.status(201).json({
                attachmentId: attachment.id,
                uploadUrl: `/api/editor-service/api/v1/attachments/${attachment.id}/upload`,
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * PUT /attachments/:id/upload - Upload attachment file
 */
router.put('/:id/upload',
    authenticateToken,
    validateParams(attachmentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const attachment = await attachmentRepository.getById(id);
            if (!attachment) {
                throw new NotFoundError('Attachment not found');
            }

            // Check write access
            const hasAccess = await documentRepository.checkWriteAccess(
                attachment.document_id,
                req.user.userId
            );
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

            // Collect the file data from request body
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', async () => {
                try {
                    const buffer = Buffer.concat(chunks);

                    // Upload to MinIO
                    await minioService.upload(
                        config.minio.buckets.attachments,
                        attachment.minio_path,
                        buffer,
                        attachment.content_type
                    );

                    logAudit('attachment_uploaded', req.user.userId, {
                        attachmentId: id,
                        documentId: attachment.document_id,
                        filename: attachment.filename,
                        size: buffer.length
                    });

                    res.json({ 
                        message: 'File uploaded successfully',
                        attachmentId: id 
                    });
                } catch (uploadErr) {
                    apiLogger.error('Failed to upload to MinIO', {
                        attachmentId: id,
                        error: uploadErr.message
                    });
                    next(uploadErr);
                }
            });

            req.on('error', (err) => {
                apiLogger.error('Request error during upload', {
                    attachmentId: id,
                    error: err.message
                });
                next(err);
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /attachments/:id - Get attachment metadata and download URL
 */
router.get('/:id',
    authenticateToken,
    validateParams(attachmentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const attachment = await attachmentRepository.getById(id);
            if (!attachment) {
                throw new NotFoundError('Attachment not found');
            }

            // Check access
            const hasAccess = await attachmentRepository.checkAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this attachment');
            }

            // Generate presigned download URL (valid for 1 hour)
            const downloadUrl = await minioService.generateDownloadUrl(
                config.minio.buckets.attachments,
                attachment.minio_path,
                3600
            );

            res.json({
                id: attachment.id,
                documentId: attachment.document_id,
                filename: attachment.filename,
                contentType: attachment.content_type,
                size: attachment.size_bytes,
                uploadedBy: attachment.uploaded_by,
                createdAt: attachment.created_at,
                downloadUrl,
                expiresIn: 3600
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /documents/:documentId/attachments - Get all attachments for document
 */
router.get('/documents/:documentId',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { documentId } = req.params;

            // Check document access
            const hasAccess = await documentRepository.checkAccess(documentId, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this document');
            }

            const attachments = await attachmentRepository.getByDocumentId(documentId);

            // Generate download URLs for all attachments
            const attachmentsWithUrls = await Promise.all(
                attachments.map(async (attachment) => {
                    const downloadUrl = await minioService.generateDownloadUrl(
                        config.minio.buckets.attachments,
                        attachment.minio_path,
                        3600
                    );

                    return {
                        id: attachment.id,
                        documentId: attachment.document_id,
                        filename: attachment.filename,
                        contentType: attachment.content_type,
                        size: attachment.size_bytes,
                        uploadedBy: attachment.uploaded_by,
                        createdAt: attachment.created_at,
                        downloadUrl,
                        expiresIn: 3600
                    };
                })
            );

            res.json({ attachments: attachmentsWithUrls });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * DELETE /attachments/:id - Delete attachment
 */
router.delete('/:id',
    authenticateToken,
    validateParams(attachmentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const attachment = await attachmentRepository.getById(id);
            if (!attachment) {
                throw new NotFoundError('Attachment not found');
            }

            // Check write access to document
            const hasAccess = await documentRepository.checkWriteAccess(
                attachment.document_id,
                req.user.userId
            );
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

            // Delete from MinIO
            try {
                await minioService.delete(
                    config.minio.buckets.attachments,
                    attachment.minio_path
                );
            } catch (err) {
                apiLogger.warn('Failed to delete attachment from MinIO', {
                    attachmentId: id,
                    error: err.message
                });
            }

            // Delete from database
            await attachmentRepository.delete(id);

            logAudit('attachment_deleted', req.user.userId, {
                attachmentId: id,
                documentId: attachment.document_id,
                filename: attachment.filename
            });

            res.json({ message: 'Attachment deleted successfully' });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
