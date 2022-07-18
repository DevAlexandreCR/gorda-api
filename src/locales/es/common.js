export default {
  fields: {
    status: 'Estado',
    enabled: 'Habilitado',
    disabled: 'Inhabilitado',
    name: 'Nombre',
    email: 'Correo electrónico',
    phone: 'Teléfono'
  },
  models: {
    users: 'Usuario | Usuarios',
    drivers: 'Conductor | Conductores'
  },
  actions: {
    submit: 'Enviar',
    edit: 'Editar',
    close: 'Cerrar',
    create: 'Crear',
    cancel: 'Cancelar',
    release: 'Liberar',
    assign: 'Asignar',
    terminate: 'Terminar'
  },
  messages: {
    updated: 'Recurso actualizado correctamente',
    created: 'Recurso creado correctamente',
    deleted: 'Recurso eliminado correctamente',
    error: 'Algo salió mal!',
    forbidden: 'Permiso denegado!'
  },
  placeholders: {
    name: 'Ingrese el nombre',
    email: 'Ingrese el email',
    phone: 'Ingrese el teléfono',
    password: 'Contraseña',
    confirm_password: 'Confirmar contraseña',
    address: 'Ingrese la dirección',
    comment: 'Ingrese un comentario (opcional)',
    search: 'Buscar',
    map: 'Mapa'
  },
  forms: {
    select_img: 'Choose image from files'
  },
  chatBot: {
    connected: 'Conectado',
    disconnected: 'Desconectado',
    disconnect: 'Desconectar',
    connect: 'Conectar',
    reset: 'Reiniciar'
  },
  colors: {
    black: 'Negro',
    blue: 'Azul',
    gray: 'Gris',
    green: 'Verde',
    purple: 'Purpura',
    red: 'Rojo',
    white: 'Blanco',
    pink: 'Rosado',
    orange: 'Naranja',
    gold: 'Dorado',
    yellow: 'Amarillo',
    magenta: 'Magenta',
    cyan: 'Cyan',
    brown: 'Café',
    maroon: 'Marrón',
    beige: 'Beige',
    silver: 'Plateado'
  }
}