import { NextRequest, NextResponse } from "next/server";
import { search } from "@gov-validator/core/retrieval";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = String(body?.query || "").trim();
    const k = Math.max(1, Math.min(20, Number(body?.k || 8)));
    if (!query) return NextResponse.json({ error: "query 不能为空" }, { status: 400 });

    const result = await search(query, k);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

