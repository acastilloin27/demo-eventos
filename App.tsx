import { useRef, useState, type FormEvent } from "react"
import { api, todayInChile } from "./client-api"

const photos = {
  hero: "https://images.unsplash.com/photo-1541020230467-e33e4f96f7fc?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=86&w=1800",
  tables:
    "https://images.unsplash.com/photo-1510076857177-7470076d4098?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=82&w=1200",
  dance:
    "https://images.unsplash.com/photo-1639330693395-0944b5bef0c7?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=82&w=1200",
  hall: "https://images.unsplash.com/photo-1712314947761-a8d718bd8c32?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=82&w=1200",
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  )
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? (
        <path d="M6 6l12 12M18 6 6 18" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  )
}

const eventTypes = [
  {
    number: "01",
    title: "Matrimonios",
    text: "Una celebración con identidad propia, desde la ceremonia hasta el último baile.",
  },
  {
    number: "02",
    title: "Eventos corporativos",
    text: "Lanzamientos, encuentros y cenas que conectan equipos y dejan una buena impresión.",
  },
  {
    number: "03",
    title: "Celebraciones",
    text: "Cumpleaños, graduaciones y aniversarios pensados para disfrutar sin preocupaciones.",
  },
]

const features = [
  ["Hasta 280", "invitados"],
  ["1.200 m²", "de espacios"],
  ["20 min", "del centro"],
  ["60", "estacionamientos"],
]

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [reference, setReference] = useState("")
  const requestKey = useRef(crypto.randomUUID())
  const inFlight = useRef(false)
  const lastPayload = useRef("")

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight.current) return
    const form = new FormData(event.currentTarget)
    const payload = JSON.stringify({
      name: form.get("name"), email: form.get("email"), phone: form.get("phone"),
      type: form.get("type"), guests: form.get("guests") ? Number(form.get("guests")) : null,
      eventDate: form.get("eventDate") || null, message: form.get("message"), website: form.get("website"),
    })
    if (lastPayload.current && payload !== lastPayload.current) requestKey.current = crypto.randomUUID()
    lastPayload.current = payload
    inFlight.current = true
    setSending(true); setSubmitError("")
    try {
      const result = await api<{ id: string }>("/inquiries", { method: "POST", headers: { "Idempotency-Key": requestKey.current }, body: payload })
      setReference(result.id.slice(0, 8)); setSent(true)
    } catch (error) { setSubmitError(error instanceof Error ? error.message : "No se pudo enviar la solicitud.") }
    finally { inFlight.current = false; setSending(false) }
  }

  const closeMenu = () => setMenuOpen(false)

  return (
    <main>
      <section className="hero" id="inicio">
        <img
          src={photos.hero}
          alt="Invitados celebrando en una recepción iluminada"
          className="hero-photo"
        />
        <div className="hero-shade" />
        <nav className="nav shell" aria-label="Navegación principal">
          <a href="#inicio" className="brand" onClick={closeMenu}>
            <span className="brand-mark">T</span>
            <span>
              <strong>TRAVESÍA</strong>
              <small>Centro de eventos</small>
            </span>
          </a>

          <div className={`nav-links ${menuOpen ? "is-open" : ""}`}>
            <a href="#espacios" onClick={closeMenu}>
              El lugar
            </a>
            <a href="#eventos" onClick={closeMenu}>
              Eventos
            </a>
            <a href="#galeria" onClick={closeMenu}>
              Galería
            </a>
            <a href="#contacto" onClick={closeMenu}>
              Contacto
            </a>
            <a href="#contacto" className="nav-cta" onClick={closeMenu}>
              Cotiza tu fecha
            </a>
          </div>

          <button
            className="menu-button"
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
          >
            <MenuIcon open={menuOpen} />
          </button>
        </nav>

        <div className="hero-content shell">
          <p className="eyebrow light">Concepción, Región del Biobío</p>
          <h1>
            El lugar donde
            <br />
            todo <em>comienza.</em>
          </h1>
          <p className="hero-copy">
            Un espacio rodeado de naturaleza, arquitectura cálida y todo lo
            necesario para celebrar a tu manera.
          </p>
          <a href="#espacios" className="text-link light-link">
            Descubre el lugar <ArrowIcon />
          </a>
        </div>

        <div className="hero-foot shell">
          <span>36°49&apos; S · 73°03&apos; O</span>
          <span className="scroll-line" />
          <span>Desliza para explorar</span>
        </div>
      </section>

      <section className="intro section shell" id="espacios">
        <div>
          <p className="eyebrow">Un refugio para celebrar</p>
          <h2>
            Cerca de la ciudad.
            <br />
            <em>Lejos de lo común.</em>
          </h2>
        </div>
        <div className="intro-copy">
          <p>
            En Travesía cada espacio fue pensado para reunir. Salones
            versátiles, jardines amplios y una propuesta gastronómica que
            transforma cada encuentro en una experiencia memorable.
          </p>
          <a href="#galeria" className="text-link">
            Conoce nuestros espacios <ArrowIcon />
          </a>
        </div>
        <div className="features">
          {features.map(([value, label]) => (
            <div className="feature" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="events" id="eventos">
        <div className="shell">
          <p className="eyebrow light">Tu evento, a tu manera</p>
          <div className="section-heading">
            <h2>
              Momentos que merecen
              <br />
              <em>un gran escenario.</em>
            </h2>
            <p>
              Nuestro equipo te acompaña desde la primera idea hasta el último
              detalle, para que tú solo tengas que disfrutar.
            </p>
          </div>

          <div className="event-list">
            {eventTypes.map((item) => (
              <a href="#contacto" className="event-row" key={item.title}>
                <span className="event-number">{item.number}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <span className="round-arrow">
                  <ArrowIcon />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="gallery section shell" id="galeria">
        <div className="gallery-grid">
          <figure className="gallery-main">
            <img
              src={photos.tables}
              alt="Montaje de mesas para un matrimonio"
            />
            <figcaption>Salón Arrayán · 180 personas</figcaption>
          </figure>
          <div className="gallery-copy">
            <p className="eyebrow">Espacios que se transforman</p>
            <h2>
              Un lienzo para
              <br />
              <em>tu historia.</em>
            </h2>
            <p>
              Interior o exterior, íntimo o multitudinario. Configuramos cada
              ambiente para que refleje el carácter de tu celebración.
            </p>
            <a href="#contacto" className="text-link">
              Agenda una visita <ArrowIcon />
            </a>
          </div>
          <figure className="gallery-small">
            <img
              src={photos.hall}
              alt="Salón de eventos preparado para recibir invitados"
            />
          </figure>
          <figure className="gallery-wide">
            <img
              src={photos.dance}
              alt="Pareja bailando frente a sus invitados"
            />
          </figure>
        </div>
      </section>

      <section className="quote-section">
        <div className="shell quote-wrap">
          <span className="quote-mark">“</span>
          <blockquote>
            Fue mucho más que un lugar bonito. Nos sentimos acompañados en cada
            decisión y el día resultó exactamente como lo imaginamos.
          </blockquote>
          <p>Josefina &amp; Matías · Noviembre 2024</p>
        </div>
      </section>

      <section className="contact section" id="contacto">
        <div className="shell contact-grid">
          <div className="contact-copy">
            <p className="eyebrow light">Conversemos</p>
            <h2>
              Tu próxima historia
              <br />
              <em>puede comenzar aquí.</em>
            </h2>
            <p>
              Cuéntanos qué estás imaginando. Te contactaremos para conocer los
              detalles y agendar una visita.
            </p>
            <div className="contact-meta">
              <div>
                <span>Visítanos</span>
                <p>Camino a Nonguén, Concepción</p>
              </div>
              <div>
                <span>Escríbenos</span>
                <a href="mailto:hola@travesiaeventos.cl">
                  hola@travesiaeventos.cl
                </a>
              </div>
            </div>
          </div>

          <form className="contact-form" onSubmit={handleSubmit}>
            {sent ? (
              <div className="success-message" role="status">
                <span>Solicitud recibida</span>
                <h3>Gracias por escribirnos.</h3>
                <p>
                  Te contactaremos pronto para comenzar a imaginar tu evento.
                </p>
                <p>Referencia: {reference}</p>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => { requestKey.current = crypto.randomUUID(); lastPayload.current = ""; setSent(false); setSubmitError("") }}
                >
                  Enviar otra consulta <ArrowIcon />
                </button>
              </div>
            ) : (
              <>
                <label>
                  <span>Nombre</span>
                  <input
                    type="text"
                    name="name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={120}
                    disabled={sending}
                    placeholder="Tu nombre y apellido"
                    required
                  />
                </label>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    maxLength={254}
                    disabled={sending}
                    placeholder="nombre@email.com"
                    required
                  />
                </label>
                <div className="form-row">
                  <label>
                    <span>Teléfono (opcional)</span>
                    <input type="tel" name="phone" autoComplete="tel" maxLength={30} placeholder="+56 9 1234 5678" disabled={sending} />
                  </label>
                  <label>
                    <span>Fecha tentativa (opcional)</span>
                    <input type="date" name="eventDate" min={todayInChile()} max={`${new Date().getFullYear() + 10}-12-31`} disabled={sending} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    <span>Tipo de evento</span>
                    <select name="type" defaultValue="" required disabled={sending}>
                      <option value="" disabled>
                        Selecciona
                      </option>
                      <option>Matrimonio</option>
                      <option>Evento corporativo</option>
                      <option>Celebración</option>
                      <option>Otro</option>
                    </select>
                  </label>
                  <label>
                    <span>Invitados</span>
                    <input
                      type="number"
                      name="guests"
                      placeholder="Ej. 120"
                      min="10"
                      max="280"
                      step="1"
                      disabled={sending}
                    />
                  </label>
                </div>
                <label>
                  <span>Cuéntanos sobre tu evento</span>
                  <textarea
                    name="message"
                    maxLength={5000}
                    disabled={sending}
                    placeholder="Fecha tentativa, ideas, preguntas..."
                    rows={3}
                  />
                </label>
                <div className="form-honeypot" aria-hidden="true">
                  <label>Sitio web<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
                </div>
                {submitError && <p className="form-error" role="alert">{submitError}</p>}
                <button type="submit" className="submit-button" disabled={sending}>
                  {sending ? "Enviando solicitud…" : "Solicitar cotización"} <ArrowIcon />
                </button>
              </>
            )}
          </form>
        </div>
      </section>

      <footer>
        <div className="shell footer-top">
          <a href="#inicio" className="brand dark-brand">
            <span className="brand-mark">T</span>
            <span>
              <strong>TRAVESÍA</strong>
              <small>Centro de eventos</small>
            </span>
          </a>
          <p>Celebraciones con sentido, en el corazón del Biobío.</p>
          <div className="social-links">
            <a href="#inicio">Instagram</a>
            <a href="#inicio">Pinterest</a>
          </div>
        </div>
        <div className="shell footer-bottom">
          <span>© {new Date().getFullYear()} Travesía Centro de Eventos</span>
          <span>Concepción · Chile</span>
        </div>
      </footer>
    </main>
  )
}
