import { useEffect, useRef, useState, type FormEvent } from "react"
import { api, ApiError } from "./client-api"
import "./admin.css"

const statuses = { new: "Nueva", contacted: "Contactada", quoted: "Cotizada", closed: "Cerrada" }
type Status = keyof typeof statuses
type Inquiry = {
  id: string; name: string; email: string; phone: string; type: string; guests: number | null;
  eventDate: string | null; message: string; status: Status; notes: string; version: number; createdAt: string; updatedAt: string
}
type List = { items: Inquiry[]; total: number; page: number; pageSize: number; counts: Partial<Record<Status, number>> }
const formatDate = (value: string) => new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(new Date(value))

function InquiryCard({ inquiry, onSaved, onUnauthorized }: { inquiry: Inquiry; onSaved: () => void; onUnauthorized: () => void }) {
  const [status, setStatus] = useState(inquiry.status)
  const [notes, setNotes] = useState(inquiry.notes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const busy = useRef(false)
  const dirty = status !== inquiry.status || notes !== inquiry.notes
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    busy.current = true
    setSaving(true); setError("")
    try {
      await api(`/admin/inquiries/${inquiry.id}`, { method: "PATCH", body: JSON.stringify({ status, notes, version: inquiry.version }) })
      onSaved()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      else setError(error instanceof Error ? error.message : "No se pudo guardar.")
    } finally { busy.current = false; setSaving(false) }
  }
  return <article className="inquiry-card">
    <header><div><p className="admin-kicker">{inquiry.type} · {formatDate(inquiry.createdAt)}</p><h2>{inquiry.name}</h2></div><span className={`status-pill status-${inquiry.status}`}>{statuses[inquiry.status]}</span></header>
    <div className="inquiry-details">
      <div><span>Email</span><a href={`mailto:${inquiry.email}`}>{inquiry.email}</a></div>
      <div><span>Teléfono</span>{inquiry.phone || "Sin indicar"}</div>
      <div><span>Invitados</span>{inquiry.guests ?? "Por definir"}</div>
      <div><span>Fecha tentativa</span>{inquiry.eventDate ? formatDate(`${inquiry.eventDate}T12:00:00Z`) : "Por definir"}</div>
    </div>
    <p className="inquiry-message">{inquiry.message || "Sin mensaje adicional."}</p>
    <details><summary>Gestionar solicitud · {inquiry.id.slice(0, 8)}</summary>
      <form onSubmit={save} className="inquiry-edit">
        <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as Status)} disabled={saving}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Notas internas<textarea rows={3} maxLength={10000} value={notes} disabled={saving} onChange={(event) => setNotes(event.target.value)} placeholder="Seguimiento, acuerdos y próximos pasos" /></label>
        {error && <p role="alert" className="admin-error">{error}</p>}
        <button className="admin-button" disabled={saving || !dirty}>{saving ? "Guardando…" : "Guardar cambios"}</button>
      </form>
    </details>
  </article>
}

export default function Admin() {
  const [session, setSession] = useState<{ email: string } | null>(null)
  const [checking, setChecking] = useState(true)
  const [loginBusy, setLoginBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [data, setData] = useState<List | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const loginLock = useRef(false)

  function unauthorized() {
    setSession(null); setData(null); setNotice("Tu sesión venció. Inicia sesión nuevamente.")
  }
  useEffect(() => {
    let active = true
    api<{ email: string }>("/auth/session").then((user) => { if (active) setSession(user) }).catch((error) => {
      if (active && (!(error instanceof ApiError) || error.status !== 401)) setError(error.message)
    }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let active = true
    setLoading(true); setError("")
    const params = new URLSearchParams({ page: String(page), search })
    if (status) params.set("status", status)
    api<List>(`/admin/inquiries?${params}`, { signal: controller.signal }).then((result) => {
      if (active) setData(result)
    }).catch((error) => {
      if (!active) return
      if (error instanceof ApiError && error.status === 401) unauthorized()
      else setError(controller.signal.aborted ? "La consulta tardó demasiado. Intenta actualizar." : error.message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [session, page, search, status, revision])
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loginLock.current) return
    loginLock.current = true
    const form = new FormData(event.currentTarget)
    setLoginBusy(true); setError(""); setNotice("")
    try {
      const user = await api<{ email: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) })
      setPage(1); setSession(user)
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo iniciar sesión.") }
    finally { loginLock.current = false; setLoginBusy(false) }
  }
  async function logout() {
    setError("")
    try {
      await api("/auth/logout", { method: "POST", body: "{}" })
      setSession(null); setData(null); setNotice("Sesión cerrada.")
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { setSession(null); setData(null) }
      else setError(error instanceof Error ? error.message : "No se pudo cerrar sesión.")
    }
  }
  return <main className="admin-page">
    <header className="admin-topbar"><a href="/" className="admin-brand">TRAVESÍA <span>Administración</span></a>{session && <div><span>{session.email}</span><button className="admin-secondary" onClick={logout}>Cerrar sesión</button></div>}</header>
    {checking ? <p className="admin-loading" role="status">Comprobando sesión…</p> : !session ? <section className="admin-login">
      <p className="admin-kicker">Centro de eventos</p><h1>Bienvenido de vuelta.</h1><p>Ingresa para gestionar las solicitudes de cotización.</p>
      <form onSubmit={login}>
        <label>Email<input type="email" name="email" autoComplete="username" required maxLength={254} disabled={loginBusy} /></label>
        <label>Contraseña<input type="password" name="password" autoComplete="current-password" required minLength={12} maxLength={128} disabled={loginBusy} /></label>
        {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="admin-error">{error}</p>}
        <button className="admin-button" disabled={loginBusy}>{loginBusy ? "Ingresando…" : "Iniciar sesión"}</button>
      </form><a href="/">Volver al sitio</a>
    </section> : <div className="admin-content">
      <div className="admin-heading"><div><p className="admin-kicker">Cada historia comienza aquí</p><h1>Solicitudes de cotización</h1></div><button className="admin-secondary" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Actualizar</button></div>
      <div className="admin-stats">{Object.entries(statuses).map(([value, label]) => <button key={value} className={status === value ? "is-selected" : ""} onClick={() => { setPage(1); setStatus(status === value ? "" : value) }}><strong>{data?.counts[value as Status] ?? "—"}</strong><span>{label}</span></button>)}</div>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput); setRevision((value) => value + 1) }}>
        <label>Buscar<input value={searchInput} maxLength={120} onChange={(event) => setSearchInput(event.target.value)} placeholder="Nombre, email o mensaje" /></label>
        <label>Estado<select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }}><option value="">Todos los estados</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="admin-button" disabled={loading}>Buscar</button>
      </form>
      {error && <p role="alert" className="admin-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading ? <p role="status" className="admin-loading">Cargando solicitudes…</p> : !error && data && <>
        <p className="admin-result-count" role="status">{data.total} {data.total === 1 ? "solicitud encontrada" : "solicitudes encontradas"}</p>
        {data.items.length ? <div className="inquiry-list">{data.items.map((inquiry) => <InquiryCard key={`${inquiry.id}-${inquiry.version}`} inquiry={inquiry} onSaved={() => { setNotice("Cambios guardados."); setRevision((value) => value + 1) }} onUnauthorized={unauthorized} />)}</div> : <div className="admin-empty"><h2>No hay solicitudes.</h2><p>{search || status ? "Prueba con otros filtros." : "Las consultas enviadas desde el sitio aparecerán aquí."}</p></div>}
        <nav className="admin-pagination" aria-label="Páginas de solicitudes"><button className="admin-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button className="admin-secondary" disabled={page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>Siguiente</button></nav>
      </>}
    </div>}
  </main>
}
