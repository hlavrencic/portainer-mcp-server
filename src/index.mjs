#!/usr/bin/env node
/**
 * Portainer MCP Server - Uses Portainer REST API
 * Env vars required: PORTAINER_URL, PORTAINER_PAT
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import express from "express";

const PORTAINER_URL = process.env.PORTAINER_URL || "http://192.168.0.214:9000";
const PORTAINER_PAT = process.env.PORTAINER_PAT;

if (!PORTAINER_PAT) {
  console.error("Error: PORTAINER_PAT environment variable is required");
  process.exit(1);
}

async function api(path, options = {}) {
  const url = `${PORTAINER_URL}/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-API-Key": PORTAINER_PAT,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Portainer API error ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Express Server for Public Endpoints ──────────────────────────────────────
const app = express();
app.use(express.json());

const PORT = process.env.PUBLIC_PORT || 3000;

// Helper function to identify unused images (dangling images not used by any container)
async function getUnusedImages(environmentId) {
  try {
    const [containers, allImages] = await Promise.all([
      api(`/endpoints/${environmentId}/docker/containers/json?all=1`),
      api(`/endpoints/${environmentId}/docker/images/json?all=1`)
    ]);

    // Get all image IDs used by containers
    const usedImageIds = new Set();
    containers.forEach((container) => {
      if (container.ImageID) {
        usedImageIds.add(container.ImageID);
      }
    });

    // Filter images that are not used by any container and have no tags
    const unusedImages = allImages.filter((img) => {
      const isUsed = usedImageIds.has(img.Id);
      const hasRepoTags = img.RepoTags && img.RepoTags.length > 0 && !img.RepoTags.includes("<none>");
      // Mark as unused if: not used by container AND (dangling or has no meaningful tags)
      return !isUsed && (!hasRepoTags || img.RepoTags.every(tag => tag === "<none>"));
    });

    return unusedImages;
  } catch (error) {
    throw new Error(`Failed to get unused images: ${error.message}`);
  }
}

// GET /api/images - List all Docker images (public endpoint)
app.get("/api/images", async (req, res) => {
  try {
    const environmentId = req.query.environmentId || 1;
    const images = await api(`/endpoints/${environmentId}/docker/images/json`);
    
    res.json({
      success: true,
      count: images.length,
      images: images.map((img) => ({
        id: img.Id.slice(7, 19),
        tags: img.RepoTags || ["<none>"],
        size: `${(img.Size / 1024 / 1024).toFixed(1)}MB`,
        created: img.Created,
        repoDigests: img.RepoDigests,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/images/unused - List unused Docker images (public endpoint)
app.get("/api/images/unused", async (req, res) => {
  try {
    const environmentId = req.query.environmentId || 1;
    const unusedImages = await getUnusedImages(environmentId);
    
    res.json({
      success: true,
      count: unusedImages.length,
      unusedImages: unusedImages.map((img) => ({
        id: img.Id.slice(7, 19),
        fullId: img.Id,
        tags: img.RepoTags || ["<none>"],
        size: `${(img.Size / 1024 / 1024).toFixed(1)}MB`,
        created: img.Created,
        dangling: !img.RepoTags || img.RepoTags.every(tag => tag === "<none>"),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/images/cleanup - Delete unused Docker images (public endpoint)
app.post("/api/images/cleanup", async (req, res) => {
  try {
    const environmentId = req.query.environmentId || 1;
    const force = req.query.force === "true";
    
    const unusedImages = await getUnusedImages(environmentId);
    
    if (unusedImages.length === 0) {
      return res.json({
        success: true,
        message: "No unused images found",
        deletedCount: 0,
        deleted: [],
      });
    }

    const deleted = [];
    const failed = [];

    for (const img of unusedImages) {
      try {
        const imageId = img.Id;
        const params = new URLSearchParams({ force: String(force) });
        await api(`/endpoints/${environmentId}/docker/images/${imageId}?${params}`, { method: "DELETE" });
        deleted.push({
          id: img.Id.slice(7, 19),
          tags: img.RepoTags || ["<none>"],
          size: `${(img.Size / 1024 / 1024).toFixed(1)}MB`,
        });
      } catch (error) {
        failed.push({
          id: img.Id.slice(7, 19),
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: `Cleanup completed. Deleted ${deleted.length} image(s).`,
      deletedCount: deleted.length,
      failedCount: failed.length,
      deleted,
      failed: failed.length > 0 ? failed : undefined,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Express server
app.listen(PORT, () => {
  console.log(`Public API server running on http://localhost:${PORT}`);
});

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "portainer",
  version: "1.0.0",
});

// ── Environments ──────────────────────────────────────────────────────────────

server.tool("list_environments", "List all Portainer environments/endpoints", {}, async () => {
  const envs = await api("/endpoints");
  const text = envs.map((e) =>
    `ID: ${e.Id} | Name: ${e.Name} | Type: ${e.Type} | Status: ${e.Status === 1 ? "up" : "down"} | URL: ${e.URL}`
  ).join("\n");
  return { content: [{ type: "text", text }] };
});

// ── Containers ────────────────────────────────────────────────────────────────

server.tool(
  "list_containers",
  "List containers in a Portainer environment",
  { environmentId: z.number().describe("Portainer environment ID"), all: z.boolean().optional().describe("Include stopped containers (default: true)") },
  async ({ environmentId, all = true }) => {
    const containers = await api(`/endpoints/${environmentId}/docker/containers/json?all=${all}`);
    const text = containers.map((c) =>
      `ID: ${c.Id.slice(0, 12)} | Name: ${c.Names[0]} | Image: ${c.Image} | State: ${c.State} | Status: ${c.Status}`
    ).join("\n");
    return { content: [{ type: "text", text: text || "No containers found" }] };
  }
);

server.tool(
  "inspect_container",
  "Get detailed info about a container",
  { environmentId: z.number().describe("Portainer environment ID"), containerId: z.string().describe("Container ID or name") },
  async ({ environmentId, containerId }) => {
    const data = await api(`/endpoints/${environmentId}/docker/containers/${containerId}/json`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_container_logs",
  "Get logs from a container",
  {
    environmentId: z.number().describe("Portainer environment ID"),
    containerId: z.string().describe("Container ID or name"),
    tail: z.number().optional().describe("Number of lines from the end (default: 100)"),
    timestamps: z.boolean().optional().describe("Include timestamps"),
  },
  async ({ environmentId, containerId, tail = 100, timestamps = false }) => {
    const params = new URLSearchParams({ stdout: "1", stderr: "1", tail: String(tail), timestamps: String(timestamps) });
    const logs = await api(`/endpoints/${environmentId}/docker/containers/${containerId}/logs?${params}`);
    return { content: [{ type: "text", text: String(logs) }] };
  }
);

server.tool(
  "start_container",
  "Start a stopped container",
  { environmentId: z.number().describe("Portainer environment ID"), containerId: z.string().describe("Container ID or name") },
  async ({ environmentId, containerId }) => {
    await api(`/endpoints/${environmentId}/docker/containers/${containerId}/start`, { method: "POST" });
    return { content: [{ type: "text", text: `Container ${containerId} started successfully` }] };
  }
);

server.tool(
  "stop_container",
  "Stop a running container",
  { environmentId: z.number().describe("Portainer environment ID"), containerId: z.string().describe("Container ID or name") },
  async ({ environmentId, containerId }) => {
    await api(`/endpoints/${environmentId}/docker/containers/${containerId}/stop`, { method: "POST" });
    return { content: [{ type: "text", text: `Container ${containerId} stopped successfully` }] };
  }
);

server.tool(
  "restart_container",
  "Restart a container",
  { environmentId: z.number().describe("Portainer environment ID"), containerId: z.string().describe("Container ID or name") },
  async ({ environmentId, containerId }) => {
    await api(`/endpoints/${environmentId}/docker/containers/${containerId}/restart`, { method: "POST" });
    return { content: [{ type: "text", text: `Container ${containerId} restarted successfully` }] };
  }
);

server.tool(
  "pull_image",
  "Pull a Docker image from a registry",
  {
    environmentId: z.number().describe("Portainer environment ID"),
    image: z.string().describe("Image name (e.g., 'nginx:latest' or 'myregistry.com/myimage:v1.0')"),
  },
  async ({ environmentId, image }) => {
    const params = new URLSearchParams({ fromImage: image });
    await api(`/endpoints/${environmentId}/docker/images/create?${params}`, { method: "POST" });
    return { content: [{ type: "text", text: `Image ${image} pulled successfully` }] };
  }
);

server.tool(
  "delete_image",
  "Delete a Docker image",
  {
    environmentId: z.number().describe("Portainer environment ID"),
    imageId: z.string().describe("Image ID or name (e.g., 'sha256:abc123' or 'nginx:latest')"),
    force: z.boolean().optional().describe("Force delete even if image is in use (default: false)"),
  },
  async ({ environmentId, imageId, force = false }) => {
    const params = new URLSearchParams({ force: String(force) });
    await api(`/endpoints/${environmentId}/docker/images/${imageId}?${params}`, { method: "DELETE" });
    return { content: [{ type: "text", text: `Image ${imageId} deleted successfully` }] };
  }
);

server.tool(
  "recreate_container",
  "Recreate a container with an updated image (stops old container, pulls new image, starts new container)",
  {
    environmentId: z.number().describe("Portainer environment ID"),
    containerId: z.string().describe("Container ID or name"),
    image: z.string().describe("New image to use (e.g., 'nginx:latest')"),
  },
  async ({ environmentId, containerId, image }) => {
    try {
      // Step 1: Get the current container configuration
      const container = await api(`/endpoints/${environmentId}/docker/containers/${containerId}/json`);
      const oldImageId = container.Image;
      
      // Step 2: Stop the container
      await api(`/endpoints/${environmentId}/docker/containers/${containerId}/stop`, { method: "POST" });
      
      // Step 3: Remove the old container
      await api(`/endpoints/${environmentId}/docker/containers/${containerId}?force=true`, { method: "DELETE" });
      
      // Step 4: Create new container with same configuration
      const createConfig = {
        Image: image,
        Hostname: container.Config.Hostname,
        Domainname: container.Config.Domainname,
        User: container.Config.User,
        AttachStdin: container.Config.AttachStdin,
        AttachStdout: container.Config.AttachStdout,
        AttachStderr: container.Config.AttachStderr,
        Tty: container.Config.Tty,
        OpenStdin: container.Config.OpenStdin,
        StdinOnce: container.Config.StdinOnce,
        Env: container.Config.Env,
        Cmd: container.Config.Cmd,
        Entrypoint: container.Config.Entrypoint,
        Labels: container.Config.Labels,
        Volumes: container.Config.Volumes,
        WorkingDir: container.Config.WorkingDir,
        NetworkMode: container.HostConfig.NetworkMode,
        Ports: container.HostConfig.PortBindings,
        CapAdd: container.HostConfig.CapAdd,
        CapDrop: container.HostConfig.CapDrop,
        RestartPolicy: container.HostConfig.RestartPolicy,
        VolumesFrom: container.HostConfig.VolumesFrom,
        Mounts: container.Mounts,
      };
      
      const createResp = await api(`/endpoints/${environmentId}/docker/containers/create?name=${container.Name.replace(/^\//, '')}`, {
        method: "POST",
        body: JSON.stringify(createConfig),
      });
      
      const newContainerId = createResp.Id;
      
      // Step 5: Pull the new image before starting the container
      const params = new URLSearchParams({ fromImage: image });
      await api(`/endpoints/${environmentId}/docker/images/create?${params}`, { method: "POST" });
      
      // Step 6: Start the new container
      try {
        await api(`/endpoints/${environmentId}/docker/containers/${newContainerId}/start`, { method: "POST" });
      } catch (startError) {
        return { content: [{ type: "text", text: `Error starting container: ${startError.message}` }] };
      }
      
      // Step 7: Get the image hash from the running container
      const runningContainer = await api(`/endpoints/${environmentId}/docker/containers/${newContainerId}/json`);
      const imageHash = runningContainer.Image;
      
      return {
        content: [
          {
            type: "text",
            text: `Container recreated successfully!\nOld image: ${oldImageId}\nNew image: ${image}\nNew container ID: ${newContainerId.slice(0, 12)}\nImage hash: ${imageHash}`,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error recreating container: ${error.message}` }] };
    }
  }
);

// ── Stacks ────────────────────────────────────────────────────────────────────

server.tool("list_stacks", "List all stacks in Portainer", {}, async () => {
  const stacks = await api("/stacks");
  const text = stacks.map((s) =>
    `ID: ${s.Id} | Name: ${s.Name} | Status: ${s.Status === 1 ? "active" : "inactive"} | Env: ${s.EndpointId}`
  ).join("\n");
  return { content: [{ type: "text", text: text || "No stacks found" }] };
});

server.tool(
  "inspect_stack",
  "Get details of a specific stack",
  { stackId: z.number().describe("Stack ID") },
  async ({ stackId }) => {
    const stack = await api(`/stacks/${stackId}`);
    return { content: [{ type: "text", text: JSON.stringify(stack, null, 2) }] };
  }
);

server.tool(
  "get_stack_file",
  "Get the docker-compose file content of a stack",
  { stackId: z.number().describe("Stack ID") },
  async ({ stackId }) => {
    const data = await api(`/stacks/${stackId}/file`);
    return { content: [{ type: "text", text: data.StackFileContent || JSON.stringify(data) }] };
  }
);

// ── Images ────────────────────────────────────────────────────────────────────

server.tool(
  "list_images",
  "List Docker images in an environment",
  { environmentId: z.number().describe("Portainer environment ID") },
  async ({ environmentId }) => {
    const images = await api(`/endpoints/${environmentId}/docker/images/json`);
    const text = images.map((img) =>
      `ID: ${img.Id.slice(7, 19)} | Tags: ${(img.RepoTags || ["<none>"]).join(", ")} | Size: ${(img.Size / 1024 / 1024).toFixed(1)}MB`
    ).join("\n");
    return { content: [{ type: "text", text: text || "No images found" }] };
  }
);

// ── Networks ──────────────────────────────────────────────────────────────────

server.tool(
  "list_networks",
  "List Docker networks in an environment",
  { environmentId: z.number().describe("Portainer environment ID") },
  async ({ environmentId }) => {
    const networks = await api(`/endpoints/${environmentId}/docker/networks`);
    const items = Array.isArray(networks) ? networks : Object.values(networks);
    const text = items.map((n) =>
      `ID: ${n.Id.slice(0, 12)} | Name: ${n.Name} | Driver: ${n.Driver} | Scope: ${n.Scope}`
    ).join("\n");
    return { content: [{ type: "text", text: text || "No networks found" }] };
  }
);

// ── Volumes ───────────────────────────────────────────────────────────────────

server.tool(
  "list_volumes",
  "List Docker volumes in an environment",
  { environmentId: z.number().describe("Portainer environment ID") },
  async ({ environmentId }) => {
    const data = await api(`/endpoints/${environmentId}/docker/volumes`);
    const vols = data.Volumes || [];
    const text = vols.map((v) =>
      `Name: ${v.Name} | Driver: ${v.Driver} | Mountpoint: ${v.Mountpoint}`
    ).join("\n");
    return { content: [{ type: "text", text: text || "No volumes found" }] };
  }
);

// ── Image Management (Unused Images) ──────────────────────────────────────────

server.tool(
  "portainer_list_unused_images",
  "List Docker images not used by any container (dangling images)",
  { environmentId: z.number().describe("Portainer environment ID") },
  async ({ environmentId }) => {
    try {
      const [containers, allImages] = await Promise.all([
        api(`/endpoints/${environmentId}/docker/containers/json?all=1`),
        api(`/endpoints/${environmentId}/docker/images/json?all=1`)
      ]);

      // Get all image IDs used by containers
      const usedImageIds = new Set();
      containers.forEach((container) => {
        if (container.ImageID) {
          usedImageIds.add(container.ImageID);
        }
      });

      // Filter images that are not used by any container and have no tags
      const unusedImages = allImages.filter((img) => {
        const isUsed = usedImageIds.has(img.Id);
        const hasRepoTags = img.RepoTags && img.RepoTags.length > 0 && !img.RepoTags.includes("<none>");
        return !isUsed && (!hasRepoTags || img.RepoTags.every(tag => tag === "<none>"));
      });

      const text = unusedImages.map((img) =>
        `ID: ${img.Id.slice(7, 19)} | Tags: ${(img.RepoTags || ["<none>"]).join(", ")} | Size: ${(img.Size / 1024 / 1024).toFixed(1)}MB | Dangling: ${!img.RepoTags || img.RepoTags.every(tag => tag === "<none>")}`
      ).join("\n");

      return { content: [{ type: "text", text: text || "No unused images found" }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error listing unused images: ${error.message}` }] };
    }
  }
);

server.tool(
  "portainer_cleanup_unused_images",
  "Delete all unused Docker images with optional force flag",
  {
    environmentId: z.number().describe("Portainer environment ID"),
    force: z.boolean().optional().describe("Force delete even if image is in use (default: false)"),
  },
  async ({ environmentId, force = false }) => {
    try {
      const [containers, allImages] = await Promise.all([
        api(`/endpoints/${environmentId}/docker/containers/json?all=1`),
        api(`/endpoints/${environmentId}/docker/images/json?all=1`)
      ]);

      // Get all image IDs used by containers
      const usedImageIds = new Set();
      containers.forEach((container) => {
        if (container.ImageID) {
          usedImageIds.add(container.ImageID);
        }
      });

      // Filter images that are not used by any container and have no tags
      const unusedImages = allImages.filter((img) => {
        const isUsed = usedImageIds.has(img.Id);
        const hasRepoTags = img.RepoTags && img.RepoTags.length > 0 && !img.RepoTags.includes("<none>");
        return !isUsed && (!hasRepoTags || img.RepoTags.every(tag => tag === "<none>"));
      });

      if (unusedImages.length === 0) {
        return { content: [{ type: "text", text: "No unused images found to delete" }] };
      }

      const deleted = [];
      const failed = [];

      for (const img of unusedImages) {
        try {
          const imageId = img.Id;
          const params = new URLSearchParams({ force: String(force) });
          await api(`/endpoints/${environmentId}/docker/images/${imageId}?${params}`, { method: "DELETE" });
          deleted.push({
            id: img.Id.slice(7, 19),
            tags: img.RepoTags || ["<none>"],
            size: `${(img.Size / 1024 / 1024).toFixed(1)}MB`,
          });
        } catch (error) {
          failed.push({
            id: img.Id.slice(7, 19),
            error: error.message,
          });
        }
      }

      let resultText = `Cleanup completed. Deleted ${deleted.length} image(s)`;
      if (deleted.length > 0) {
        resultText += ":\n" + deleted.map(img => `  - ${img.tags.join(", ")} (${img.size})`).join("\n");
      }
      if (failed.length > 0) {
        resultText += `\n\nFailed to delete ${failed.length} image(s):\n` + failed.map(img => `  - ${img.id}: ${img.error}`).join("\n");
      }

      return { content: [{ type: "text", text: resultText }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error cleaning up images: ${error.message}` }] };
    }
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
