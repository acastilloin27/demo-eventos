# Conectar Supabase con demo-eventos en Vercel

El sitio usa React en Vercel, una API Express dentro de una función Vercel y PostgreSQL en Supabase. El navegador habla con `/api` en tu propio dominio. Las claves de Supabase se usan exclusivamente en el servidor.

## 1. Crear el proyecto en Supabase

1. Abre https://supabase.com/dashboard y selecciona **New project**.
2. Selecciona tu organización, escribe `demo-eventos` y guarda la contraseña de la base de datos en tu gestor de contraseñas.
3. Selecciona la región y el plan que correspondan a tu cuenta y espera a que termine la creación.
4. En **SQL Editor → New query**, copia todo `supabase/migrations/202611040001_travesia.sql` y pulsa **Run**. Debe terminar sin errores. El archivo crea las tablas y funciones; no borra registros existentes si lo vuelves a ejecutar.

Las cuatro tablas `travesia_*` tienen RLS activado y no permiten acceso directo a visitantes ni usuarios de Supabase Auth. Las operaciones pasan por tu API, que comprueba la sesión del administrador. No agregues políticas públicas para solucionar un error de permisos.

## 2. Configurar las variables de Vercel

En Supabase, el diálogo **Connect** muestra la URL del proyecto. En **Settings → API Keys** encontrarás las claves. Para este backend se utiliza una **secret key** (`sb_secret_...`). También se admite la clave antigua `service_role`, si tu proyecto aún la usa. La clave pública `publishable`/`anon` no sirve para este backend.

En Vercel abre el proyecto que tiene el dominio `demo-eventos-liard.vercel.app` y entra en **Settings → Environment Variables**. Configura para **Production**:

| Variable | Valor |
| --- | --- |
| `STORAGE_PROVIDER` | `supabase` |
| `SUPABASE_URL` | La URL de tu proyecto, por ejemplo `https://TU-PROYECTO.supabase.co` |
| `SUPABASE_SECRET_KEY` | La clave secreta de servidor de ese mismo proyecto |
| `APP_ORIGIN` | `https://demo-eventos-liard.vercel.app` |

No agregues `VITE_` al nombre de la clave secreta. No la pegues en el chat, GitHub o código React. Vercel administra `NODE_ENV`; no necesitas configurar `PORT`, `HOST`, `DATABASE_PATH` ni `TRUST_PROXY_HOPS` para la función.

La clave secreta tiene privilegios de servidor y omite RLS. Por eso solo se utiliza en la función y en el comando local para crear administradores. Las funciones PostgreSQL rechazan llamadas con las claves públicas.

## 3. Crear tu administrador en Supabase

En tu copia local, edita `.env` con la URL y la clave del mismo proyecto. Si no existe, copia `.env.example` como `.env`. Cambia o agrega estas variables (sin duplicar líneas):

```dotenv
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=TU_CLAVE_SECRETA
APP_ORIGIN=http://localhost:5173
```

Ejecuta:

```powershell
npm ci
npm run admin:create
```

El comando pide email y contraseña con entrada oculta. Crea la cuenta en `travesia_admins` de Supabase. **No se crea desde Authentication → Users**: el panel conserva su propio sistema de sesión y contraseñas scrypt. Ejecutar el comando nuevamente con el mismo email cambia la contraseña y revoca sus sesiones.

Las cuentas y cotizaciones de SQLite local no se copian automáticamente a Supabase. Si ya hay datos reales en SQLite, conserva una copia y planifica su migración antes de cambiar el almacenamiento.

## 4. Volver a desplegar

En Vercel comprueba:

- Framework: **Vite**.
- Build command: `npm run build`.
- Output directory: `dist`.
- Node.js: rama **24.x**.
- El repositorio conectado es `acastilloin27/demo-eventos`, rama `main`.

El archivo `vercel.json` incluye la función de `/api` y permite abrir `/admin` directamente. Después de guardar las variables y tener el código actualizado en GitHub, usa **Deployments → Redeploy**. Las variables nuevas no se aplican a un despliegue anterior sin volver a desplegar.

La API solo acepta escrituras desde el origen configurado. Para usar previews de Vercel, configura un entorno de prueba separado y su `APP_ORIGIN` exacto; no abras el acceso a todos los dominios `*.vercel.app`.

## 5. Comprobar la conexión

1. Abre https://demo-eventos-liard.vercel.app/api/health. Debe responder `{"status":"ok"}`; esta ruta consulta Supabase.
2. Abre https://demo-eventos-liard.vercel.app/admin e inicia sesión con la cuenta creada mediante el comando.
3. Envía una cotización desde la portada y comprueba que aparece en el panel.
4. Cambia el estado y agrega una nota. Recarga y comprueba que se conservaron.

Si `/admin` responde 404, el despliegue todavía no contiene `vercel.json`. Si la API responde 503, revisa las variables. Si responde 500, consulta **Vercel → Logs** y comprueba que ejecutaste el SQL completo en el proyecto correcto. No publiques logs que contengan claves.

Los límites de solicitudes se comparten entre instancias mediante contadores atómicos en Supabase. Se guardan hashes de las IP, nunca la IP en texto. El sitio no envía correos automáticos y las fechas siguen siendo tentativas.

Referencias oficiales: [Vercel Functions](https://vercel.com/docs/functions/runtimes/node-js), [rutas SPA de Vite](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas), [claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys).
