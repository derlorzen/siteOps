import * as z from 'zod/v4';
const siteCommonSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  domain: z.string().min(1),
  siteType: z.enum(['wordpress', 'php', 'static', 'node']).default('php'),
  monitorUrl: z.string().url().optional(),
  backupEnabled: z.boolean().optional(),
  backupIntervalSeconds: z.coerce.number().int().min(900).max(2592000).optional(),
  backupMaxFiles: z.coerce.number().int().min(100).max(200000).optional(),
  monitorEnabled: z.boolean().optional(),
  monitorIntervalSeconds: z.coerce.number().int().min(30).max(86400).optional(),
  monitorFailureThreshold: z.coerce.number().int().min(1).max(20).optional(),
  sslWarnDays: z.coerce.number().int().min(1).max(365).optional()
});
const webspaceSiteSchema = siteCommonSchema.extend({
  deploymentMode: z.literal('webspace'),
  protocol: z.enum(['sftp', 'ftps', 'ftp']),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  remoteRoot: z.string().min(1),
  profileId: z.uuid().optional(),
  sourceRepository: z.string().optional(),
  sourceBranch: z.string().optional(),
  sourceRoot: z.string().optional(),
  gitToken: z.string().optional(),
  hostingerTargetDirectory: z.string().optional()
});
const hostingerGitSiteSchema = siteCommonSchema.extend({
  deploymentMode: z.literal('hostinger_git'),
  sourceRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  sourceBranch: z.string().min(1),
  sourceRoot: z.string().optional(),
  gitToken: z.string().min(1),
  hostingerTargetDirectory: z.string().optional(),
  protocol: z.enum(['sftp', 'ftps', 'ftp']).optional(),
  host: z.string().optional(),
  port: z.coerce.number().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  remoteRoot: z.string().optional()
});
export const siteCreateSchema = z.discriminatedUnion('deploymentMode', [webspaceSiteSchema, hostingerGitSiteSchema]);
