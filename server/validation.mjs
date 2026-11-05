import { z } from 'zod'

export const eventTypes = ['Matrimonio', 'Evento corporativo', 'Celebración', 'Otro']
export const statuses = ['new', 'contacted', 'quoted', 'closed']
export function todayInChile() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

const eventDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= todayInChile() && Number(value.slice(0, 4)) <= new Date().getUTCFullYear() + 10
}, 'Indica una fecha válida, desde hoy y hasta diez años en el futuro.')

export const inquirySchema = z.object({
  name: z.string().trim().min(2, 'Escribe tu nombre.').max(120),
  email: z.string().trim().toLowerCase().email('Escribe un email válido.').max(254),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/, 'Revisa el teléfono.').default(''),
  type: z.enum(eventTypes),
  guests: z.number().int().min(10).max(280).nullable().default(null),
  eventDate: eventDate.nullable().default(null),
  message: z.string().trim().max(5000).default(''),
  website: z.string().max(0, 'No se pudo enviar la solicitud.').optional(),
}).strict()

export const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  status: z.enum(statuses).optional(),
  search: z.string().trim().max(120).default(''),
})

export const updateSchema = z.object({
  status: z.enum(statuses),
  notes: z.string().trim().max(10000),
  version: z.number().int().positive(),
}).strict()
