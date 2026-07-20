import { NextResponse } from "next/server";
import { embedMissingChunks } from "@gov-validator/core/vector-index";

export async function POST() {
  try {
    const result = await embedMissingChunks();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

