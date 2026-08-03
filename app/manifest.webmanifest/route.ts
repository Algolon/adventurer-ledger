import { createManifest } from "@/src/pwa/manifest";

export const dynamic = "force-static";

export function GET() {
  return Response.json(createManifest(), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
