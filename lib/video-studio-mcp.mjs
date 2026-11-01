import * as z from 'zod/v4';
import { finalVideoSchema } from './video-final-assets.mjs';
import {
  projectSchema,
  projectChangesSchema,
  videoJobSchema,
  metadataSchema,
  templateSchema
} from './video-production.mjs';

export function registerVideoStudioTools(server, service, text) {
  const register = (name, description, schema, run, readOnly = false) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: !readOnly }
      },
      async input => {
        try {
          return text(await run(service(), schema.parse(input)));
        } catch (error) {
          if (error instanceof z.ZodError)
            return {
              ...text({ error: error.issues.map(x => x.path.join('.') + ': ' + x.message).join('; '), status: 422 }),
              isError: true
            };
          return {
            ...text({
              error:
                error.statusCode && error.statusCode < 500
                  ? error.message
                  : 'Video Studio konnte die Anfrage nicht abschließen. Verbindung und Konfiguration prüfen.',
              status: error.statusCode || 500
            }),
            isError: true
          };
        }
      }
    );
  register(
    'video_studio_projects',
    'List existing projects. Reuse a matching channel/language/voice project before creating one.',
    z.object({}),
    s => s.listProjects(),
    true
  );
  register(
    'video_studio_create_project',
    'Create an English or German Video Studio project. English defaults to Kokoro Adam; German to Piper Thorsten. OpenAI Audio supports both.',
    projectSchema,
    (s, x) => s.createProject(x)
  );
  register(
    'video_studio_update_project',
    'Update project settings; existing video jobs, files and saved render settings remain intact.',
    z.object({ id: z.uuid(), changes: projectChangesSchema }),
    (s, x) => s.updateProject(x.id, x.changes)
  );
  register(
    'video_studio_runner_status',
    'Check renderer connection, supported languages, available voices and model readiness. Does not download models or start rendering.',
    z.object({}),
    s => s.capabilities(),
    true
  );
  register(
    'video_studio_list_jobs',
    'List a project’s jobs with pagination. Continue with offset until an empty page for complete history.',
    z.object({
      project_id: z.uuid(),
      limit: z.number().int().min(1).max(100).default(100),
      offset: z.number().int().min(0).max(100000).default(0)
    }),
    (s, x) => s.listJobs(x.project_id, x),
    true
  );
  register(
    'video_studio_create_job',
    'Read video_production_guidelines_get with project_id for the effective project production rules before planning. Create an English or German draft, landscape 16:9 or portrait 9:16. Research product features using connected read-only tools first. Supply verified source URLs, authored narration, visual_directions and YouTube metadata. Demo scenes require approved demo domains and test_data_only=true. Never operate on live customer data. Show the complete draft to the user and obtain explicit approval before rendering.',
    videoJobSchema,
    (s, x) => s.createJob(x)
  );
  register(
    'video_studio_render_job',
    'Start the private renderer only after explicit human approval of this exact draft. Set approved=true only after the user has approved it. This does not publish to YouTube.',
    z.object({ id: z.uuid(), approved: z.literal(true) }),
    (s, x) => s.renderJob(x.id)
  );
  register(
    'video_studio_job_status',
    'Read render progress, errors and completed file types. Does not start another job.',
    z.object({ id: z.uuid() }),
    (s, x) => s.refreshJob(x.id),
    true
  );
  register(
    'video_studio_downloads',
    'Return available completed video/short/subtitles/thumbnail/metadata files with authenticated, time-limited download URLs. Do not publish or expose them to third parties.',
    z.object({ id: z.uuid() }),
    (s, x) => s.downloads(x.id),
    true
  );
  register(
    'video_studio_demo_templates',
    'List reusable demo scenes containing only approved test-domain actions. Preserve their test-data restriction when reusing a template_id.',
    z.object({}),
    s => s.listDemoTemplates(),
    true
  );
  register(
    'video_studio_save_demo_template',
    'Create or update a reusable demo scene using only approved domains, test accounts and test data. No passwords or live customer actions. Existing jobs keep a snapshot.',
    templateSchema.extend({ id: z.uuid().optional() }),
    (s, { id, ...data }) => s.saveDemoTemplate(data, id)
  );
  register(
    'video_studio_import_final',
    'Import a checksum-verified edited MP4 up to 5 MiB for a completed production. Preserves runner originals and earlier final versions. The latest final is used for video previews, downloads and future private YouTube upload previews. Existing upload approvals remain pinned to their exact source. Does not upload to YouTube.',
    finalVideoSchema.extend({ job_id: z.uuid() }),
    (s, { job_id, ...file }) => s.importFinalVideo(job_id, file)
  );
  register(
    'video_studio_update_metadata',
    'Save an authored SEO title, description, keywords, hashtags, chapter marks, thumbnail concept and verified research sources. Does not render or publish.',
    z.object({ id: z.uuid(), youtube: metadataSchema }),
    (s, x) => s.updateMetadata(x.id, x.youtube)
  );
}
