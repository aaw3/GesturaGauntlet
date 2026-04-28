import { NextResponse } from "next/server"
import { listDeviceStates } from "@/lib/simulator-api"

export function GET() {
  return NextResponse.json(listDeviceStates())
}
