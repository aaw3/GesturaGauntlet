import { NextResponse } from "next/server"
import { getManagerInfo } from "@/lib/simulator-api"

export function GET() {
  return NextResponse.json(getManagerInfo())
}
