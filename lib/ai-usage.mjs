import crypto from 'node:crypto';
import * as z from 'zod/v4';

export const aiLimitsSchema = z.object({
  monthly_calls: z.number().int().min(1).max(100000),
  monthly_tokens: z.number().int().min(1000).max(1000000000),
  monthly_usd: z.number().positive().max(100000).nullable(),
  prices: z
    .record(
      z.string().max(100),
      z.object({
        input_per_million: z.number().min(0).max(100000),
        output_per_million: z.number().min(0).max(100000),
        image_per_call: z.number().min(0).max(1000).optional()
      })
    )
    .default({})
});
const fail = message => {
  throw Object.assign(Error(message), { statusCode: 429, publicCode: 'AI_LIMIT_REACHED' });
};
const number = value => Math.max(0, Number(value) || 0);
export function aiReservation(body, operation) {
  // Conservative planning allowance, not measured usage or a progress value.
  const input = operation === 'images/generations' ? 0 : Buffer.byteLength(JSON.stringify(body || {}), 'utf8') + 4096;
  const output = operation === 'images/generations' ? 0 : number(body?.max_output_tokens || body?.max_tokens || 4096);
  return { input, output, tokens: input + output };
}
function priceFor(price, input, output, operation) {
  if (!price) return null;
  if (operation === 'images/generations') return price.image_per_call ?? null;
  return (input * price.input_per_million + output * price.output_per_million) / 1000000;
}
export function createAiUsage({ db }) {
  const policy = async connection => {
    const [rows] = await connection.query('SELECT * FROM ai_usage_policy WHERE id=1 FOR UPDATE');
    const row = rows[0];
    if (!row) throw Object.assign(Error('AI policy missing'), { statusCode: 503 });
    return {
      monthly_calls: Number(row.monthly_calls),
      monthly_tokens: Number(row.monthly_tokens),
      monthly_usd: row.monthly_usd == null ? null : Number(row.monthly_usd),
      prices: typeof row.prices_json === 'string' ? JSON.parse(row.prices_json) : row.prices_json || {}
    };
  };
  const totals = async connection =>
    (
      await connection.query(
        "SELECT COUNT(*) calls,COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) measured_tokens,COALESCE(SUM(accounted_tokens),0) accounted_tokens,SUM(estimated_usd) estimated_usd,SUM(estimated_usd IS NULL) unknown_costs FROM ai_usage_ledger WHERE created_at>=DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-01')"
      )
    )[0][0];
  async function overview() {
    const limits = await policy(db),
      summary = await totals(db);
    const [entries] = await db.query(
      'SELECT id,operation,model,state,input_tokens,output_tokens,estimated_usd,created_at FROM ai_usage_ledger ORDER BY created_at DESC LIMIT 100'
    );
    return {
      scope:
        'OpenAI-Text und Bild in der SiteOps Video Suite. Runner-Sprachausgabe und andere Provider sind nicht enthalten.',
      month_basis: 'UTC-Kalendermonat',
      limits,
      summary,
      entries,
      cost_note:
        'Kosten sind Schätzungen anhand deiner hinterlegten Modellpreise. Die tatsächliche Anbieterrechnung wird nicht abgerufen. Ohne Modellpreis bleibt der Betrag unbekannt.'
    };
  }
  async function configure(input) {
    const value = aiLimitsSchema.parse(input);
    await db.query(
      'UPDATE ai_usage_policy SET monthly_calls=?,monthly_tokens=?,monthly_usd=?,prices_json=? WHERE id=1',
      [value.monthly_calls, value.monthly_tokens, value.monthly_usd, JSON.stringify(value.prices)]
    );
    return overview();
  }
  async function run({ operation, body }, execute) {
    const model = String(body?.model || 'unknown').slice(0, 100),
      reservation = aiReservation(body, operation),
      id = crypto.randomUUID();
    const connection = await db.getConnection();
    let price;
    try {
      await connection.beginTransaction();
      const limits = await policy(connection),
        summary = await totals(connection);
      price = limits.prices[model];
      const estimate = priceFor(price, reservation.input, reservation.output, operation);
      if (number(summary.calls) >= limits.monthly_calls)
        fail('Das monatliche Anfrage-Limit ist erreicht. Prüfe die Nutzung und passe das Limit bei Bedarf an.');
      if (number(summary.accounted_tokens) + reservation.tokens > limits.monthly_tokens)
        fail(
          'Für diese Anfrage reicht das monatliche Token-Limit nicht aus. Kürze den Kontext oder passe das Limit an.'
        );
      if (
        limits.monthly_usd != null &&
        (estimate == null ||
          number(summary.unknown_costs) > 0 ||
          number(summary.estimated_usd) + estimate > limits.monthly_usd)
      )
        fail(
          'Das Kostenlimit kann für diese Anfrage nicht sicher eingehalten werden. Prüfe Modellpreise und bisherige unbekannte Kosten.'
        );
      await connection.query(
        "INSERT INTO ai_usage_ledger(id,operation,model,state,accounted_tokens,estimated_usd,created_at) VALUES(?,?,?,'reserved',?,?,UTC_TIMESTAMP())",
        [id, operation, model, reservation.tokens, estimate]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    let payload;
    try {
      payload = await execute();
    } catch (error) {
      await db.query("UPDATE ai_usage_ledger SET state='unconfirmed' WHERE id=?", [id]);
      throw error;
    }
    const usage = payload?.usage;
    const input = Number.isFinite(usage?.input_tokens)
      ? usage.input_tokens
      : Number.isFinite(usage?.prompt_tokens)
        ? usage.prompt_tokens
        : null;
    const output = Number.isFinite(usage?.output_tokens)
      ? usage.output_tokens
      : Number.isFinite(usage?.completion_tokens)
        ? usage.completion_tokens
        : null;
    const measured = input != null && output != null;
    const estimated =
      operation === 'images/generations'
        ? priceFor(price, 0, 0, operation)
        : measured
          ? priceFor(price, input, output, operation)
          : null;
    await db.query(
      "UPDATE ai_usage_ledger SET state='completed',input_tokens=?,output_tokens=?,accounted_tokens=?,estimated_usd=? WHERE id=?",
      [input, output, measured ? input + output : reservation.tokens, estimated, id]
    );
    return payload;
  }
  return { overview, configure, run };
}
