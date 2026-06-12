import sharp from "sharp";

export function heatmapColor(count, maxCell) {
    const t = maxCell > 0 ? Math.log1p(count) / Math.log1p(maxCell) : 0;
    return [
        Math.round(255 * Math.min(1, t * 1.4)),
        Math.round(255 * Math.min(1, t * 0.9)),
        Math.round(255 * Math.min(1, 0.3 + t * 0.4)),
    ];
}

export function createHeatmapPixels(data, {
    outputWidth = data.width,
    outputHeight = data.height,
    offsetX = 0,
    offsetY = 0,
    background = [0, 0, 0],
    heatmapBackground = background,
} = {}) {
    const pixels = Buffer.alloc(outputWidth * outputHeight * 3);

    for (let offset = 0; offset < pixels.length; offset += 3) {
        pixels[offset] = background[0];
        pixels[offset + 1] = background[1];
        pixels[offset + 2] = background[2];
    }

    for (let y = offsetY; y < offsetY + data.height; y++) {
        for (let x = offsetX; x < offsetX + data.width; x++) {
            const offset = (y * outputWidth + x) * 3;
            pixels[offset] = heatmapBackground[0];
            pixels[offset + 1] = heatmapBackground[1];
            pixels[offset + 2] = heatmapBackground[2];
        }
    }

    for (let i = 0; i < data.xs.length; i++) {
        const x = offsetX + data.xs[i];
        const y = offsetY + data.ys[i];
        if (x < 0 || x >= outputWidth || y < 0 || y >= outputHeight) continue;

        const offset = (y * outputWidth + x) * 3;
        const [red, green, blue] = heatmapColor(data.ns[i], data.maxCell);
        pixels[offset] = red;
        pixels[offset + 1] = green;
        pixels[offset + 2] = blue;
    }

    return pixels;
}

export function rawImage(pixels, width, height) {
    return sharp(pixels, {
        raw: {
            width,
            height,
            channels: 3,
        },
    });
}

export function escapeXml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
