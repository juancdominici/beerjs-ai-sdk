# Guía para trabajar en el repositorio

## Arquitectura

- Mantené un router y tres nodos (`academico`, `institucional`, `fallback`), con un registro tipado y contratos compartidos en `src/shared/`.
- Usá el clasificador de OpenAI cuando esté habilitado. Conservá la política de enrutamiento en el servidor y AI SDK como protocolo de mensajes y streaming.
- Hacé que el modo simulado recorra el mismo servidor que usa la integración real. El servidor envía texto y datos, y React se encarga de representarlos.
- Mantené la corrección de los intentos en el servidor y respetá los contratos compartidos al actualizar las herramientas de práctica o sus consumidores.

## Configuración

- Trabajá dentro de este repositorio. Usá los modos simulados para el desarrollo y las pruebas por defecto.
- Para probar los adaptadores de red, interceptá HTTP. Las llamadas a servicios reales, el acceso a cuentas y los despliegues requieren autorización explícita.
- Guardá las credenciales en `.env.local`, ignorado por Git. Conservá los valores de ejemplo vacíos en `.env.example`.

## Validación

- Ejecutá `pnpm check` para comprobar tipos, pruebas y build. Si cambiás el comportamiento del chat, recorré también las tres rutas y la práctica con `pnpm dev`.
- Usá las APIs de las versiones resueltas en `pnpm-lock.yaml`. Si cambian las dependencias o los pasos de configuración, actualizá el README.
- Al informar una validación, indicá si usaste el modo simulado, HTTP interceptado o servicios reales.
