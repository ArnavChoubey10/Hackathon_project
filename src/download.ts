/* Bundles the full project source (embedded at build time via Vite raw
   imports — always in sync with what you're running) into campuscore-erp.zip. */
import JSZip from "jszip";

const SOURCES = import.meta.glob(
  [
    "/index.html",
    "/package.json",
    "/tsconfig.json",
    "/vite.config.js",
    "/README.md",
    "/.gitignore",
    "/src/**/*.{ts,tsx,css}",
  ],
  { eager: true, query: "?raw", import: "default" },
);

export function projectFileCount(): number {
  return Object.keys(SOURCES).length;
}

export async function downloadProjectZip(): Promise<number> {
  const zip = new JSZip();
  const root = zip.folder("campuscore-erp")!;
  for (const [path, content] of Object.entries(SOURCES)) {
    root.file(path.replace(/^\//, ""), String(content));
  }
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "campuscore-erp.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return Object.keys(SOURCES).length;
}
