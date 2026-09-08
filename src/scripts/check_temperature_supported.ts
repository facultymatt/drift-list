// probe.ts
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic()
async function tryIt(label: string, extra: Record<string, unknown>) {
  try {
    const r = await client.messages.create({
      model: process.env.MENTOR_MODEL_PHASE1 ?? 'claude-sonnet-4-5-20250929',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'say ok' }],
      ...extra,
    } as any)
    console.log(label, 'OK', JSON.stringify(r.content))
  } catch (e: any) {
    console.log(label, 'FAIL', e?.status, String(e?.message ?? e).slice(0, 200))
  }
}
await tryIt('no temperature ', {})
await tryIt('temperature: 0 ', { temperature: 0 })