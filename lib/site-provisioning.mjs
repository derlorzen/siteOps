import * as z from 'zod/v4';

// A deployment target is a project directory, never the FTP account root.
export const hostingTargetSchema = z
  .string()
  .trim()
  .min(2)
  .max(500)
  .refine(
    path =>
      path.startsWith('/') &&
      path !== '/' &&
      !path.endsWith('/') &&
      !path.includes('\\') &&
      path
        .slice(1)
        .split('/')
        .every(part => part && part !== '.' && part !== '..' && !/\p{Cc}/u.test(part)),
    'Absolutes Unterverzeichnis ohne leere, .- oder ..-Segmente erforderlich.'
  );

export const websiteProvisionSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{1,100}$/),
    name: z.string().trim().min(1).max(190),
    domain: z.string().trim().min(3).max(253).regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i),
    siteType: z.enum(['static', 'php']).default('static'),
    remoteRoot: hostingTargetSchema,
    profileId: z.uuid().optional(),
    existingSiteId: z.uuid().optional(),
    projectId: z.uuid().optional()
  })
  .refine(x => Boolean(x.profileId) !== Boolean(x.existingSiteId), {
    message: 'Genau ein gespeichertes Serverprofil oder eine bestehende Website als Verbindung auswählen.'
  });

// Never upload a new website over a populated directory. FTP and SFTP
// adapters create directories recursively; content is checked afterwards.
export async function prepareEmptyHostingTarget(remote, root) {
  const path = hostingTargetSchema.parse(root);
  await remote.ensureDirectory(path);
  const entries = await remote.list(path);
  if (entries.some(entry => !['.', '..'].includes(entry.name))) {
    throw new Error('Zielverzeichnis ist nicht leer. Bitte ein neues Verzeichnis wählen.');
  }
  return { remoteRoot: path, empty: true };
}
