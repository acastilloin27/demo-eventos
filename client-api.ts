export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options, credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: options.signal ?? AbortSignal.timeout(15000),
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError("No pudimos conectar con el servidor. Revisa tu conexión e intenta nuevamente.", 0)
  }
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const fieldMessage = body?.fields ? Object.values(body.fields).flat().find((value) => typeof value === "string") : null
    throw new ApiError(fieldMessage || body?.error || "Ocurrió un error. Intenta nuevamente.", response.status)
  }
  if (!body) throw new ApiError("El servidor devolvió una respuesta inválida.", response.status)
  return body as T
}

export function todayInChile() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}
