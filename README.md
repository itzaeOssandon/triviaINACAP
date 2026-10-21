# La máquina del tiempo · Trivia INACAP

Trivia para el stand de INACAP, inspirada en la estética de los años 60 y 70. Funciona en teléfonos, tablets y computadores, sin cuentas para los visitantes. El modo individual funciona en el navegador; la sala con presentador usa una API de Vercel y almacenamiento privado.

## Jugar

- Tres niveles: Fácil, Medio y Hardcore.
- Cada partida selecciona al azar **cinco preguntas**, exactamente una de INACAP, Tecnología, Cultura, Música y Educación, del nivel elegido.
- También se mezclan el orden de las categorías y las alternativas. Las preguntas pueden repetirse entre partidas independientes.
- Hay 20 segundos por pregunta. Una respuesta correcta entrega entre 500 y 1000 puntos, según la rapidez; una incorrecta o fuera de tiempo entrega 0. Máximo: 5000 puntos.
- Se muestra la respuesta correcta y una explicación antes de continuar. Al final se pueden revisar las cinco respuestas o comenzar otra partida.
- Récord por dificultad guardado en este navegador y dispositivo; no es un ranking compartido entre visitantes.
- Botón de pantalla completa cuando el navegador lo admite. También se puede responder con las teclas 1, 2, 3 y 4.

El banco contiene las **75 preguntas entregadas para el stand**: 15 por categoría y cinco por cada dificultad dentro de cada categoría. Las respuestas se conservaron; se añadieron alternativas incorrectas para permitir la selección. Algunas consignas se adaptaron a opción múltiple y se retiraron referencias a un documento que el jugador no tiene a la vista. Los campos `sourceQuestion` y `sourceAnswer` conservan el texto original.

## Sala con presentador y público

1. En el computador conectado a la televisión, pulsar **Crear sala · Presentador** y elegir la dificultad. No se pide una cantidad de jugadores.
2. La sala muestra un **PIN de seis dígitos**, un **QR grande** y los apodos de los participantes. El QR abre directamente el ingreso a esa sala; solo falta escribir un apodo. También se puede usar **Ingresar con código** desde el inicio.
3. El presentador pulsa **¡Comenzar el show!** cuando esté listo. Se requiere al menos un participante; el presentador no ocupa un lugar en el ranking. El ingreso se cierra al comenzar.
4. La televisión muestra las preguntas y alternativas grandes. Los teléfonos muestran botones con las mismas alternativas, formas y colores. Hay 20 segundos por pregunta y una única respuesta por participante.
5. La respuesta correcta y la explicación se muestran cuando todos respondieron, se agotó el tiempo o el presentador pulsa **Cerrar respuestas**. Solo el presentador avanza a la siguiente pregunta.
6. Tras la quinta pregunta, **Ver podio y ranking** muestra a los tres primeros en un podio retro con vinilos y flores, y al resto en una lista lateral con posición y puntaje. Con menos de tres participantes, los lugares vacíos se identifican como tales.

Se conservan cinco preguntas por partida, una de cada categoría del nivel elegido. El puntaje premia los aciertos y la rapidez. Los empates se ordenan por aciertos, menor tiempo total de respuesta, orden de ingreso y un identificador estable si coinciden todos esos criterios. El teléfono muestra también la posición personal al finalizar.

La sala utiliza Vercel Blob privado. Las inscripciones y respuestas son archivos independientes e inmutables: las respuestas simultáneas no compiten por sobrescribir un único archivo. El estado del presentador y los puntajes se guardan con escrituras condicionales por ETag para evitar dobles avances o dobles puntuaciones. La API valida la identidad del presentador, el tiempo y la respuesta; el navegador no puede enviar su propio puntaje. El QR se genera en el navegador sin servicios externos.

Los teléfonos y el computador necesitan Internet, pero pueden estar en redes distintas. Las sesiones se recuperan al recargar la misma pestaña. Salir desde un teléfono no cierra la partida de los demás; los participantes ausentes suman cero en las preguntas sin responder. El presentador puede cerrar la sala para todos. Las salas expiran después de dos horas; sus archivos privados permanecen en almacenamiento hasta su limpieza administrativa. No hay un número predeterminado de participantes ni un selector de capacidad. Las pruebas de concurrencia incluyen 40 participantes simulados; esto no constituye una garantía de carga ilimitada.

En individual se gana con **3 respuestas correctas de 5**. El modo anterior de duelo permanece en sus archivos y endpoint para compatibilidad con pestañas antiguas; la interfaz principal utiliza la nueva sala con presentador.

## Desarrollo local

Node.js 20.19+ o 22.12+; recomendado Node.js 24 LTS.

```bash
npm ci
npm run dev
```

Vite informa el puerto del servidor. Para generar y probar la versión de producción:

```bash
npm run build
npm run preview
```

Las tipografías se sirven desde la propia aplicación. El modo individual no requiere claves ni variables de entorno. La sala usa `BLOB_READ_WRITE_TOKEN`, configurada únicamente en Vercel, y una conexión a Internet. Nunca debe incluirse la credencial en archivos del frontend o en el repositorio. `npm run dev` sirve el frontend y el modo individual; para usar la API local, utilizar `vercel dev` con acceso al proyecto y su almacén privado. La primera carga requiere conexión; no se implementa un modo sin conexión.

## Editar las preguntas

El banco se encuentra en `src/questions.json`. Cada pregunta tiene este formato:

```json
{
  "id": "inacap-facil-01",
  "category": "inacap",
  "level": "facil",
  "question": "¿En qué año se fundó INACAP?",
  "options": ["1966", "1970", "1960", "1975"],
  "answer": 0,
  "explanation": "INACAP se fundó el 21 de octubre de 1966."
}
```

`answer` es la posición de la respuesta correcta **antes de mezclar**, contando desde cero. Se requieren entre dos y cuatro alternativas distintas, un ID único y una explicación.

| Campo      | Valores permitidos                                       |
| ---------- | -------------------------------------------------------- |
| `category` | `inacap`, `tecnologia`, `cultura`, `musica`, `educacion` |
| `level`    | `facil`, `medio`, `hardcore`                             |
| `answer`   | Índice válido dentro de `options`                                       |

Debe existir al menos una pregunta de cada categoría en cada dificultad: 15 combinaciones en total. Las preguntas pueden distribuirse libremente respetando esa cobertura. La aplicación detecta un banco incompleto o inválido y muestra un error en lugar de iniciar una partida defectuosa.

No hay un panel de administración: los cambios al banco se publican con un nuevo despliegue.

## Pruebas

```bash
npm test
npx playwright install chromium
npm run test:e2e
```

Las pruebas unitarias y de contrato HTTP comprueban respuestas simultáneas con ETags, identidad de jugadores, capacidad de salas, tiempos del servidor, respuestas duplicadas, revelado de respuestas, avance sincronizado, ganador, empate y expiración. También comprueban la selección por categoría y nivel, la correspondencia de respuestas después de mezclarlas, la validación del banco y el puntaje. Las pruebas de navegador cubren partidas completas en las tres dificultades, vencimiento del tiempo, respuestas incorrectas, bloqueo de respuestas múltiples, salida de partida, teclado y récord local en escritorio y móvil.

En este entorno cloud ya está disponible Chromium. Para usarlo sin descargar otro navegador: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e`. Si npm no puede escribir en su caché habitual, agregar `--cache /workspace/.npm-cache` a `npm ci`.

## Publicar en Vercel

1. Subir los archivos de este proyecto a un repositorio propio en GitHub.
2. En Vercel, elegir **Add New → Project** e importar ese repositorio con la cuenta que tenga acceso.
3. Usar la raíz del repositorio como Root Directory. El archivo `vercel.json` configura Vite, `npm run build` y la salida `dist`. Para la sala se requiere el almacén Blob privado conectado al proyecto; Vercel inyecta su variable de entorno. El modo individual funciona sin ella.
4. Pulsar **Deploy**. Vercel asignará una URL pública HTTPS que se puede usar en un QR para el stand.
5. Abrir la URL pública en el dispositivo del stand y comprobar una partida. Los siguientes cambios en la rama de producción se publicarán mediante la integración de Git.

Alternativa desde una máquina con la CLI de Vercel autenticada: `npx vercel --prod`. Este repositorio no contiene credenciales de despliegue.

El modo individual incluye las respuestas en los archivos del navegador; la aplicación está pensada para una actividad recreativa presencial. La sala con presentador calcula el ranking de su partida en el servidor. No incluye un ranking global entre salas. El frontend se construye en `dist`; Vercel despliega además `api/live.js`, `lib/live.js` y el SDK de Blob. Los endpoints del duelo anterior se conservan para compatibilidad.

## Logo histórico

`public/logo-inacap-historico.jpg` es el archivo original proporcionado por el organizador en `logoinacap.zip`, sin recortes ni retoques. La cabecera conserva su proporción en escritorio y teléfono; se utiliza también como favicon.

Las pruebas de la sala cubren ingreso de 40 participantes en paralelo, respuestas concurrentes e inmutables, solicitudes repetidas del presentador, control de acceso, cierre de ingreso, cinco rondas, tiempos agotados, clasificación completa, desempates y recuperación de sesión. La validación automatizada no sustituye una prueba del montaje real de televisión y teléfonos antes del evento.
