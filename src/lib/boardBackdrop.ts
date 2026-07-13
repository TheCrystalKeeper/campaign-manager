/// <summary>
/// Board backdrop helpers (Phase 8): the tabletop AROUND the scene's map.
/// - deriveBoardColor: a very dark tone based on the map image's average color —
///   computed by downsampling the whole image into a 4×4 canvas (16 pixels to
///   average, one drawImage: effectively free) and crushing the lightness.
/// (The backdrop IMAGE is blurred at render time with a real CSS/GPU filter on a
/// static, screen-fixed layer — see MapCanvas — so no pre-blur pass is needed here.)
/// Results are cached per input, so scene switches and re-renders are instant.
/// </summary>

export const DEFAULT_BOARD_BG = "#191712";

const colorCache = new Map<string, Promise<string>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Uploads are same-origin (R2 via our functions); anonymous keeps external
    // URLs from tainting the canvas where their CORS headers allow it.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** Average the map's color and return a near-black version of it (the "table"). */
export function deriveBoardColor(mapUrl: string | null): Promise<string> {
  if (!mapUrl) {
    return Promise.resolve(DEFAULT_BOARD_BG);
  }
  let cached = colorCache.get(mapUrl);
  if (!cached) {
    cached = loadImage(mapUrl)
      .then((img) => {
        const canvas = document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          return DEFAULT_BOARD_BG;
        }
        ctx.drawImage(img, 0, 0, 4, 4);
        const data = ctx.getImageData(0, 0, 4, 4).data;
        let r = 0;
        let g = 0;
        let b = 0;
        const count = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        // Keep the hue, crush the lightness: the backdrop should read as a dark
        // table the map sits on, never compete with the map itself.
        const dark = (sum: number) => Math.max(7, Math.min(46, Math.round((sum / count) * 0.24)));
        return `rgb(${dark(r)}, ${dark(g)}, ${dark(b)})`;
      })
      .catch(() => DEFAULT_BOARD_BG); // cross-origin taint / broken URL → dark default
    colorCache.set(mapUrl, cached);
  }
  return cached;
}
