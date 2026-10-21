# La máquina del tiempo · Trivia INACAP

Trivia individual para el stand de INACAP, inspirada en la estética de los años 60 y 70. Funciona en teléfonos, tablets y computadores, sin cuentas para los visitantes. El modo individual funciona en el navegador; el duelo usa una API de Vercel y almacenamiento privado de salas.

## Jugar

- Tres niveles: Fácil, Medio y Hardcore.
- Cada partida selecciona al azar **cinco preguntas**, exactamente una de INACAP, Tecnología, Cultura, Música y Educación, del nivel elegido.
- También se mezclan el orden de las categorías y las alternativas. Las preguntas pueden repetirse entre partidas independientes.
- Hay 20 segundos por pregunta. Una respuesta correcta entrega entre 500 y 1000 puntos, según la rapidez; una incorrecta o fuera de tiempo entrega 0. Máximo: 5000 puntos.
- Se muestra la respuesta correcta y una explicación antes de continuar. Al final se pueden revisar las cinco respuestas o comenzar otra partida.
- Récord por dificultad guardado en este navegador y dispositivo; no es un ranking compartido entre visitantes.
- Botón de pantalla completa cuando el navegador lo admite. También se puede responder con las teclas 1, 2, 3 y 4.

El banco contiene las **75 preguntas entregadas para el stand**: 15 por categoría y cinco por cada dificultad dentro de cada categoría. Las respuestas se conservaron; se añadieron alternativas incorrectas para permitir la selección. Algunas consignas se adaptaron a opción múltiple y se retiraron referencias a un documento que el jugador no tiene a la vista. Los campos `sourceQuestion` y `sourceAnswer` conservan el texto original.

## Dos jugadores desde sus teléfonos

1. En el inicio, seleccionar el nivel y pulsar **2 jugadores**.
2. El primer jugador ingresa su apodo y crea una sala.
3. Comparte el enlace o el código de 10 caracteres con el segundo jugador.
4. El creador inicia el duelo cuando ambos aparecen en la sala.
5. Ambos reciben las mismas cinco preguntas y tienen 20 segundos por ronda. Las respuestas se revelan cuando ambos responden o se acaba el tiempo. Ambos deben pulsar Siguiente para avanzar.
6. Gana el mayor puntaje total. Si los puntajes coinciden, se informa empate. Si alguien sale, se informa partida interrumpida sin asignar ganador.

En individual se gana con **3 respuestas correctas de 5**. Los textos de apoyo y explicaciones se ampliaron para facilitar la lectura.

Las salas se guardan en Vercel Blob privado mediante escrituras condicionales por ETag, que evitan perder respuestas simultáneas. La API calcula el puntaje y comprueba el tiempo en el servidor; nunca acepta puntajes enviados por el navegador. Los teléfonos se sincronizan cada 1,5 segundos, conservan la sesión al recargar y no necesitan estar en la misma red. Las salas expiran después de una hora; un acceso posterior elimina su archivo. Los archivos de salas que no se vuelven a consultar permanecen en el almacenamiento hasta su limpieza administrativa.

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

Las tipografías se sirven desde la propia aplicación. El modo individual no requiere claves ni variables de entorno. El duelo usa `BLOB_READ_WRITE_TOKEN`, configurada únicamente en Vercel, y una conexión a Internet. Nunca debe incluirse la credencial en archivos del frontend o en el repositorio. `npm run dev` sirve el frontend y el modo individual; para usar la API local, utilizar `vercel dev` con acceso al proyecto y su almacén privado. La primera carga requiere conexión; no se implementa un modo sin conexión.

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
3. Usar la raíz del repositorio como Root Directory. El archivo `vercel.json` configura Vite, `npm run build` y la salida `dist`. Para el duelo se requiere el almacén Blob privado conectado al proyecto; Vercel inyecta su variable de entorno. El modo individual funciona sin ella.
4. Pulsar **Deploy**. Vercel asignará una URL pública HTTPS que se puede usar en un QR para el stand.
5. Abrir la URL pública en el dispositivo del stand y comprobar una partida. Los siguientes cambios en la rama de producción se publicarán mediante la integración de Git.

Alternativa desde una máquina con la CLI de Vercel autenticada: `npx vercel --prod`. Este repositorio no contiene credenciales de despliegue.

El modo individual incluye las respuestas en los archivos del navegador; la aplicación está pensada para una actividad recreativa presencial. El duelo tiene salas privadas de dos jugadores con cálculo del resultado en el servidor. No incluye un ranking global. El frontend se construye en `dist`; Vercel despliega además `api/duel.js`, `lib/duel.js` y el SDK de Blob.

## Logo histórico

`public/logo-inacap-historico.jpg` es el archivo original proporcionado por el organizador en `logoinacap.zip`, sin recortes ni retoques. La cabecera conserva su proporción en escritorio y teléfono; se utiliza también como favicon.
