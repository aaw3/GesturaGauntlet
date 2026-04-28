import { NextRequest, NextResponse } from "next/server"
import { applyDeviceAction, getDeviceState } from "@/lib/simulator-api"
import { publishDeviceStateChange } from "@/lib/simulator-events"

type RouteContext = {
  params: Promise<{
    deviceId: string
    capabilityId: string
  }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { deviceId, capabilityId } = await context.params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const result = applyDeviceAction({
    ...body,
    deviceId,
    capabilityId,
    commandType: body.commandType === "toggle" || body.commandType === "delta" || body.commandType === "execute"
      ? body.commandType
      : "set",
    value: body.value as string | number | boolean | null | undefined,
    delta: typeof body.delta === "number" ? body.delta : undefined,
  })

  if (result.ok && result.changed) {
    const state = getDeviceState(deviceId)
    if (state) publishDeviceStateChange(state)
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 404 })
}
