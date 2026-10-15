import * as z from 'zod/v4';

const searchSchema = z.string().trim().min(2).max(90);
const matches = term => '%' + term.replace(/[!%_]/g, c => '!' + c) + '%';
const safePath = value => encodeURIComponent(String(value));

export function createWorkspaceSearch({ db }) {
  async function search(raw) {
    const parsed = searchSchema.safeParse(String(raw ?? ''));
    if (!parsed.success) return { query: String(raw ?? '').trim().slice(0, 90), results: [] };
    const query = parsed.data;
    const pattern = matches(query);
    const statements = [
      {
        type: 'customer',
        sql: "SELECT id,name title,COALESCE(email,'') subtitle FROM customers WHERE name LIKE ? ESCAPE '!' OR contact_name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' ORDER BY name LIMIT 10",
        params: [pattern, pattern, pattern],
        url: () => '/billing/customers'
      },
      {
        type: 'project',
        sql: "SELECT p.id,p.name title,c.name subtitle FROM customer_projects p JOIN customers c ON c.id=p.customer_id WHERE p.name LIKE ? ESCAPE '!' OR c.name LIKE ? ESCAPE '!' ORDER BY p.name LIMIT 12",
        params: [pattern, pattern],
        url: row => '/billing/projects/' + safePath(row.id)
      },
      {
        type: 'task',
        sql: "SELECT t.id,t.name title,CONCAT(c.name,' / ',p.name) subtitle,p.id project_id FROM project_tasks t JOIN customer_projects p ON p.id=t.project_id JOIN customers c ON c.id=p.customer_id WHERE t.name LIKE ? ESCAPE '!' OR t.description LIKE ? ESCAPE '!' ORDER BY t.created_at DESC LIMIT 12",
        params: [pattern, pattern],
        url: row => '/billing/projects/' + safePath(row.project_id) + '?task=' + safePath(row.id)
      },
      {
        type: 'site',
        sql: "SELECT id,name title,domain subtitle,slug FROM sites WHERE name LIKE ? ESCAPE '!' OR domain LIKE ? ESCAPE '!' OR slug LIKE ? ESCAPE '!' ORDER BY name LIMIT 12",
        params: [pattern, pattern, pattern],
        url: row => '/sites/' + safePath(row.slug)
      },
      {
        type: 'invoice',
        sql: "SELECT i.id,COALESCE(i.invoice_number,'Rechnungsentwurf') title,c.name subtitle FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.invoice_number LIKE ? ESCAPE '!' OR c.name LIKE ? ESCAPE '!' ORDER BY i.created_at DESC LIMIT 10",
        params: [pattern, pattern],
        url: () => '/billing/invoices'
      }
    ];
    const results = await Promise.all(statements.map(async item => {
      const [rows] = await db.query(item.sql, item.params);
      return rows.map(row => ({
        type: item.type, id: row.id, title: String(row.title), subtitle: String(row.subtitle || ''),
        url: item.url(row)
      }));
    }));
    // Prioritize title matches, without returning unrelated metadata or hidden identifiers.
    const ordered = results.flat().sort((a, b) => {
      const score = entry => entry.title.toLocaleLowerCase('de-DE').startsWith(query.toLocaleLowerCase('de-DE')) ? 0 : 1;
      return score(a) - score(b);
    });
    return { query, results: ordered.slice(0, 35) };
  }

  return { search };
}

export function registerWorkspaceSearchRoutes(app, service) {
  app.get('/api/workspace/search', req => service.search(req.query?.q));
}
