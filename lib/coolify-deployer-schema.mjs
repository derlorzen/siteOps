import * as z from 'zod/v4';
import { safeMount } from './coolify-analyze.mjs';

export const resourceId = z.string().regex(/^[a-zA-Z0-9_-]{4,191}$/);
export const deploymentIdSchema = z.object({ id: z.uuid() });
export const executeSchema = deploymentIdSchema.extend({
  approve: z.literal(true),
  approveRisks: z.boolean().default(false),
  riskAcknowledgement: z.string().trim().min(10).max(1000).optional()
});
export const projectEnsureSchema = z.object({ connectionId: z.uuid(), name: z.string().trim().min(1).max(190) });
export const siteopsProjectEnsureSchema = z.object({
  name: z.string().trim().min(1).max(190),
  customerId: z.uuid().optional()
});
export const planSchema = z.object({
  connectionId: z.uuid(),
  name: z.string().trim().min(2).max(190),
  domain: z
    .string()
    .toLowerCase()
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  projectName: z.string().trim().min(1).max(190),
  siteopsProjectId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  coolifyProjectUuid: resourceId.optional(),
  coolifyProjectName: z.string().trim().min(1).max(190).optional(),
  serverUuid: resourceId.optional(),
  destinationUuid: resourceId.optional(),
  environmentName: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/)
    .default('production'),
  sourceKind: z.enum(['git', 'image', 'dockerfile', 'compose']).default('git'),
  url: z.url().max(700).optional(),
  gitRepository: z.string().max(512).optional(),
  gitBranch: z
    .string()
    .regex(/^[\w./-]{1,190}$/)
    .optional(),
  gitCommit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  sourceType: z.enum(['public', 'private-deploy-key', 'private-github-app']).default('public'),
  sourceUuid: resourceId.optional(),
  image: z
    .string()
    .max(255)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/)
    .optional(),
  imageTag: z
    .string()
    .regex(/^[\w.-]{1,128}$/)
    .default('latest'),
  dockerfile: z.string().min(10).max(100000).optional(),
  compose: z.string().min(10).max(150000).optional(),
  buildPack: z.enum(['auto', 'dockerfile', 'dockercompose', 'nixpacks', 'railpack', 'static']).default('auto'),
  containerPort: z.number().int().min(1).max(65535).optional(),
  composeService: z
    .string()
    .regex(/^[a-zA-Z0-9][\w.-]{0,62}$/)
    .optional(),
  dockerfileLocation: z
    .string()
    .regex(/^\/[a-zA-Z0-9_./-]+$/)
    .optional(),
  dockerComposeLocation: z
    .string()
    .regex(/^\/[a-zA-Z0-9_./-]+\.ya?ml$/)
    .optional(),
  baseDirectory: z
    .string()
    .regex(/^\/[a-zA-Z0-9_./-]*$/)
    .default('/'),
  publishDirectory: z
    .string()
    .regex(/^[a-zA-Z0-9_./-]+$/)
    .optional(),
  environment: z
    .array(
      z.object({
        key: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/),
        value: z.string().max(8000),
        buildTime: z.boolean().default(false)
      })
    )
    .max(100)
    .default([]),
  volumes: z
    .array(
      z.object({ name: z.string().regex(/^[a-zA-Z0-9][\w-]{0,62}$/), mountPath: z.string().max(190).refine(safeMount) })
    )
    .max(20)
    .default([]),
  access: z.enum(['basic', 'application', 'public-static']).default('basic'),
  authUsername: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .optional(),
  authPassword: z.string().min(16).max(200).optional(),
  applicationAuthEvidence: z.string().trim().min(20).max(1000).optional(),
  memoryMb: z.number().int().min(128).max(131072).default(1024),
  cpus: z.number().min(0.1).max(64).default(1),
  diskMb: z.number().int().min(256).max(1048576).default(2048),
  healthPath: z
    .string()
    .max(300)
    .regex(/^\/[a-zA-Z0-9_./%-]*$/)
    .default('/'),
  healthStatus: z.number().int().min(200).max(299).default(200),
  healthText: z.string().max(300).optional(),
  allinklAccountId: z.uuid().optional(),
  reviewEvidence: z.string().trim().min(20).max(3000).optional()
});
