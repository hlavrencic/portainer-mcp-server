# portainer-mcp-server

MCP server for the [Portainer](https://portainer.io) REST API. Manage Docker containers, stacks, images, networks and volumes from any AI assistant that supports the [Model Context Protocol](https://modelcontextprotocol.io).

## Usage

```bash
npx portainer-mcp-server
```

Or with a permanent install:

```bash
npm install -g portainer-mcp-server
portainer-mcp-server
```

## Configuration

Two environment variables are required:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORTAINER_URL` | Portainer base URL | `http://localhost:9000` |
| `PORTAINER_PAT` | Portainer API token (Personal Access Token) | *(required)* |

To generate a PAT: Portainer UI → Account → Access Tokens → Add access token.

## OpenCode / Claude Desktop config

```json
{
  "mcp": {
    "portainer": {
      "type": "local",
      "command": ["npx", "-y", "portainer-mcp-server"],
      "enabled": true,
      "environment": {
        "PORTAINER_URL": "http://your-portainer-host:9000",
        "PORTAINER_PAT": "<your-token>"
      }
    }
  }
}
```

## Available tools

| Tool | Description |
|------|-------------|
| `list_environments` | List all Portainer environments/endpoints |
| `list_containers` | List containers in an environment |
| `inspect_container` | Get detailed info about a container |
| `get_container_logs` | Get logs from a container |
| `start_container` | Start a stopped container |
| `stop_container` | Stop a running container |
| `restart_container` | Restart a container |
| `list_stacks` | List all Portainer stacks |
| `inspect_stack` | Get details of a specific stack |
| `get_stack_file` | Get the docker-compose file of a stack |
| `list_images` | List Docker images in an environment |
| `list_networks` | List Docker networks in an environment |
| `list_volumes` | List Docker volumes in an environment |

## License

MIT
