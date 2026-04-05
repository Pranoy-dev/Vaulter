import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"

type RiskNarrative = {
  summary: string
  verdict: "risky" | "good" | "mixed"
  positives: string[]
  concerns: string[]
  actions: string[]
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim()
    try {
      return JSON.parse(cleaned) as T
    } catch {
      return null
    }
  }
}

function normalizeNarrative(data: Partial<RiskNarrative> | null): RiskNarrative {
  return {
    summary:
      data?.summary?.trim() ||
      "Risk explanation unavailable. Please review risk drivers, missing items, and expiry concentration.",
    verdict:
      data?.verdict === "good" || data?.verdict === "risky" || data?.verdict === "mixed"
        ? data.verdict
        : "mixed",
    positives: Array.isArray(data?.positives) ? data!.positives.slice(0, 4) : [],
    concerns: Array.isArray(data?.concerns) ? data!.concerns.slice(0, 4) : [],
    actions: Array.isArray(data?.actions) ? data!.actions.slice(0, 4) : [],
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const dealId = body?.dealId as string | undefined
    const insights = body?.insights

    if (!insights || typeof insights !== "object") {
      return new Response(JSON.stringify({ error: "Missing insights payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Compact but comprehensive payload for the model.
    const keyInfo = {
      deal_id: dealId ?? null,
      risk_score: insights.risk_score,
      risk_band: insights.risk_band,
      dimensions: insights.dimensions,
      wault: insights.wault,
      total_documents: insights.total_documents,
      processed_documents: insights.processed_documents,
      circuit_breakers: insights.circuit_breakers,
      risk_drivers: insights.risk_drivers,
      missing_items: insights.missing_items,
      key_metrics: insights.key_metrics,
      expiry_timeline: insights.expiry_timeline,
      category_breakdown: insights.category_breakdown,
      lease_chain_summary: insights.lease_chain_summary ?? null,
      document_insights: Array.isArray(insights.document_insights)
        ? insights.document_insights.slice(0, 30).map((doc: Record<string, unknown>) => ({
            filename: doc.filename,
            category: doc.category,
            confidence: doc.confidence,
            summary: doc.summary,
            parties: doc.parties,
            expiry_date: doc.expiry_date,
            has_signature: doc.has_signature,
            has_seal: doc.has_seal,
            is_incomplete: doc.is_incomplete,
            incompleteness_reasons: doc.incompleteness_reasons,
            key_terms: doc.key_terms,
          }))
        : [],
    }

    const prompt = [
      "You are a commercial real-estate risk analyst.",
      "Explain whether this deal appears risky or good, and why, using only the provided data.",
      "You must weigh positives and concerns fairly. If score is borderline, use mixed verdict.",
      "Return strict JSON only with keys:",
      '{"summary":"string <= 70 words","verdict":"risky|good|mixed","positives":["short bullets"],"concerns":["short bullets"],"actions":["short bullets"]}',
      "Keep each bullet under 14 words.",
      "\nDEAL DATA:",
      JSON.stringify(keyInfo),
    ].join("\n")

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      prompt,
      temperature: 0.2,
      maxOutputTokens: 350,
    })

    const parsed = safeJsonParse<Partial<RiskNarrative>>(result.text)
    const narrative = normalizeNarrative(parsed)

    return new Response(JSON.stringify({ success: true, data: narrative }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
