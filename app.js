const porId = (id) => document.getElementById(id);
const formularioLogin = porId("login-form");
const formularioPost = porId("post-form");
const dialogo = porId("delete-dialog");
let sesion = null;
let idEdicion = null;
let idBorrado = null;
let ultimaLectura = 0;

function avisar(elemento, mensaje = "", esError = false) {
  elemento.textContent = mensaje;
  elemento.classList.toggle("error", esError);
  elemento.hidden = !mensaje;
}

function mostrarClave(visible) {
  porId("password").type = visible ? "text" : "password";
  const boton = porId("toggle-password");
  boton.setAttribute("aria-pressed", String(visible));
  boton.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
}

function iniciarEditor(post = null) {
  formularioPost.reset();
  idEdicion = post?._id ?? null;
  porId("editor-title").textContent = post ? "Editar publicación" : "Nueva publicación";
  porId("save").textContent = post ? "Guardar cambios" : "Publicar";
  porId("cancel-edit").hidden = !post;
  if (post) {
    porId("content").value = post.contenido;
    porId("likes").value = post.likes;
    porId("state").value = post.estado;
    porId("content").focus();
  }
}

function salir(mensaje = "") {
  sesion?.peticiones.abort();
  sesion = null;
  ultimaLectura++;
  if (dialogo.open) dialogo.close();
  idBorrado = null;
  iniciarEditor();
  porId("post-fields").disabled = false;
  porId("posts").replaceChildren();
  porId("posts").inert = false;
  porId("count").hidden = true;
  porId("my-name").textContent = "";
  porId("my-avatar").textContent = "";
  porId("account").hidden = porId("feed-view").hidden = true;
  porId("course").hidden = porId("login-view").hidden = false;
  formularioLogin.reset();
  mostrarClave(false);
  avisar(porId("feed-message"));
  avisar(porId("login-message"), mensaje, Boolean(mensaje));
  document.title = "ConectaSocial · Iniciar sesión";
  porId("username").focus();
}

function mensajeHttp(estado, detalle) {
  switch (estado) {
    case 400: return "El identificador de la publicación no es válido.";
    case 401: return "Usuario o contraseña incorrectos.";
    case 403: return "Solo el propietario puede editar o eliminar esta publicación.";
    case 404: return "La publicación ya no existe. Actualiza el muro para ver los cambios.";
    case 422: {
      const campos = Array.isArray(detalle) ? detalle.map((e) => e.loc?.at(-1)) : [];
      if (campos.includes("likes")) return "Likes debe ser un entero mayor o igual que cero.";
      if (campos.includes("contenido") || campos.includes("estado")) return "Completa el contenido y el estado.";
      if (campos.includes("usuario") || campos.includes("contrasena")) return "Revisa el usuario y la contraseña.";
      return "Revisa los datos del formulario.";
    }
    case 503: return "El servicio de datos no está disponible. Inténtalo de nuevo.";
    case 502:
    case 504: return "El servidor web no pudo contactar con la API. Inténtalo de nuevo.";
    default: return "No se pudo completar la solicitud. Inténtalo de nuevo.";
  }
}

async function pedir(ruta, metodo = "GET", cuerpo) {
  const activa = sesion;
  const headers = { Accept: "application/json" };
  if (activa) headers.Authorization = "Bearer " + activa.token;
  if (cuerpo !== undefined) headers["Content-Type"] = "application/json";
  let respuesta;
  try {
    respuesta = await fetch("/api" + ruta, {
      method: metodo, headers, body: cuerpo, cache: "no-store", signal: activa?.peticiones.signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("No se pudo conectar con la API. Comprueba la conexión e inténtalo de nuevo.");
  }
  if (respuesta.status === 401 && activa) {
    if (sesion === activa) salir("Tu sesión ya no es válida. Vuelve a iniciar sesión.");
    throw new DOMException("Sesión finalizada", "AbortError");
  }
  if (!respuesta.ok) {
    const datos = await respuesta.json().catch(() => null);
    throw new Error(mensajeHttp(respuesta.status, datos?.detail));
  }
  if (respuesta.status === 204) return;
  const texto = await respuesta.text().catch(() => {
    throw new Error("Se interrumpió la conexión con la API. Actualiza el muro o vuelve a iniciar sesión.");
  });
  // Conserva el entero original de BSON incluso cuando excede la precisión de Number.
  try {
    return JSON.parse(texto, (campo, valor, contexto) =>
      campo === "likes" && contexto?.source ? contexto.source : valor
    );
  } catch {
    throw new Error("La API devolvió una respuesta que no se pudo leer.");
  }
}

function avatar(nombre) {
  return Array.from(nombre).slice(0, 2).join("").toLocaleUpperCase("es");
}

function pintarPosts(posts) {
  if (idEdicion && !posts.some((post) => post._id === idEdicion && post.usuario === sesion.usuario)) {
    iniciarEditor();
  }
  const fragmento = document.createDocumentFragment();
  for (const post of posts.sort((a, b) => b._id.localeCompare(a._id))) {
    const tarjeta = porId("post-template").content.cloneNode(true);
    tarjeta.querySelector("[data-avatar]").textContent = avatar(post.usuario);
    tarjeta.querySelector("[data-author]").textContent = post.usuario;
    tarjeta.querySelector("[data-state]").textContent = post.estado;
    tarjeta.querySelector("[data-content]").textContent = post.contenido;
    tarjeta.querySelector("[data-likes]").textContent = post.likes + (String(post.likes) === "1" ? " like" : " likes");
    if (post.usuario === sesion.usuario) {
      tarjeta.querySelector("[data-actions]").hidden = false;
      tarjeta.querySelector("[data-edit]").onclick = () => iniciarEditor(post);
      tarjeta.querySelector("[data-delete]").onclick = () => {
        idBorrado = post._id;
        dialogo.showModal();
      };
    }
    fragmento.append(tarjeta);
  }
  porId("posts").replaceChildren(fragmento);
  porId("count").textContent = posts.length;
  porId("count").hidden = false;
  porId("list-state").textContent = posts.length ? "" : "Todavía no hay publicaciones.";
  porId("list-state").hidden = posts.length > 0;
}

async function cargarPosts() {
  const lectura = ++ultimaLectura;
  porId("refresh").disabled = true;
  porId("list-state").hidden = false;
  porId("list-state").textContent = "Cargando publicaciones…";
  try {
    const posts = await pedir("/publicaciones");
    if (lectura === ultimaLectura) pintarPosts(posts);
  } catch (error) {
    if (lectura === ultimaLectura && error.name !== "AbortError") {
      porId("list-state").textContent = error.message + " Usa Actualizar para volver a cargar el muro.";
    }
  } finally {
    if (lectura === ultimaLectura) porId("refresh").disabled = false;
  }
}

formularioLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const usuario = porId("username").value.trim();
  const contrasena = porId("password").value;
  if (!usuario) {
    avisar(porId("login-message"), "Ingresa tu nombre de usuario.", true);
    porId("username").focus();
    return;
  }
  const boton = porId("login-submit");
  if (boton.disabled) return;
  boton.disabled = true;
  boton.textContent = "Ingresando…";
  avisar(porId("login-message"));
  try {
    const datos = await pedir("/auth/login", "POST", JSON.stringify({ usuario, contrasena }));
    if (!datos.access_token || datos.token_type !== "bearer") throw new Error("La API devolvió una sesión inválida.");
    sesion = { usuario, token: datos.access_token, peticiones: new AbortController() };
    porId("password").value = "";
    mostrarClave(false);
    porId("login-view").hidden = porId("course").hidden = true;
    porId("feed-view").hidden = porId("account").hidden = false;
    porId("my-name").textContent = usuario;
    porId("my-avatar").textContent = avatar(usuario);
    document.title = "ConectaSocial · Publicaciones";
    porId("content").focus();
    await cargarPosts();
  } catch (error) {
    if (error.name !== "AbortError") avisar(porId("login-message"), error.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = "Ingresar al muro";
  }
});

function cuerpoPublicacion() {
  const contenido = porId("content").value.trim();
  const estado = porId("state").value.trim();
  const likes = porId("likes").value;
  if (!contenido || !estado) throw new Error("Completa el contenido y el estado.");
  if (!/^\d+$/.test(likes) || BigInt(likes) > 9223372036854775807n) {
    throw new Error("Likes debe ser un entero entre 0 y 9223372036854775807.");
  }
  // Los textos se escapan como JSON y solo el entero validado se emite como número.
  return `{"contenido":${JSON.stringify(contenido)},"likes":${BigInt(likes)},"estado":${JSON.stringify(estado)}}`;
}

async function cambiarPublicacion(eliminar = false) {
  const activa = sesion;
  const campos = porId("post-fields");
  if (!activa || campos.disabled) return;
  const id = eliminar ? idBorrado : idEdicion;
  const ruta = id ? "/publicaciones/" + encodeURIComponent(id) : "/publicaciones";
  campos.disabled = true;
  porId("posts").inert = true;
  avisar(porId("feed-message"));
  try {
    if (eliminar) {
      await pedir(ruta, "DELETE");
    } else {
      await pedir(ruta, id ? "PUT" : "POST", cuerpoPublicacion());
    }
    if (sesion !== activa) return;
    if (!eliminar || idEdicion === id) iniciarEditor();
    const mensaje = eliminar ? "Publicación eliminada." : id ? "Cambios guardados." : "Publicación creada.";
    avisar(porId("feed-message"), mensaje);
    await cargarPosts();
  } catch (error) {
    if (sesion === activa && error.name !== "AbortError") avisar(porId("feed-message"), error.message, true);
  } finally {
    if (sesion === activa) campos.disabled = false;
    if (sesion === activa || !sesion) porId("posts").inert = false;
  }
}

formularioPost.addEventListener("submit", (evento) => {
  evento.preventDefault();
  cambiarPublicacion();
});
porId("toggle-password").onclick = () => mostrarClave(porId("password").type === "password");
porId("logout").onclick = () => salir();
porId("refresh").onclick = cargarPosts;
porId("cancel-edit").onclick = () => { iniciarEditor(); porId("content").focus(); };
porId("cancel-delete").onclick = () => dialogo.close();
porId("confirm-delete").onclick = () => {
  dialogo.close();
  cambiarPublicacion(true);
};
