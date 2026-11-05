# Travesía · Centro de eventos

Sitio React con API Express y base de datos SQLite persistente. Incluye solicitudes de cotización y panel de administración en `/admin`.

## Ejecutar localmente

Requiere Node.js 24.14 o superior de la rama 24. SQLite está incluido en Node; no necesitas instalar otro motor de base de datos. Node puede mostrar una advertencia sobre el módulo SQLite experimental.

```powershell
npm ci
Copy-Item .env.example .env
npm run admin:create
npm run dev
```

`admin:create` pide email y contraseña (12 a 128 caracteres) con entrada oculta. No hay cuenta ni contraseña predeterminadas. Ejecutar nuevamente con el mismo email cambia la contraseña y cierra sus sesiones existentes.

- Sitio: http://localhost:5173
- Administración: http://localhost:5173/admin
- API: http://127.0.0.1:3001/api/health

Las tablas se crean automáticamente. Los datos se guardan en `data/travesia.sqlite`; `.env`, sesiones y base de datos no se incluyen en Git.

## Funciones

- Formulario conectado a la API: nombre, email, teléfono opcional, fecha tentativa opcional, tipo de evento, invitados y mensaje.
- Validación en cliente y servidor; capacidad entre 10 y 280 invitados, según el diseño original.
- Confirmación con referencia solo después de guardar. Si falla la conexión se conservan los datos. Los reintentos con la misma clave y contenido no duplican solicitudes.
- Panel protegido con búsqueda por nombre, email o mensaje, filtros, contadores y paginación de 20 registros.
- Seguimiento mediante estados nueva, contactada, cotizada y cerrada, más notas internas. Si dos administradores editan la misma versión, se rechaza el segundo cambio para evitar sobrescribir datos.
- Contraseñas con scrypt; cookies HttpOnly y SameSite; sesiones de ocho horas almacenadas como hashes, con cierre y revocación.
- Límites de solicitudes, protección de origen, campo antispam, consultas SQL parametrizadas y límites de tamaño.

Las solicitudes se consultan desde el panel. No se envían correos automáticos ni se reservan fechas; la fecha del formulario es tentativa. Los enlaces de email abren tu aplicación de correo. Instagram y Pinterest conservan los enlaces de muestra del diseño: reemplázalos con las cuentas reales antes de publicar.

## Comprobaciones

```powershell
npm test
npm run build
```

Las pruebas usan bases aisladas y verifican persistencia, validaciones, autenticación, autorización, cookies, límites de solicitudes, filtros, paginación y conflictos de edición.

## Producción

Este repositorio requiere un servidor Node con disco persistente. No basta con publicar `dist` como sitio estático. `npm start` sirve el frontend compilado y la API desde el mismo origen.

1. Instala con `npm ci` y compila con `npm run build`.
2. Configura `.env`: `NODE_ENV=production`, `APP_ORIGIN=https://tu-dominio.cl`, `DATABASE_PATH` en un disco persistente y `HOST`/`PORT` según el hosting.
3. Ejecuta `npm run admin:create` en ese entorno y después `npm start`.
4. Configura HTTPS en el proxy o plataforma. Las cookies de producción requieren HTTPS. Si usas proxy, configura `TRUST_PROXY_HOPS` con el número exacto de saltos de confianza para identificar correctamente los clientes.
5. Ejecuta una sola instancia con esta configuración SQLite. Conserva copias de seguridad con la API de backup de SQLite o un snapshot consistente del volumen; el archivo puede tener datos pendientes en `-wal` mientras el servicio está activo. No borres `data/` al desplegar.

Los límites de solicitudes se mantienen en memoria y se reinician con el proceso. Para varias instancias se necesita una base compartida y un almacén compartido para esos límites. Las fotografías y fuentes dependen de Unsplash y Google Fonts, como en el diseño original.

## API

| Método y ruta | Acceso | Uso |
| --- | --- | --- |
| `GET /api/health` | Público | Estado del servicio y conexión a la base |
| `POST /api/inquiries` | Público | Crear consulta; requiere header `Idempotency-Key` con UUID |
| `POST /api/auth/login` | Público | Iniciar sesión con email y contraseña |
| `GET /api/auth/session` | Administrador | Consultar sesión |
| `POST /api/auth/logout` | Administrador | Cerrar sesión |
| `GET /api/admin/inquiries` | Administrador | Listar; parámetros `page`, `status`, `search` |
| `PATCH /api/admin/inquiries/:id` | Administrador | Guardar `{ status, notes, version }` |

Todas las escrituras usan JSON. Los datos de las consultas y las notas solo se entregan a administradores autenticados. No existe registro público de administradores.
