import { z } from 'zod';

export const uuidSchema = z.string().uuid('Invalid UUID format');

export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const createDocumentSchema = z.object({
    title: z
        .string()
        .min(1, 'Title is required')
        .max(500, 'Title must be less than 500 characters')
        .trim()
        .default('Untitled Document'),
    vaultId: uuidSchema.optional().nullable(),
    parentId: uuidSchema.optional().nullable(),
    isFolder: z.boolean().default(false),
    icon: z
        .string()
        .max(10, 'Icon must be less than 10 characters')
        .optional()
        .nullable(),
});

export const updateDocumentSchema = z.object({
    title: z
        .string()
        .min(1, 'Title cannot be empty')
        .max(500, 'Title must be less than 500 characters')
        .trim()
        .optional(),
    icon: z
        .string()
        .max(10, 'Icon must be less than 10 characters')
        .optional()
        .nullable(),
    parentId: uuidSchema.optional().nullable(),
});

export const moveDocumentSchema = z.object({
    parentId: uuidSchema.nullable(),
});

export const documentIdParamSchema = z.object({
    id: uuidSchema,
});

export const createVaultSchema = z.object({
    name: z
        .string()
        .min(1, 'Vault name is required')
        .max(255, 'Vault name must be less than 255 characters')
        .trim(),
    description: z
        .string()
        .max(1000, 'Description must be less than 1000 characters')
        .optional()
        .nullable(),
    icon: z
        .string()
        .max(10, 'Icon must be less than 10 characters')
        .default('📁'),
    color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
        .default('#6366f1'),
});

export const updateVaultSchema = z.object({
    name: z
        .string()
        .min(1, 'Vault name cannot be empty')
        .max(255, 'Vault name must be less than 255 characters')
        .trim()
        .optional(),
    description: z
        .string()
        .max(1000, 'Description must be less than 1000 characters')
        .optional()
        .nullable(),
    icon: z
        .string()
        .max(10, 'Icon must be less than 10 characters')
        .optional(),
    color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
        .optional(),
    settings: z.record(z.unknown()).optional(),
});

export const vaultIdParamSchema = z.object({
    id: uuidSchema,
});

export const permissionEnum = z.enum(['read', 'write', 'admin']);

export const shareVaultSchema = z.object({
    userId: uuidSchema,
    permission: permissionEnum,
});

export const shareDocumentSchema = z.object({
    userId: uuidSchema,
    permission: permissionEnum,
});

export const uploadAttachmentSchema = z.object({
    documentId: uuidSchema,
});

export const attachmentQuerySchema = z.object({
    documentId: uuidSchema.optional(),
});

export const wsAuthSchema = z.object({
    token: z.string().min(1, 'Token is required'),
    documentId: uuidSchema,
});
