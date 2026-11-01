# UI-/MCP-Abdeckungsmatrix

Automatisch aus den tatsächlichen Fastify-Routen, der zentralen MCP-Registrierung und den ausdrücklich geprüften Ausnahmen in `lib/ui-capabilities.json` erzeugt. Neu erzeugen: `npm run capabilities`. Neue oder entfernte API-Routen sowie nicht existierende MCP-Tools lassen den Abdeckungstest fehlschlagen.

Bestand: 271 API-Funktionen, 240 MCP-Tools, 41 begründete Dashboard-Ausnahmen. „Zugeordnet“ bezeichnet fachliche Adapterabdeckung, keine erfolgreiche Live-Prüfung eines externen Providers oder Clients.

Die UI-Funktion wird durch API-Methode und Pfad eindeutig bezeichnet. Der UI-Einstieg und Service benennen ihren Arbeitskontext. Bei zusammengesetzten Abläufen können mehrere Tool-Aufrufe erforderlich sein. Einzelne Credential- und Binärtransferwege bleiben bewusst im Dashboard.

| Modul | UI-Einstieg / Funktion | Geschäftsprozess / Service | API | MCP | Recht | Freigabe | Stand | Abweichung |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ai | /ai | ai.configure | PUT /api/ai/limits | ai_limits_update | Ändern | Gebundene Freigabe | Zugeordnet |  |
| ai | /ai | ai.overview | GET /api/ai/usage | ai_usage_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/invoices | billing.archiveManifest | GET /api/billing/archive-manifest/:year | invoice_archive_manifest | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.board.getBoard | GET /api/billing/boards/:projectId | project_board | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.board.saveBoard | PUT /api/billing/boards/:projectId | project_board_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/customers | billing.editClient | PATCH /api/billing/customers/:id | customer_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/customers | billing.clients | GET /api/billing/customers | customers_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/customers | billing.createClient | POST /api/billing/customers | customer_create | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/invoices | billing.datevCsv | GET /api/billing/datev/:year.csv | invoice_datev_export | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.dueTasks | GET /api/billing/due | tasks_due | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/time | billing.deleteEntry | DELETE /api/billing/entries/:id | time_entry_delete | Ändern | Gebundene Freigabe | Zugeordnet |  |
| billing | /billing/time | billing.editEntry | PATCH /api/billing/entries/:id | time_entry_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/time | billing.entries | GET /api/billing/entries | time_entries | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/time | billing.createEntry | POST /api/billing/entries | time_entry_create | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/invoices | billing.pdf | GET /api/billing/invoices/:id/cancellation-pdf | invoice_document | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/invoices | billing.cancel | POST /api/billing/invoices/:id/cancel | invoice_cancel | Ändern | Gebundene Freigabe | Zugeordnet |  |
| billing | /billing/invoices | billing.issue | POST /api/billing/invoices/:id/issue | invoice_issue | Ändern | Gebundene Freigabe | Zugeordnet |  |
| billing | /billing/invoices | billing.mailHistory | GET /api/billing/invoices/:id/mail-history | invoice_mail_history | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/invoices | billing.paid | POST /api/billing/invoices/:id/pay | invoice_mark_paid | Ändern | Gebundene Freigabe | Zugeordnet |  |
| billing | /billing/invoices | billing.pdf | GET /api/billing/invoices/:id/pdf | invoice_document | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/invoices | billing.deliver | POST /api/billing/invoices/:id/send | invoice_send | Ändern | Gebundene Freigabe | Zugeordnet |  |
| billing | /billing/invoices | billing.discard | DELETE /api/billing/invoices/:id | invoice_draft_discard | Ändern | Gebundene Freigabe | Zugeordnet |  |
| billing | /billing/invoices | billing.details | GET /api/billing/invoices/:id | invoice_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/invoices | billing.invoices | GET /api/billing/invoices | invoices_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/invoices | billing.createDraft | POST /api/billing/invoices | invoice_draft_create | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.editProject | PATCH /api/billing/projects/:id | project_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.listRules | GET /api/billing/projects/:projectId/recurring | project_recurring_rules | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.addRule | POST /api/billing/projects/:projectId/recurring | project_recurring_add | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.applyTemplate | POST /api/billing/projects/:projectId/template | project_template_apply | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.projects | GET /api/billing/projects | projects_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.createProject | POST /api/billing/projects | project_create | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.setRule | PATCH /api/billing/recurring/:id | project_recurring_toggle | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.runRecurring | POST /api/billing/recurring/run | project_recurring_run | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/settings | billing.settings | GET /api/billing/settings | billing_settings_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/settings | billing.saveSettings | POST /api/billing/settings | billing_settings_update | Ändern | Gebundene Freigabe | Zugeordnet |  |
| billing | /billing | billing.removeItem | DELETE /api/billing/tasks/:id/checklist/:itemId | task_checklist_remove | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.checkItem | PATCH /api/billing/tasks/:id/checklist/:itemId | task_checklist_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.addChecklist | POST /api/billing/tasks/:id/checklist | task_checklist_add | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.comment | POST /api/billing/tasks/:id/comments | task_comment_add | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.taskDetail | GET /api/billing/tasks/:id/detail | task_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.deleteFile | DELETE /api/billing/tasks/:id/files/:fileId | task_file_remove | Ändern | Gebundene Freigabe | Zugeordnet |  |
| billing | /billing | billing.download | GET /api/billing/tasks/:id/files/:fileId | task_file_read | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.upload | POST /api/billing/tasks/:id/files | task_file_upload | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.editTask | PATCH /api/billing/tasks/:id | task_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.tasks | GET /api/billing/tasks | tasks_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.createTask | POST /api/billing/tasks | task_create | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.templates | GET /api/billing/templates | project_templates | Lesen | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/time | billing.stopTimer | POST /api/billing/timer/:id/stop | timer_stop | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing/time | billing.startTimer | POST /api/billing/timer/start | timer_start | Ändern | Keine zusätzliche | Zugeordnet |  |
| billing | /billing | billing.projects | GET /api/tools/projects | projects_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| cms | /lorzcms | cms_inspect | POST /api/lorzcms/installations/:id/inspect | cms_inspect | Lesen | Keine zusätzliche | Zugeordnet |  |
| cms | /lorzcms | cms_attach | POST /api/lorzcms/installations/attach | cms_attach | Ändern | Gebundene Freigabe | Zugeordnet |  |
| cms | /lorzcms | cms_install | POST /api/lorzcms/installations | cms_install | Ändern | Gebundene Freigabe | Zugeordnet |  |
| cms | /lorzcms | cms_job_cancel | POST /api/lorzcms/jobs/:id/cancel | cms_job_cancel | Ändern | Keine zusätzliche | Zugeordnet |  |
| cms | /lorzcms | cms_job_retry | POST /api/lorzcms/jobs/:id/retry | cms_job_retry | Ändern | Gebundene Freigabe | Zugeordnet |  |
| cms | /lorzcms | cms_rollback | POST /api/lorzcms/jobs/:id/rollback | cms_rollback | Ändern | Gebundene Freigabe | Zugeordnet |  |
| cms | /lorzcms | cms_overview | GET /api/lorzcms/overview | cms_overview | Lesen | Keine zusätzliche | Zugeordnet |  |
| cms | /lorzcms | cms_release_bundled | POST /api/lorzcms/releases/bundled | cms_release_bundled | Ändern | Gebundene Freigabe | Zugeordnet |  |
| cms | /lorzcms | cms_update_schedule | POST /api/lorzcms/updates | cms_update_schedule | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /coolify | coolify_app_adopt | POST /api/coolify/adopt | coolify_app_adopt | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /coolify | coolify_app_analyze | POST /api/coolify/analyze | coolify_app_analyze | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_app_deploy | POST /api/coolify/applications/:uuid/deploy | coolify_app_deploy | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /coolify | coolify_app_restart | POST /api/coolify/applications/:uuid/restart | coolify_app_restart | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /coolify | coolify_app_create | POST /api/coolify/applications | coolify_app_create | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /mcp-info | Dashboard-Administration | DELETE /api/coolify/commands/:id | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Änderung der Remote-Befehlsfreigaben bleibt im Dashboard. |
| coolify | /coolify | coolify_command_run | POST /api/coolify/commands/run | coolify_command_run | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /mcp-info | Dashboard-Administration | POST /api/coolify/commands | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Vertrauensgrenze: Nur Administratoren definieren die ausführbaren Remote-Befehle. MCP darf die erlaubte Befehlsliste nicht selbst erweitern. |
| coolify | /coolify | coolify_app_logs | GET /api/coolify/connections/:id/applications/:uuid/logs | coolify_app_logs | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_app_info | GET /api/coolify/connections/:id/applications/:uuid | coolify_app_info | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_apps_list | GET /api/coolify/connections/:id/applications | coolify_apps_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_command_list | GET /api/coolify/connections/:id/commands | coolify_command_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_connection_info | GET /api/coolify/connections/:id/info | coolify_connection_info | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_environments_list | GET /api/coolify/connections/:id/projects/:uuid/environments | coolify_environments_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_projects_list | GET /api/coolify/connections/:id/projects | coolify_projects_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_service_info | GET /api/coolify/connections/:id/services/:uuid | coolify_service_info | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_services_list | GET /api/coolify/connections/:id/services | coolify_services_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_sources_list | GET /api/coolify/connections/:id/sources | coolify_sources_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_targets | GET /api/coolify/connections/:id/targets | coolify_targets | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /mcp-info | Dashboard-Administration | PUT /api/coolify/connections/:id | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Einrichtung oder Entfernung eines Zugangsdaten enthaltenden Providerkontos bleibt im Dashboard. MCP verwendet ausschließlich die gespeicherten Verbindungen. |
| coolify | /coolify | coolify_connections | GET /api/coolify/connections | coolify_connections | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /mcp-info | Dashboard-Administration | POST /api/coolify/connections | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Einrichtung oder Entfernung eines Zugangsdaten enthaltenden Providerkontos bleibt im Dashboard. MCP verwendet ausschließlich die gespeicherten Verbindungen. |
| coolify | /coolify | coolify_deployment_status | GET /api/coolify/installations/:id/deployment | coolify_deployment_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_install_execute | POST /api/coolify/installations/:id/execute | coolify_install_execute | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /coolify | coolify_install_logs | GET /api/coolify/installations/:id/logs | coolify_install_logs | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_app_redeploy | POST /api/coolify/installations/:id/redeploy | coolify_app_redeploy | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /coolify | coolify_app_status | GET /api/coolify/installations/:id | coolify_app_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_installations_list | GET /api/coolify/installations | coolify_installations_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_app_plan | POST /api/coolify/plans | coolify_app_plan | Ändern | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_project_create | POST /api/coolify/projects | coolify_project_create | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /coolify | coolify_supabase_retry | POST /api/coolify/supabase/:id/retry | coolify_supabase_retry | Ändern | Gebundene Freigabe | Zugeordnet |  |
| coolify | /coolify | coolify_supabase_status | GET /api/coolify/supabase/:id | coolify_supabase_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_supabase_list | GET /api/coolify/supabase | coolify_supabase_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| coolify | /coolify | coolify_supabase_create | POST /api/coolify/supabase | coolify_supabase_create | Ändern | Gebundene Freigabe | Zugeordnet |  |
| fix | /mcp-info | fix_prompt | POST /api/fix-prompt | fix_prompt | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /hosting | allinkl_diagnostics | GET /api/hosting/allinkl/accounts/:id/diagnostics | allinkl_diagnostics | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /hosting | hosting.removeRecord | DELETE /api/hosting/allinkl/accounts/:id/dns/:recordId | allinkl_dns_remove | Ändern | Gebundene Freigabe | Zugeordnet |  |
| hosting | /hosting | allinkl_dns_update | PUT /api/hosting/allinkl/accounts/:id/dns/:recordId | allinkl_dns_update | Ändern | Gebundene Freigabe | Zugeordnet |  |
| hosting | /hosting | allinkl_dns_list | GET /api/hosting/allinkl/accounts/:id/dns | allinkl_dns_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /hosting | allinkl_dns_add | POST /api/hosting/allinkl/accounts/:id/dns | allinkl_dns_add | Ändern | Gebundene Freigabe | Zugeordnet |  |
| hosting | /hosting | allinkl_domains | GET /api/hosting/allinkl/accounts/:id/domains | allinkl_domains | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /hosting | hosting.subdomains | GET /api/hosting/allinkl/accounts/:id/subdomains | allinkl_subdomains | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /mcp-info | Dashboard-Administration | DELETE /api/hosting/allinkl/accounts/:id | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Einrichtung oder Entfernung eines Zugangsdaten enthaltenden Providerkontos bleibt im Dashboard. MCP verwendet ausschließlich die gespeicherten Verbindungen. |
| hosting | /hosting | allinkl_accounts | GET /api/hosting/allinkl/accounts | allinkl_accounts | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /mcp-info | Dashboard-Administration | POST /api/hosting/allinkl/accounts | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Einrichtung oder Entfernung eines Zugangsdaten enthaltenden Providerkontos bleibt im Dashboard. MCP verwendet ausschließlich die gespeicherten Verbindungen. |
| hosting | /hosting | allinkl_provision | POST /api/hosting/allinkl/provision | allinkl_provision | Ändern | Gebundene Freigabe | Zugeordnet |  |
| hosting | /hosting | allinkl_ssl_status | GET /api/hosting/allinkl/ssl/:hostname | allinkl_ssl_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /hosting | allinkl_ssl_diagnostics | GET /api/hosting/allinkl/ssl/diagnostics | allinkl_ssl_diagnostics | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /hosting | allinkl_ssl_list | GET /api/hosting/allinkl/ssl | allinkl_ssl_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| hosting | /hosting | allinkl_ssl_enable | POST /api/hosting/allinkl/ssl | allinkl_ssl_enable | Ändern | Gebundene Freigabe | Zugeordnet |  |
| hosting | /hosting | server_profiles_list | GET /api/server-profiles | server_profiles_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| lorzcms | /mcp-info | Dashboard-Administration | POST /api/lorzcms/installations/:id/admin-recovery | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Persönliche Wiederherstellung: Das neue temporäre Passwort wird ausschließlich im geschützten Dashboard angezeigt. cms_admin_recovery liefert den Einstieg, setzt aber kein Passwort zurück und gibt keine Zugangsdaten an Agenten aus. |
| lorzcms | /mcp-info | Dashboard-Administration | POST /api/lorzcms/installations/:id/resume | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Erneute Hinterlegung von Installations-Zugangsdaten erfolgt nur im Dashboard. MCP verwendet cms_job_retry für vorhandene wiederaufnehmbare Aufträge. |
| lorzcms | /mcp-info | Dashboard-Administration | POST /api/lorzcms/releases | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Neue ausführbare Releasearchive werden nur nach manueller Artefaktprüfung im Dashboard registriert. MCP installiert und aktualisiert bereits bekannte Releases. |
| mcp | /mcp-info | audit.list | GET /api/audit-log | audit_log_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| mcp | /mcp-info | Dashboard-Administration | POST /api/mcp/approvals/:id/approve | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Persönliche Freigabegrenze: Ein KI-Agent darf seine eigenen kritischen Aktionen nicht freigeben. |
| mcp | /mcp-info | mcp.approvalStatus | GET /api/mcp/approvals | action_status | Lesen | Keine zusätzliche | Zugeordnet | Das Dashboard listet offene Freigaben für die persönliche Prüfung. MCP kann mit action_status ausschließlich den Zustand eigener, bereits bekannter Freigaben abfragen. |
| mcp | /mcp-info | mcp.catalog | GET /api/mcp/capabilities | capabilities_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| mcp | /mcp-info | Dashboard-Administration | POST /api/mcp/self-test | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Die Administration erzeugt ein temporäres OAuth-Testtoken für den internen HTTP-Test. KI-Clients testen ihre eigene Verbindung direkt mit Discovery und ungefährlichen Tools. |
| mcp | /mcp-info | oauth.connections | GET /api/oauth/connections | mcp_connections_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| oauth | /mcp-info | Dashboard-Administration | POST /api/oauth/revoke-all | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Anmeldung, Tokenfreigabe und Widerruf sind persönliche Sicherheitsentscheidungen im Dashboard oder beim OAuth-Client, keine vom Agenten ausführbaren Rechtevergaben. |
| oauth | /mcp-info | Dashboard-Administration | POST /api/oauth/revoke-client | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Anmeldung, Tokenfreigabe und Widerruf sind persönliche Sicherheitsentscheidungen im Dashboard oder beim OAuth-Client, keine vom Agenten ausführbaren Rechtevergaben. |
| search-console | /mcp-info | Dashboard-Administration | POST /api/search-console/accounts/:id/disconnect | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Trennen und erneutes Autorisieren eines Providerkontos bleibt im persönlichen Verbindungsdialog. MCP darf dadurch seine Sicherheitsgrenzen nicht selbst verändern. |
| search-console | /mcp-info | search_console_change_status | POST /api/search-console/change-status | search_console_change_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | Dashboard-Administration | POST /api/search-console/configure | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Einrichtung oder Entfernung eines Zugangsdaten enthaltenden Providerkontos bleibt im Dashboard. MCP verwendet ausschließlich die gespeicherten Verbindungen. |
| search-console | /mcp-info | search_console_change_execute | POST /api/search-console/execute | search_console_change_execute | Ändern | Gebundene Freigabe | Zugeordnet |  |
| search-console | /mcp-info | search_console_link | POST /api/search-console/link | search_console_link | Ändern | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | Dashboard-Administration | GET /api/search-console/oauth/callback | – | Lesen | Dashboard-Entscheidung | Begründete Ausnahme | Anmeldung, Tokenfreigabe und Widerruf sind persönliche Sicherheitsentscheidungen im Dashboard oder beim OAuth-Client, keine vom Agenten ausführbaren Rechtevergaben. |
| search-console | /mcp-info | Dashboard-Administration | POST /api/search-console/oauth/start | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Anmeldung, Tokenfreigabe und Widerruf sind persönliche Sicherheitsentscheidungen im Dashboard oder beim OAuth-Client, keine vom Agenten ausführbaren Rechtevergaben. |
| search-console | /mcp-info | search_console_status | GET /api/search-console/overview | search_console_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | search_console_change_preview | POST /api/search-console/previews | search_console_change_preview | Ändern | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | search_console_properties | GET /api/search-console/properties | search_console_properties | Lesen | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | search_console_inspect_url | POST /api/search-console/sites/:site/inspect | search_console_inspect_url | Lesen | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | search_console_performance | GET /api/search-console/sites/:site/performance | search_console_performance | Lesen | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | search_console_sync | POST /api/search-console/sites/:site/sync | search_console_sync | Ändern | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | search_console_unlink | POST /api/search-console/sites/:site/unlink | search_console_unlink | Ändern | Keine zusätzliche | Zugeordnet |  |
| search-console | /mcp-info | search_console_status | GET /api/search-console/status | search_console_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| seo | /websites | seo_page | GET /api/seo-pages/:id | seo_page | Lesen | Keine zusätzliche | Zugeordnet |  |
| seo | /websites | seo_run_status | GET /api/seo-runs/:id | seo_run_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| seo | /websites | seo_start | POST /api/sites/:site/seo-runs | seo_start | Ändern | Gebundene Freigabe | Zugeordnet |  |
| seo | /websites | seo_compare | GET /api/sites/:site/seo/compare | seo_compare | Lesen | Keine zusätzliche | Zugeordnet |  |
| seo | /websites | seo_graph | GET /api/sites/:site/seo/graph | seo_graph | Lesen | Keine zusätzliche | Zugeordnet |  |
| seo | /websites | seo_issues | GET /api/sites/:site/seo/issues | seo_issues | Lesen | Keine zusätzliche | Zugeordnet |  |
| seo | /websites | seo_latest | GET /api/sites/:site/seo/latest | seo_latest | Lesen | Keine zusätzliche | Zugeordnet |  |
| server-profiles | /mcp-info | Dashboard-Administration | DELETE /api/server-profiles/:id | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Einrichtung oder Entfernung eines Zugangsdaten enthaltenden Providerkontos bleibt im Dashboard. MCP verwendet ausschließlich die gespeicherten Verbindungen. |
| server-profiles | /mcp-info | Dashboard-Administration | POST /api/server-profiles/from-site | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Kopieren von Zugangsdaten zwischen Verbindungsprofilen bleibt ein administrativer Dashboard-Vorgang. |
| server-profiles | /mcp-info | Dashboard-Administration | GET /api/server-profiles/source-sites | – | Lesen | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Auswahl für die Übernahme verschlüsselter Verbindungsdaten. MCP verwendet die bereits freigegebenen Profile aus server_profiles_list. |
| server-profiles | /mcp-info | Dashboard-Administration | POST /api/server-profiles | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Einrichtung oder Entfernung eines Zugangsdaten enthaltenden Providerkontos bleibt im Dashboard. MCP verwendet ausschließlich die gespeicherten Verbindungen. |
| settings | /settings | settings_get | GET /api/build-info | settings_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| settings | /mcp-info | Dashboard-Administration | POST /api/settings/alert-test | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Versendet eine externe Testnachricht; die administrative Benachrichtigungseinrichtung bleibt im Dashboard. |
| settings | /mcp-info | Dashboard-Administration | POST /api/settings/browser-runner-test | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Neue Runner-URLs und Tokens werden im Dashboard eingerichtet. MCP prüft den gespeicherten Runner mit video_studio_runner_status. |
| settings | /mcp-info | Dashboard-Administration | POST /api/settings/github-test | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Einrichtung und Prüfung neuer GitHub-Zugangsdaten erfolgen im Dashboard; MCP verwendet die bestehende Backupkonfiguration. |
| settings | /mcp-info | Dashboard-Administration | POST /api/settings/pagespeed-test | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Einrichtung und Prüfung neuer API-Zugangsdaten bleiben im Dashboard. MCP verwendet seo_start mit gespeicherter Konfiguration und persönlicher Freigabe. |
| settings | /settings | settings_get | GET /api/settings | settings_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| settings | /settings#defaults | settings.saveAppSettings | PATCH /api/settings | settings_update_defaults | Ändern | Keine zusätzliche | Zugeordnet | MCP ändert ausschließlich öffentliche Website-Standardwerte. Zugangsdaten, Webhooks, SMTP und OAuth-Basisadresse bleiben aus Sicherheitsgründen im Dashboard. |
| site-connection-test | /mcp-info | Dashboard-Administration | POST /api/site-connection-test | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Neue, noch nicht gespeicherte Verbindungsdaten werden nur im Dashboard geprüft. MCP testet gespeicherte, autorisierte Verbindungen mit site_connection_test. |
| sites | /websites | sites.link | PUT /api/sites/:site/project | website_project_assign | Ändern | Keine zusätzliche | Zugeordnet |  |
| tools | /tools | tools.remove | DELETE /api/tools/:id | tool_link_remove | Ändern | Keine zusätzliche | Zugeordnet |  |
| tools | /tools | tools.update | PUT /api/tools/:id | tool_link_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| tools | /tools | tools.passivePhpCheck | POST /api/tools/phpcheck | php_version_check | Lesen | Keine zusätzliche | Zugeordnet |  |
| tools | /tools | tools.list | GET /api/tools | tools_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| tools | /tools | tools.create | POST /api/tools | tool_link_create | Ändern | Keine zusätzliche | Zugeordnet |  |
| ui-theme | /mcp-info | Dashboard-Administration | GET /api/ui-theme | – | Lesen | Dashboard-Entscheidung | Begründete Ausnahme | Rein visuelle persönliche Akzentfarbe, keine fachliche Aktion. |
| ui-theme | /mcp-info | Dashboard-Administration | PUT /api/ui-theme | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Rein visuelle persönliche Akzentfarbe, keine fachliche Aktion. |
| video-studio | /mcp-info | Dashboard-Administration | POST /api/video-studio/demo-logins | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Passwörter für Testkonten werden unmittelbar im Dashboard hinterlegt, ohne sie durch den Agentenkontext zu leiten. |
| video-studio | /mcp-info | Dashboard-Administration | POST /api/video-studio/demo-policy | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Vertrauensgrenze: KI-Agenten dürfen ihre eigenen erlaubten Demo-Domains nicht erweitern. |
| video-studio | /mcp-info | Dashboard-Administration | POST /api/video-studio/intro-assets/:id/cancel | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Original-Introdateien bis 50 MB und ihre Upload-Chunks werden direkt zwischen Dashboard und Runner übertragen. MCP wählt vorhandene geprüfte Intro-IDs im Szenen-/Renderauftrag. |
| video-studio | /mcp-info | Dashboard-Administration | POST /api/video-studio/intro-assets/:id/chunks | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Original-Introdateien bis 50 MB und ihre Upload-Chunks werden direkt zwischen Dashboard und Runner übertragen. MCP wählt vorhandene geprüfte Intro-IDs im Szenen-/Renderauftrag. |
| video-studio | /mcp-info | Dashboard-Administration | POST /api/video-studio/intro-assets/:id/complete | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Original-Introdateien bis 50 MB und ihre Upload-Chunks werden direkt zwischen Dashboard und Runner übertragen. MCP wählt vorhandene geprüfte Intro-IDs im Szenen-/Renderauftrag. |
| video-studio | /mcp-info | Dashboard-Administration | GET /api/video-studio/intro-assets/:id/file | – | Lesen | Dashboard-Entscheidung | Begründete Ausnahme | Original-Introdateien bis 50 MB und ihre Upload-Chunks werden direkt zwischen Dashboard und Runner übertragen. MCP wählt vorhandene geprüfte Intro-IDs im Szenen-/Renderauftrag. |
| video-studio | /mcp-info | Dashboard-Administration | POST /api/video-studio/intro-assets | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Original-Introdateien bis 50 MB und ihre Upload-Chunks werden direkt zwischen Dashboard und Runner übertragen. MCP wählt vorhandene geprüfte Intro-IDs im Szenen-/Renderauftrag. |
| video-suite | /mcp-info | Dashboard-Administration | POST /api/video-suite/chat-images | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Originalbilder werden über die UI übertragen; MCP verwendet vorhandene projektgebundene Bildkennungen. Große Base64-Bildtransfers durch den Sprachmodellkontext werden vermieden. |
| video-suite | /mcp-info | Dashboard-Administration | POST /api/video-suite/settings | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | API-Schlüssel werden unmittelbar im Dashboard hinterlegt. MCP kann den bereinigten Verbindungszustand und echte Tests nach Freigabe abrufen. |
| video | /video-suite | video_studio_runner_status | GET /api/video-studio/capabilities | video_studio_runner_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#script | video.testCapture | POST /api/video-studio/capture-test | video_capture_test | Ändern | Gebundene Freigabe | Zugeordnet |  |
| video | /video-suite#settings | video.testDemoLogin | POST /api/video-studio/demo-logins/:id/test | video_demo_login_test | Ändern | Gebundene Freigabe | Zugeordnet |  |
| video | /video-suite#settings | video.listDemoLogins | GET /api/video-studio/demo-logins | video_demo_logins | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.getDemoPolicy | GET /api/video-studio/demo-policy | video_demo_policy | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_save_demo_template | POST /api/video-studio/demo-templates/:id | video_studio_save_demo_template | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_demo_templates | GET /api/video-studio/demo-templates | video_studio_demo_templates | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_save_demo_template | POST /api/video-studio/demo-templates | video_studio_save_demo_template | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#script | video.intros.list | GET /api/video-studio/intro-assets | video_intros_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_downloads | GET /api/video-studio/jobs/:id/downloads | video_studio_downloads | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_downloads | GET /api/video-studio/jobs/:id/file | video_studio_downloads | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_import_final | POST /api/video-studio/jobs/:id/final-video | video_studio_import_final | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_update_metadata | POST /api/video-studio/jobs/:id/metadata | video_studio_update_metadata | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#review | video.publication.read | GET /api/video-studio/jobs/:id/publication/thumbnail | video_publication_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#review | video.publication.read | GET /api/video-studio/jobs/:id/publication | video_publication_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#assets | video.publication.save | POST /api/video-studio/jobs/:id/publication | video_publication_save | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_render_job | POST /api/video-studio/jobs/:id/render | video_studio_render_job | Ändern | Gebundene Freigabe | Zugeordnet |  |
| video | /video-suite#production | video.restoreJob | POST /api/video-studio/jobs/:id/restore | video_job_restore | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#production | video.trashJob | POST /api/video-studio/jobs/:id/trash | video_job_trash | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_job_status | GET /api/video-studio/jobs/:id | video_studio_job_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_list_jobs | GET /api/video-studio/jobs | video_studio_list_jobs | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_create_job | POST /api/video-studio/jobs | video_studio_create_job | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.testOpenAINarration | POST /api/video-studio/openai-audio-test | video_audio_test | Ändern | Gebundene Freigabe | Zugeordnet |  |
| video | /video-suite | video_studio_update_project | POST /api/video-studio/projects/:id | video_studio_update_project | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_projects | GET /api/video-studio/projects | video_studio_projects | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_create_project | POST /api/video-studio/projects | video_studio_create_project | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#assets | video.asset | GET /api/video-suite/assets/:id | video_image_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#assets | video.assets | GET /api/video-suite/assets | video_assets | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#assets | video.asset | GET /api/video-suite/chat-images/:id | video_image_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#ideas | video.chat | POST /api/video-suite/chat | video_assistant_request | Ändern | Gebundene Freigabe | Zugeordnet |  |
| video | /video-suite#ideas | video.conversation | GET /api/video-suite/conversations/:id | video_conversation_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#ideas | video.conversations | GET /api/video-suite/conversations | video_conversations | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#script | video.loadDraft | GET /api/video-suite/drafts/:id | video_draft_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#script | video.saveDraft | POST /api/video-suite/drafts/:id | video_draft_save | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.knowledge | GET /api/video-suite/knowledge | video_knowledge_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.saveKnowledge | POST /api/video-suite/knowledge | video_knowledge_save | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.models | GET /api/video-suite/models | video_models_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite | video_studio_downloads | GET /api/video-suite/preview/:id | video_studio_downloads | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.productionGuidelines | GET /api/video-suite/production-guidelines | video_production_guidelines_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.saveProductionGuidelines | POST /api/video-suite/production-guidelines | video_production_guidelines_save | Ändern | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.status | GET /api/video-suite/settings | video_workspace_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| video | /video-suite#settings | video.testConnection | POST /api/video-suite/test-connection | video_connection_test | Ändern | Gebundene Freigabe | Zugeordnet |  |
| video | /video-suite#assets | video.thumbnail | POST /api/video-suite/thumbnails | video_thumbnail_generate | Ändern | Gebundene Freigabe | Zugeordnet |  |
| website | /mcp-info | website_create_status | GET /api/website-factory/:installationId | website_create_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| website | /mcp-info | website_create | POST /api/website-factory/create | website_create | Ändern | Gebundene Freigabe | Zugeordnet |  |
| website | /mcp-info | website_create_plan | POST /api/website-factory/plan | website_create_plan | Ändern | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | backups.get | GET /api/backup-jobs/:id | backup_job_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | backup_restore_preview | POST /api/backups/:id/restore-preview | backup_restore_preview | Ändern | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | rollback_preview | POST /api/changes/:id/rollback-preview | rollback_preview | Ändern | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | incident_get | GET /api/incidents/:id | incident_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | change_apply | POST /api/previews/:id/apply | change_apply | Ändern | Gebundene Freigabe | Zugeordnet |  |
| websites | /websites | site_delete_confirm | POST /api/site-deletions/confirm | site_delete_confirm | Ändern | Gebundene Freigabe | Zugeordnet |  |
| websites | /websites | backups.start | POST /api/sites/:site/backup-jobs | backup_start | Ändern | Gebundene Freigabe | Zugeordnet |  |
| websites | /websites | backup_status | GET /api/sites/:site/backup-status | backup_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | site_backup | POST /api/sites/:site/backup | site_backup | Ändern | Gebundene Freigabe | Zugeordnet |  |
| websites | /websites | monitoring.processMonitor | POST /api/sites/:site/check | monitor_check_run | Ändern | Gebundene Freigabe | Zugeordnet |  |
| websites | /websites | site_connection_test | POST /api/sites/:site/connection-test | site_connection_test | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | site_connection_update | PATCH /api/sites/:site/connection | site_connection_update | Ändern | Gebundene Freigabe | Zugeordnet |  |
| websites | /websites | site_delete_preview | POST /api/sites/:site/delete-preview | site_delete_preview | Ändern | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | deployment_info | GET /api/sites/:site/deployment | deployment_info | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | change_preview | POST /api/sites/:site/file-preview | change_preview | Ändern | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | file_read | GET /api/sites/:site/file | file_read | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | files_list | GET /api/sites/:site/files | files_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | incidents_list | GET /api/sites/:site/incidents | incidents_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | monitor_history | GET /api/sites/:site/monitor-checks | monitor_history | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | site_overview | GET /api/sites/:site/overview | site_overview | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | quality_overview | GET /api/sites/:site/quality | quality_overview | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | site_status | POST /api/sites/:site/status | site_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | synthetics_list | GET /api/sites/:site/synthetics | synthetics_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | synthetic_create | POST /api/sites/:site/synthetics | synthetic_create | Ändern | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | site_get | GET /api/sites/:site | site_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | site_update | PATCH /api/sites/:site | site_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | sites_list | GET /api/sites | sites_list | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /setup | sites.createSite | POST /api/sites | site_register | Ändern | Gebundene Freigabe | Zugeordnet |  |
| websites | /websites | synthetics.synthetic_screenshot | GET /api/synthetic-runs/:id/screenshot | synthetic_screenshot | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | synthetic_run_get | GET /api/synthetic-runs/:id | synthetic_run_get | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | synthetics.synthetic_baseline | GET /api/synthetic-tests/:id/baseline | synthetic_baseline | Lesen | Keine zusätzliche | Zugeordnet |  |
| websites | /websites | synthetic_run | POST /api/synthetic-tests/:id/run | synthetic_run | Ändern | Gebundene Freigabe | Zugeordnet |  |
| websites | /websites | synthetic_update | PATCH /api/synthetic-tests/:id | synthetic_update | Ändern | Keine zusätzliche | Zugeordnet |  |
| workspace | /websites | workspace.portfolio | GET /api/site-projects | websites_search | Lesen | Keine zusätzliche | Zugeordnet |  |
| workspace | /billing/activity | workspace.activity | GET /api/workspace/activity | workspace_activity | Lesen | Keine zusätzliche | Zugeordnet |  |
| workspace | / | workspace.overview | GET /api/workspace/overview | workspace_overview | Lesen | Keine zusätzliche | Zugeordnet |  |
| workspace | /billing | workspace.projectOverview | GET /api/workspace/projects/:id/overview | project_overview | Lesen | Keine zusätzliche | Zugeordnet |  |
| workspace | / | workspace.search | GET /api/workspace/search | workspace_search | Lesen | Keine zusätzliche | Zugeordnet |  |
| workspace | /websites | workspace.portfolio | GET /api/workspace/websites | websites_search | Lesen | Keine zusätzliche | Zugeordnet |  |
| youtube | /youtube | youtube_analytics | POST /api/youtube/analytics | youtube_analytics | Lesen | Keine zusätzliche | Zugeordnet |  |
| youtube | /youtube | youtube_studio_asset_preview | POST /api/youtube/asset-preview | youtube_studio_asset_preview | Ändern | Keine zusätzliche | Zugeordnet |  |
| youtube | /youtube | youtube_api_catalog | GET /api/youtube/catalog | youtube_api_catalog | Lesen | Keine zusätzliche | Zugeordnet |  |
| youtube | /youtube | youtube_change_status | POST /api/youtube/change-status | youtube_change_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| youtube | /mcp-info | Dashboard-Administration | POST /api/youtube/configure | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Administrative Einrichtung oder Entfernung eines Zugangsdaten enthaltenden Providerkontos bleibt im Dashboard. MCP verwendet ausschließlich die gespeicherten Verbindungen. |
| youtube | /mcp-info | Dashboard-Administration | POST /api/youtube/disconnect | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Trennen und erneutes Autorisieren eines Providerkontos bleibt im persönlichen Verbindungsdialog. MCP darf dadurch seine Sicherheitsgrenzen nicht selbst verändern. |
| youtube | /youtube | youtube_change_execute | POST /api/youtube/execute | youtube_change_execute | Ändern | Gebundene Freigabe | Zugeordnet |  |
| youtube | /mcp-info | Dashboard-Administration | GET /api/youtube/oauth/callback | – | Lesen | Dashboard-Entscheidung | Begründete Ausnahme | Anmeldung, Tokenfreigabe und Widerruf sind persönliche Sicherheitsentscheidungen im Dashboard oder beim OAuth-Client, keine vom Agenten ausführbaren Rechtevergaben. |
| youtube | /mcp-info | Dashboard-Administration | POST /api/youtube/oauth/start | – | Ändern | Dashboard-Entscheidung | Begründete Ausnahme | Anmeldung, Tokenfreigabe und Widerruf sind persönliche Sicherheitsentscheidungen im Dashboard oder beim OAuth-Client, keine vom Agenten ausführbaren Rechtevergaben. |
| youtube | /youtube | youtube_change_preview | POST /api/youtube/previews | youtube_change_preview | Ändern | Keine zusätzliche | Zugeordnet |  |
| youtube | /youtube | youtube_read | POST /api/youtube/read | youtube_read | Lesen | Keine zusätzliche | Zugeordnet |  |
| youtube | /youtube | youtube_status | GET /api/youtube/status | youtube_status | Lesen | Keine zusätzliche | Zugeordnet |  |
| youtube | /youtube | youtube_upload_preview | POST /api/youtube/upload-preview | youtube_upload_preview | Ändern | Keine zusätzliche | Zugeordnet |  |
| youtube | /youtube | youtube_uploads | GET /api/youtube/uploads | youtube_uploads | Lesen | Keine zusätzliche | Zugeordnet |  |

## Zusätzliche fachliche MCP-Aktionen

Diese Tools ergänzen zusammengesetzte Abläufe oder vorhandene Website-Services; es existiert nicht zwingend ein separater gleichnamiger REST-Endpunkt. Der Arbeitskontext ist ausgewiesen.

| Tool | Modul | UI-Kontext | Recht | Freigabe | Aufgabe |
| --- | --- | --- | --- | --- | --- |
| coolify_app_verify | coolify | /coolify | read | Nein | Check remote healthy state, DNS, trusted TLS certificate and configured HTTPS health response. Read-only; does not turn an unverified plan into a website. |
| coolify_project_ensure | coolify | /coolify | write | Ja | Find a unique existing Coolify project by name or create it. Real remote write: only for explicit project creation/installation intent. SiteOps customer projects are separate. |
| siteops_project_ensure | siteops | /mcp-info | write | Ja | Find or create a SiteOps customer project. If no customer is provided for a new project, use/create the internal customer SiteOps. Real write: only for explicit project creation/installation intent. |
| domain_dns_ensure | hosting | /hosting | write | Ja | Ensure conflict-free ALL-INKL DNS for a previously approved installation plan. Rechecks ownership, public server IP and current records. Never overwrites existing records. |
| siteops_coolify_site_register | siteops | /mcp-info | write | Ja | Resume an approved installation including verification and idempotent project/website registration. Cannot register an unverified application. Same human approval requirements as coolify_install_execute. |
| site_provision | websites | /websites | write | Ja | Create a SiteOps website with an existing FTP/SFTP connection, recursively create its dedicated empty server directory, and register the website. Never overwrites existing content. Use change_preview/change_apply to upload files afterwards; hosting domain document root must be configured separately. |
| files_find | websites | /websites | read | Nein | Recursively find files/directories by path/name substring, bounded by a result limit. |
| text_search | websites | /websites | read | Nein | Search bounded text file contents in the current source of truth. Binary and large files are skipped. |
| history_list | websites | /websites | read | Nein | List recent recorded changes. |
| history_diff | websites | /websites | read | Nein | Get Git diff for a recorded SiteOps change. |
| backups_list | websites | /websites | read | Nein | List full backups. |
| cms_project_begin | cms | /lorzcms | write | Nein | Stage an immutable existing LorzCMS project manifest before installation. No hosting writes. Include project PHP, public assets/media, the seed export and optionally audit/asset-verification.json; exclude core, credentials and local databases. Returns a packageId for per-file transfer. |
| cms_project_file | cms | /lorzcms | write | Nein | Transfer one declared project file as canonical base64, up to 5 MiB decoded. SHA-256 and size must match the immutable manifest. Idempotent; never writes to hosting or returns file contents. |
| cms_project_status | cms | /lorzcms | read | Nein | Show project upload progress and missing files without returning project code, media or secrets. |
| cms_project_finish | cms | /lorzcms | write | Nein | Verify every staged project file and content seed. Returns preserved routes and record count. A ready package can be passed as projectPackageId to cms_install or cms_install_allinkl. Does not publish by itself. |
| cms_install_allinkl | cms | /lorzcms | write | Ja | Create an ALL-INKL subdomain, prepare an empty public/ webroot using a saved FTP/SFTP profile, and queue a new LorzCMS website. Requires an existing KAS account, released CMS version and HTTPS readiness. |
| cms_theme_apply | cms | /lorzcms | write | Ja | Apply a theme designed for a managed LorzCMS website. industrial = Containerdienst/Bau, protection = Unfallversicherung/Sport. Updates only the selected website appearance, preserving existing content and page URLs. |
| cms_admin_recovery | cms | /lorzcms | read | Nein | Den persönlichen Einstieg zur Wiederherstellung eines CMS-Administrators abrufen. Setzt kein Passwort zurück. Neue Zugangsdaten werden ausschließlich im geschützten Dashboard angezeigt. |
| action_prepare | mcp | /mcp-info | write | Nein | Kritische Aktion vorbereiten, ohne sie auszuführen. Das genaue Tool und seine Argumente angeben; der Benutzer muss die Vorschau anschließend persönlich im SiteOps-Dashboard freigeben. Zustimmung des Agenten genügt nicht. |
| operation_status | operations | /mcp-info | read | Nein | Tatsächlichen Zustand eines vorhandenen SEO-, CMS-, Coolify- oder Videoauftrags nachladen. Keine erfundenen Fortschrittswerte; unbekannte Providerzustände bleiben unbekannt. |
