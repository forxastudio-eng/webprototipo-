# GPUnlock CRM · Plan de producto y desarrollo

CRM inmobiliario con IA, multiempresa y por suscripción, con app móvil que registra llamadas y conexión completa con Meta Ads.

Octubre 2026 · Base: `crm-inmobiliario.zip` (CRM multiempresa con IA y app instalable) + lo que ya existe en este repositorio (inventario, cotizador y landings de GPUnlock).

## Avance

| Semana | Estado | Qué quedó |
| --- | --- | --- |
| 1 · Preparación | Parcial | Repositorio reorganizado, base traída y pruebas automáticas (CI) corriendo. **Pendiente de tu lado:** cuentas (Meta Business, Anthropic, Supabase Pro), proveedor de telefonía y dominio. |
| 2 · Marca, origen de leads y cobros | **Hecha** | Marca GPUnlock en la app; Stripe fuera; `03_atribucion.sql` (UTM y clics de Meta/Google); `04_cobros.sql` y consola de pagos por transferencia; `lead.js` con origen de campaña; 94 comprobaciones de SQL y 61 de navegador. |
| 3 · Marca por empresa | Siguiente | Editor de logo y colores por inmobiliaria (M13). |

## Resumen ejecutivo

**Qué se vende.** Un CRM para inmobiliarias y constructoras que se contrata en línea, por usuario y por plan. Cada inmobiliaria tiene su espacio aislado, su equipo, sus proyectos, su inventario y sus integraciones (su página de Facebook, su número de WhatsApp, sus números de teléfono).

**Qué lo diferencia de un CRM genérico:**

1. **Inventario y cotizador inmobiliarios dentro del CRM**: unidades, disponibilidad, proformas con financiamiento, reserva y plan de pagos de la entrada, todo ligado al lead.
2. **App móvil que registra sola las llamadas**, las graba, las transcribe y deja en la ficha un resumen hecho por la IA con la siguiente tarea.
3. **Meta Ads de punta a punta**: los leads entran solos con su campaña, el CRM le devuelve a Meta qué leads compraron (Conversions API) y cada inmobiliaria ve su costo por venta por campaña.
4. **IA que trabaja sola**: califica, resume, recomienda unidades y avisa de leads en riesgo. Nunca envía nada al cliente sin que una persona lo apruebe.

**Datos clave**

| | |
| --- | --- |
| Esfuerzo | 21 semanas de una persona desarrolladora, en 6 fases. En la semana 5 el producto ya se puede vender (CRM con la marca de cada empresa + inventario + cotizador + app instalable). |
| Base técnica | Supabase (Postgres con RLS por empresa, Auth, Storage, Edge Functions, Realtime, `pg_cron`, Vault) + Netlify + JavaScript sin compilación. Solo la cáscara nativa de la app (Capacitor) se compila. |
| Modelo de cobro | Planes por suscripción mensual o anual, **pagados por transferencia bancaria** y activados por GPUnlock desde su consola. Sin pasarela de pagos. Complementos de telefonía como paquetes prepagados. |
| Distribución de la app | **Sin tiendas.** Se descarga desde la web de GPUnlock (`/descargar`): Android como app nativa (APK firmado), iPhone y computadoras como app web instalable. Ver M3. |
| Mayor riesgo técnico | El registro automático de llamadas: en Android funciona con la app descargada de la web; iPhone no deja que ninguna app lea las llamadas, así que ahí se usa la telefonía en la nube (ver M5). |
| Mayor riesgo de negocio | Los cobros por transferencia dependen de que GPUnlock revise y apruebe los pagos a tiempo; se resuelve con recordatorios automáticos, días de gracia y una cola de pagos por aprobar en la consola (ver M12). |

## Punto de partida

### Lo que trae la base (`crm-inmobiliario.zip`)

| Pieza | Archivo | Estado |
| --- | --- | --- |
| Multiempresa: planes, organizaciones, miembros, invitaciones | `supabase/01_nucleo.sql` | Completo. Roles propietario, administrador, agente y lector, con RLS por `org_id` |
| Prueba de 14 días y solo lectura al vencer | `organizaciones.estado`, `org_activa()` | Completo. Los formularios nunca pierden un lead aunque la cuenta esté vencida |
| CRM: contactos, oportunidades, actividades y tareas, 7 etapas, 15 fuentes | `supabase/02_crm.sql` | Completo. Deduplicación por teléfono normalizado, reparto rotativo por carga, historial automático de cambios de etapa |
| Captura de leads de la web de cada cliente | `web/embed/lead.js`, `crm_registrar_lead` | Completo, con campo trampa. **No guarda UTM ni `fbclid`** |
| App instalable (PWA): Hoy, Embudo, Asistente IA, Métricas, Ajustes | `web/app/` | Completa. Sin avisos push, sin trabajo sin conexión más allá de abrir la app |
| IA: resumen y calificación, borradores, nota dictada, preguntas al embudo | `supabase/functions/crm-ia` | Completa, con límite por persona y hora y por empresa y mes según el plan |
| Cobros con Stripe: checkout, portal y webhook | `supabase/functions/billing-*`, columnas `stripe_*` | **Se elimina.** Se reemplaza por cobro por transferencia (M12). Se conserva la idea clave: una empresa nunca puede cambiarse el plan a sí misma |
| Página de ventas con precios desde la base | `web/index.html` | Completa |
| Métricas por etapa, fuente y asesor | `crm_metricas()` | Completa |

### Lo que aporta este repositorio (GPUnlock)

Es una plataforma de **una sola inmobiliaria** (sin `org_id`): landings de 3 proyectos, inventario en 4 tablas distintas (`units`, `prisma_units`, `lots`, `cotizador_unidades`), cotizador con financiamiento y proformas (`cotizador_historial`), dashboard de marketing y panel con roles por correo. Su lógica de inventario y de cotizador es justo lo que le falta a la base; se reescribe como módulo multiempresa (M2). Las landings quedan como **sitio de demostración** de un cliente ficticio, que usa `lead.js` para mostrar el producto funcionando.

### Lo que falta para el producto completo

Inventario y cotizador por empresa, avisos push, app nativa, llamadas, WhatsApp dentro del CRM, Meta Ads, agenda, automatizaciones, IA proactiva, reservas y pagos, importación de cartera, portales, consola de administración del producto (para GPUnlock) y cumplimiento de privacidad.

## Organización del repositorio

```
web/                       producto (Netlify sitio 1: app.gpunlock…)
  index.html               página de ventas (tu web principal)
  descargar/               descarga de la app: APK de Android y guías para iPhone y computadora
  app/                     app (PWA) y CRM de escritorio, misma base de código
  embed/lead.js            captura de leads para las webs de los clientes
  embed/inventario.js      disponibilidad en vivo para las webs de los clientes (nuevo)
supabase/
  01_nucleo.sql  02_crm.sql   de la base
  03_… en adelante            migraciones nuevas (ver plan semanal)
  functions/                  Edge Functions
  tests/                      pruebas de aislamiento y permisos (pgTAP)
mobile/                    cáscara Capacitor solo para Android + plugin de llamadas (el APK se publica en web/descargar/)
demo/                      landings actuales de GPUnlock como cliente de demostración (Netlify sitio 2)
docs/                      este plan, manuales, textos legales
e2e/                       pruebas de punta a punta (Playwright)
```

El contenido actual de `site/`, `supabase/` y `scripts/` pasa a `demo/` y a `docs/legado/` para consulta; nada se borra sin haber portado antes su lógica.

## Arquitectura

```
 Web del cliente (lead.js) ──┐
 Meta Lead Ads ──────────────┤
 WhatsApp Cloud API ─────────┤    Edge Functions                  Postgres (RLS por org_id)
 Proveedor de telefonía ─────┼──► · verifican firma          ──►  crm_alta_lead  ──►  oportunidades, actividades…
 Correo de portales ─────────┤    · buscan la empresa por             │                      │
 App Android (llamadas SIM) ─┘      page_id / phone_number_id /       │                      ├─► Realtime ─► app y escritorio
                                    número / clave pública             │                      ├─► pg_cron: reglas, IA nocturna,
                                                                       │                      │   gasto de Meta, retención
                                                                       │                      └─► Storage privado por empresa
                                                                       └─► Claude (IA) · voz a texto · Meta Conversions API · push
```

**Reglas de diseño que se mantienen de la base:**

- Todo dato lleva `org_id` y su política RLS. Una prueba automática verifica, para cada tabla nueva, que una empresa no ve ni escribe datos de otra.
- Todo lead entra por `crm_alta_lead` (deduplica por teléfono y correo, reparte, registra la fuente).
- Escrituras sensibles solo por funciones `security definer` que validan rol, plan y estado de la suscripción.
- Un lead entrante nunca se rechaza por plan vencido o lleno: se guarda y se avisa.
- Los secretos de cada empresa (tokens de Meta, WhatsApp, telefonía) se guardan cifrados en **Supabase Vault**, nunca en tablas legibles desde la app.

**Integraciones por empresa.** Nueva tabla `org_integraciones` (empresa, tipo `meta` / `whatsapp` / `telefonia` / `correo_entrante`, estado, identificadores públicos como `page_id`, `ad_account_id`, `phone_number_id`, `dataset_id`, y referencia al secreto en Vault). Los webhooks son únicos para todo el producto y encuentran la empresa por esos identificadores.

**Planes y complementos.** La tabla `planes` agrega `funciones jsonb` (qué módulos incluye: whatsapp, llamadas, meta_capi, automatizaciones) y nuevos límites (`ia_mes`, `almacenamiento_gb`). Una tabla `uso_mensual` acumula por empresa los minutos, mensajes y consultas, y descuenta los paquetes prepagados de telefonía e IA de llamadas (M12).

## Módulos

### M1 · Base en producción y atribución

- Traer la base al repositorio, aplicar la marca GPUnlock, publicar en un proyecto de Supabase de pruebas y otro de producción.
- `lead.js` captura `utm_*`, `gclid`, `fbclid` y la página de origen (guardados 30 días en el navegador) y los envía en un nuevo parámetro `p_atribucion jsonb`. Columnas nuevas en `crm_oportunidades`: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `campaign_id`, `adset_id`, `ad_id`, `form_id`, `leadgen_id`, `ctwa_clid`, `fbclid`.
- Cloudflare Turnstile opcional en `lead.js` y CAPTCHA en el registro (la prueba gratis atrae registros falsos).
- **Consola de GPUnlock** (solo para el equipo de GPUnlock, rol `superadmin` fuera de las empresas): empresas, plan, estado, uso del mes, **pagos por transferencia por revisar** (M12), ingresos, extender prueba, entrar en modo soporte con registro de auditoría.

### M2 · Inventario y cotizador por empresa

Lo que hace a este CRM inmobiliario. Se porta la lógica de GPUnlock a tablas con `org_id`:

- `crm_unidades`: proyecto, código, tipo (departamento, suite, loft, casa, lote, local, parqueo, bodega), piso, área, dormitorios, baños, precio, estado (disponible, reservada, vendida, no disponible), fotos y ficha. Importación desde Excel.
- `crm_cotizador_config` por proyecto: tasa, plazos, porcentajes de reserva, promesa y entrada (lo que hoy está en `cotizador_proyectos`).
- `crm_cotizaciones`: oportunidad, unidades, descuento, precio final, plan de entrada, financiamiento, número correlativo por proyecto, PDF en Storage.
- En la ficha del lead: cotizar en 3 toques desde el celular, enviar el PDF por WhatsApp, ver todas las proformas. Al guardar una proforma, la oportunidad sube a *Proforma* y toma su valor.
- Reservar o vender una unidad mueve la oportunidad a *Reserva* o *Vendido*; los demás leads interesados en esa unidad reciben la tarea «ofrecer alternativa» con 3 unidades parecidas sugeridas por la IA.
- `embed/inventario.js`: la web de cada cliente muestra disponibilidad y precios en vivo (lo que hoy hacen las landings de GPUnlock con Supabase directo).

### M3 · App móvil

**Paso 1 · App web instalable mejorada** (sobre `web/app/` de la base):

- Avisos push (Web Push; en iPhone requiere instalar la app, iOS 16.4 o posterior).
- Cartera disponible sin conexión y cola de acciones que se envía al volver la señal.
- Ficha con botones grandes: Llamar, WhatsApp, Cotizar, Agendar, Nota de voz, Cambiar etapa.
- Nota de voz grabada en la app → voz a texto → la acción `nota` de `crm-ia` que ya existe.
- Vista de escritorio más ancha para administradores (tablero de embudo, listas con filtros, exportar).

**Paso 2 · App nativa para Android con Capacitor** (`mobile/`), una sola app para todas las empresas (la empresa sale del inicio de sesión y su marca se aplica sola, ver M13):

- Push nativo fiable (FCM) aunque la app esté cerrada, identificador de llamadas entrantes de leads, check-in con ubicación en visitas, cámara para documentos, huella para entrar.
- Plugin de registro de llamadas (M5, vía B).
- La interfaz se carga desde el servidor, así que casi todas las mejoras llegan sin reinstalar. Solo los cambios del código nativo (por ejemplo el plugin de llamadas) necesitan un APK nuevo.

**Distribución sin tiendas: página `/descargar` en la web de GPUnlock**

La página detecta el dispositivo y muestra solo lo que sirve:

| Dispositivo | Qué se instala | Cómo |
| --- | --- | --- |
| **Android** | App nativa (APK) con registro de llamadas | Botón *Descargar para Android*, guía con capturas para permitir «instalar apps de este origen» (se hace una sola vez) y aceptar los permisos. |
| **iPhone y iPad** | App web instalable (PWA) | Apple no permite instalar apps fuera de la App Store, así que se instala la versión web: guía de 3 pasos *Compartir → Agregar a inicio*. Queda con ícono, pantalla completa y avisos push (iOS 16.4 o posterior). |
| **Computadora** | App web instalable | Botón *Instalar* (Chrome y Edge) y un código QR para abrir la descarga en el celular. |

- **Actualizaciones del APK:** la app consulta al abrir un archivo `version.json`; si hay una versión nueva muestra *Actualizar*, descarga el APK y Android pide confirmar la instalación. Se puede marcar una versión como obligatoria.
- **Firma y confianza:** el APK se firma siempre con la misma clave de GPUnlock (si se pierde, los teléfonos no aceptan actualizaciones; se guarda en dos lugares seguros). La página publica la huella SHA-256 del archivo y la versión.
- **Aviso de seguridad de Android:** Google Play Protect puede advertir al instalar una app de fuera de la tienda; la guía lo explica. Google anunció que, por etapas y por país desde 2026, los teléfonos Android certificados solo instalarán apps de desarrolladores verificados aunque no estén en la tienda: GPUnlock registra su identidad y el nombre del paquete en la consola de desarrolladores de Android (sin publicar en Google Play). Verificar el calendario para Ecuador al iniciar.
- **Instalación por empresa:** el enlace de descarga puede incluir la empresa (`/descargar?e=miempresa`), así la app abre directamente con su logo y colores en la pantalla de inicio de sesión.

### M4 · Meta Ads

Cada inmobiliaria conecta su cuenta desde **Ajustes → Integraciones → Conectar con Facebook** (Facebook Login for Business), elige su página, su cuenta publicitaria y su conjunto de datos, y listo.

1. **Leads de formularios.** Un solo webhook `meta-leads-webhook` para todo el producto: recibe el evento `leadgen`, encuentra la empresa por `page_id`, pide el lead a la Graph API con el token de esa empresa, aplica el mapeo de preguntas que la empresa configuró y llama a `crm_alta_lead` con campaña, conjunto, anuncio y formulario. Recuperación nocturna de leads no entregados.
2. **Anuncios que abren WhatsApp.** La bandeja (M6) guarda los datos del anuncio de origen del primer mensaje.
3. **Conversions API.** Cada cambio de etapa genera un evento en la cola `crm_meta_eventos` (*Lead calificado*, *Cita*, *Visita*, *Reserva*, *Venta* con valor) que `meta-capi` envía al conjunto de datos de esa empresa, con teléfono y correo cifrados (SHA-256) y `event_id` para no duplicar. Así cada inmobiliaria puede optimizar sus campañas por leads que compran.
4. **Gasto.** `meta-insights` baja cada día el gasto por campaña, conjunto y anuncio de cada empresa a `marketing_inversion`. Métricas: costo por lead, por cita, por reserva y por venta; retorno por campaña.

**Qué necesita GPUnlock (una sola vez):** empresa verificada en Meta Business, una app de Meta con revisión aprobada de los permisos `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_read` y `business_management`. La revisión pide video de demostración y política de privacidad publicada; puede tardar semanas, por eso se inicia en la semana 1.

### M5 · Llamadas

Dos vías, más una de respaldo:

| Vía | Cómo funciona | iPhone | Grabación | Cómo se cobra |
| --- | --- | --- | --- | --- |
| **A. Telefonía en la nube** (principal) | Cada empresa activa el complemento y recibe uno o más números virtuales. *Llamar* en la app hace una llamada puente: suena el celular del asesor y luego se conecta al cliente mostrando el número de la empresa. Las entrantes se enrutan al asesor del lead. El proveedor avisa por webhook. | Sí | En servidor, con aviso de grabación automático | Paquete prepagado (número + minutos), pagado por transferencia |
| **B. App Android con la SIM** | Plugin nativo de la app descargada de la web que, al colgar, lee número, dirección y duración del registro del teléfono y lo liga al lead; si es un número nuevo pregunta «¿Crear lead?». Sube la grabación de la grabadora integrada del teléfono si existe. | No | Depende del teléfono | Incluido en todos los planes |
| **C. Manual asistida** | `tel:` y al volver a la app, resultado en un toque y nota de voz | Sí | No | Incluido |

**Recomendación:** como la app de Android se descarga de la web y no pasa por la revisión de Google Play, el permiso para leer el registro de llamadas (`READ_CALL_LOG`) se puede usar sin restricción de tienda. Entonces: **en Android, la vía B por defecto** (sin costo extra, con la SIM del asesor); **la vía A como complemento pagado** para equipos con iPhone y para empresas que quieren un número propio que se quede en la empresa y grabación fiable en servidor. La vía C queda siempre como respaldo.

**Proveedor de telefonía:** uno con subcuentas por cliente, números de Ecuador y del resto de la región, API de llamadas puente y grabación (Twilio, Telnyx, Plivo o Zadarma; comparar cobertura y precio por minuto antes de elegir). GPUnlock revende con margen.

**Proceso de cada llamada** (`llamada-procesar`, en cola):

1. Se guarda en `crm_llamadas` (empresa, oportunidad, asesor, dirección, número, inicio, duración, resultado, vía, grabación, transcripción, resumen, datos extraídos, puntaje).
2. Llamadas sin contestar o de menos de 20 segundos: solo cuentan como intento.
3. Voz a texto en español con separación de hablantes (servicio aparte; Claude no transcribe audio; comparar Deepgram, AssemblyAI, Google y Whisper con 20 grabaciones reales).
4. Claude devuelve en JSON: resumen, datos del cliente (presupuesto, dormitorios, forma de pago, plazo, objeciones), siguiente paso con fecha, etapa sugerida y calificación.
5. Se crea la tarea y se propone la etapa; el asesor confirma con un toque.
6. Por la noche, en lotes: puntaje de la llamada y consejos semanales por asesor.

**Legal:** aviso de grabación al inicio; cada empresa cliente es responsable de sus datos y GPUnlock actúa como encargado del tratamiento (contrato de tratamiento de datos en los términos del servicio); conservación configurable por empresa (12 meses por defecto) con borrado automático.

### M6 · WhatsApp dentro del CRM

- GPUnlock se registra como **proveedor tecnológico de Meta** y usa el **registro integrado** (Embedded Signup): cada inmobiliaria conecta su propio número desde Ajustes en unos minutos y Meta le cobra sus conversaciones directamente.
- `wa-webhook` único, que encuentra la empresa por `phone_number_id`; un número nuevo crea el lead con fuente `whatsapp`. `wa-enviar` con la regla de 24 horas (fuera de ella, solo plantillas aprobadas).
- Bandeja en la app y en escritorio: no leídos primero, hilo dentro de la ficha, adjuntos, notas de voz transcritas, plantillas, «Sugerir respuesta» con la IA usando precios reales del inventario.
- Decisión de cada cliente: conectar su número actual (puede dejar de funcionar en la app de WhatsApp salvo que Meta permita la coexistencia) o uno nuevo.

### M7 · Agenda y automatizaciones

- `crm_citas`: visita a obra, llamada o videollamada; vista por día y semana; check-in con ubicación; recordatorio al cliente por plantilla de WhatsApp; *no asistió* con reprogramación.
- Motor de reglas por empresa (`pg_cron` cada 5 minutos, `crm_reglas` y `crm_reglas_log`), activables desde Ajustes:
  1. Lead nuevo sin contacto en 15 minutos → aviso al administrador; a los 60, reasignación.
  2. Sin actividad 3 días en *Contactado* o *Cita* → tarea con borrador de la IA.
  3. Cita mañana → recordatorio al asesor y confirmación al cliente.
  4. Proforma sin respuesta en 48 horas → tarea.
  5. Llamada no contestada → reintento (máximo 3 en 5 días, en horarios distintos).
  6. Perdido por «No responde» → reactivación a los 60 días.
- Resumen diario por correo a las 8:00 y semanal al propietario.

### M8 · Reservas, pagos y comisiones

- Reserva y promesa con documentos del cliente en Storage privado; la IA lee cédula, roles de pago y precalificación bancaria y llena los datos.
- Plan de pagos de la entrada (`crm_pagos`): cuotas, comprobantes, recordatorios y alerta de mora.
- Comisiones por proyecto para asesores y referidores.

### M9 · IA

Todas por Edge Functions, salida estructurada en JSON, uso descontado del plan (`crm_ia_reservar` ya existe) y registro en `crm_ia_uso`. La IA lee con los permisos de quien pregunta; precios y disponibilidad salen siempre del inventario, nunca inventados; el texto de clientes y transcripciones es dato, nunca instrucción.

| # | Función | Estado |
| --- | --- | --- |
| 1 | Resumen, siguiente acción y calificación | Existe (`resumen`) |
| 2 | Borrador de WhatsApp o correo | Existe (`mensaje`) |
| 3 | Nota dictada a nota limpia, tareas y etapa | Existe (`nota`); se le agrega la voz |
| 4 | Preguntas al embudo | Existe (`consulta`); pasa a usar herramientas de solo lectura sin límite de 250 leads |
| 5 | Resumen y datos de cada llamada | Nueva (M5) |
| 6 | Calificación automática de cada lead, mensaje y llamada | Nueva; alimenta el evento *Lead calificado* de Meta |
| 7 | Recomendación de 3 unidades con precio real | Nueva (M2) |
| 8 | Sugerir respuesta de WhatsApp | Nueva (M6) |
| 9 | Leads en riesgo cada noche | Nueva, por lotes |
| 10 | Coaching de llamadas por asesor | Nueva, por lotes |
| 11 | Informe mensual por campaña de Meta | Nueva |
| 12 | Lectura de documentos para la reserva | Nueva (M8) |

**Modelo:** Claude Opus 5.5 (`claude-opus-5-5`) por defecto, como ya hace la base (`CRM_IA_MODEL`). Las funciones de volumen (5, 6) se prueban también con Claude Sonnet 5.5 o Claude Haiku 4.5 sobre 30 casos reales y se decide por calidad y margen. Los procesos nocturnos (9, 10, 11) usan la API de lotes de Anthropic (mitad de precio), y el prompt fijo de cada función se guarda en caché.

### M10 · Fuentes adicionales e importación

- Importación de cartera desde Excel con mapeo de columnas, vista previa y duplicados marcados.
- Portales inmobiliarios: cada empresa recibe una dirección de correo de entrada; la IA extrae nombre, teléfono e inmueble de los correos del portal.
- Formularios de Google Ads por webhook, TikTok Lead Ads (la fuente `tiktok` ya existe en la base).

### M11 · Seguridad, privacidad y calidad

- Términos del servicio, política de privacidad y contrato de tratamiento de datos revisados por un abogado (LOPDP de Ecuador y leyes de cada país donde se venda); transferencia internacional declarada (Supabase, Anthropic, Meta, telefonía, voz a texto).
- Exportar y suprimir los datos de un contacto; exportar todos los datos de una empresa al cancelar; borrado definitivo a los 90 días de cancelar.
- Doble factor obligatorio para propietarios y administradores; auditoría de exportaciones, reasignaciones y accesos de soporte.
- Pruebas: aislamiento entre empresas y permisos por rol en SQL (pgTAP), punta a punta con Playwright, GitHub Actions en cada cambio, copias diarias, alertas si un webhook falla 3 veces seguidas.

### M12 · Cobro de suscripciones por transferencia

Sin pasarela de pagos. GPUnlock recibe transferencias en su cuenta bancaria y activa cada suscripción desde su consola. Se eliminan de la base las funciones `billing-checkout`, `billing-portal` y `billing-webhook`, las columnas `stripe_*` y la tabla `eventos_facturacion`.

**Cómo lo vive la inmobiliaria**

1. Se registra y usa la prueba gratis de 14 días (como hoy).
2. En **Ajustes → Plan y pagos** elige plan y periodo (mensual o anual). La app le muestra el monto con impuestos, los datos de la cuenta bancaria de GPUnlock y un **código de referencia único** (por ejemplo `GPU-7F3K-2611`) para poner en la descripción de la transferencia.
3. Transfiere y sube la foto o el PDF del comprobante en la misma pantalla. Su solicitud queda *En revisión*; mientras tanto la cuenta sigue funcionando normalmente.
4. Cuando GPUnlock aprueba, recibe un correo de confirmación con su factura y ve el plan activo y la fecha del próximo pago.
5. Recordatorios automáticos 7 días, 3 días y el día del vencimiento, con el monto y la referencia ya listos. Después del vencimiento tiene **5 días de gracia**; luego la cuenta pasa a solo lectura (como ya hace la base): no se borra nada y los leads de formularios, Meta y WhatsApp siguen entrando.

**Cómo lo vive GPUnlock (consola)**

- Cola *Pagos por revisar*: empresa, plan, periodo, monto esperado, referencia, comprobante y fecha. Aviso por correo al equipo de GPUnlock cada vez que entra uno.
- **Aprobar** (después de ver el dinero en el banco): registra el pago, activa o extiende la suscripción desde la fecha de vencimiento anterior (no desde hoy, para no regalar ni quitar días) y envía la confirmación. **Rechazar** con motivo, que le llega a la empresa.
- Acciones manuales: cambiar de plan, extender una prueba, dar días de cortesía, registrar un pago recibido sin solicitud previa.
- Reportes: ingresos por mes, cobros por vencer en los próximos 30 días, empresas en gracia y en solo lectura, exportación para contabilidad.

**Base de datos (`supabase/04_cobros.sql`)**

| Pieza | Para qué |
| --- | --- |
| `datos_cobro` | Cuenta bancaria, titular, RUC, tasa de impuesto y textos que ve el cliente (editable solo por superadmin) |
| `solicitudes_pago` | Empresa, plan, periodo, monto, referencia única, comprobante en Storage privado, estado (`en_revision`, `aprobada`, `rechazada`), motivo, quién y cuándo revisó |
| `pagos_suscripcion` | Pagos aprobados: monto, fecha de transferencia, banco, número de comprobante, periodo cubierto (desde, hasta), número de factura |
| `solicitar_pago(org, plan, periodo)` | Solo el propietario de la empresa. Calcula el monto desde `planes` y genera la referencia |
| `subir_comprobante(solicitud, ruta)` | Solo el propietario |
| `aprobar_pago(solicitud, fecha, banco, comprobante)` y `rechazar_pago(solicitud, motivo)` | **Solo superadmin de GPUnlock.** Es la única forma de cambiar `plan_id`, `estado` y `periodo_hasta` de una empresa |
| Tarea diaria (`pg_cron`) | Recordatorios, paso a gracia y a solo lectura, aviso al equipo de GPUnlock de pagos sin revisar por más de 24 horas |

`organizaciones` cambia sus estados a `prueba`, `activa`, `gracia`, `vencida` y `cancelada`, y `org_activa()` considera activa una empresa en gracia.

**Factura.** En Ecuador cada pago necesita una factura electrónica autorizada por el SRI. Para empezar, se emite desde el sistema de facturación que ya use GPUnlock y su número se registra al aprobar el pago. Más adelante, si el volumen lo justifica, se integra un proveedor de facturación electrónica con API para que la factura salga sola al aprobar.

**Complementos de uso** (minutos de telefonía, IA de llamadas): como paquetes **prepagados** que se compran con el mismo flujo de transferencia. Al aprobarse, el saldo se acredita en `uso_mensual`; con saldo bajo se avisa, y sin saldo las llamadas pasan a la vía manual en lugar de cortarse. Así GPUnlock nunca pone dinero por adelantado para un cliente.

### M13 · Marca de cada empresa (logos, colores y tema automático)

Cada inmobiliaria ve el CRM como si fuera suyo. Lo configura el propietario o un administrador en **Ajustes → Marca**, sin ayuda de GPUnlock.

**Qué configura**

- Logo horizontal (para la barra y los PDF), logo para fondo oscuro (opcional) e ícono cuadrado (opcional; si no lo sube, se genera con sus iniciales sobre su color).
- Color principal y, si quiere, un color de acento.
- Nombre comercial que aparece en la app, los correos y los PDF.
- Tipografía de títulos, de una lista corta de fuentes alojadas en el propio sitio (sin depender de servicios externos).
- Cada usuario elige en su perfil modo **claro, oscuro o automático** (sigue al teléfono).

**Lo que pasa solo**

1. **Colores sacados del logo.** Al subirlo, la app lee sus colores dominantes en el mismo navegador (sin enviar la imagen a ningún servicio) y propone 3 combinaciones. Un toque y queda.
2. **Paleta completa desde un solo color.** A partir del color principal se generan los tonos claros y oscuros, el color al pasar el mouse, el degradado, la versión para modo oscuro y el color del texto sobre los botones (blanco u oscuro, el que se lea mejor).
3. **Contraste garantizado.** Si el color elegido no se lee bien como texto sobre blanco (contraste menor a 4,5:1, norma AA), se crea sola una variante más oscura para textos y enlaces, y se le avisa. Los colores de estado (verde, ámbar, rojo) y los de las etapas del embudo no cambian, para que siempre signifiquen lo mismo.
4. **Vista previa en vivo** antes de guardar: barra superior, botón, tarjeta de lead y gráfico, en claro y oscuro.
5. **Cambio al instante para todo el equipo.** Al guardar, la app de cada miembro cambia de tema sin recargar ni reinstalar (Supabase Realtime sobre `org_marca`).
6. **Sin parpadeo al abrir.** El celular recuerda el último tema y lo aplica antes de mostrar la primera pantalla; luego lo confirma con el servidor.

**Dónde aparece la marca**

| Lugar | Cómo |
| --- | --- |
| App y CRM de escritorio | Logo, colores, color de la barra del navegador (`theme-color`) |
| Inicio de sesión | Por subdominio (`miempresa.gpunlock…`) o por enlace (`/app/?e=miempresa`): la persona ve el logo de su empresa antes de entrar |
| Ícono de la app web instalable | El manifest se genera por empresa (nombre, ícono y color) con una función de Netlify según el subdominio, así el ícono en el iPhone o la computadora es el de la inmobiliaria |
| App Android (APK) | Una sola app GPUnlock que toma la marca de la empresa al iniciar sesión. El ícono en el teléfono es el de GPUnlock. **Opcional para el plan Agencia:** APK con nombre e ícono de la inmobiliaria, generado automáticamente por GitHub Actions desde la consola y publicado en su enlace de descarga |
| Proformas, fichas de unidades y reservas en PDF | Logo, colores y datos de la empresa |
| Correos (recordatorios, resumen diario, confirmaciones) | Logo y color; remitente con el nombre de la empresa |
| Widgets en la web del cliente (`lead.js`, `inventario.js`) | Toman sus colores por defecto |
| Pie «Con la tecnología de GPUnlock» | Visible en Inicial y Profesional; se puede quitar en Agencia (marca blanca completa) |
| Dominio propio (`crm.miinmobiliaria.com`) | Opcional en Agencia: se agrega como alias del sitio en Netlify con certificado automático |

**Cómo se construye**

- La base ya separa colores primitivos y semánticos en `web/css/tokens.css`, y `app.css` usa variables en casi todo; los pocos colores fijos se pasan a variables. Se agrega el conjunto de variables para modo oscuro.
- `web/js/tema.js` calcula la paleta (en el espacio de color OKLCH, para que los tonos se vean parejos), revisa el contraste y escribe las variables en `:root`. Lo usan la app, el escritorio, `/descargar`, los widgets y la plantilla de PDF.
- Tabla `org_marca` (empresa, nombre comercial, rutas de logos e ícono, color principal y de acento, tipografía, paleta calculada, mostrar pie de GPUnlock, subdominio único, dominio propio) y función `actualizar_marca()` que solo acepta al propietario o a un administrador de esa empresa y valida los colores.
- Bucket `marcas` en Storage: lectura pública (los logos se ven en webs y PDF), escritura solo en la carpeta de la propia empresa. PNG, JPG, WebP o SVG de hasta 1 MB; los SVG se limpian de scripts o se convierten a PNG antes de guardarlos.
- El plan de cada empresa define qué puede personalizar (`planes.funciones`: `marca_blanca`, `dominio_propio`, `apk_propio`).

**Terminado cuando:** una empresa sube su logo, acepta la paleta sugerida y en menos de 1 minuto todo su equipo ve la app, los PDF y los correos con su marca, en claro y oscuro, con contraste AA comprobado.

## Plan de desarrollo semana a semana

**Forma de trabajo:** un PR por semana a `main`, probado primero en el proyecto de pruebas; demostración los viernes con una inmobiliaria piloto (puede ser la que inspiró la base) que usa el producto real desde la semana 5.

### Fase 0 · Preparación (semana 1)

| Trabajo | Listo cuando |
| --- | --- |
| Cuentas a nombre de GPUnlock: Supabase Pro (pruebas y producción), Anthropic con límite de gasto, Meta Business (verificación) y app de Meta, Firebase (avisos push de Android), registro como desarrollador verificado de Android (sin publicar en Google Play), clave de firma del APK guardada en dos lugares seguros, cuenta bancaria de la empresa para recibir transferencias, firma electrónica y punto de emisión para facturación electrónica del SRI. Pedir el alta como proveedor tecnológico de WhatsApp. Reorganizar el repositorio (`web/`, `supabase/`, `demo/`, `docs/`). GitHub Actions con la primera prueba de aislamiento. | La base corre en el proyecto de pruebas y CI pasa en cada PR |

### Fase 1 · Producto vendible (semanas 2 a 5)

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 2 | Marca GPUnlock en la página de ventas. Quitar Stripe (`billing-*`, columnas `stripe_*`). `03_atribucion.sql` + `lead.js` con UTM y `fbclid`. `04_cobros.sql`: solicitudes de pago, comprobantes, aprobación por superadmin, recordatorios y gracia (M12). Consola de GPUnlock con la cola de pagos. CAPTCHA en registro. | Una empresa de prueba pide el plan Profesional, sube su comprobante, GPUnlock lo aprueba y la empresa ve el plan activo con su fecha de vencimiento |
| 3 | `06_marca.sql` y M13: editor de marca en Ajustes, paleta automática desde el logo o desde un color, control de contraste, modo claro, oscuro y automático, aplicación en vivo a todo el equipo, pantalla de inicio de sesión con la marca por subdominio, manifest de la app con el nombre y el ícono de la empresa. Migrar a variables los pocos colores fijos de `app.css`. | Una empresa sube su logo, acepta la paleta sugerida y todo su equipo ve la app con su marca en menos de 1 minuto, en claro y oscuro, con contraste AA |
| 4 | `07_inventario.sql`: unidades por empresa, importación desde Excel, cambio de estado con historial, `embed/inventario.js`. Pantalla de inventario en la app. El sitio `demo/` pasa a leer de aquí. | Una empresa nueva carga su inventario desde Excel y su web muestra la disponibilidad en vivo |
| 5 | `08_cotizador.sql`: configuración por proyecto, cotizaciones con financiamiento, PDF, ligadas a la oportunidad, compartir por WhatsApp. Web Push. Nota de voz con transcripción. | **Lanzamiento a la inmobiliaria piloto**: lead → llamada manual → proforma → reserva, todo desde el celular |

### Fase 2 · Meta Ads y WhatsApp (semanas 6 a 9)

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 6 | `05_integraciones.sql` (`org_integraciones`, secretos en Vault, `planes.funciones`, `uso_mensual`). Conexión con Facebook desde Ajustes, suscripción de la página, `meta-leads-webhook` multiempresa, mapeo de preguntas, recuperación nocturna. | Un lead de un formulario de Meta de la empresa piloto llega en menos de 1 minuto con su campaña |
| 7 | `09_meta.sql`, cola de eventos y `meta-capi`; `meta-insights` diario; métricas de costo por lead, cita y venta por campaña. | Una venta en el CRM aparece como *Purchase* en Meta; el gasto de ayer está en el CRM |
| 8 | `10_whatsapp.sql`, registro integrado de WhatsApp, `wa-webhook` y `wa-enviar` multiempresa, plantillas. | La empresa piloto conecta su número sola y los mensajes entran y salen |
| 9 | Bandeja en app y escritorio, notas de voz transcritas, sugerir respuesta, atribución de anuncios a WhatsApp, push de mensajes. | Un asesor atiende una conversación completa desde el celular |

### Fase 3 · App nativa y llamadas (semanas 10 a 13)

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 10 | `mobile/` con Capacitor, push nativo, enlaces profundos a la ficha, entrada con huella, APK firmado, página `/descargar` con detección de dispositivo, guías de instalación para Android, iPhone y computadora, y actualización desde la app con `version.json`. | Un asesor instala la app desde la web en su Android y en su iPhone, y recibe avisos con el teléfono bloqueado |
| 11 | `11_llamadas.sql`. Proveedor de telefonía: subcuenta y número por empresa desde Ajustes, llamada puente, enrutamiento de entrantes, grabación, `telefonia-webhook`, conteo de minutos en `uso_mensual`. | Una llamada desde un iPhone queda registrada y grabada sin que el asesor haga nada |
| 12 | Plugin Android de registro de llamadas, identificador de llamadas, subida de grabaciones de la grabadora integrada. Prueba en los modelos de Android más comunes entre los clientes. | Una llamada por la SIM a un lead aparece en su ficha al colgar |
| 13 | `llamada-procesar`: voz a texto, resumen y datos con Claude, tarea y etapa sugerida; reproductor y transcripción en la ficha. Publicación del APK 1.0 en `/descargar`. | A los 2 minutos de colgar la ficha tiene resumen y siguiente tarea |

### Fase 4 · Ventas en piloto automático (semanas 14 a 17)

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 14 | `12_citas.sql`: agenda, check-in, recordatorios por WhatsApp. | La etapa *Cita* se mide con citas reales |
| 15 | `13_reglas.sql`: motor de reglas y pantalla de configuración; las 6 reglas; resumen diario por correo. | Un administrador activa una regla sin ayuda y cada acción queda en la línea de tiempo |
| 16 | Calificación automática (validada con 30 leads), recomendación de unidades, alternativa al reservarse una unidad. | Cada lead nuevo llega calificado |
| 17 | Asistente con herramientas, leads en riesgo y coaching por lotes nocturnos. | La lista de leads en riesgo aparece cada mañana en *Hoy* |

### Fase 5 · Cierre de venta, escala y lanzamiento (semanas 18 a 21)

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 18 | `14_reservas_pagos.sql`: reserva con documentos leídos por IA, plan de pagos, recordatorios, comisiones. | Una reserva completa se registra desde la app |
| 19 | Complementos: paquetes prepagados de minutos de telefonía y de IA de llamadas, pagados por transferencia y acreditados desde la consola; alertas de saldo bajo. Métricas de marketing completas; informe mensual con IA. | Una empresa compra un paquete de minutos por transferencia y, al aprobarse, el saldo aparece en su cuenta |
| 20 | Opcionales de marca para Agencia: APK con nombre e ícono de la inmobiliaria generado desde la consola, dominio propio y marca blanca completa. Importación de cartera, correo de portales, Google Ads y TikTok; asistente de inicio para empresas nuevas (proyectos → inventario → equipo → web → integraciones). | Una inmobiliaria nueva queda operando en menos de 1 hora sin ayuda |
| 21 | `15_privacidad.sql` (exportar, suprimir, retención, auditoría), doble factor, Playwright completo, alertas, centro de ayuda, textos legales publicados. | Lanzamiento público |

## Precios sugeridos y costos

**Costos fijos de la plataforma** (crecen poco con los clientes): Supabase Pro 25 a 100 USD al mes según tamaño de la base y almacenamiento; Netlify 0 a 19; sin cuentas de tiendas (no se publica en Google Play ni en App Store); posible registro de desarrollador verificado de Android; correo transaccional 0 a 20.

**Costo variable por asesor activo al mes** (estimado, con unas 400 llamadas al mes por asesor, la mitad contestadas):

| Concepto | USD por asesor al mes | Quién lo paga |
| --- | --- | --- |
| IA de CRM (resúmenes, borradores, calificación) | 1 a 4 | Incluido en el plan, con tope (`ia_mes`) |
| IA de llamadas (unos 200 resúmenes a ~0,02 USD con Opus 5.5) | 2 a 4 | Paquete prepagado de llamadas |
| Voz a texto (~400 minutos) | 2 a 4 | Paquete prepagado de llamadas |
| Telefonía (número + ~800 minutos a celulares) | 15 a 40 | Paquete prepagado, revendido con margen |
| WhatsApp (plantillas) | 0 | Meta lo cobra directo a cada empresa |

**Sugerencia de planes** (ajustar a la competencia local; los de la base son de ejemplo): Inicial 19 USD (2 usuarios), Profesional 49 USD (8 usuarios), Agencia 129 USD (30 usuarios), más paquetes prepagados de **Llamadas con IA** (por ejemplo 1.000 minutos con transcripción y resumen por 45 a 70 USD) y **WhatsApp en el CRM** en Profesional y Agencia. Con esos números, el margen bruto de la IA y la voz queda por encima del 70 % si los topes del plan se respetan.

## Decisiones

| # | Decisión | Estado o recomendación |
| --- | --- | --- |
| 1 | Una empresa o varias | **Decidido: producto para varias inmobiliarias** |
| 2 | Base del desarrollo | **Decidido: `crm-inmobiliario.zip`**, portando inventario y cotizador de GPUnlock |
| 3 | Vía de llamadas | **Decidido: telefonía en la nube como estándar + app Android con SIM como opción** |
| 4 | Forma de cobro | **Decidido: transferencia bancaria con activación manual desde la consola de GPUnlock. Sin Stripe.** Recomendación: días de gracia de 5 días tras el vencimiento antes de pasar a solo lectura, y descuento por pago anual (2 meses gratis) para reducir el número de transferencias que hay que revisar |
| 5 | Dominio y nombre comercial | Por ejemplo `gpunlock.com` para ventas y `app.gpunlock.com` para la app |
| 6 | Proveedor de telefonía | Elegir en la semana 1 comparando cobertura de números en Ecuador y la región, precio por minuto, subcuentas y grabación |
| 7 | Modelo de IA para funciones de volumen | Opus 5.5 por defecto; probar Sonnet 5.5 y Haiku 4.5 con 30 casos reales |
| 8 | Países de lanzamiento | Ecuador primero; la normalización de teléfonos (`crm_normalizar_telefono`, hoy fija en 593) pasa a depender del país de cada empresa |
| 9 | Inmobiliaria piloto | Una empresa real que use el producto desde la semana 5 y valide cada fase |

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Meta tarda en aprobar la app o el alta como proveedor de WhatsApp | Iniciar en la semana 1; probar en modo desarrollo con la empresa piloto como evaluadora |
| Instalar fuera de la tienda asusta a algunos usuarios o Android lo bloquea | Guía con capturas en `/descargar`, desarrollador verificado de Android, APK firmado con huella publicada; la app web instalable siempre funciona como alternativa |
| Se pierde la clave de firma del APK | Copia cifrada en dos lugares; sin ella no se pueden publicar actualizaciones para las apps ya instaladas |
| Pagos que se aprueban tarde o clientes que no pagan | Cola de pagos por aprobar con aviso al equipo de GPUnlock, recordatorios automáticos antes del vencimiento, días de gracia y luego solo lectura (nunca se borra ni se pierde un lead) |
| Comprobantes falsos | Se activa solo después de ver el dinero en la cuenta bancaria; el comprobante subido es un apoyo, no una prueba |
| Fuga de datos entre empresas | RLS por `org_id` en todo, pruebas automáticas de aislamiento en cada PR, secretos en Vault |
| Costos de IA y voz por encima del precio | Topes por plan, `uso_mensual`, lotes y caché, modelo más barato si la prueba lo permite |
| Calidad de transcripción en español | Probar varios proveedores con grabaciones reales antes de elegir |
| Abuso de la prueba gratis | CAPTCHA en registro, límites de la prueba, revisión en la consola de GPUnlock |
