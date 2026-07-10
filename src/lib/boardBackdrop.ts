/// <summary>
/// Board backdrop helpers (Phase 8): the tabletop AROUND the scene's map.
/// - deriveBoardColor: a very dark tone based on the map image's average color —
///   computed by downsampling the whole image into a 4×4 canvas (16 pixels to
///   average, one drawImage: effectively free) and crushing the lightness.
/// - blurredBackdropUrl: pre-blurs a backdrop image by progressive downscaling
///   (each halving is a cheap box filter; CSS upscaling smooths the rest), so
///   the live page renders a plain stretched image with NO runtime CSS filter —
///   zero per-frame GPU blur cost, regardless of blur strength.
/// Results are cached per input, so scene switches and re-renders are instant.
/// </summary>

export const DEFAULT_BOARD_BG = "#191712";

const colorCache = new Map<string, Promise<string>>();
const blurCache = new Map<string, Promise<string>>();

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

/**
 * Pre-blur a backdrop image. `blur` is 0–30 (≈ the Gaussian radius it emulates):
 * the image is progressively halved down to ~1/blur scale, then the browser's
 * bilinear upscale of the small bitmap does the smoothing. Returns a data URL
 * (or the original URL for blur 0 / on any failure).
 */
export function blurredBackdropUrl(url: string, blur: number): Promise<string> {
  const strength = Math.max(0, Math.min(30, Math.round(blur)));
  if (strength <= 0) {
    return Promise.resolve(url);
  }
  const key = `${url}|${strength}`;
  let cached = blurCache.get(key);
  if (!cached) {
    cached = loadImage(url)
      .then((img) => {
        // Cap the working size so huge uploads cost the same as small ones.
        const maxSide = Math.max(img.naturalWidth, img.naturalHeight, 1);
        const startScale = Math.min(1, 1024 / maxSide);
        let w = Math.max(2, Math.round(img.naturalWidth * startScale));
        let h = Math.max(2, Math.round(img.naturalHeight * startScale));
        let source: HTMLImageElement | HTMLCanvasElement = img;
        const targetW = Math.max(16, Math.round(w / strength));
        // Progressive halving (each step is a clean 2× box filter).
        while (w / 2 >= targetW) {
          w = Math.max(targetW, Math.round(w / 2));
          h = Math.max(2, Math.round(h / 2));
          const step = document.createElement("canvas");
          step.width = w;
          step.height = h;
          const ctx = step.getContext("2d");
          if (!ctx) {
            return url;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(source, 0, 0, w, h);
          source = step;
        }
        if (source === img) {
          // No halving happened (tiny image / low blur): still normalize through
          // one draw so the data URL below has a canvas to read.
          const step = document.createElement("canvas");
          step.width = w;
          step.height = h;
          const ctx = step.getContext("2d");
          if (!ctx) {
            return url;
          }
          ctx.drawImage(img, 0, 0, w, h);
          source = step;
        }
        return (source as HTMLCanvasElement).toDataURL("image/jpeg", 0.75);
      })
      .catch(() => url); // taint/failure → show it unblurred rather than not at all
    blurCache.set(key, cached);
  }
  return cached;
}
