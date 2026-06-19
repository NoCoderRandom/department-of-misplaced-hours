import { mkdir, readdir, stat } from "node:fs/promises";
import { join, parse } from "node:path";
import sharp from "sharp";

const sourceDir = process.env.IMAGE_SOURCE_DIR ?? "release_backups/source_png_before_webp_20260618";
const outputDir = process.env.IMAGE_OUTPUT_DIR ?? "public/assets/images";
const width = Number(process.env.IMAGE_WIDTH ?? 1200);
const height = Number(process.env.IMAGE_HEIGHT ?? 800);
const quality = Number(process.env.IMAGE_QUALITY ?? 82);

await mkdir(outputDir, { recursive: true });

const files = (await readdir(sourceDir)).filter((file) => file.toLowerCase().endsWith(".png"));
if (files.length === 0) {
  throw new Error(`No PNG files found in ${sourceDir}`);
}

for (const file of files) {
  const input = join(sourceDir, file);
  const output = join(outputDir, `${parse(file).name}.webp`);
  await sharp(input)
    .resize(width, height, { fit: "cover" })
    .webp({ quality, effort: 6 })
    .toFile(output);

  const before = (await stat(input)).size;
  const after = (await stat(output)).size;
  console.log(`${file} -> ${parse(file).name}.webp ${(before / 1024).toFixed(1)} KiB -> ${(after / 1024).toFixed(1)} KiB`);
}
