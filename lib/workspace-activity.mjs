import * as z from 'zod/v4';

const uuid = z.uuid();
const limitValue = input => Math.min(100, Math.max(10, Number.parseInt(input,10) || 40));
const niceTime = v => v instanceof Date ? v.toISOString() : v;
const safe = v => String(v ?? '').slice(0, 300);
const urlPart = v => encodeURIComponent(String(v));
const mapped = (kind, items, fn) => items.map((row,i) => ({
  id: kind + ':' + row.id + ':' + i, kind, occurred_at: niceTime(row.created_at), ...fn(row)
}));

export function createWorkspaceActivity(db) {
  async function list(options={}) {
    const projectId = options.projectId ? uuid.parse(options.projectId) : null;
    const limit = limitValue(options.limit);
    const scope = projectId ? ' WHERE p.id=?' : '';
    const scoped = () => projectId ? [projectId,limit] : [limit];
    const siteScope = projectId ? ' WHERE ps.project_id=?' : '';
    const siteParams = () => projectId ? [projectId,limit] : [limit];
    const scopedProject = projectId ? ' AND p.id=?' : '';
    const invoiceScoped = projectId
      ? ' WHERE EXISTS (SELECT 1 FROM invoice_items ii JOIN time_entries e ON e.id=ii.entry_id JOIN project_tasks t ON t.id=e.task_id WHERE ii.invoice_id=i.id AND t.project_id=?)'
      : '';
    const invoiceParams = projectId ? [projectId,limit] : [limit];

    const sources = [
      db.query(
        'SELECT a.id,a.event_type,a.details,a.created_at,t.name task_name,p.id project_id,p.name project_name ' +
        'FROM billing_task_events a JOIN project_tasks t ON t.id=a.task_id JOIN customer_projects p ON p.id=t.project_id' +
        scope+' ORDER BY a.created_at DESC LIMIT ?', scoped()),
      db.query(
        'SELECT a.id,a.actor,a.text,a.created_at,t.name task_name,t.id task_id,p.id project_id ' +
        'FROM billing_task_comments a JOIN project_tasks t ON t.id=a.task_id JOIN customer_projects p ON p.id=t.project_id' +
        scope+' ORDER BY a.created_at DESC LIMIT ?',scoped()),
      db.query(
        'SELECT a.id,a.event_type,a.created_at,s.name site_name,s.slug,ps.project_id ' +
        'FROM incident_events a JOIN sites s ON s.id=a.site_id LEFT JOIN project_sites ps ON ps.site_id=s.id'+
        siteScope+' ORDER BY a.created_at DESC LIMIT ?',siteParams()),
      db.query(
        'SELECT b.id,b.backup_type,b.file_count,b.created_at,s.name site_name,s.slug,ps.project_id ' +
        'FROM backups b JOIN sites s ON s.id=b.site_id LEFT JOIN project_sites ps ON ps.site_id=s.id'+
        siteScope+' ORDER BY b.created_at DESC LIMIT ?',siteParams()),
      db.query(
        'SELECT a.id,a.description,a.actor,a.status,a.created_at,s.name site_name,s.slug,ps.project_id ' +
        'FROM changes a JOIN sites s ON s.id=a.site_id LEFT JOIN project_sites ps ON ps.site_id=s.id'+
        siteScope+' ORDER BY a.created_at DESC LIMIT ?',siteParams()),
      db.query(
        'SELECT e.id,e.duration_seconds,e.description,e.created_at,t.name task_name,t.id task_id,p.id project_id ' +
        'FROM time_entries e JOIN project_tasks t ON t.id=e.task_id JOIN customer_projects p ON p.id=t.project_id ' +
        'WHERE e.started_at IS NULL'+scopedProject+' ORDER BY e.created_at DESC LIMIT ?',scoped()),
      db.query(
        'SELECT i.id,i.invoice_number,i.status,i.created_at,c.name customer_name ' +
        'FROM invoices i JOIN customers c ON c.id=i.customer_id'+invoiceScoped+
        ' ORDER BY i.created_at DESC LIMIT ?',invoiceParams)
    ];
    const data = (await Promise.all(sources)).map(result=>result[0]);
    const [taskEvents,comments,monitoring,backups,changes,times,invoices]=data;
    const output = [
      ...mapped('task',taskEvents,row=>({
        title: 'Task verschoben: '+safe(row.task_name), description:safe(row.details),
        project_id:row.project_id,url:'/billing/projects/'+urlPart(row.project_id)
      })),
      ...mapped('comment',comments,row=>({
        title:'Kommentar: '+safe(row.task_name),description:safe(row.actor)+': '+safe(row.text),
        project_id:row.project_id,url:'/billing/projects/'+urlPart(row.project_id)+'?task='+urlPart(row.task_id)
      })),
      ...mapped('monitor',monitoring,row=>({
        title:'Monitoring '+safe(row.event_type)+': '+safe(row.site_name),
        description:'Website-Ereignis',project_id:row.project_id,url:'/sites/'+urlPart(row.slug)
      })),
      ...mapped('backup',backups,row=>({
        title:'Backup: '+safe(row.site_name),
        description:safe(row.backup_type)+' · '+Number(row.file_count||0)+' Dateien',
        project_id:row.project_id,url:'/sites/'+urlPart(row.slug)
      })),
      ...mapped('deploy',changes,row=>({
        title:'Änderung: '+safe(row.site_name),
        description:safe(row.description)+' · '+safe(row.status),project_id:row.project_id,
        url:'/sites/'+urlPart(row.slug)
      })),
      ...mapped('time',times,row=>({
        title:'Zeit erfasst: '+safe(row.task_name),
        description:(Number(row.duration_seconds||0)/3600).toFixed(2)+' h · '+safe(row.description),
        project_id:row.project_id,url:'/billing/projects/'+urlPart(row.project_id)+'?task='+urlPart(row.task_id)
      })),
      ...mapped('invoice',invoices,row=>({
        title:'Rechnung: '+safe(row.invoice_number||'Entwurf'),
        description:safe(row.customer_name)+' · '+safe(row.status),url:'/billing/invoices',project_id:projectId
      }))
    ];
    output.sort((a,b)=>new Date(b.occurred_at).getTime()-new Date(a.occurred_at).getTime());
    return { entries:output.slice(0,limit), limit, project_id:projectId };
  }
  return {list};
}

export function registerWorkspaceActivityRoutes(app,service) {
  app.get('/api/workspace/activity',req=>service.list({
    projectId:req.query?.project_id,
    limit:req.query?.limit
  }));
}
