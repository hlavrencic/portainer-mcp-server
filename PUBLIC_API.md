# Portainer MCP Server - Public API Endpoints

## Overview

El servidor Portainer MCP ahora expone dos endpoints públicos (sin autenticación) para gestionar imágenes de Docker:

1. **GET /api/images** - Listar todas las imágenes Docker
2. **GET /api/images/unused** - Listar imágenes sin uso
3. **POST /api/images/cleanup** - Eliminar imágenes sin uso

## Configuration

El servidor Express se inicia en el puerto definido por la variable de entorno `PUBLIC_PORT` (por defecto 3000):

```bash
PUBLIC_PORT=3000 PORTAINER_URL=http://localhost:9000 PORTAINER_PAT=xxx node src/index.mjs
```

## Endpoints

### 1. GET /api/images

Lista todas las imágenes Docker disponibles en un ambiente específico.

**URL:**
```
GET http://localhost:3000/api/images?environmentId=1
```

**Query Parameters:**
- `environmentId` (optional): ID del ambiente Portainer (default: 1)

**Response:**
```json
{
  "success": true,
  "count": 5,
  "images": [
    {
      "id": "abc123def456",
      "tags": ["nginx:latest", "nginx:1.21"],
      "size": "142.5MB",
      "created": 1234567890,
      "repoDigests": ["nginx@sha256:..."]
    }
  ]
}
```

**Example:**
```bash
curl http://localhost:3000/api/images
curl http://localhost:3000/api/images?environmentId=2
```

---

### 2. GET /api/images/unused

Lista imágenes Docker que no son utilizadas por ningún contenedor activo.

**URL:**
```
GET http://localhost:3000/api/images/unused?environmentId=1
```

**Query Parameters:**
- `environmentId` (optional): ID del ambiente Portainer (default: 1)

**Response:**
```json
{
  "success": true,
  "count": 3,
  "unusedImages": [
    {
      "id": "abc123def456",
      "fullId": "sha256:abc123def456...",
      "tags": ["<none>"],
      "size": "5.2MB",
      "created": 1234567890,
      "dangling": true
    }
  ]
}
```

**Example:**
```bash
curl http://localhost:3000/api/images/unused
curl http://localhost:3000/api/images/unused?environmentId=2
```

---

### 3. POST /api/images/cleanup

Elimina todas las imágenes sin uso del ambiente especificado.

**URL:**
```
POST http://localhost:3000/api/images/cleanup?environmentId=1&force=false
```

**Query Parameters:**
- `environmentId` (optional): ID del ambiente Portainer (default: 1)
- `force` (optional): Forzar eliminación incluso si la imagen está siendo usada (default: false)

**Response:**
```json
{
  "success": true,
  "message": "Cleanup completed. Deleted 2 image(s).",
  "deletedCount": 2,
  "failedCount": 0,
  "deleted": [
    {
      "id": "abc123def456",
      "tags": ["<none>"],
      "size": "5.2MB"
    }
  ]
}
```

**Example:**
```bash
# Simple cleanup
curl -X POST http://localhost:3000/api/images/cleanup

# Force cleanup
curl -X POST http://localhost:3000/api/images/cleanup?force=true

# Specific environment
curl -X POST http://localhost:3000/api/images/cleanup?environmentId=2&force=false
```

---

## Testing

Usa el script de prueba incluido:

```bash
# Test all endpoints
node test-public-api.mjs all

# Test specific endpoint
node test-public-api.mjs list      # GET /api/images
node test-public-api.mjs unused    # GET /api/images/unused
node test-public-api.mjs cleanup   # POST /api/images/cleanup
```

**Environment Variables for Testing:**
- `API_URL`: URL base de la API (default: http://localhost:3000)
- `ENVIRONMENT_ID`: ID del ambiente Portainer (default: 1)

```bash
API_URL=http://localhost:3000 ENVIRONMENT_ID=2 node test-public-api.mjs all
```

---

## Implementation Details

### Unused Images Detection

Una imagen se considera "sin uso" si cumple AMBAS condiciones:
1. No es utilizada por ningún contenedor activo o detenido
2. Es una imagen "dangling" (sin tags) O tiene solo tags `<none>`

### Error Handling

- Si una imagen falla al eliminarse, se incluye en el array `failed` con el mensaje de error
- El endpoint continúa intentando eliminar las demás imágenes
- Si no hay imágenes sin uso, retorna `deletedCount: 0`

### Security Considerations

⚠️ **Nota**: Estos endpoints son públicos sin autenticación. Se recomienda:
- Protegerlos con un proxy reverso (nginx, Caddy, etc.)
- Usar firewall/seguridad de red
- Limitar acceso a IPs confiables
- Implementar rate limiting

---

## Docker Compose Example

```yaml
version: '3.8'
services:
  portainer-mcp:
    image: portainer-mcp-server
    ports:
      - "3000:3000"
    environment:
      PORTAINER_URL: http://portainer:9000
      PORTAINER_PAT: your_api_key_here
      PUBLIC_PORT: 3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```
