import { serveStoredImageOrNext } from "../_shared/imageUpload";

/// <summary>
/// Serves uploaded map layer images from R2, falling back to bundled static maps.
/// </summary>
export const onRequestGet: PagesFunction = async (context) => {
  const filename = context.params.filename;
  if (!filename || Array.isArray(filename)) {
    return context.next();
  }
  return serveStoredImageOrNext(context, "maps", filename);
};
