# Video Suite

Video Suite combines the production workspace and YouTube channel management. Open `/video-suite`; existing `/video-studio` links continue to work. YouTube remains at `/youtube`. The Video Suite steps are nested in the shared SiteOps navigation on every page.

1. Create/select a project under Settings and choose narration language and voice.
2. Select OpenAI or NVIDIA Playground for the text agent under Video Suite → Settings. Provider keys are encrypted using SiteOps' existing master key. `OPENAI_API_KEY` can still be supplied on the SiteOps application server. OpenAI remains the image-generation and visual-quality-review provider; its key is needed for both features. The runner's optional speech API key remains separate.
3. Describe a video in Creative Agent, or use a script, editing, SEO, thumbnail or social preset. Conversations belong to the selected project and can be reopened.
4. Review a generated production proposal and adopt it into the working draft. Edit narration and scene order visually; verified browser-demo actions remain available in the advanced editor.
5. Prepare SEO and thumbnails. Save the production draft, render it, check the results, then choose “An YouTube übergeben”. YouTube retains its preview and approval flow.

Working drafts autosave online per project. Opening an existing production creates a working copy; saving produces a new production record. Generated thumbnail illustrations are stored online, cropped to 1280×720 in the preview, and can be passed to YouTube without a manual download. Authentic screenshots and portraits can still be uploaded through YouTube's existing thumbnail control.

## Agent scope

The local producer instructions incorporate the scripting, retention and scene-planning principles of Faceless Video Maker and the honest composition, mobile readability and title/thumbnail pairing principles of YouTube Thumbnail Creator. They are application instructions; the installed plugins and MCP are not runtime requirements.

The text agent uses OpenAI Responses or NVIDIA Playground Chat Completions, depending on the selected provider. Both calls happen from the server and return the same validated advice, optional complete draft, thumbnail prompt and social posts. Thumbnail illustrations and visual quality reviews still use OpenAI. NVIDIA API Catalog availability and account access are controlled by NVIDIA.

Visual directions are planning notes; the renderer currently makes text slides or configured browser demos. Completed videos can be reviewed in the production workspace with a protected streaming preview.

The agent does not browse the web, execute arbitrary code or automatically publish. Editing is scene-based narration, order and visual direction, using the existing renderer; this is not a frame-accurate timeline editor. Image generation makes original illustrations without reference-image editing. It must not invent product interfaces, analytics, features or a user's likeness. Estimated chapter times should be checked against the completed render.

Text providers are configurable. OpenAI defaults to `gpt-4.1`; NVIDIA Playground defaults to `nvidia/nemotron-3.5-super-vl-120b-a12b`. Model IDs can be loaded from the selected provider and entered manually. Use the connection test to check access and structured-output compatibility. NVIDIA model and endpoint availability can change. Image generation uses OpenAI with `gpt-image-1` by default. NVIDIA text requests count toward token limits; when a USD spend limit is enabled, add a price entry for the selected `nvidia:<model>` before sending requests.

## Operations

The new SQL migration creates working drafts, conversations and image assets. Routes inherit dashboard authentication and CSRF protection. New writes additionally validate JSON/origin, bound inputs and rate-limit generation requests. Only the server contacts the fixed OpenAI or NVIDIA API origins. Keys and raw provider errors are never returned. `store:false` is sent on OpenAI Responses requests; conversation continuity is managed in the SiteOps database.

Official API references:
- https://developers.openai.com/api/reference/responses/overview
- https://developers.openai.com/api/docs/guides/image-generation
- https://docs.api.nvidia.com/nim/reference/llm-apis
