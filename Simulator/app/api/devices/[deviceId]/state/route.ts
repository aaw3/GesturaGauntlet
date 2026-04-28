import { NextRequest, NextResponse } from "next/server"
import { getDeviceState } from "@/lib/simulator-api"

type RouteContext = {
  params: Promise<{
    deviceId: string
  }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { deviceId } = await context.params
  const state = getDeviceState(deviceId)

  if (!state) {
    return NextResponse.json({ error: "Device state not found" }, { status: 404 })
  }

  return NextResponse.json(state)
}
