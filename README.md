# ConectaSocial · WebTier del TB2

Interfaz web para el curso Sistemas Operativos de la UPC. Permite iniciar sesión, leer el muro y crear, editar o eliminar publicaciones. El navegador usa HTML5, CSS3, Bootstrap 5 y JavaScript con Fetch. Nginx sirve los archivos y comunica el navegador con la API de FastAPI. MongoDB permanece en DataTier.

## Cómo se conecta con el backend

Un login envía `POST /api/auth/login` al mismo origen que sirvió la página. Nginx sustituye el prefijo `/api/` por `/` y entrega a FastAPI `POST /auth/login` con el JSON `usuario` y `contrasena`. La dirección de destino se configura al crear el contenedor mediante **`API_UPSTREAM`**, con esquema, host y puerto, sin ruta ni barra final. La imagen oficial aplica esa variable a la plantilla al iniciar Nginx. [Referencia de proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)

El JWT vive en memoria. Las peticiones al muro llevan `Authorization: Bearer TOKEN`. Al salir, recargar la página o recibir un `401` en una ruta protegida, se requiere un nuevo login. El backend devuelve el token y su tipo. La interfaz utiliza el nombre ingresado en el login exitoso para decidir dónde mostrar **Editar** y **Eliminar**. FastAPI comprueba el propietario en MongoDB en cada escritura.

| Solicitud desde el navegador | Comportamiento |
| --- | --- |
| POST `/api/auth/login` | Valida el usuario y la contraseña. |
| GET `/api/publicaciones` | Carga las publicaciones reales de la base. **Actualizar** vuelve a consultarlas. |
| POST `/api/publicaciones` | Envía únicamente `contenido`, `likes` y `estado`. FastAPI asigna el propietario. |
| PUT `/api/publicaciones/{id}` | Envía los mismos tres campos. Usa el `_id` devuelto por la API. |
| DELETE `/api/publicaciones/{id}` | Pide confirmación y acepta `204` con cuerpo vacío. |

## Prueba local con Docker

Ejecuta estos comandos en Bash desde `conectasocial-frontend`. Se necesita Docker con BuildKit, OpenSSL y el backend en la carpeta hermana `../conectasocial-api`. La primera construcción descarga la imagen de Nginx y el CSS de Bootstrap 5.3.9, cuya integridad comprueba Docker. El navegador carga los estilos desde el propio WebTier. [Bootstrap 5](https://getbootstrap.com/docs/5.3/getting-started/introduction/)

```bash
docker build -t conectasocial-frontend:tb2 .
docker build -t conectasocial-api:tb2 ../conectasocial-api
docker network create conecta-lab
docker run -d --rm --name conecta-lab-mongo --network conecta-lab mongo:7.0

export JWT_SECRET_KEY="$(openssl rand -hex 32)"
docker run -d --rm --name conecta-lab-api --network conecta-lab \
  -e MONGO_URI=mongodb://conecta-lab-mongo:27017/ \
  -e MONGO_DB=conectasocial_webtier_pruebas -e JWT_SECRET_KEY conectasocial-api:tb2
unset JWT_SECRET_KEY
docker exec -it conecta-lab-api python crear_usuarios.py

docker run -d --rm --name conecta-lab-web --network conecta-lab \
  -p 127.0.0.1:8080:80 -e API_UPSTREAM=http://conecta-lab-api:8000 conectasocial-frontend:tb2
```

El script del backend pide las contraseñas de `ana_tb2` y `luis_tb2` en la terminal. Si MongoDB aún está arrancando, vuelve a ejecutar el script cuando esté disponible. Abre el sitio en un navegador actual. Este laboratorio usa HTTP en loopback, sin cifrado. [Abrir el frontend local](http://127.0.0.1:8080)

1. Prueba una contraseña incorrecta y luego inicia sesión como Ana. Publica un texto, cambia su contenido, likes o estado y pulsa **Guardar cambios**.
2. Cierra sesión e ingresa como Luis. Verifica que puede leer la publicación de Ana y que sus controles de edición y eliminación aparecen solo en las publicaciones que él crea.
3. Vuelve a entrar como Ana. Cancela la primera confirmación de borrado y verifica que el texto sigue en el muro. Confirma el segundo intento y comprueba que desaparece.
4. Recarga la página con una sesión abierta. Debe volver al login. Para comprobar el proxy de forma independiente, ejecuta `curl -i http://127.0.0.1:8080/api/publicaciones`. Sin token se espera `401` con `WWW-Authenticate: Bearer`.

Para retirar el laboratorio y sus datos temporales, ejecuta estos comandos sobre los contenedores anteriores.

```bash
docker stop conecta-lab-web conecta-lab-api conecta-lab-mongo
docker network rm conecta-lab
```

## Despliegue en EC2 con HTTPS

**AppTier.** El contenedor de la PC4 publicaba el puerto en `127.0.0.1`. Para que lo alcance otra instancia, recrea únicamente el contenedor de la API con el puerto asociado a la **IP privada de AppTier**. Este ejemplo supone que la imagen TB2 ya está construida, el contenedor actual se llama `conectasocial-api` y estás en el directorio del backend con su `.env` vigente.

```bash
docker stop conectasocial-api
docker rm conectasocial-api
docker run -d --name conectasocial-api --restart unless-stopped --env-file .env \
  -p IP_PRIVADA_APPTIER:8000:8000 conectasocial-api:tb2
```

Sustituye `IP_PRIVADA_APPTIER` por la IP real. En una instalación nueva omite los comandos de parada y retirada. La configuración de MongoDB y la clave JWT permanecen en AppTier. El equipo que administra el backend puede provisionar las dos cuentas mediante `docker exec -it conectasocial-api python crear_usuarios.py`.

**WebTier.** Configura el DNS del dominio hacia WebTier. Prepara en el servidor el directorio `/etc/conectasocial/tls/` con la cadena de certificados `fullchain.pem` y su clave `privkey.pem`, legibles por Nginx. El certificado debe cubrir el dominio. Desde este repositorio en WebTier, sustituye el marcador de IP y ejecuta lo siguiente.

```bash
docker build -t conectasocial-frontend:tb2 .
docker run -d --name conectasocial-web --restart unless-stopped \
  -p 80:80 -p 443:443 -e API_UPSTREAM=http://IP_PRIVADA_APPTIER:8000 \
  --mount "type=bind,source=$PWD/nginx.tls.conf,target=/etc/nginx/optional/https.conf,readonly" \
  --mount type=bind,source=/etc/conectasocial/tls,target=/etc/nginx/tls,readonly \
  conectasocial-frontend:tb2
docker exec conectasocial-web nginx -t
```

El archivo `nginx.tls.conf` activa HTTPS en 443 y la redirección HTTP `308` en 80. Nginx termina TLS en WebTier. Con el `API_UPSTREAM` del ejemplo, el siguiente salto usa HTTP por la red privada de la VPC. El navegador consume web y API bajo el mismo origen.

| Security Group de destino | Puerto TCP | Origen permitido |
| --- | --- | --- |
| WebTier | 443 | Clientes web autorizados. Internet si el sitio es público. |
| WebTier | 80 | Los mismos clientes para redirección a HTTPS. |
| AppTier | 8000 | Solo el Security Group de WebTier. |
| DataTier | 27017 | Solo el Security Group de AppTier. |
| Instancias con acceso SSH | 22 | Solo direcciones administrativas autorizadas. |

Las instancias necesitan rutas privadas entre las capas. Si se restringe el tráfico de salida, permite los saltos WebTier → AppTier en 8000 y AppTier → DataTier en 27017. [Reglas entre grupos de seguridad de AWS](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)

**Verificación en AWS.** Desde WebTier, `curl -i http://IP_PRIVADA_APPTIER:8000/publicaciones` debe llegar a FastAPI y devolver `401`. Desde un cliente autorizado, reemplaza `DOMINIO_WEB` y verifica la redirección, el certificado y el proxy.

```bash
curl -I http://DOMINIO_WEB/
curl -v -o /dev/null https://DOMINIO_WEB/
curl -i https://DOMINIO_WEB/api/publicaciones
```

Se esperan `308` hacia HTTPS, verificación del certificado con `200` y `401` sin token, respectivamente. Para la evidencia del TB2, abre el dominio por HTTPS, inspecciona el certificado y la versión TLS en el navegador e inicia sesión. Realiza el CRUD únicamente sobre una publicación creada para esa prueba.

## Archivos

| Archivo | Función |
| --- | --- |
| `index.html` | Vistas de acceso y muro, formulario, tarjeta de publicación y diálogo de eliminación. |
| `styles.css` | Estilos responsive y ajustes de Bootstrap. |
| `app.js` | Sesión en memoria, Fetch, validación y mensajes en español. Inserta los datos de MongoDB con `textContent`. |
| `nginx.conf.template` | Sirve los archivos y reenvía `/api/` a la dirección indicada por `API_UPSTREAM`. |
| `nginx.tls.conf` | Configuración HTTPS opcional montada al desplegar. |
| `Dockerfile` | Construye WebTier a partir de la imagen oficial de Nginx. |
| `.dockerignore`, `.gitignore` | Limitan el contexto de construcción y excluyen certificados, secretos y capturas locales. |
