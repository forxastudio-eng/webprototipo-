# GPUnlock CRM · Hoja de ruta «CRM premium LATAM»

Octubre 2026 · Basada en la investigación *CRM premium en LATAM* (Salesforce, HubSpot, Zoho, Pipedrive, Kommo, RD Station, Bitrix24, GoHighLevel, Tokko, EasyBroker…) y cruzada con lo que GPUnlock CRM ya tiene.

**Idea guía (de la investigación):** un CRM *conversation-first* (WhatsApp nativo, estilo Kommo) con datos sólidos (estilo HubSpot), procesos obligatorios (estilo Zoho Blueprint), la simpleza de Pipedrive y una capa de IA que ejecuta. En nuestro caso, **vertical inmobiliario**: inventario + matching + proformas son el corazón, y ningún CRM general los trae.

Leyenda: ✅ hecho · 🟡 parcial · ⬜ falta · 🔑 necesita una cuenta o un trámite tuyo

## 1. Dónde estamos frente a la investigación

| # | Función (sección del estudio) | Estado | Qué hay / qué falta |
|---|---|---|---|
| 5.1 | Modelo de datos, campos personalizados, historial por campo | 🟡 | Contactos, leads, actividades, unidades, proformas. Falta: campos personalizados por empresa e historial por campo. |
| 5.2 | Captura multicanal y atribución | 🟡 | Formulario web (`lead.js`) con UTM, fbclid, gclid, ttclid y deduplicación por `leadgen_id`. Falta: webhook genérico, Meta Lead Ads en vivo 🔑, CTWA, correo y portales. |
| 5.3 | Deduplicación y fusión | 🟡 | Por teléfono y correo (sin duplicar al crear ni al cotizar). Falta: cédula/RUC con dígito verificador y la fusión manual. |
| 5.4 | Asignación y SLA de primera respuesta | ✅ | Reparto rotativo por carga; primera respuesta medida por la base, meta configurable, «Sin responder» en Hoy. Falta: reasignación automática al vencer el SLA. |
| 5.5 | Pipeline: probabilidad, valor ponderado, *rotting*, próxima actividad | ✅ | Kanban con etapas inmobiliarias, motivo de pérdida obligatorio, probabilidad y alerta por etapa, valor y ponderado por columna, «sin próxima tarea». Falta: arrastrar y soltar. |
| 5.6 | Bandeja de WhatsApp (Cloud API) | ⬜ 🔑 | **Bloque 2.** Necesita tu cuenta de WhatsApp Business Platform (Meta). |
| 5.7 | Bots y agente de IA conversacional | ⬜ | Bloque 4 (sobre la bandeja de WhatsApp). |
| 5.8 | Automatizaciones | 🟡 | Tareas automáticas por etapa con plazo y variables. Workflows con ramas y esperas, en el Bloque 4. |
| 5.9 | Procesos obligatorios (Blueprint) | ⬜ | Bloque 3: datos obligatorios por etapa (p. ej. proforma antes de reserva). |
| 5.10 | Tareas, «Mi día», agenda de visitas | 🟡 | Tareas con fecha, vista Hoy, vencidas. Falta: agenda de visitas con confirmación por WhatsApp y calendario. |
| 5.11–5.12 | Secuencias y correo | ⬜ | Bloque 4. |
| 5.13 | Telefonía y transcripción | 🟡 | Notas dictadas que la IA ordena. Falta: registro de llamadas desde la app Android (Bloque 3). |
| 5.14 | Puntaje de leads | 🟡 | Calificación por IA (caliente / tibio / frío). Falta: puntaje por reglas con decaimiento y probabilidad de cierre. |
| 5.15 | Cotizaciones y firma | ✅ | Proformas con la marca de cada inmobiliaria, cálculo en servidor, enlace privado, PDF, WhatsApp, tope de descuento. Falta: aceptación en línea y firma. |
| 5.16 | Pagos y factura electrónica | ⬜ 🔑 | Bloque 5 (SRI vía proveedor, links de pago). |
| 5.17 | Forecast y metas | ⬜ | Bloque 3 (con el valor ponderado del Bloque 1). |
| 5.18 | Reportes | 🟡 | Métricas por etapa, fuente, asesor, campaña, primera respuesta (mediana, p90, % en meta, por asesor), valor ponderado, % con próxima tarea, estancados. Falta: constructor de reportes. |
| 5.19 | Difusiones y consentimientos | ⬜ 🔑 | Bloque 4 (sobre WhatsApp). |
| 5.20 | IA: copiloto y agentes | 🟡 | Resumen, mensaje sugerido, nota dictada, preguntas al embudo. Falta: copiloto por WhatsApp para vendedores (Bloque 4). |
| 5.21 | Permisos y auditoría | ✅ | Propietario, administrador, agente y lector con RLS; auditoría en la consola. Falta: equipos jerárquicos. |
| 5.22 | Multiempresa, moneda, zona horaria | ✅ | Multiempresa con RLS, USD, hora de Ecuador. |
| 5.23 | API, webhooks, conversiones offline | ⬜ 🔑 | Bloque 5 (Meta CAPI y Google Ads al vender). |
| 5.24 | App móvil | 🟡 | App instalable (PWA) con modo claro/oscuro. Falta: APK, push, visitas con ubicación (Bloque 3). |
| 5.25 | Importación y protección de datos | 🟡 | Importación de inventario Excel/CSV, políticas legales en borrador. Importación de cartera de leads desde Excel/CSV, Kommo, Pipedrive o HubSpot, con deshacer. Falta: exportar o borrar los datos de un contacto. |
| 9 | Vertical inmobiliario: inventario, matching, portales, visitas, captación | 🟡 | Inventario con fotos, web pública, proformas. Búsqueda del cliente y matching unidad ↔ lead (hecho). Después: visitas, captación y portales. |

## 2. Orden de construcción propuesto

Prioridad = lo que más mueve las ventas de una inmobiliaria pequeña o mediana, empezando por lo que no depende de cuentas externas.

**Bloque 1 · Embudo premium + matching inmobiliario** — ✅ hecho, incluida la importación de la cartera (con deshacer).
- Probabilidad por etapa y valor ponderado del embudo; días sin actividad por etapa (*rotting*) y aviso de «sin próxima tarea».
- Tiempo de primera respuesta (*speed-to-lead*): por lead, por asesor y mediana del equipo; lista «Sin responder» en Hoy.
- Automatización por etapa: al entrar a una etapa se crea la tarea que la empresa defina (p. ej. «Llamar en 15 minutos» al llegar un lead nuevo).
- Lo que busca cada cliente (tipo, dormitorios, presupuesto, proyecto) → unidades que le calzan en su ficha → proforma en un toque; y en cada unidad, los clientes interesados para escribirles por WhatsApp.
- Importar la cartera de leads desde Excel/CSV (migración desde Kommo, Pipedrive, HubSpot o una hoja propia).

**Bloque 2 · Bandeja de WhatsApp Cloud API** 🔑 — el diferenciador número uno según el estudio. Conversaciones dentro de la ficha del lead, ventana de 24 h, plantillas aprobadas, audios transcritos, origen Click-to-WhatsApp. Requiere: cuenta de Meta Business verificada, una app de Meta y un número para la API.

**Bloque 3 · App Android y trabajo de campo** — APK, notificaciones push, registro de llamadas, visitas con ubicación y confirmación por WhatsApp, metas y forecast, datos obligatorios por etapa.

**Bloque 4 · Automatización e IA que ejecuta** — workflows con esperas y ramas, secuencias, difusiones con consentimiento, copiloto por WhatsApp para el vendedor (audio → actualiza el CRM con botón «Deshacer»), agente que califica y agenda.

**Bloque 5 · Cierre del ciclo** 🔑 — factura electrónica SRI vía proveedor, links de pago, conversiones offline a Meta y Google Ads, aceptación en línea de la proforma, portales inmobiliarios.

## 3. Lo que necesito de ti para los bloques con 🔑
- **WhatsApp:** Meta Business verificado, app en developers.facebook.com con WhatsApp, número dedicado (o *coexistence* con la app actual), token permanente.
- **Factura electrónica:** el proveedor que ya usas con el SRI (o elegir uno con API).
- **Conversiones offline:** acceso a Meta Ads Manager y Google Ads de cada inmobiliaria (se conecta por empresa).
