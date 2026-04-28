import { NextResponse } from "next/server"
import { listDevices } from "@/lib/simulator-api"

export function GET() {
  return NextResponse.json(listDevices())
}
