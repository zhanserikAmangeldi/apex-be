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

            if (size > MAX_FILE_SIZE) {
                throw new ValidationError(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
            }

            if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
                apiLogger.warn('Rejected file upload - unsupported MIME type', {
                    mimeType,
                    filename,
                    userId: req.user.userId
                });
                throw new ValidationError(`File type "${mimeType}" is not allowed. Please upload a supported file type.`);
            }

            const hasAccess = await documentRepository.checkWriteAccess(documentId, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

            const attachmentId = crypto.randomUUID();
            const fileExtension = filename.split('.').pop();
            const minioPath = `${documentId}/${attachmentId}.${fileExtension}`;

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

            const hasAccess = await documentRepository.checkWriteAccess(
                attachment.document_id,
                req.user.userId
            );
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', async () => {
                try {
                    const buffer = Buffer.concat(chunks);

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

            const hasAccess = await attachmentRepository.checkAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this attachment');
            }

            const downloadUrl = `http://localhost:3000/public/attachments/${id}/download`;

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
 * GET /attachments/:id/download - Download attachment file (proxy)
 */
router.get('/:id/download',
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');

            console.log('Download request:', {
                id,
                hasToken: !!token,
                tokenLength: token?.length,
                query: req.query,
                headers: req.headers.authorization
            });

            if (!token) {
                console.log('No token provided');
                throw new UnauthorizedError('No authentication token provided');
            }

            let userId;
            try {
                console.log('Verifying token with auth service...');
                const response = await fetch(`${config.auth.serviceUrl}/api/v1/auth/verify`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                console.log('Auth service response:', response.status);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.log('Auth service error:', errorText);
                    throw new UnauthorizedError('Invalid token');
                }
                
                const data = await response.json();
                userId = data.user_id;
                console.log('Token verified for user:', userId);
            } catch (error) {
                console.error('Token verification failed:', error);
                throw new UnauthorizedError('Token verification failed');
            }

            const attachment = await attachmentRepository.getById(id);
            if (!attachment) {
                throw new NotFoundError('Attachment not found');
            }

            const hasAccess = await attachmentRepository.checkAccess(id, userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this attachment');
            }

            console.log('Downloading file from MinIO:', attachment.minio_path);

            const fileBuffer = await minioService.download(
                config.minio.buckets.attachments,
                attachment.minio_path
            );

            console.log('File downloaded, size:', fileBuffer.length);

            res.setHeader('Content-Type', attachment.content_type || 'application/octet-stream');
            res.setHeader('Content-Length', fileBuffer.length);
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
            res.setHeader('Cache-Control', 'private, max-age=3600');

            res.send(fileBuffer);
        } catch (err) {
            console.error('Download error:', err);
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

            const hasAccess = await documentRepository.checkAccess(documentId, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this document');
            }

            const attachments = await attachmentRepository.getByDocumentId(documentId);

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

            const hasAccess = await documentRepository.checkWriteAccess(
                attachment.document_id,
                req.user.userId
            );
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

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
