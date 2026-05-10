#!/usr/bin/env node
/**
 * Test script for public API endpoints
 * Usage: node test-public-api.mjs [command] [options]
 */

const API_URL = process.env.API_URL || "http://localhost:3000";
const ENV_ID = process.env.ENVIRONMENT_ID || "1";

async function testListImages() {
  console.log(`\n📦 Testing GET /api/images?environmentId=${ENV_ID}`);
  try {
    const res = await fetch(`${API_URL}/api/images?environmentId=${ENV_ID}`);
    const data = await res.json();
    console.log(`✓ Success (${res.status})`);
    console.log(`  Found ${data.count} images:`);
    data.images.slice(0, 3).forEach((img) => {
      console.log(`    - ${img.tags.join(", ")} (${img.size})`);
    });
    if (data.images.length > 3) {
      console.log(`    ... and ${data.images.length - 3} more`);
    }
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
  }
}

async function testListUnusedImages() {
  console.log(`\n🗑️  Testing GET /api/images/unused?environmentId=${ENV_ID}`);
  try {
    const res = await fetch(`${API_URL}/api/images/unused?environmentId=${ENV_ID}`);
    const data = await res.json();
    console.log(`✓ Success (${res.status})`);
    console.log(`  Found ${data.count} unused images:`);
    data.unusedImages.slice(0, 3).forEach((img) => {
      console.log(`    - ${img.tags.join(", ")} (${img.size}, dangling: ${img.dangling})`);
    });
    if (data.unusedImages.length > 3) {
      console.log(`    ... and ${data.unusedImages.length - 3} more`);
    }
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
  }
}

async function testCleanup() {
  console.log(`\n🧹 Testing POST /api/images/cleanup?environmentId=${ENV_ID}`);
  try {
    const res = await fetch(`${API_URL}/api/images/cleanup?environmentId=${ENV_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    console.log(`✓ Success (${res.status})`);
    console.log(`  ${data.message}`);
    console.log(`  Deleted: ${data.deletedCount} images`);
    if (data.deletedCount > 0) {
      console.log("  Removed:");
      data.deleted.forEach((img) => {
        console.log(`    - ${img.tags.join(", ")} (${img.size})`);
      });
    }
    if (data.failedCount > 0) {
      console.log("  Failed:");
      data.failed.forEach((img) => {
        console.log(`    - ${img.id}: ${img.error}`);
      });
    }
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
  }
}

async function main() {
  const command = process.argv[2] || "all";

  console.log(`🚀 Public API Tests\nAPI URL: ${API_URL}\nEnvironment ID: ${ENV_ID}\n`);

  if (command === "all" || command === "list") await testListImages();
  if (command === "all" || command === "unused") await testListUnusedImages();
  if (command === "all" || command === "cleanup") await testCleanup();

  console.log("\n✅ Tests completed\n");
}

main();
