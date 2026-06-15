export type FogBrushMode = "reveal" | "hide";

const FOG_COLOR = "#000000";

/// <summary>
/// Fills the entire fog canvas with opaque black (unexplored area).
/// </summary>
export function fillFog(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = FOG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/// <summary>
/// Loads fog mask pixels from a data URL or initializes a fully fogged canvas.
/// </summary>
export function loadFogCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dataUrl: string | null,
): Promise<void> {
  canvas.width = width;
  canvas.height = height;

  if (!dataUrl) {
    fillFog(canvas);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve();
        return;
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve();
    };
    img.onerror = () => {
      fillFog(canvas);
      resolve();
    };
    img.src = dataUrl;
  });
}

/// <summary>
/// Paints a circular reveal (erase fog) or hide (add fog) brush stroke on the mask.
/// </summary>
export function paintFogBrush(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  mode: FogBrushMode,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);

  if (mode === "reveal") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = FOG_COLOR;
  }

  ctx.fill();
  ctx.restore();
}

/// <summary>
/// Serializes the fog canvas to a PNG data URL for sync and rendering.
/// </summary>
export function fogCanvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}
