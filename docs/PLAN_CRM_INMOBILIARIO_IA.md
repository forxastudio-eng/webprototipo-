# GPUnlock · Plan para un CRM inmobiliario completo con IA, app móvil, llamadas y Meta Ads

Octubre 2026 · Basado en la *Hoja de ruta del CRM con IA* de FORXA y en el estado actual de este repositorio.

## Resumen ejecutivo

La meta es convertir la plataforma GPUnlock (landings, inventario, cotizador, dashboard de marketing y panel con roles) en un CRM inmobiliario completo con:

1. **Un embudo de ventas** donde cada lead queda guardado, asignado y con seguimiento, venga de la web, de Meta, de WhatsApp, de un portal o de una llamada.
2. **Una app móvil para asesores** que registra solas las llamadas hechas y recibidas, sube la grabación, la transcribe y la IA deja en la ficha un resumen, los datos del cliente y la siguiente tarea.
3. **Conexión completa con Meta Ads**: los leads de formularios entran solos y con su campaña, el CRM le devuelve a Meta qué leads se volvieron citas, reservas y ventas (Conversions API) y el gasto por campaña se carga solo para medir el costo por venta.
4. **Una IA que trabaja sola** sobre cada lead, mensaje y llamada (calificar, resumir, recomendar unidades, avisar de leads en riesgo) y nunca envía nada al cliente sin que una persona lo apruebe.

**Datos clave**

| | |
| --- | --- |
| Esfuerzo | 18 a 22 semanas de una persona desarrolladora a tiempo completo, en 6 fases. La fase 1 deja el CRM usable en el celular (como app web instalable) en la semana 4. |
| Costo mensual al terminar | 150 a 400 USD para unos 10 asesores (detalle en *Costos*). Sin licencias por usuario. |
| Base técnica | La misma de hoy: Supabase (Postgres, Auth, RLS, Storage, Edge Functions, Realtime) + Netlify + JavaScript sin compilación. Lo único compilado es la cáscara nativa de la app móvil (Capacitor), en su propia carpeta. |
| Mayor riesgo técnico | El registro automático de llamadas: Android lo permite con una app nativa; iPhone no deja leer las llamadas del teléfono, así que en iPhone se usa telefonía en la nube (ver *M3*). |

## Punto de partida: lo que ya hay en este repositorio

Este repositorio es un prototipo con datos ficticios. **No contiene el CRM base** que la hoja de ruta de FORXA describe en la rama `claude/determined-fermat-wud52v` (`11_crm.sql`, `site/crm/`, `crm-ia`): esa rama vive en el repositorio de FORXA, no aquí.

| Pieza | Dónde | Estado | Uso en el CRM |
| --- | --- | --- | --- |
| Roles editor, administrador, marketing, asesor con RLS | `supabase/01_roles.sql`, `06_politicas.sql` | Funciona | Se amplía con permisos del CRM (el asesor ve sus leads) |
| Registro de actividad | tabla `actividad` | Funciona | Se mantiene para auditoría del panel |
| Inventario de landings | `units`, `prisma_units`, `lots` (`02_landings.sql`) | Funciona | Son 3 tablas distintas, más `cotizador_unidades`; se unifican en una vista |
| Cambio de disponibilidad | `cambiar_estado()` (`05_cambiar_estado.sql`) | Funciona | Punto de enganche para mover la etapa del lead al reservar o vender |
| Cotizador y proformas | `03_cotizador.sql`, `site/cotizador/` | Funciona | `cotizador_historial` guarda nombre, teléfono y correo del cliente como texto, sin ligarlo a un lead |
| Dashboard de marketing | `04_marketing.sql`, `site/marketing/` | Funciona con cifras de ejemplo | Pasa a calcularse desde el CRM y el gasto real de Meta |
| Panel único | `site/admin/` (rutas `#/...`) | Funciona | Se le agregan las secciones del CRM para escritorio |
| Formularios de las landings | `site/js/home.js`, `site/*/js/script.js` | Solo abren WhatsApp | Deben guardar el lead antes de abrir WhatsApp |
| App instalable (PWA) | — | No existe | Nueva |
| Edge Functions | — | No existen | Nuevas (webhooks, IA, llamadas) |

**Primera decisión técnica:** si el repositorio de FORXA es accesible, se trae el CRM base de esa rama (ahorra unas 2 semanas y ya está probado); si no, se reconstruye con el mismo diseño (prefijo `crm_`, RLS por rol, funciones `security definer` para escrituras sensibles).

## Arquitectura

Todo lead, venga de donde venga, entra por una sola función de base de datos (`crm_alta_lead`) que deduplica por teléfono normalizado (E.164) y correo. Así nunca hay dos fichas de la misma persona.

```
 Landings ─┐                                  ┌─► App web (escritorio) /crm/
 Meta Lead Ads ─┤                              │
 WhatsApp Cloud API ─┤   Edge Functions        │   Supabase Postgres
 Portales (correo) ─┼──► (webhooks, firma   ──►├─► crm_* + RLS + Realtime ──► App móvil (PWA → Capacitor)
 Telefonía en la nube ─┤    verificada)         │        │
 App Android (llamadas) ─┘                     │        ├─► pg_cron: reglas, IA nocturna, sincronizar gasto Meta
                                                │        └─► Storage privado: grabaciones, documentos, proformas
                                                └─► Claude API (resúmenes, calificación, extracción)
                                                    Voz a texto (transcripción de llamadas y notas de voz)
                                                    Meta Conversions API (eventos de vuelta a Meta)
```

**Modelo de datos nuevo (resumen).** Todas con RLS; el asesor solo ve lo suyo y lo no asignado, marketing solo lectura, editor y administrador todo.

| Tabla | Para qué |
| --- | --- |
| `crm_contactos` | Persona: nombre, teléfono E.164, correo, cédula opcional, consentimiento (fecha, origen, texto aceptado) |
| `crm_oportunidades` | Interés de compra: contacto, proyecto, etapa, asesor, valor estimado, fuente, atribución (`utm_*`, `fbclid`, `campaign_id`, `adset_id`, `ad_id`, `form_id`, `leadgen_id`, `ctwa_clid`), puntaje IA |
| `crm_actividades` | Línea de tiempo: nota, llamada, mensaje, cita, cambio de etapa, proforma, tarea |
| `crm_tareas` | Pendientes con fecha y responsable |
| `crm_llamadas` | Cada llamada (ver *M3*) |
| `crm_conversaciones`, `crm_mensajes`, `crm_plantillas_wa` | Bandeja de WhatsApp |
| `crm_citas` | Visitas a obra, llamadas y videollamadas agendadas |
| `crm_oportunidad_unidades` | Unidades de interés, reservadas o vendidas por oportunidad |
| `crm_reservas`, `crm_pagos` | Reserva, promesa, cuotas de entrada y su cobranza |
| `crm_reglas`, `crm_reglas_log` | Automatizaciones configurables |
| `crm_dispositivos` | App instalada por asesor: plataforma, token push, versión |
| `crm_meta_eventos` | Cola de eventos enviados a Meta (estado, reintentos, respuesta) |
| `marketing_inversion` | Gasto diario por campaña, conjunto y anuncio |
| `crm_ia_uso`, `crm_auditoria` | Costo de IA y auditoría de acciones sensibles |

**Etapas del embudo** (iguales a las del dashboard): Nuevo → Contactado → Cita → Proforma → Reserva → Vendido, más Perdido con motivo.

## Módulos

Cada módulo se publica por separado y no rompe lo anterior. Los M1, M5, M6, M7, M8, M9, M11 y M12 siguen la hoja de ruta de FORXA con ajustes; M2, M3, M4 y M10 son nuevos o se amplían mucho.

### M1 · CRM base y formularios que guardan leads

- **Qué:** tablas del CRM, funciones `crm_alta_lead` (servidor) y `crm_registrar_lead` (pública, para formularios, con límite por IP y Cloudflare Turnstile), pantallas *Hoy*, *Embudo* (tablero por etapas), *Leads* (lista con filtros), *Ficha* (datos, línea de tiempo, tareas) y *Tareas*, dentro de una nueva ruta `/crm/` y enlazadas desde `/admin/`.
- **Formularios:** los 4 formularios guardan el lead y luego abren WhatsApp como hoy. Se agrega casilla de consentimiento y se capturan `utm_*`, `gclid` y `fbclid` (guardados 30 días en el navegador).
- **Reparto:** por proyecto y rotativo dentro de cada proyecto (configurable).
- **Terminado cuando:** un formulario enviado desde un celular aparece en *Hoy* del asesor asignado en menos de 5 segundos.

### M2 · App móvil para asesores

Se construye en dos pasos para tener algo útil pronto y no rehacer trabajo.

**Paso 1 · App web instalable (PWA), semana 3 y 4.** Una ruta `/app/` con `manifest.webmanifest` y *service worker*, pensada para el pulgar:

- *Hoy*: a quién llamar ahora, tareas vencidas, leads nuevos sin tocar, citas del día.
- Ficha del lead con botones grandes: **Llamar**, **WhatsApp**, **Agendar**, **Nota de voz**, **Cambiar etapa**.
- Nota de voz: se graba en la app, se transcribe y la IA la convierte en nota limpia, tareas con fecha y etapa sugerida.
- Funciona sin conexión para leer la cartera; las acciones hechas sin señal se guardan en cola y se envían al volver la conexión.
- Avisos push (Web Push; en iPhone requiere instalar la app en la pantalla de inicio, iOS 16.4 o posterior).

**Paso 2 · App nativa con Capacitor, Android y iOS.** La misma `/app/` envuelta en una cáscara nativa (carpeta `mobile/`, fuera de lo que publica Netlify). La web sigue sin compilación; solo la cáscara se compila. Agrega lo que una web no puede hacer:

- Registro automático de llamadas (Android, ver M3).
- Push nativo fiable (FCM en Android, APNs en iPhone) aunque la app esté cerrada.
- Identificador de llamadas: al entrar una llamada de un lead, notificación con nombre, proyecto y etapa.
- Check-in con ubicación al llegar a una visita en obra (marca la cita como realizada).
- Escaneo de cédula y documentos con la cámara, que suben a Storage privado.
- Inicio de sesión con huella o Face ID sobre la sesión de Supabase.

**Distribución:** Android como app privada de la empresa (Google Play administrado o APK interno con MDM). Google Play limita el permiso de registro de llamadas (`READ_CALL_LOG`) a usos declarados y revisados; una app privada evita esa revisión pública, pero hay que confirmarlo con la política vigente. iPhone por App Store (cuenta de Apple Developer de la empresa) o distribución empresarial.

**Terminado cuando:** un asesor con la app cerrada recibe el aviso de un lead nuevo, lo abre, lo llama con un toque y la llamada queda en la ficha sin escribir nada.

### M3 · Llamadas: registro automático, grabación, transcripción e IA

Es el módulo más delicado porque depende del sistema operativo del teléfono. Hay tres vías y se recomienda combinar las dos primeras.

| Vía | Cómo funciona | Registro | Grabación | Teléfonos |
| --- | --- | --- | --- | --- |
| **A. App Android nativa** (llamadas por la SIM) | Un plugin de Capacitor en Kotlin escucha el fin de cada llamada y lee del registro del teléfono número, dirección, hora y duración. Si el número es de un lead, crea la llamada en `crm_llamadas`; si no, pregunta «¿Crear lead?». | Automático, entrantes y salientes | Android 10+ no deja a otras apps grabar el audio de la llamada. Se usa la grabadora integrada del teléfono (Samsung, Xiaomi y otros la traen) y la app sube el archivo desde esa carpeta y lo liga a la llamada por hora y número. | Solo Android, idealmente teléfonos de empresa del mismo modelo |
| **B. Telefonía en la nube** (número virtual de la empresa) | El asesor pulsa *Llamar* en la app: el proveedor llama primero al celular del asesor y luego conecta al cliente, mostrando el número de la empresa. Las llamadas entrantes a ese número se enrutan al asesor del lead. El proveedor avisa al CRM por webhook. | Automático, en servidor | Automática y de buena calidad, en servidor | Cualquiera, incluido iPhone |
| **C. Manual asistida** (respaldo) | La app abre el marcador (`tel:`); al volver a la app pide el resultado en un toque (contestó, no contestó, buzón) y una nota de voz opcional. | Semiautomático | No | Cualquiera |

**Recomendación:** vía B como estándar (funciona en iPhone, el número es de la empresa y la cartera no se va con el asesor) y vía A para asesores con Android que llaman desde su SIM. La vía C queda siempre como respaldo. Proveedor a elegir según números de Ecuador, precio por minuto y API de grabación (Twilio, Telnyx, Zadarma o un proveedor local de VoIP; verificar disponibilidad y tarifas). Meta también ofrece llamadas por la API de WhatsApp Business; si está disponible para Ecuador, las llamadas de WhatsApp entran por la misma tabla.

**Tabla `crm_llamadas`:** oportunidad, contacto, asesor, dirección (entrante, saliente), número, inicio, duración, resultado (contestó, no contestó, ocupado, buzón), vía (android, nube, manual), `grabacion_path` (bucket privado `crm-llamadas`), transcripción, resumen IA, datos extraídos (jsonb), sentimiento, puntaje de calidad, `procesada_en`.

**Proceso después de cada llamada** (Edge Function `llamada-procesar`, en cola):

1. Llega el registro (desde la app o el webhook del proveedor) y, si existe, la grabación.
2. Se descartan para IA las llamadas sin contestar o de menos de 20 segundos (solo cuentan como intento).
3. Voz a texto en español con separación de hablantes (asesor y cliente). Claude no transcribe audio; se usa un servicio aparte (por ejemplo Deepgram, AssemblyAI, Google Speech-to-Text o Whisper; elegir por calidad en español de Ecuador y precio).
4. Claude lee la transcripción con la ficha y devuelve en JSON: resumen de 2 a 4 frases, datos del cliente (presupuesto, dormitorios, forma de pago, plazo de compra, objeciones), siguiente paso con fecha, etapa sugerida y puntaje del lead.
5. Se escribe en la línea de tiempo, se crean las tareas y se propone (no se aplica) el cambio de etapa; el asesor lo confirma con un toque.
6. Cada noche, en lotes: puntaje de calidad de la llamada (saludo, preguntas de calificación, cierre con cita) para el resumen semanal de coaching.

**Legal:** grabar llamadas exige avisar al cliente al inicio («esta llamada puede ser grabada para fines de calidad») y declararlo en la política de privacidad. El proveedor en la nube puede reproducir ese aviso automáticamente. Validar con el asesor legal (LOPDP de Ecuador) y fijar un plazo de conservación de las grabaciones (por ejemplo 12 meses) con borrado automático.

**Terminado cuando:** un asesor llama a un lead desde la app, cuelga y en menos de 2 minutos la ficha muestra la llamada, su duración, la grabación, el resumen y la tarea siguiente.

### M4 · Meta Ads: leads, atribución, conversiones y gasto

La vinculación con Meta tiene cuatro piezas. Las dos primeras traen los leads; las dos últimas cierran el ciclo para que Meta optimice hacia leads que compran y no solo hacia leads baratos.

1. **Leads de formularios (Lead Ads).** Edge Function `meta-leads-webhook`: Meta avisa del evento `leadgen`, la función pide el lead a la Graph API con un token de usuario del sistema, mapea las preguntas del formulario a campos del CRM y llama a `crm_alta_lead` con fuente `facebook` o `instagram` y los IDs de campaña, conjunto, anuncio y formulario. Un proceso nocturno recupera leads que el webhook no haya entregado.
2. **Anuncios que abren WhatsApp (Click-to-WhatsApp).** El primer mensaje trae los datos del anuncio de origen; la bandeja de WhatsApp (M6) los guarda en la oportunidad para atribuirla a la campaña.
3. **Conversions API (CAPI).** Cada vez que una oportunidad avanza, el CRM envía un evento a Meta: *Lead calificado* (puntaje IA mayor al umbral), *Cita agendada*, *Visita realizada*, *Reserva* y *Venta* con su valor. Se envían con el `leadgen_id` o con teléfono y correo cifrados (SHA-256), nunca en claro, y un `event_id` para no duplicar con el Pixel. Con estos eventos se pueden crear campañas optimizadas por calidad del lead en lugar de por volumen. Los envíos quedan en `crm_meta_eventos` con reintentos.
4. **Gasto e informes (Marketing API).** Una tarea diaria (`pg_cron` + Edge Function `meta-insights`) baja gasto, impresiones, clics y leads por campaña, conjunto y anuncio a `marketing_inversion`. El dashboard calcula costo por lead, por cita, por reserva y por venta, y retorno por campaña.

**También:** Pixel de Meta en las 4 landings (con consentimiento de cookies) y, opcional, audiencias personalizadas (excluir compradores, crear similares a compradores) solo con contactos que hayan dado consentimiento.

**Qué necesita la empresa:** Meta Business Manager verificado, una app de Meta con los permisos `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `ads_read` y `whatsapp_business_messaging` (revisión de Meta), un usuario del sistema con token de larga duración y un *dataset* de conversiones. La verificación puede tardar semanas, por eso se pide en la semana 1.

**Terminado cuando:** un lead de un formulario de Facebook aparece en el CRM con su campaña en menos de 1 minuto, una venta marcada en el CRM aparece como evento *Purchase* en el administrador de eventos de Meta, y el dashboard muestra el costo por venta de cada campaña sin cargar nada a mano.

### M5 · Otras fuentes de leads

- **Portales inmobiliarios** (Plusvalía y similares): una dirección de correo de entrada (Postmark, Mailgun o Resend inbound); la IA extrae nombre, teléfono, inmueble y mensaje del correo del portal.
- **Google Ads:** webhook de formularios de cliente potencial con su campaña.
- **Referidos y brokers externos:** formulario propio con el nombre del referidor para pagar comisiones (M9).
- **Importación de cartera** desde Excel o CSV con vista previa, duplicados marcados y confirmación (solo editor).

### M6 · Bandeja de WhatsApp

Igual que el M2 de la hoja de ruta de FORXA: WhatsApp Business Cloud API, webhook con firma verificada, conversaciones compartidas por lead, regla de las 24 horas (fuera de ella solo plantillas aprobadas), adjuntos, notas de voz transcritas y botón «Sugerir respuesta». En la app móvil, el hilo aparece dentro de la ficha del lead.

**Decisión previa:** usar el número actual o uno nuevo. Conectar un número a la API puede impedir usarlo en la app de WhatsApp, salvo que Meta permita la coexistencia para esa cuenta; confirmarlo antes de migrar.

### M7 · Cotizador e inventario conectados al lead

- **Una sola verdad del inventario:** vista `v_inventario` que une `units`, `prisma_units`, `lots` y `cotizador_unidades`, y una función que cambia el estado en todas a la vez (extiende `cambiar_estado`). Las landings, el cotizador y el CRM leen de ahí.
- **Cotizador:** al escribir el teléfono encuentra al cliente («Cliente existente: María Pérez, Prisma, etapa Cita»); al guardar la proforma la liga a la oportunidad, registra la actividad, sube la etapa a *Proforma* y pone el valor estimado. Columna `oportunidad_id` en `cotizador_historial`.
- **Reservar o vender** una unidad ligada mueve la oportunidad a *Reserva* o *Vendido*; si otros leads la tenían como interés, su asesor recibe la tarea «ofrecer alternativa» con 3 unidades parecidas sugeridas por la IA.
- **Desde la app:** compartir ficha de la unidad y proforma en PDF por WhatsApp con un toque.

### M8 · Agenda, visitas y automatizaciones

- **Citas** (`crm_citas`): vista por día y semana, creación desde la ficha, recordatorio al cliente por plantilla de WhatsApp el día anterior, check-in con ubicación en la app, *no asistió* con reprogramación. Sincronización opcional con Google Calendar.
- **Motor de reglas** (`pg_cron` cada 5 minutos, reglas activables desde el panel sin tocar código):
  1. Lead nuevo sin contacto en 15 minutos → aviso al administrador; a los 60, reasignación.
  2. Sin actividad 3 días en *Contactado* o *Cita* → tarea con borrador de mensaje de la IA.
  3. Cita mañana → recordatorio al asesor y confirmación al cliente.
  4. Proforma sin respuesta en 48 horas → tarea de seguimiento.
  5. Llamada no contestada → reintento programado (máximo 3 en 5 días, en horarios distintos).
  6. Perdido por «No responde» → reactivación a los 60 días.
- **Notificaciones:** push en la app y resumen por correo a las 8:00 (tareas del día, leads calientes) y semanal a dirección.

### M9 · Cierre de venta, cobranza y comisiones

Lo que distingue a un CRM inmobiliario de uno genérico: la venta no termina al reservar.

- **Reserva y promesa:** monto, fecha, unidad, documentos del cliente (cédula, roles de pago, precalificación bancaria) en Storage privado; la IA lee los documentos y llena los datos.
- **Plan de pagos de la entrada** (`crm_pagos`): cuotas con fecha, estado y comprobante; recordatorio automático antes del vencimiento y alerta de mora.
- **Comisiones:** reglas por proyecto para asesores y referidores; reporte mensual.
- **Postventa (opcional):** entrega, observaciones y garantías como tareas.

### M10 · Funciones de IA

Todas sobre la API de Claude desde Edge Functions, con salida estructurada en JSON, registro en `crm_ia_uso` y límite por persona y hora. Los precios, la disponibilidad y las condiciones salen siempre de herramientas que leen el cotizador; la IA no los inventa.

| # | Función | Cuándo corre | Resultado |
| --- | --- | --- | --- |
| 1 | Resumen y siguiente acción | Botón en la ficha | 2 a 4 frases, una acción, calificación |
| 2 | Borrador de mensaje | Botón en la ficha o tarea automática | Texto de WhatsApp o correo editable |
| 3 | Nota de voz a tareas | Al grabar una nota en la app | Nota limpia, tareas con fecha, etapa sugerida |
| 4 | **Resumen de llamada** | Al terminar cada llamada contestada | Resumen, datos del cliente, objeciones, siguiente paso |
| 5 | Calificación automática | Al entrar un lead, mensaje o llamada | Puntaje 0 a 100, caliente, tibio o frío, motivo; alimenta el evento *Lead calificado* de Meta |
| 6 | Extracción de datos | Cada mensaje y llamada | Presupuesto, dormitorios, forma de pago, plazo, a la ficha |
| 7 | Recomendación de unidades | Botón o al calificar | 3 unidades disponibles con razón y precio real |
| 8 | Sugerir respuesta de WhatsApp | Botón en el hilo | Borrador listo para enviar |
| 9 | Asistente con herramientas | Pestaña *Asistente* | Respuestas sobre el embudo con funciones de solo lectura y permisos de quien pregunta |
| 10 | Leads en riesgo | Cada noche, en lotes | Lista en *Hoy* con motivo |
| 11 | Coaching de llamadas | Cada noche, en lotes | Puntaje por llamada y 3 consejos por asesor a la semana |
| 12 | Informe mensual de marketing | Una vez al mes | Análisis por campaña de Meta con costo por venta |
| 13 | Lectura de documentos | Al subir cédula, roles o comprobantes | Datos para la reserva y el plan de pagos |

**Modelo.** Claude Opus 5.5 (`claude-opus-5-5`) por defecto. Las funciones que corren sobre cada lead, mensaje y llamada (4, 5, 6) son las de mayor volumen; conviene comparar en 30 casos reales su calidad con Opus 5.5 frente a un modelo más barato (Claude Sonnet 5.5 o Claude Haiku 4.5) y decidir por calidad y costo. Los procesos nocturnos (10, 11, 12) usan la API de lotes de Anthropic, que cuesta la mitad, y el prompt fijo de cada función se guarda en caché para abaratar las lecturas repetidas.

**Salvaguardas:** la IA nunca envía nada al cliente por su cuenta (solo las plantillas de recordatorio aprobadas, que no escribe la IA); los cambios de etapa que propone requieren un toque del asesor; el texto de clientes y las transcripciones se tratan como datos, nunca como instrucciones; un asesor no obtiene datos de leads ajenos a través de la IA.

### M11 · Dashboard de marketing y ventas con datos reales

- Función `marketing_metricas(desde, hasta)` calculada desde el CRM: leads, contactados, citas, visitas, proformas, reservas y ventas por fuente, campaña, proyecto y asesor; tiempo de primera respuesta; llamadas por asesor y tasa de contacto.
- Gasto de Meta desde `marketing_inversion` (y carga manual para otros canales): costo por lead, por cita y por venta, retorno por campaña.
- Los párrafos de análisis los propone la IA (función 12). El JSON editado a mano deja de usarse.

### M12 · Seguridad, privacidad y calidad

Antes de guardar conversaciones y grabaciones:

- **Privacidad (LOPDP):** actualizar la política de privacidad (formularios, WhatsApp, llamadas grabadas, procesamiento por IA fuera de Ecuador en Supabase, Anthropic, Meta y el proveedor de voz); aceptar los acuerdos de tratamiento de datos de cada proveedor; casilla de consentimiento en formularios; funciones de exportar y suprimir los datos de una persona; borrado automático según plazos.
- **Seguridad:** doble factor obligatorio para editor y administrador; exportaciones solo para editor; auditoría de reasignar, exportar, importar y suprimir; verificación de firma en todos los webhooks; secretos solo en Edge Functions; cierre de sesión remoto y desvinculación del dispositivo cuando alguien deja el equipo; Turnstile en formularios públicos.
- **Calidad:** proyecto de Supabase de pruebas separado de producción; migraciones numeradas en `supabase/` como hoy (09 en adelante); pruebas de permisos en SQL (pgTAP) por rol; pruebas de punta a punta con Playwright para formularios, CRM y cotizador; GitHub Actions que las corre en cada cambio; alertas si un webhook falla 3 veces seguidas.

## Plan por fases

Estimación para una persona desarrolladora a tiempo completo. Las verificaciones de Meta y Apple se piden en la semana 1 porque tardan.

| Fase | Semanas | Entrega | Módulos |
| --- | --- | --- | --- |
| **0 · Preparación** | 1 | Decisiones tomadas, cuentas abiertas a nombre de la empresa (Meta Business, Anthropic, Supabase Pro, Apple y Google), proyecto de pruebas, verificación de Meta solicitada | — |
| **1 · CRM usable en el celular** | 2 a 4 | CRM base, formularios que guardan leads con atribución, app web instalable con *Hoy*, ficha, llamar, WhatsApp y nota de voz, IA bajo demanda (funciones 1 a 3), privacidad actualizada | M1, M2 paso 1, M10 parcial, M12 parcial |
| **2 · Meta Ads y WhatsApp** | 5 a 8 | Leads de Meta solos y con campaña, Pixel y Conversions API, gasto diario por campaña, bandeja de WhatsApp, push | M4, M6, M5 parcial |
| **3 · App nativa y llamadas** | 9 a 12 | App Capacitor para Android y iPhone, telefonía en la nube, registro automático en Android, grabación, transcripción y resumen de llamadas, identificador de llamadas | M2 paso 2, M3, M10 (4 a 6) |
| **4 · Ventas conectadas** | 13 a 16 | Cotizador e inventario ligados al lead, agenda con check-in, automatizaciones, calificación automática y leads en riesgo | M7, M8, M10 (5, 7 a 10) |
| **5 · Cierre y medición** | 17 a 20 | Reservas, plan de pagos y comisiones, dashboard con datos reales, importación de cartera, coaching de llamadas, pruebas automáticas y endurecimiento de seguridad | M9, M11, M5, M10 (11 a 13), M12 |

Puertas entre fases: no se pasa a la fase 2 sin la política de privacidad publicada y el consentimiento en los formularios; no se activa la grabación de llamadas sin la validación legal; no se activa la calificación automática sin compararla con el criterio de los asesores en 30 leads reales.

## Plan de desarrollo detallado

### Forma de trabajo

- **Ciclo semanal:** cada semana termina con un cambio revisable (PR a `main`), probado primero en el proyecto de Supabase de pruebas y luego publicado en producción. Demostración el viernes con 2 asesores piloto que lo usan la semana siguiente.
- **Migraciones:** archivos SQL numerados en `supabase/`, como hoy, seguros de volver a ejecutar. Cada migración llega con sus pruebas de permisos.
- **Servidor:** Edge Functions de Supabase en `supabase/functions/`, en TypeScript (Deno). Los secretos (Anthropic, Meta, WhatsApp, telefonía, voz a texto) solo viven ahí.
- **Web:** JavaScript sin compilación, igual que el resto del sitio. Código compartido entre escritorio y app en `site/js/crm-*.js`.
- **Móvil:** cáscara Capacitor en `mobile/`, que carga la misma `/app/`. Es lo único que se compila.
- **Personas:** 1 desarrollador a tiempo completo; 1 responsable de la empresa para decisiones, cuentas y plantillas (unas 3 horas a la semana); 2 asesores piloto; el asesor legal en las fases 1 y 3.

### Estructura de archivos nueva

```
supabase/
  09_crm_base.sql            contactos, oportunidades, actividades, tareas, crm_alta_lead, reparto
  10_crm_politicas.sql       RLS del CRM por rol
  11_crm_formularios.sql     crm_registrar_lead (pública), límite por IP, consentimiento, atribución
  12_crm_ia.sql              crm_ia_uso, límites por persona
  13_whatsapp.sql            conversaciones, mensajes, plantillas
  14_meta.sql                crm_meta_eventos, marketing_inversion, mapeo de formularios
  15_llamadas.sql            crm_llamadas, bucket crm-llamadas, crm_dispositivos
  16_inventario_crm.sql      v_inventario, cambiar_estado ampliado, crm_oportunidad_unidades
  17_citas_reglas.sql        crm_citas, crm_reglas, crm_reglas_log, pg_cron
  18_reservas_pagos.sql      crm_reservas, crm_pagos, comisiones
  19_metricas.sql            marketing_metricas()
  20_privacidad.sql          exportar, suprimir, retención, crm_auditoria
  functions/
    crm-ia/                  funciones de IA bajo demanda (1, 2, 3, 7, 8, 9)
    crm-ia-lotes/            procesos nocturnos con la API de lotes (10, 11, 12)
    meta-leads-webhook/      leads de formularios de Meta
    meta-capi/               eventos de conversión hacia Meta
    meta-insights/           gasto diario por campaña
    wa-webhook/  wa-enviar/  WhatsApp entrante y saliente
    telefonia-webhook/       eventos y grabaciones del proveedor de telefonía
    llamada-procesar/        voz a texto + resumen de llamada (4, 5, 6)
    push-enviar/             avisos a la app
    correo-entrante/         leads de portales por correo
    resumen-diario/          correos de las 8:00
  tests/                     pruebas de permisos (pgTAP)
site/
  crm/                       CRM de escritorio
  app/                       app móvil (PWA): manifest, service worker, pantallas
  js/crm-lead.js             captura de leads en los formularios
  js/crm-core.js             sesión, datos, tiempo real, utilidades compartidas
mobile/
  capacitor.config.json
  android/  ios/
  plugins/registro-llamadas/ plugin Kotlin para Android
e2e/                         pruebas de punta a punta (Playwright)
.github/workflows/ci.yml     pruebas en cada PR
```

### Semana a semana

**Fase 0 · Preparación**

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 1 | Decisiones 1 a 3. Cuentas a nombre de la empresa: Meta Business (pedir verificación), Anthropic con límite de gasto, Supabase Pro, Apple Developer, Google Play. Proyecto de Supabase de pruebas. Supabase CLI y carpeta de migraciones. Flujo de GitHub Actions vacío que ya corre. Utilidad para normalizar teléfonos de Ecuador a formato internacional. | El proyecto de pruebas se reconstruye desde cero con `01` → `08` sin errores y CI corre en cada PR |

**Fase 1 · CRM usable en el celular**

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 2 | `09`, `10`, `11`: tablas del CRM, `crm_alta_lead` con deduplicación, reparto por proyecto y rotativo, `crm_registrar_lead` con Turnstile y límite por IP. Pruebas de permisos por cada rol. `crm-lead.js` en los 4 formularios (guardar y luego abrir WhatsApp), casilla de consentimiento, captura de UTM y `fbclid`. Borrador de la nueva política de privacidad al asesor legal. | Un formulario crea el lead una sola vez aunque se envíe dos veces; un asesor no ve leads ajenos (prueba automática) |
| 3 | `/crm/` de escritorio: *Hoy*, *Embudo* por etapas con arrastrar, *Leads* con filtros, *Ficha* con línea de tiempo y tareas, *Tareas*. Tiempo real con Supabase Realtime. Enlace desde `/admin/`. | Un lead nuevo aparece sin recargar en menos de 5 s; mover una tarjeta de etapa queda en la línea de tiempo |
| 4 | `/app/` móvil (PWA): manifest, service worker, lectura sin conexión y cola de acciones, *Hoy* y ficha con Llamar (vía manual con resultado en un toque), WhatsApp y Agendar. Nota de voz: grabación, voz a texto y `crm-ia` función 3. `12_crm_ia.sql` y funciones 1 y 2. Web Push básico. Publicar la política de privacidad. | Los asesores piloto trabajan un día completo solo con el celular |

**Fase 2 · Meta Ads y WhatsApp**

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 5 | `14_meta.sql`. App de Meta y usuario del sistema. `meta-leads-webhook` con verificación de firma, pantalla para mapear preguntas de cada formulario a campos del CRM, recuperación nocturna de leads no entregados. | Un lead de prueba del formulario de Meta llega con campaña, conjunto y anuncio en menos de 1 minuto |
| 6 | Pixel en las landings con `event_id`. `meta-capi`: disparador al cambiar de etapa → cola `crm_meta_eventos` → envío con reintentos y datos cifrados. `meta-insights` diario a `marketing_inversion`. | Una venta de prueba aparece como *Purchase* en el administrador de eventos de Meta; el gasto de ayer está en la base |
| 7 | `13_whatsapp.sql`. `wa-webhook` (mensajes, estados, número nuevo crea lead, datos del anuncio Click-to-WhatsApp) y `wa-enviar` (regla de 24 horas, plantillas). Alta de plantillas en Meta. | Un mensaje al número llega a la base y la respuesta enviada por la API llega al cliente |
| 8 | Bandeja en `/crm/` y en la app: lista con no leídos, hilo, adjuntos, plantillas, notas de voz transcritas, función 8 (sugerir respuesta). Push de mensaje entrante y lead asignado. | Un asesor atiende una conversación completa desde la app; fuera de 24 horas solo ve plantillas |

**Fase 3 · App nativa y llamadas**

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 9 | `mobile/` con Capacitor: compilación Android e iOS, push nativo (FCM y APNs) en `push-enviar`, enlaces que abren la ficha, inicio con huella o Face ID, `crm_dispositivos`. Distribución interna de prueba (Firebase App Distribution o TestFlight). | La app instalada recibe avisos con el teléfono bloqueado |
| 10 | `15_llamadas.sql`. Proveedor de telefonía: número virtual, llamada puente desde el botón *Llamar*, enrutamiento de entrantes al asesor del lead, aviso de grabación, `telefonia-webhook` que guarda la llamada y sube la grabación al bucket privado. | Una llamada hecha desde un iPhone queda registrada con grabación sin intervención del asesor |
| 11 | Plugin `registro-llamadas` para Android: detectar fin de llamada, leer el registro del teléfono, asociar al lead, preguntar «¿Crear lead?» si es desconocido, identificador de llamadas entrantes, subir la grabación de la grabadora integrada. Pruebas en los modelos de teléfono elegidos. | Una llamada por la SIM a un lead aparece en su ficha al colgar |
| 12 | `llamada-procesar`: filtro de llamadas cortas, voz a texto con hablantes, funciones 4, 5 y 6, tareas creadas y etapa propuesta. En la ficha: reproductor, transcripción y resumen. Publicación privada en Android y en App Store. | A los 2 minutos de colgar la ficha muestra resumen y siguiente tarea; el asesor confirma la etapa con un toque |

**Fase 4 · Ventas conectadas**

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 13 | `16_inventario_crm.sql`: vista `v_inventario`, `cambiar_estado` que actualiza todas las tablas, unidades por oportunidad, disparadores de *Reserva* y *Vendido*, tarea «ofrecer alternativa». | Reservar una unidad en el panel mueve la etapa del lead y avisa a los demás interesados |
| 14 | Cotizador: búsqueda del cliente por teléfono, `oportunidad_id` en `cotizador_historial`, actividad y cambio a *Proforma*, proformas en la ficha. Compartir ficha y proforma en PDF por WhatsApp desde la app. | Desde la ficha se ven todas las proformas del cliente |
| 15 | `17_citas_reglas.sql`: agenda por día y semana, check-in con ubicación, recordatorios; motor de reglas con `pg_cron` y pantalla para activarlas; las 6 reglas iniciales. | El administrador apaga y enciende una regla sin tocar código y cada acción queda en la línea de tiempo |
| 16 | IA proactiva: calificación automática (validada con 30 leads), recomendación de unidades (función 7), asistente con herramientas (9), leads en riesgo nocturno con la API de lotes (10). | La lista de leads en riesgo aparece cada mañana en *Hoy* |

**Fase 5 · Cierre y medición**

| Semana | Trabajo | Listo cuando |
| --- | --- | --- |
| 17 | `18_reservas_pagos.sql`: reserva, documentos con lectura por IA (13), plan de pagos con recordatorios y mora. | Una reserva completa se registra desde la app con sus documentos |
| 18 | Comisiones. `19_metricas.sql` y dashboard de marketing con datos reales y gasto de Meta; informe mensual con IA (12). | El informe del mes sale sin editar el JSON |
| 19 | Importación de cartera desde Excel, `correo-entrante` para portales, webhook de Google Ads, coaching de llamadas (11) y resumen semanal por asesor. | La cartera histórica queda importada sin duplicados |
| 20 | `20_privacidad.sql`: exportar y suprimir datos de una persona, borrado automático por plazos, auditoría. Doble factor obligatorio. Pruebas de punta a punta con Playwright, alertas de webhooks, manual de uso y capacitación del equipo. | CI verde con todas las pruebas; el equipo completo usa el CRM |

### Riesgos y cómo se manejan

| Riesgo | Efecto | Mitigación |
| --- | --- | --- |
| Meta tarda en verificar la empresa o aprobar permisos | Retrasa la fase 2 | Pedirlo en la semana 1; mientras tanto, probar con la app en modo desarrollo y usuarios de prueba |
| La grabadora integrada no existe o cambia en algunos Android | Llamadas por SIM sin grabación | Teléfonos de empresa de un modelo probado; la telefonía en la nube como vía principal |
| Google Play rechaza el permiso de registro de llamadas | No se puede publicar en la tienda pública | Distribución privada (Google Play administrado o MDM) |
| Calidad de la transcripción en español de Ecuador | Resúmenes con errores | Probar 2 o 3 proveedores con 20 grabaciones reales antes de elegir |
| Costos de IA mayores a lo previsto | Factura alta | Límite de gasto en Anthropic, registro en `crm_ia_uso`, API de lotes, caché del prompt, modelo más barato para funciones de volumen si la prueba lo permite |
| Asesores que no adoptan la app | Datos incompletos | Piloto desde la semana 4, registro automático para que no tengan que escribir, *Hoy* como lista de trabajo diaria |
| Cambio de número de WhatsApp | Se corta el canal actual | Confirmar coexistencia con Meta o usar un número nuevo |

## Costos mensuales estimados al terminar

Para unos 10 asesores, 150 leads al mes y unas 4.000 llamadas al mes (la mitad contestadas y de más de 20 segundos). Son estimaciones; verificar tarifas vigentes de cada proveedor.

| Concepto | USD al mes | Nota |
| --- | --- | --- |
| Supabase Pro | 25 a 50 | Copias diarias; más almacenamiento por grabaciones |
| Netlify | 0 | Plan gratuito |
| API de Claude | 60 a 180 | Opus 5.5 a 4 USD por millón de tokens de entrada y 20 USD por millón de salida; un resumen de llamada típico cuesta unos 0,02 USD. Baja bastante si las funciones de volumen usan un modelo más barato o la API de lotes |
| Voz a texto | 20 a 60 | Unos 4.000 a 8.000 minutos al mes, según proveedor |
| Telefonía en la nube | 30 a 120 | Número virtual y minutos salientes a celulares de Ecuador; depende mucho del proveedor |
| WhatsApp (plantillas) | 5 a 60 | Meta cobra por plantilla según categoría y país |
| Correo transaccional | 0 a 20 | Plan gratuito al inicio |
| **Total** | **140 a 490** | Sin licencias por usuario |

Pagos únicos o anuales: cuenta de Apple Developer (99 USD al año), cuenta de Google Play (25 USD una vez), teléfonos Android de empresa si se elige la vía A.

## Decisiones antes de empezar

Las tres primeras bloquean el diseño; el resto puede decidirse sobre la marcha.

| # | Decisión | Opciones | Recomendación |
| --- | --- | --- | --- |
| 1 | ¿GPUnlock es para una sola inmobiliaria o un producto para varias? | Una empresa, o varias empresas (multiempresa) | Si se va a vender a otras inmobiliarias, agregar `empresa_id` a todas las tablas y a las políticas RLS desde el día 1; hacerlo después cuesta varias semanas |
| 2 | Cómo se registran las llamadas | Telefonía en la nube, app Android nativa, o ambas | Ambas: nube como estándar (sirve en iPhone y el número es de la empresa), Android nativo para quien llama por la SIM |
| 3 | ¿Traer el CRM base de FORXA o reconstruirlo? | Traer la rama `claude/determined-fermat-wud52v` o reconstruir | Traerla si el repositorio es accesible |
| 4 | Número de WhatsApp para la API | Migrar el actual o usar uno nuevo | Confirmar con Meta la coexistencia; si no, número nuevo |
| 5 | Quién abre y paga las cuentas | Empresa o una persona | Todas a nombre de la empresa |
| 6 | Grabación de llamadas | Todas, solo algunas, ninguna | Todas con aviso al inicio, conservación 12 meses, sujeto a validación legal |
| 7 | Eventos de venta hacia Meta | Solo lead, o lead, cita, reserva y venta | Todos, con teléfono y correo cifrados |
| 8 | Modelo de IA para funciones de volumen (4, 5, 6) | Opus 5.5 en todo, o un modelo más barato para esas | Probar ambos con 30 casos reales |
| 9 | Reparto de leads | Manual, rotativo, por proyecto, por carga | Por proyecto y rotativo dentro de cada proyecto |
| 10 | Teléfonos de los asesores | Personales o de empresa | De empresa para quien use la vía Android: misma grabadora integrada, control del dispositivo y la cartera queda en la empresa |

## Próximos pasos

1. Tomar las decisiones 1, 2 y 3.
2. Abrir las cuentas y pedir la verificación de Meta Business y la cuenta de Apple Developer.
3. Crear el proyecto de Supabase de pruebas.
4. Empezar la fase 1 con `supabase/09_crm.sql` y la ruta `/crm/`.
