import { serveStoredImageOrNext } from "../_shared/imageUpload";

/// <summary>
/// Serves uploaded map token images from R2.
/// </summary>
export const onRequestGet: PagesFunction = async (context) => {
  const filename = context.params.filename;
  if (!filename || Array.isArray(filename)) {
    return context.next();
  }
  return serveStoredImageOrNext(context, "tokens", filename);
};
